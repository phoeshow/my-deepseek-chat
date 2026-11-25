import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi, BootstrapInfo, ChatFrame, Result, WindowUiState } from '@shared/types'

/**
 * 白名单桥。只暴露具体方法，不暴露 ipcRenderer 本体——
 * 一旦把 ipcRenderer 交出去，渲染层就能调任意通道，白名单等于没有。
 */
async function invoke<T>(channel: string, payload?: unknown): Promise<Result<T>> {
  return (await ipcRenderer.invoke(channel, payload)) as Result<T>
}

const api: AppApi = {
  bootstrap: () => invoke<BootstrapInfo>('app:bootstrap'),

  secret: {
    status: () => invoke('secret:status'),
    set: (apiKey) => invoke('secret:set', apiKey),
    clear: () => invoke('secret:clear'),
    test: () => invoke('secret:test')
  },

  models: {
    refresh: () => invoke('models:refresh')
  },

  session: {
    list: () => invoke('session:list'),
    create: (input) => invoke('session:create', input ?? {}),
    rename: (id, title) => invoke('session:rename', { id, title }),
    update: (id, patch) => invoke('session:update', { id, patch }),
    remove: (id) => invoke('session:delete', { id })
  },

  message: {
    thread: (sessionId, leafId) => invoke('message:thread', { sessionId, leafId: leafId ?? null })
  },

  usage: {
    summary: (range) => invoke('usage:summary', { range })
  },

  search: {
    query: (query) => invoke('search:messages', { query })
  },

  chat: {
    send: (params) => invoke('chat:send', params),
    abort: (requestId) => invoke('chat:abort', { requestId }),
    switchVersion: (messageId, direction) =>
      invoke('chat:switch-version', { messageId, direction }),
    regenerate: (assistantMessageId) => invoke('chat:regenerate', { assistantMessageId }),
    onFrame: (listener) => {
      const wrapped = (_event: unknown, frame: ChatFrame): void => listener(frame)
      ipcRenderer.on('chat:frame', wrapped)
      return () => {
        ipcRenderer.off('chat:frame', wrapped)
      }
    }
  },

  settings: {
    update: (patch) => invoke('settings:update', { patch })
  },

  data: {
    exportSession: (sessionId, format, includeReasoning) =>
      invoke('export:session', { sessionId, format, includeReasoning }),
    exportAll: () => invoke('export:all'),
    openDataDir: () => invoke('app:open-data-dir'),
    clearConversations: () => invoke('app:clear-conversations')
  },

  system: {
    openExternal: (url) => invoke('shell:open-external', { url })
  },

  windowControls: {
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggle-maximize'),
    close: () => invoke('window:close'),
    getState: () => invoke('window:get-state'),
    onStateChange: (listener) => {
      const wrapped = (_event: unknown, state: WindowUiState): void => listener(state)
      ipcRenderer.on('window:state', wrapped)
      return () => {
        ipcRenderer.off('window:state', wrapped)
      }
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
