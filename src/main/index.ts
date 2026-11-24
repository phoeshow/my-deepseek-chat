import { app, BrowserWindow, Menu } from 'electron'
import { setFrameSink } from './chat/service'
import { closeDatabase, initDatabase } from './db'
import { registerIpc } from './ipc/router'
import { logger } from './logger'
import { initModels } from './services/models'
import { initSecret } from './services/secret'
import { getConfig, initSettings, updateWindowState } from './services/settings'
import { applyCsp, createMainWindow, setAppIdentity } from './window'

let handle: ReturnType<typeof createMainWindow> | null = null

// 必须在 ready 之前固定名字：打包后的 app.getName() 会变成 productName，
// 那样 userData 会从 ~/.config/my-deepseek-chat 变成 ~/.config/DeepSeek Chat，
// 等于把开发期的数据孤立掉。
app.setName('my-deepseek-chat')

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
  installApplicationMenu()
  initDatabase(dataDir)
  initSettings(dataDir)
  initSecret(dataDir)
  initModels(dataDir)

  // 严格 CSP 只在打包后注入：开发环境的 Vite HMR 需要 ws 与 eval
  if (app.isPackaged) applyCsp()

  registerIpc({ dataDir, getWindow: () => handle?.window ?? null })
  openWindow()

  logger.info('[app] ready', {
    dataDir,
    version: app.getVersion(),
    packaged: app.isPackaged
  })
}

/**
 * 菜单策略（docs/02 §8）：
 * - Linux / Windows：彻底去掉菜单栏，窗口控制交给自绘标题栏
 * - macOS：必须保留最小应用菜单，否则 Cmd+C / Cmd+V / Cmd+Z 等编辑快捷键会失效
 * 去掉菜单后 DevTools 的默认快捷键也没了，开发期用 window.ts 里的 before-input-event 补回。
 */
function installApplicationMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
  )
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
