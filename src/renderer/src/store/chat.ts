import { create } from 'zustand'
import type {
  AppErrorCode,
  BootstrapInfo,
  ChatFrame,
  ChatMessage,
  ModelInfo,
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

  init: () => Promise<void>
  setError: (error: { code: string; message: string } | null) => void

  refreshSessions: () => Promise<void>
  refreshThread: () => Promise<void>
  selectSession: (id: string) => Promise<void>
  createSession: () => Promise<void>
  removeSession: (id: string) => Promise<void>

  refreshModels: () => Promise<void>
  saveKey: (apiKey: string) => Promise<void>
  testKey: () => Promise<void>

  send: (text: string) => Promise<void>
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

  refreshThread: async () => {
    const sessionId = get().activeSessionId
    if (!sessionId) {
      set({ messages: [] })
      return
    }
    const session = get().sessions.find((item) => item.id === sessionId)
    const messages = await unwrap(window.api.message.thread(sessionId, session?.activeLeafId ?? null))
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

  send: async (text) => {
    const sessionId = get().activeSessionId
    if (!sessionId || get().run) return
    const trimmed = text.trim()
    if (!trimmed) return

    set({ error: null })
    try {
      const result = await unwrap(
        window.api.chat.send({ sessionId, parentId: null, text: trimmed })
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
