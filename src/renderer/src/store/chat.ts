import { create } from 'zustand'
import type {
  AppErrorCode,
  AppConfigPatch,
  BootstrapInfo,
  ChatFrame,
  ChatMessage,
  ModelInfo,
  SearchHit,
  SessionPatch,
  SessionSummary
} from '@shared/types'
import { IpcError, unwrap } from '../lib/ipc'

export interface LiveMessage {
  messageId: string
  text: string
  reasoning: string
  status: 'streaming' | 'done' | 'error' | 'aborted'
  error?: { code: string; message: string }
}

/** 本条消息的临时覆盖项（不写回会话设定） */
export interface SendOverrides {
  thinking?: boolean
}

interface RunState {
  requestId: string
  sessionId: string
  assistantMessageId: string
}

interface ChatStore {
  ready: boolean
  boot: BootstrapInfo | null
  models: ModelInfo[]
  sessions: SessionSummary[]
  activeSessionId: string | null
  messages: ChatMessage[]
  live: Record<string, LiveMessage>
  run: RunState | null
  error: { code: AppErrorCode | string; message: string } | null
  /** 输入框草稿：空态里的示例卡片需要往里填内容，所以放在 store 而不是组件内部 */
  draft: string
  setDraft: (draft: string) => void
  /**
   * 右栏参数面板是否展开。刻意**不持久化**：
   * 参数面板是可选内容，每次启动都收起，把宽度让给对话区。
   */
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  /** 搜索状态：query 非空时左栏切换为结果列表 */
  searchQuery: string
  searchResults: SearchHit[]
  searching: boolean
  /** 自增计数：⌘K 触发焦点，Sidebar 监听它去 focus 输入框 */
  searchFocusNonce: number
  /** 从搜索结果跳转后要高亮的消息 */
  highlightMessageId: string | null
  setSearchQuery: (query: string) => void
  clearSearch: () => void
  focusSearch: () => void
  openSearchHit: (hit: SearchHit) => Promise<void>
  clearHighlight: () => void

  /** 一次性提示（导出结果等），由 Toast 组件展示 */
  notice: string | null
  showNotice: (text: string) => void
  clearNotice: () => void

  init: () => Promise<void>
  setError: (error: { code: string; message: string } | null) => void

  refreshSessions: () => Promise<void>
  /** 清空数据后重新拉取全部状态 */
  reloadAll: () => Promise<void>
  refreshThread: () => Promise<void>
  selectSession: (id: string) => Promise<void>
  createSession: () => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  updateSession: (patch: SessionPatch) => Promise<void>
  removeSession: (id: string) => Promise<void>

  patchConfig: (patch: AppConfigPatch) => Promise<void>
  refreshModels: () => Promise<void>
  saveKey: (apiKey: string) => Promise<void>
  testKey: () => Promise<void>

  send: (text: string, overrides?: SendOverrides) => Promise<void>
  abort: () => Promise<void>
  regenerate: (assistantMessageId: string) => Promise<void>
  applyFrame: (frame: ChatFrame) => void
}

/**
 * 流式增量不直接写进 store：一秒钟可能上百帧，
 * 每帧一次 setState 会让长回答直接卡死（AGENTS.md §3.5）。
 * 这里先攒进 buffer，用 requestAnimationFrame 每帧最多提交一次。
 */
const buffer = new Map<string, { text: string; reasoning: string }>()
let rafHandle = 0

/** 搜索防抖定时器与请求序号（序号用于丢弃过期响应） */
let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchSeq = 0

function pushDelta(messageId: string, channel: 'text' | 'reasoning', delta: string): void {
  const entry = buffer.get(messageId) ?? { text: '', reasoning: '' }
  if (channel === 'text') entry.text += delta
  else entry.reasoning += delta
  buffer.set(messageId, entry)
  scheduleFlush()
}

function scheduleFlush(): void {
  if (rafHandle) return
  rafHandle = requestAnimationFrame(() => {
    rafHandle = 0
    const batch = new Map(buffer)
    buffer.clear()
    useChat.setState((state) => {
      const live = { ...state.live }
      for (const [messageId, delta] of batch) {
        const current = live[messageId] ?? {
          messageId,
          text: '',
          reasoning: '',
          status: 'streaming' as const
        }
        live[messageId] = {
          ...current,
          text: current.text + delta.text,
          reasoning: current.reasoning + delta.reasoning
        }
      }
      return { live }
    })
  })
}

