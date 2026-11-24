import { randomUUID } from 'node:crypto'
import type { ChatFrame, ReasoningEffort, SendParams, TokenUsage } from '@shared/types'
import { insertUsage } from '../db/repo/usage'
import * as messages from '../db/repo/message'
import * as sessions from '../db/repo/session'
import { logger } from '../logger'
import { getKey } from '../services/secret'
import { getModels } from '../services/models'
import { getConfig } from '../services/settings'
import { streamChatCompletion } from './client'
import { buildChatBody } from './context'
import { ChatError, isAbortError } from './errors'

/**
 * 请求生命周期（docs/02 §6）。
 *
 * 关键约束：
 * - 同一会话不允许并发请求（UI 置灰之外，这里再挡一次）
 * - 先插入空的 assistant 消息再开始流式，崩溃时至少知道"曾经有过这一轮"
 * - 无论成功/中止/失败，都必须走完终态落库，否则会留下 streaming 孤儿
 */

const FIRST_TOKEN_TIMEOUT_MS = 30_000

export interface SendResult {
  requestId: string
  userMessageId: string
  assistantMessageId: string
}

interface RunContext {
  requestId: string
  sessionId: string
  assistantMessageId: string
  controller: AbortController
  abortedByUser: boolean
  timedOut: boolean
}

type FrameSink = (frame: ChatFrame) => void

let sink: FrameSink = () => undefined
const runs = new Map<string, RunContext>()
const activeBySession = new Map<string, string>()

export function setFrameSink(next: FrameSink): void {
  sink = next
}

export function activeRunCount(): number {
  return runs.size
}

export async function send(params: SendParams): Promise<SendResult> {
  const session = sessions.mustGetSession(params.sessionId)
  const text = params.text.trim()
  if (!text) throw new ChatError('VALIDATION', '消息不能为空')

  ensureNotBusy(session.id)
  const apiKey = await requireKey()
  const modelId = resolveModelId(session.modelId)

  // 父节点：显式传入优先，否则接在当前主线末端
  const parentId = params.parentId ?? session.activeLeafId

  const userMessage = messages.insertMessage({
    sessionId: session.id,
    parentId,
    role: 'user',
    content: text
  })

  // 首轮用首句截断做标题（模型生成的标题在 M2 补），否则左栏全是"新对话"
  if (session.title === '新对话' && !parentId) {
    sessions.renameSession(session.id, text.replace(/\s+/g, ' ').slice(0, 20))
  }

  const assistantMessage = messages.insertMessage({
    sessionId: session.id,
    parentId: userMessage.id,
    role: 'assistant',
    status: 'streaming',
    modelId
  })

  const requestId = randomUUID()
  const thinking = resolveThinking(session.thinking, params.overrides?.thinking)
  const effort = resolveEffort(session.effort, params.overrides?.effort)

  startRun({
    requestId,
    sessionId: session.id,
    parentId: userMessage.id,
    assistantMessageId: assistantMessage.id,
    modelId,
    apiKey,
    thinking,
    effort,
    temperature: params.overrides?.temperature,
    maxTokens: params.overrides?.maxTokens,
    systemPrompt: null
  })

  return { requestId, userMessageId: userMessage.id, assistantMessageId: assistantMessage.id }
}

/** 重新生成：在同一个 parent 下再挂一个 assistant 兄弟节点，旧回答保留 */
export async function regenerate(assistantMessageId: string): Promise<{
  requestId: string
  assistantMessageId: string
}> {
  const previous = messages.getMessage(assistantMessageId)
  if (!previous) throw new ChatError('VALIDATION', '要重新生成的消息不存在')
  if (previous.role !== 'assistant') throw new ChatError('VALIDATION', '只能重新生成助手消息')
  if (!previous.parentId) throw new ChatError('VALIDATION', '该消息没有可复用的上下文')

  const session = sessions.mustGetSession(previous.sessionId)
  ensureNotBusy(session.id)
  const apiKey = await requireKey()
  const modelId = previous.modelId ?? resolveModelId(session.modelId)

  const next = messages.insertMessage({
    sessionId: session.id,
    parentId: previous.parentId,
    role: 'assistant',
    status: 'streaming',
    modelId
  })

  const requestId = randomUUID()
  startRun({
    requestId,
    sessionId: session.id,
    parentId: previous.parentId,
    assistantMessageId: next.id,
    modelId,
    apiKey,
    thinking: resolveThinking(session.thinking, undefined),
    effort: resolveEffort(session.effort, undefined),
    temperature: undefined,
    maxTokens: undefined,
    systemPrompt: null
  })

  return { requestId, assistantMessageId: next.id }
}

