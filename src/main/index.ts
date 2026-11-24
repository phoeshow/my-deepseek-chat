import { app, BrowserWindow } from 'electron'
import { setFrameSink } from './chat/service'
import { closeDatabase, initDatabase } from './db'
import { registerIpc } from './ipc/router'
import { logger } from './logger'
import { initModels } from './services/models'
import { initSecret } from './services/secret'
import { getConfig, initSettings, updateWindowState } from './services/settings'
import { applyCsp, createMainWindow, setAppIdentity } from './window'

let handle: ReturnType<typeof createMainWindow> | null = null

start()

function start(): void {
  // 单实例锁必须在 whenReady 之前抢，否则第二个进程已经开始初始化数据库了
  if (!app.requestSingleInstanceLock()) {
    logger.warn('[app] another instance is running — quitting')
    app.quit()
    return
  }

  app.on('second-instance', () => {
    const win = handle?.window
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })

  app.on('before-quit', () => {
    handle?.flushState()
    closeDatabase()
  })

  void app.whenReady().then(onReady)
}

function onReady(): void {
  const dataDir = app.getPath('userData')

  setAppIdentity()
  initDatabase(dataDir)
  initSettings(dataDir)
  initSecret(dataDir)
  initModels(dataDir)

  // 严格 CSP 只在打包后注入：开发环境的 Vite HMR 需要 ws 与 eval
  if (app.isPackaged) applyCsp()

  registerIpc({ dataDir })
  openWindow()

  logger.info('[app] ready', {
    dataDir,
    version: app.getVersion(),
    packaged: app.isPackaged
  })
}

function openWindow(): void {
  handle = createMainWindow(getConfig().window, updateWindowState)
  wireFrameSink()
}

/** 流式帧的唯一出口：窗口重建后也要重新绑定 */
function wireFrameSink(): void {
  setFrameSink((frame) => {
    const win = handle?.window
    if (!win || win.isDestroyed()) return
    win.webContents.send('chat:frame', frame)
  })
}