export const useChat = create<ChatStore>((set, get) => ({
  ready: false,
  boot: null,
  models: [],
  sessions: [],
  activeSessionId: null,
  messages: [],
  live: {},
  run: null,
  error: null,
  draft: '',
  panelOpen: false,
  searchQuery: '',
  searchResults: [],
  searching: false,
  searchFocusNonce: 0,
  highlightMessageId: null,
  notice: null,

  setDraft: (draft) => set({ draft }),
  setPanelOpen: (open) => set({ panelOpen: open }),

  setSearchQuery: (query) => {
    set({ searchQuery: query })
    if (searchTimer) clearTimeout(searchTimer)

    const trimmed = query.trim()
    if (!trimmed) {
      set({ searchResults: [], searching: false })
      return
    }

    set({ searching: true })
    // 输入过程中不逐字符打库：180ms 静默后再查
    searchTimer = setTimeout(() => {
      const seq = ++searchSeq
      void window.api.search
        .query(trimmed)
        .then((result) => {
          if (seq !== searchSeq) return
          set({ searchResults: result.ok ? result.data : [], searching: false })
        })
        .catch(() => {
          if (seq === searchSeq) set({ searchResults: [], searching: false })
        })
    }, 180)
  },

  clearSearch: () => {
    if (searchTimer) clearTimeout(searchTimer)
    set({ searchQuery: '', searchResults: [], searching: false })
  },

  focusSearch: () => set((state) => ({ searchFocusNonce: state.searchFocusNonce + 1 })),

  openSearchHit: async (hit) => {
    await get().selectSession(hit.sessionId)
    set({
      searchQuery: '',
      searchResults: [],
      searching: false,
      highlightMessageId: hit.kind === 'message' ? hit.messageId : null
    })
  },

  clearHighlight: () => set({ highlightMessageId: null }),
  showNotice: (text) => set({ notice: text }),
  clearNotice: () => set({ notice: null }),

  init: async () => {
    try {
      const boot = await unwrap(window.api.bootstrap())
      set({ boot, ready: true })
      await get().refreshSessions()
      if (boot.hasKey) await get().refreshModels().catch(() => undefined)
      const first = get().sessions[0]
      if (first) await get().selectSession(first.id)
    } catch (err) {
      set({ ready: true, error: toError(err) })
    }
  },

  setError: (error) => set({ error }),

  refreshSessions: async () => {
    const sessions = await unwrap(window.api.session.list())
    set({ sessions })
  },

  reloadAll: async () => {
    const sessions = await unwrap(window.api.session.list())
    set({ sessions, messages: [], live: {}, run: null, activeSessionId: null })
    const first = sessions[0]
    if (first) await get().selectSession(first.id)
  },

  refreshThread: async () => {
    const sessionId = get().activeSessionId
    if (!sessionId) {
      set({ messages: [] })
      return
    }
    // 不传 leafId：由主进程按数据库里的 sessions.active_leaf_id 解析。
    // 渲染层缓存的 activeLeafId 在"end 帧到达但 sessions 还没刷新"时是上一轮的旧值，
    // 拿它查线程会导致刚生成的回答从界面上消失。
    const messages = await unwrap(window.api.message.thread(sessionId))
    set({ messages })
  },

  selectSession: async (id) => {
    set({ activeSessionId: id, live: {}, run: null })
    await get().refreshThread()
  },

  createSession: async () => {
    const session = await unwrap(window.api.session.create({}))
    await get().refreshSessions()
    await get().selectSession(session.id)
  },

  renameSession: async (id, title) => {
    const updated = await unwrap(window.api.session.rename(id, title))
    set((state) => ({
      sessions: state.sessions.map((item) => (item.id === updated.id ? updated : item))
    }))
  },

  updateSession: async (patch) => {
    const id = get().activeSessionId
    if (!id) return
    const updated = await unwrap(window.api.session.update(id, patch))
    set((state) => ({
      sessions: state.sessions.map((item) => (item.id === updated.id ? updated : item))
    }))
  },

  removeSession: async (id) => {
    await unwrap(window.api.session.remove(id))
    const wasActive = get().activeSessionId === id
    await get().refreshSessions()
    if (wasActive) {
      const next = get().sessions[0]
      if (next) await get().selectSession(next.id)
      else set({ activeSessionId: null, messages: [] })
    }
  },

  patchConfig: async (patch) => {
    const config = await unwrap(window.api.settings.update(patch))
    set((state) => ({ boot: state.boot ? { ...state.boot, config } : state.boot }))
  },

  refreshModels: async () => {
    const { models } = await unwrap(window.api.models.refresh())
    set({ models })
  },

  saveKey: async (apiKey) => {
    await unwrap(window.api.secret.set(apiKey))
    const boot = await unwrap(window.api.bootstrap())
    set({ boot })
    await get().refreshModels().catch(() => undefined)
  },

  testKey: async () => {
    const { models } = await unwrap(window.api.secret.test())
    set({ models })
  },

  send: async (text, overrides) => {
    const sessionId = get().activeSessionId
    if (!sessionId || get().run) return
    const trimmed = text.trim()
    if (!trimmed) return

    set({ error: null })
    try {
      const result = await unwrap(
        window.api.chat.send({
          sessionId,
          parentId: null,
          text: trimmed,
          ...(overrides ? { overrides } : {})
        })
      )
      set({
        run: {
          requestId: result.requestId,
          sessionId,
          assistantMessageId: result.assistantMessageId
        }
      })
      await get().refreshThread()
      await get().refreshSessions()
    } catch (err) {
      set({ error: toError(err) })
    }
  },

  abort: async () => {
    const run = get().run
    if (!run) return
    await unwrap(window.api.chat.abort(run.requestId)).catch(() => undefined)
  },

  regenerate: async (assistantMessageId) => {
    if (get().run) return
    const sessionId = get().activeSessionId
    if (!sessionId) return
    set({ error: null })
    try {
      const result = await unwrap(window.api.chat.regenerate(assistantMessageId))
      set({
        run: { requestId: result.requestId, sessionId, assistantMessageId: result.assistantMessageId }
      })
      await get().refreshThread()
    } catch (err) {
      set({ error: toError(err) })
    }
  },

  applyFrame: (frame) => {
    switch (frame.type) {
      case 'start':
        set((state) => ({
          live: {
            ...state.live,
            [frame.assistantMessageId]: {
              messageId: frame.assistantMessageId,
              text: '',
              reasoning: '',
              status: 'streaming'
            }
          }
        }))
        break

      case 'think':
        pushDelta(currentAssistantId(get()), 'reasoning', frame.delta)
        break

      case 'text':
        pushDelta(currentAssistantId(get()), 'text', frame.delta)
        break

      case 'usage':
        // M3 才展示预算与费用，这里先不消费
        break

      case 'end': {
        const messageId = currentAssistantId(get())
        flushNow()
        set((state) => ({
          run: null,
          live: {
            ...state.live,
            [messageId]: {
              ...(state.live[messageId] ?? { messageId, text: '', reasoning: '' }),
              status: frame.reason === 'aborted' ? 'aborted' : 'done'
            }
          }
        }))
        void get().refreshThread().finally(() => clearLive(messageId))
        void get().refreshSessions()
        break
      }

      case 'error': {
        const messageId = currentAssistantId(get())
        flushNow()
        set((state) => ({
          run: null,
          error: { code: frame.code, message: frame.message },
          live: {
            ...state.live,
            [messageId]: {
              ...(state.live[messageId] ?? { messageId, text: '', reasoning: '' }),
              status: 'error',
              error: { code: frame.code, message: frame.message }
            }
          }
        }))
        break
      }
    }
  }
}))

function currentAssistantId(state: ChatStore): string {
  return state.run?.assistantMessageId ?? ''
}

/** 终止帧到达时必须立刻提交缓冲，否则最后几个字符会丢 */
function flushNow(): void {
  if (!rafHandle) return
  cancelAnimationFrame(rafHandle)
  rafHandle = 0
  const batch = new Map(buffer)
  buffer.clear()
  useChat.setState((state) => {
    const live = { ...state.live }
    for (const [messageId, delta] of batch) {
      const current = live[messageId] ?? { messageId, text: '', reasoning: '', status: 'streaming' as const }
      live[messageId] = {
        ...current,
        text: current.text + delta.text,
        reasoning: current.reasoning + delta.reasoning
      }
    }
    return { live }
  })
}

function clearLive(messageId: string): void {
  useChat.setState((state) => {
    const live = { ...state.live }
    delete live[messageId]
    return { live }
  })
}

function toError(err: unknown): { code: string; message: string } {
  if (err instanceof IpcError) return { code: err.code, message: err.message }
  return { code: 'UNKNOWN', message: err instanceof Error ? err.message : String(err) }
}
