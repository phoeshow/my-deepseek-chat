import type { Result } from '@shared/types'

/**
 * 把 { ok, data } 信封拆成"要么拿到值、要么抛错"。
 * 组件里不写 if (!res.ok) 分支：错误统一走 store 的错误条。
 */
export async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new IpcError(result.code, result.message)
  return result.data
}

export class IpcError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'IpcError'
    this.code = code
  }
}
