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
  /** 已归档会话：只在「已归档」弹层里展示，不进主列表也不进搜索结果 */
  archivedSessions: SessionSummary[]
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
  /** 中栏显示对话还是用量仪表盘 */
  view: 'chat' | 'usage'
  setView: (view: 'chat' | 'usage') => void
  /** 搜索状态：query 非空时左栏切换为结果列表 */
  searchQuery: string
  searchResults: SearchHit[]
  searching: boolean
  /** 自增计数：⌘K 触发焦点，Sidebar 监听它去 focus 输入框 */
  searchFocusNonce: number
  /** 从搜索结果跳转后要高亮的消息 */
  highlightMessageId: string | null
  /** 正在内联编辑的消息 id：全局只允许一个编辑器 */
  editingMessageId: string | null
  startEditMessage: (id: string) => void
  cancelEditMessage: () => void
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
  archiveSession: (id: string) => Promise<void>
  restoreSession: (id: string) => Promise<void>

  patchConfig: (patch: AppConfigPatch) => Promise<void>
  refreshModels: () => Promise<void>
  saveKey: (apiKey: string) => Promise<void>
  testKey: () => Promise<void>

  send: (text: string, overrides?: SendOverrides) => Promise<void>
  abort: () => Promise<void>
  regenerate: (assistantMessageId: string) => Promise<void>
  switchVersion: (messageId: string, direction: 'prev' | 'next') => Promise<void>
  /** 编辑用户消息：在同 parent 下开新分支，返回是否发送成功 */
  editMessage: (messageId: string, text: string) => Promise<boolean>
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
  archivedSessions: [],
  activeSessionId: null,
  messages: [],
  live: {},
  run: null,
  error: null,
  draft: '',
  panelOpen: false,
  view: 'chat',
  searchQuery: '',
  searchResults: [],
  searching: false,
  searchFocusNonce: 0,
  highlightMessageId: null,
  editingMessageId: null,
  notice: null,

  setDraft: (draft) => set({ draft }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  setView: (view) => set({ view }),

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

  startEditMessage: (id) => {
    const target = get().messages.find((item) => item.id === id)
    if (!target || target.role !== 'user' || get().run) return
    set({ editingMessageId: id })
  },

  cancelEditMessage: () => set({ editingMessageId: null }),
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
    // 一次拿全（含归档）再在本地拆分：两个列表来自同一个快照，不会出现归档瞬间的重复/丢失
    const all = await unwrap(window.api.session.list({ includeArchived: true }))
    set({
      sessions: all.filter((item) => item.archivedAt === null),
      archivedSessions: all.filter((item) => item.archivedAt !== null)
    })
  },

  reloadAll: async () => {
    set({ messages: [], live: {}, run: null, activeSessionId: null, editingMessageId: null })
    await get().refreshSessions()
    const first = get().sessions[0]
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
    set({ activeSessionId: id, live: {}, run: null, editingMessageId: null })
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

  archiveSession: async (id) => {
    // 正在生成的会话不能归档：切走会丢掉 live 状态，而主进程仍在写库，两边的游标会对不上
    if (get().run?.sessionId === id) return
    const wasActive = get().activeSessionId === id
    await unwrap(window.api.session.archive(id, true))
    await get().refreshSessions()
    if (!wasActive) return
    const next = get().sessions[0]
    if (next) await get().selectSession(next.id)
    else set({ activeSessionId: null, messages: [], live: {}, run: null })
  },

  editMessage: async (messageId, text) => {
    const sessionId = get().activeSessionId
    if (!sessionId || get().run) return false
    const target = get().messages.find((item) => item.id === messageId)
    if (!target || target.role !== 'user') return false
    const trimmed = text.trim()
    // 无变更时不制造多余分支
    if (!trimmed || trimmed === target.content.trim()) return false

    set({ error: null })
    try {
      // 复用 chat:send：显式 parentId 让新消息成为原消息的兄弟，而不是接在主线末端
      const result = await unwrap(
        window.api.chat.send({
          sessionId,
          // 显式传 null 才是“编辑首条消息”：省略会被主进程理解为接在主线末端
          parentId: target.parentId,
          text: trimmed
        })
      )
      set({
        editingMessageId: null,
        run: {
          requestId: result.requestId,
          sessionId,
          assistantMessageId: result.assistantMessageId
        }
      })
      await get().refreshThread()
      await get().refreshSessions()
      return true
    } catch (err) {
      set({ error: toError(err) })
      return false
    }
  },

  restoreSession: async (id) => {
    await unwrap(window.api.session.archive(id, false))
    await get().refreshSessions()
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

  switchVersion: async (messageId, direction) => {
    if (get().run) return
    try {
      await unwrap(window.api.chat.switchVersion(messageId, direction))
      // 主线游标已经在主进程改好，重新取一遍线程即可
      await get().refreshThread()
      await get().refreshSessions()
    } catch (err) {
      set({ error: toError(err) })
    }
  },

  applyFrame: (frame) => {
    switch (frame.type) {
      case 'start':
        set((state) => ({
          // 任何生成一开始就关闭编辑器：生成期间不允许编辑（docs/04 §4.14）
          editingMessageId: null,
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
