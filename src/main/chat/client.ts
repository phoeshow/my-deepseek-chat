import type { TokenUsage } from '../../shared/types'
import { ChatError, fromHttpStatus } from './errors'

/**
 * DeepSeek Chat Completions 流式客户端。
 *
 * 刻意不用 EventSource：它只支持 GET，而 /chat/completions 是 POST（ADR-04）。
 * 也刻意不依赖 Electron / 路径别名，这样可以 `node src/main/chat/client.ts` 直接跑验证。
 */

export type StreamEvent =
  | { type: 'thinking'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: string }

export interface StreamChatOptions {
  baseUrl: string
  apiKey: string
  body: Record<string, unknown>
  signal: AbortSignal
  /** 注入点：测试时可替换，默认用全局 fetch */
  fetchImpl?: typeof fetch
}

export function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

export function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream'
  }
}

export async function* streamChatCompletion(options: StreamChatOptions): AsyncGenerator<StreamEvent> {
  const doFetch = options.fetchImpl ?? fetch

  let response: Response
  try {
    response = await doFetch(buildUrl(options.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: authHeaders(options.apiKey),
      body: JSON.stringify(options.body),
      signal: options.signal
    })
  } catch (err) {
    if (options.signal.aborted) throw err
    throw new ChatError('NETWORK', `无法连接 ${options.baseUrl}：${errText(err)}`, true)
  }

  if (!response.ok) {
    throw fromHttpStatus(response.status, await safeText(response))
  }
  if (!response.body) {
    throw new ChatError('SERVER_ERROR', '响应体为空', false, response.status)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // 按行切分；保留最后一段不完整的数据等待下一个 chunk
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const rawLine = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')

        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
        const event = parseSseLine(line)
        if (event === 'done') return
        if (event) yield event
      }
    }

    // 流结束时缓冲里若还有一行（无结尾换行），补处理
    const tail = parseSseLine(buffer)
    if (tail && tail !== 'done') yield tail
  } finally {
    // 中止或异常时释放底层连接，避免 socket 悬挂
    reader.cancel().catch(() => undefined)
  }
}

/** 解析单行 SSE。返回 'done' 表示收到 [DONE] 结束标记 */
export function parseSseLine(line: string): StreamEvent | 'done' | null {
  if (!line || line.startsWith(':')) return null
  if (!line.startsWith('data:')) return null

  const payload = line.slice(5).trim()
  if (!payload) return null
  if (payload === '[DONE]') return 'done'

  let parsed: DeepSeekChunk
  try {
    parsed = JSON.parse(payload) as DeepSeekChunk
  } catch {
    // 单行 JSON 损坏不应中断整条流：丢弃该行继续
    return null
  }

  // 部分实现会把错误塞进 200 的流里
  if (parsed.error) {
    throw new ChatError('SERVER_ERROR', parsed.error.message ?? '流式响应中返回错误', false)
  }

  const choice = parsed.choices?.[0]
  const delta = choice?.delta

  // 思考内容与正文是并列的两个字段，UI 需要分开渲染
  if (delta?.reasoning_content) {
    return { type: 'thinking', delta: delta.reasoning_content }
  }
  if (delta?.content) {
    return { type: 'text', delta: delta.content }
  }
  if (choice?.finish_reason) {
    return { type: 'finish', reason: choice.finish_reason }
  }
  if (parsed.usage) {
    return { type: 'usage', usage: normalizeUsage(parsed.usage) }
  }
  return null
}

/**
 * usage 字段在不同版本里有三种写法，全部兼容：
 * - DeepSeek 原生: prompt_cache_hit_tokens / prompt_cache_miss_tokens
 * - OpenAI 兼容:   prompt_tokens_details.cached_tokens
 * - 推理模型:      completion_tokens_details.reasoning_tokens
 */
export function normalizeUsage(raw: RawUsage): TokenUsage {
  const prompt = raw.prompt_tokens ?? 0
  const completion = raw.completion_tokens ?? 0
  const cacheHit =
    raw.prompt_cache_hit_tokens ?? raw.prompt_tokens_details?.cached_tokens ?? undefined
  const cacheMiss =
    raw.prompt_cache_miss_tokens ??
    (cacheHit !== undefined ? Math.max(prompt - cacheHit, 0) : undefined)

  return {
    prompt,
    completion,
    reasoning: raw.completion_tokens_details?.reasoning_tokens,
    cacheHit,
    cacheMiss
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface RawUsage {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

interface DeepSeekChunk {
  choices?: {
    delta?: { content?: string | null; reasoning_content?: string | null }
    finish_reason?: string | null
  }[]
  usage?: RawUsage
  error?: { message?: string }
}