export function abort(requestId: string): boolean {
  const run = runs.get(requestId)
  if (!run) return false
  run.abortedByUser = true
  run.controller.abort()
  return true
}

interface RunInput {
  requestId: string
  sessionId: string
  parentId: string
  assistantMessageId: string
  modelId: string
  apiKey: string
  thinking: boolean
  effort: ReasoningEffort
  temperature?: number | undefined
  maxTokens?: number | undefined
  systemPrompt: string | null
}

function startRun(input: RunInput): void {
  const run: RunContext = {
    requestId: input.requestId,
    sessionId: input.sessionId,
    assistantMessageId: input.assistantMessageId,
    controller: new AbortController(),
    abortedByUser: false,
    timedOut: false
  }

  runs.set(input.requestId, run)
  activeBySession.set(input.sessionId, input.requestId)

  // 不 await：IPC 要立刻返回请求 id，让 UI 先渲染出流式占位
  void executeRun(run, input).catch((err: unknown) => {
    logger.error('[chat] run crashed outside handler', err)
  })
}

async function executeRun(run: RunContext, input: RunInput): Promise<void> {
  const startedAt = Date.now()
  let content = ''
  let reasoning = ''
  let usage: TokenUsage | undefined
  let finishReason: string | null = null
  let firstTokenAt: number | null = null

  emit({ requestId: run.requestId, type: 'start', assistantMessageId: run.assistantMessageId, startedAt })

  const firstTokenTimer = setTimeout(() => {
    run.timedOut = true
    run.controller.abort()
  }, FIRST_TOKEN_TIMEOUT_MS)

  try {
    const thread = messages.getThread(input.sessionId, input.parentId)
    const body = buildChatBody({
      thread,
      model: input.modelId,
      systemPrompt: input.systemPrompt,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      thinking: input.thinking,
      effort: input.effort
    })

    const stream = streamChatCompletion({
      baseUrl: getConfig().baseUrl,
      apiKey: input.apiKey,
      body,
      signal: run.controller.signal
    })

    for await (const event of stream) {
      if (firstTokenAt === null) {
        firstTokenAt = Date.now()
        clearTimeout(firstTokenTimer)
      }

      switch (event.type) {
        case 'thinking':
          reasoning += event.delta
          emit({ requestId: run.requestId, type: 'think', delta: event.delta })
          break
        case 'text':
          content += event.delta
          emit({ requestId: run.requestId, type: 'text', delta: event.delta })
          break
        case 'usage':
          usage = event.usage
          emit({ requestId: run.requestId, type: 'usage', usage: event.usage })
          break
        case 'finish':
          finishReason = event.reason
          break
      }
    }

    const finalUsage = finalizeUsage(usage, firstTokenAt, startedAt)
    const reason = finishReason === 'length' ? 'length' : 'stop'

    persist(run, { content, reasoning, status: 'complete', finishReason, usage: finalUsage })
    emit({
      requestId: run.requestId,
      type: 'end',
      reason,
      ...(finalUsage ? { usage: finalUsage } : {}),
      endedAt: Date.now()
    })
  } catch (err) {
    const finalUsage = finalizeUsage(usage, firstTokenAt, startedAt)

    if (isAbortError(err)) {
      if (run.timedOut) {
        persist(run, { content, reasoning, status: 'error', finishReason: null, usage: finalUsage,
          error: { code: 'FIRST_TOKEN_TIMEOUT', message: '30 秒内没有收到任何响应，已中止' } })
        emit({
          requestId: run.requestId,
          type: 'error',
          code: 'FIRST_TOKEN_TIMEOUT',
          message: '30 秒内没有收到任何响应，已中止',
          retryable: false
        })
      } else {
        // 用户主动停止：已收到的内容必须保留，标记 aborted 而不是 error
        persist(run, { content, reasoning, status: 'aborted', finishReason: 'aborted', usage: finalUsage })
        emit({ requestId: run.requestId, type: 'end', reason: 'aborted', endedAt: Date.now() })
      }
      return
    }

    const error = toChatError(err, content.length > 0)
    logger.error(`[chat] ${error.code}`, error.message)
    persist(run, { content, reasoning, status: 'error', finishReason: null, usage: finalUsage,
      error: { code: error.code, message: error.message } })
    emit({
      requestId: run.requestId,
      type: 'error',
      code: error.code,
      message: error.message,
      retryable: error.retryable
    })
  } finally {
    clearTimeout(firstTokenTimer)
    runs.delete(run.requestId)
    if (activeBySession.get(input.sessionId) === run.requestId) {
      activeBySession.delete(input.sessionId)
    }
  }
}

