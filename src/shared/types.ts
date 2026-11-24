/**
 * 主进程与渲染层共享的类型。
 * 这里只允许出现类型与纯常量，不允许 import 任何 Node / Electron 模块。
 */

export type ThemeMode = 'system' | 'light' | 'dark'
export type ReasoningEffort = 'low' | 'high' | 'max'

/** 错误码集合，与 docs/02-系统架构.md §7 一一对应 */
export type AppErrorCode =
  | 'AUTH_INVALID'
  | 'INSUFFICIENT_BALANCE'
  | 'BAD_REQUEST'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'NETWORK'
  | 'FIRST_TOKEN_TIMEOUT'
  | 'STREAM_INTERRUPTED'
  | 'NO_API_KEY'
  | 'DB_ERROR'
  | 'UNKNOWN'

export type Ok<T> = { ok: true; data: T }
export type Err = { ok: false; code: AppErrorCode; message: string; detail?: unknown }
export type Result<T> = Ok<T> | Err

export interface WindowState {
  width: number
  height: number
  /** null 表示"未记录过位置"，交由主进程居中 */
  x: number | null
  y: number | null
  maximized: boolean
  sidebarWidth: number
  panelWidth: number
  sidebarCollapsed: boolean
  panelCollapsed: boolean
}

export interface AppConfig {
  version: number
  baseUrl: string
  defaultModelId: string | null
  defaultThinking: boolean
  defaultEffort: ReasoningEffort
  theme: ThemeMode
  autoTitle: boolean
  window: WindowState
}

/**
 * preload 通过 contextBridge 暴露给渲染层的全部能力（window.api）。
 * 这里是白名单的唯一事实来源：新增通道必须同时改这个接口和 ipc/router.ts。
 */
export interface AppApi {
  bootstrap(): Promise<Result<BootstrapInfo>>
}

/** 操作系统密钥链的可用性，由 SecretService 探测（Electron 45 的异步 API） */
export interface EncryptionStatus {
  available: boolean
  /** Linux: gnome_libsecret / kwallet / basic_text；其他平台为 null */
  backend: string | null
  /** Linux 的 basic_text 等同明文，UI 需展示为弱加密而非安全 */
  weak: boolean
}

/** app:bootstrap 的返回体：渲染层首帧需要的全部信息，一次拿全避免瀑布请求 */
export interface BootstrapInfo {
  config: AppConfig
  hasKey: boolean
  encryption: EncryptionStatus
  sessionCount: number
  dataDir: string
  appVersion: string
  electronVersion: string
  nodeVersion: string
  chromeVersion: string
  platform: string
}
