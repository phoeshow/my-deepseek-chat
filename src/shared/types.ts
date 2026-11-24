/**
 * 主进程与渲染层共享的类型。
 * 这里只允许出现类型与纯常量，不允许 import 任何 Node / Electron 模块。
 */

export type ThemeMode = 'system' | 'light' | 'dark'
export type ReasoningEffort = 'low' | 'high' | 'max'

/** GET /models 的归一化结果。contextWindow 可能缺失，缺失时 UI 不做预算提示 */
export interface ModelInfo {
  id: string
  name: string
  contextWindow: number | null
  maxOutputTokens: number | null
}

export type MessageRole = 'system' | 'user' | 'assistant'
export type MessageStatus = 'streaming' | 'complete' | 'aborted' | 'error'

export interface TokenUsage {
  prompt: number
  completion: number
  reasoning?: number
  cacheHit?: number
  cacheMiss?: number
  firstTokenMs?: number
  durationMs?: number
  /** 思维链首帧到末帧的耗时，用于「已思考 2.1s」 */
  reasoningMs?: number
}

export interface ChatMessage {
  id: string
  sessionId: string
  parentId: string | null
  role: MessageRole
  content: string
  reasoning: string | null
  status: MessageStatus
  modelId: string | null
  finishReason: string | null
  error: { code: AppErrorCode; message: string } | null
  tokens: TokenUsage | null
  createdAt: number
  updatedAt: number
}

export interface SessionSummary {
  id: string
  title: string
  modelId: string | null
  thinking: boolean | null
  effort: ReasoningEffort | null
  temperature: number | null
  maxTokens: number | null
  systemPrompt: string | null
  activeLeafId: string | null
  createdAt: number
  updatedAt: number
  archivedAt: number | null
  messageCount: number
}

/** 会话级设定补丁。字段传 null 表示"回退到全局默认" */
export interface SessionPatch {
  modelId?: string | null
  thinking?: boolean | null
  effort?: ReasoningEffort | null
  temperature?: number | null
  maxTokens?: number | null
  systemPrompt?: string | null
}

export interface SendParams {
  sessionId: string
  parentId: string | null
  text: string
  overrides?: {
    thinking?: boolean
    effort?: ReasoningEffort
    temperature?: number
    maxTokens?: number
  }
}

/**
 * 主进程 → 渲染层的流式帧协议（docs/02 §4.3）。
 * 渲染层只需处理这 6 种，SSE 细节全部封在主进程。
 */
export type ChatFrame =
  | { requestId: string; type: 'start'; assistantMessageId: string; startedAt: number }
  | { requestId: string; type: 'think'; delta: string }
  | { requestId: string; type: 'text'; delta: string }
  | { requestId: string; type: 'usage'; usage: TokenUsage }
  | {
      requestId: string
      type: 'end'
      reason: 'stop' | 'length' | 'aborted'
      usage?: TokenUsage
      endedAt: number
    }
  | { requestId: string; type: 'error'; code: AppErrorCode; message: string; retryable: boolean }

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

/** 设置补丁：只允许改动这些键，避免渲染层顺手改掉不该改的东西 */
export interface AppConfigPatch {
  theme?: ThemeMode
  defaultModelId?: string | null
  defaultThinking?: boolean
  defaultEffort?: ReasoningEffort
  autoTitle?: boolean
  baseUrl?: string
  window?: Partial<WindowState>
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

/** 窗口 UI 状态，供自绘标题栏显示最大化/还原图标 */
export interface WindowUiState {
  maximized: boolean
  focused: boolean
}

/**
 * preload 通过 contextBridge 暴露给渲染层的全部能力（window.api）。
 * 这里是白名单的唯一事实来源：新增通道必须同时改这个接口和 ipc/router.ts。
 */
export interface AppApi {
  bootstrap(): Promise<Result<BootstrapInfo>>

  secret: {
    status(): Promise<Result<EncryptionStatus & { hasKey: boolean }>>
    set(apiKey: string): Promise<Result<{ hasKey: boolean }>>
    clear(): Promise<Result<{ hasKey: boolean }>>
    /** 在主进程内实调 GET /models，验证 Key 与 baseUrl 是否可用 */
    test(): Promise<Result<{ modelCount: number; models: ModelInfo[] }>>
  }

  models: {
    refresh(): Promise<Result<{ models: ModelInfo[]; source: 'remote' | 'cache' }>>
  }

  session: {
    list(): Promise<Result<SessionSummary[]>>
    create(input?: {
      modelId?: string | null
      thinking?: boolean | null
    }): Promise<Result<SessionSummary>>
    rename(id: string, title: string): Promise<Result<SessionSummary>>
    update(id: string, patch: SessionPatch): Promise<Result<SessionSummary>>
    remove(id: string): Promise<Result<{ id: string }>>
  }

  message: {
    thread(sessionId: string, leafId?: string | null): Promise<Result<ChatMessage[]>>
  }

  settings: {
    update(patch: AppConfigPatch): Promise<Result<AppConfig>>
  }

  data: {
    /** 单会话导出；返回 path 为 null 表示用户取消了保存 */
    exportSession(
      sessionId: string,
      format: 'md' | 'json',
      includeReasoning: boolean
    ): Promise<Result<{ path: string | null; bytes: number }>>
    exportAll(): Promise<Result<{ path: string | null; bytes: number }>>
    openDataDir(): Promise<Result<{ opened: boolean }>>
    /** 删除全部会话与消息，保留设置与 API Key */
    clearConversations(): Promise<Result<{ deleted: number }>>
  }

  system: {
    /** 外链一律经主进程校验协议 + 二次确认，渲染层不做导航 */
    openExternal(url: string): Promise<Result<{ opened: boolean }>>
  }

  /** 自绘标题栏所需的窗口控制（docs/04 §2.1） */
  windowControls: {
    minimize(): Promise<Result<{ ok: true }>>
    toggleMaximize(): Promise<Result<{ maximized: boolean }>>
    close(): Promise<Result<{ ok: true }>>
    getState(): Promise<Result<WindowUiState>>
    onStateChange(listener: (state: WindowUiState) => void): () => void
  }

  chat: {
    send(
      params: SendParams
    ): Promise<Result<{ requestId: string; userMessageId: string; assistantMessageId: string }>>
    abort(requestId: string): Promise<Result<{ aborted: boolean }>>
    regenerate(
      assistantMessageId: string
    ): Promise<Result<{ requestId: string; assistantMessageId: string }>>
    /** 订阅流式帧，返回取消订阅函数 */
    onFrame(listener: (frame: ChatFrame) => void): () => void
  }
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
  /** 上次异常退出遗留的 streaming 消息数，启动时已被标记为 aborted */
  recoveredMessages: number
  dataDir: string
  appVersion: string
  electronVersion: string
  nodeVersion: string
  chromeVersion: string
  platform: string
}