function persist(
  run: RunContext,
  patch: {
    content: string
    reasoning: string
    status: 'complete' | 'aborted' | 'error'
    finishReason: string | null
    usage: TokenUsage | undefined
    error?: { code: ChatError['code']; message: string }
  }
): void {
  messages.updateMessage(run.assistantMessageId, {
    content: patch.content,
    reasoning: patch.reasoning || null,
    status: patch.status,
    finishReason: patch.finishReason,
    tokens: patch.usage ?? null,
    error: patch.error ?? null
  })

  if (patch.usage) {
    const session = sessions.getSession(run.sessionId)
    const modelId = session?.modelId ?? 'unknown'
    insertUsage({
      sessionId: run.sessionId,
      messageId: run.assistantMessageId,
      modelId,
      usage: patch.usage
    })
  }

  // 只有成功与"用户主动停止"才推进主线游标：失败的半截回答不应成为后续上下文
  if (patch.status === 'complete' || patch.status === 'aborted') {
    sessions.setActiveLeaf(run.sessionId, run.assistantMessageId)
  }
}

function finalizeUsage(
  usage: TokenUsage | undefined,
  firstTokenAt: number | null,
  startedAt: number
): TokenUsage | undefined {
  const endedAt = Date.now()
  const base: TokenUsage = usage ?? { prompt: 0, completion: 0 }
  // 没有任何 usage 且一个字都没收到：不记录这条空统计
  if (!usage && firstTokenAt === null) return undefined
  return {
    ...base,
    ...(firstTokenAt !== null ? { firstTokenMs: firstTokenAt - startedAt } : {}),
    durationMs: endedAt - startedAt
  }
}

function toChatError(err: unknown, hasPartialContent: boolean): ChatError {
  if (err instanceof ChatError) {
    // 流已经吐了一半才断：归为可重试的流中断，而不是服务端错误
    if (hasPartialContent && (err.code === 'NETWORK' || err.code === 'SERVER_ERROR')) {
      return new ChatError('STREAM_INTERRUPTED', err.message, true)
    }
    return err
  }
  const message = err instanceof Error ? err.message : String(err)
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket/i.test(message)) {
    return new ChatError('NETWORK', `网络错误：${message}`, true)
  }
  return new ChatError('UNKNOWN', message)
}

function emit(frame: ChatFrame): void {
  try {
    sink(frame)
  } catch (err) {
    logger.warn('[chat] failed to deliver frame', err)
  }
}

function ensureNotBusy(sessionId: string): void {
  if (activeBySession.has(sessionId)) {
    throw new ChatError('VALIDATION', '该会话正在生成中，请先停止')
  }
}

async function requireKey(): Promise<string> {
  const key = await getKey()
  if (!key) throw new ChatError('NO_API_KEY', '尚未配置 API Key')
  return key
}

function resolveModelId(sessionModelId: string | null): string {
  const config = getConfig()
  const candidates = [sessionModelId, config.defaultModelId, getModels()[0]?.id ?? null]
  const found = candidates.find((id): id is string => Boolean(id))
  if (!found) throw new ChatError('VALIDATION', '未选择模型，请先在设置中刷新模型列表')
  return found
}

function resolveThinking(sessionValue: boolean | null, override: boolean | undefined): boolean {
  if (override !== undefined) return override
  if (sessionValue !== null) return sessionValue
  return getConfig().defaultThinking
}

function resolveEffort(
  sessionValue: ReasoningEffort | null,
  override: ReasoningEffort | undefined
): ReasoningEffort {
  return override ?? sessionValue ?? getConfig().defaultEffort
}
