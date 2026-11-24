import type { AppErrorCode } from '../../shared/types'

/**
 * 协议层错误。刻意不依赖 Electron，方便用 Node 直接跑验证脚本。
 *
 * retryable 的判定依据 docs/02 §7：只有限速、网络、流中断值得自动重试；
 * 401/402/400/422 重试多少次都一样，立刻把决定权交给用户。
 */
export class ChatError extends Error {
  readonly code: AppErrorCode
  readonly retryable: boolean
  readonly status: number | null

  constructor(code: AppErrorCode, message: string, retryable = false, status: number | null = null) {
    super(message)
    this.name = 'ChatError'
    this.code = code
    this.retryable = retryable
    this.status = status
  }
}

export function fromHttpStatus(status: number, body: string): ChatError {
  const detail = extractMessage(body)
  switch (status) {
    case 400:
      return new ChatError('BAD_REQUEST', detail ?? '请求参数不合法', false, status)
    case 401:
      return new ChatError('AUTH_INVALID', detail ?? 'API Key 无效或已失效', false, status)
    case 402:
      return new ChatError('INSUFFICIENT_BALANCE', detail ?? '账户余额不足', false, status)
    case 422:
      return new ChatError('VALIDATION', detail ?? '参数校验失败', false, status)
    case 429:
      return new ChatError('RATE_LIMITED', detail ?? '请求被限流', true, status)
    default:
      if (status >= 500) return new ChatError('SERVER_ERROR', detail ?? `服务端错误（${status}）`, false, status)
      return new ChatError('UNKNOWN', detail ?? `请求失败（${status}）`, false, status)
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === 'AbortError') ||
    (typeof err === 'object' && err !== null && 'name' in err && (err as { name: unknown }).name === 'AbortError')
  )
}

/** DeepSeek 的错误体形如 { error: { message, type, code } } */
function extractMessage(body: string): string | null {
  if (!body.trim()) return null
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed === 'object' && parsed !== null) {
      const error = (parsed as { error?: unknown }).error
      if (typeof error === 'object' && error !== null) {
        const message = (error as { message?: unknown }).message
        if (typeof message === 'string' && message.trim()) return message
      }
      const message = (parsed as { message?: unknown }).message
      if (typeof message === 'string' && message.trim()) return message
    }
  } catch {
    // 非 JSON 响应：截断原文当详情，避免把整个 HTML 页面塞进 UI
    return body.slice(0, 300)
  }
  return null
}
