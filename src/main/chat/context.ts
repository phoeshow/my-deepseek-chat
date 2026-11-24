import type { ChatMessage, ReasoningEffort } from '../../shared/types'

/**
 * ContextBuilder（docs/02 §5）：把会话主线拼成 API 的 messages[]。
 *
 * 两条容易出错的规则集中在这里，别散到调用方：
 *
 * 1. reasoning_content 回传规则
 *    - 请求体带 tools → 每条历史 assistant 必须回传 reasoning_content，否则 API 返回 400
 *    - 请求体不带 tools → 回传了也会被忽略，所以干脆不发，省 token
 *    v1 不实现 tools，因此 hasTools 恒为 false；参数位保留是为了将来加工具调用时只改这一处。
 *
 * 2. 空内容消息过滤
 *    仍在 streaming / error 状态的 assistant 消息不能进上下文，否则会把半截回答当成历史。
 */

export interface BuildChatBodyInput {
  thread: ChatMessage[]
  model: string
  systemPrompt?: string | null
  temperature?: number
  maxTokens?: number
  thinking: boolean
  effort: ReasoningEffort
  hasTools?: boolean
}

export function buildChatBody(input: BuildChatBodyInput): Record<string, unknown> {
  const hasTools = input.hasTools ?? false
  const messages: ApiMessage[] = []

  if (input.systemPrompt?.trim()) {
    messages.push({ role: 'system', content: input.systemPrompt.trim() })
  }

  for (const message of input.thread) {
    if (message.role === 'assistant') {
      if (message.status !== 'complete' && message.status !== 'aborted') continue
      if (!message.content.trim()) continue
      const apiMessage: ApiMessage = { role: 'assistant', content: message.content }
      if (hasTools && message.reasoning) apiMessage.reasoning_content = message.reasoning
      messages.push(apiMessage)
      continue
    }

    if (message.role === 'user') {
      if (!message.content.trim()) continue
      messages.push({ role: 'user', content: message.content })
    }
  }

  const body: Record<string, unknown> = {
    model: input.model,
    messages,
    stream: true,
    // 不声明它就拿不到 usage，预算条与费用统计会全部归零
    stream_options: { include_usage: true }
  }

  if (input.thinking) {
    body.thinking = { type: 'enabled' }
    body.reasoning_effort = input.effort
  } else {
    body.thinking = { type: 'disabled' }
  }

  if (typeof input.temperature === 'number') body.temperature = input.temperature
  if (typeof input.maxTokens === 'number' && input.maxTokens > 0) body.max_tokens = input.maxTokens

  return body
}

interface ApiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  reasoning_content?: string
}
