import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi, BootstrapInfo, Result } from '@shared/types'

/**
 * 白名单桥。只暴露具体方法，不暴露 ipcRenderer 本体——
 * 一旦把 ipcRenderer 交出去，渲染层就能调任意通道，白名单等于没有。
 */
const api: AppApi = {
  bootstrap: () =>
    ipcRenderer.invoke('app:bootstrap') as Promise<Result<BootstrapInfo>>
}

contextBridge.exposeInMainWorld('api', api)
