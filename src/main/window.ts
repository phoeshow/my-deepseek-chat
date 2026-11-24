import { app, BrowserWindow, nativeTheme, screen, session } from 'electron'
import { join } from 'node:path'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from '@shared/defaults'
import type { WindowState, WindowUiState } from '@shared/types'
import { logger } from './logger'

/**
 * 生产环境的 CSP（docs/02 §8）。
 * connect-src 'none' 是架构约束，不是优化：渲染层一旦能发请求，
 * "Key 只存在于主进程"这条保证就失效了。
 * 开发环境不注入此策略，因为 Vite HMR 需要 ws 与 eval，注入会让热更新不可用。
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

export function applyCsp(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP]
      }
    })
  })
}

export interface MainWindowHandle {
  window: BrowserWindow
  /** 退出前强制落盘窗口状态，绕过节流 */
  flushState: () => void
}

export function createMainWindow(
  initial: WindowState,
  onStateChange: (state: WindowState) => void
): MainWindowHandle {
  let state: WindowState = { ...initial }
  let timer: ReturnType<typeof setTimeout> | null = null
  // Wayland 下窗口在 show 之前没有真实几何：构造完立即采样会拿到合成器尚未分配的
  // 假值（实测 1264×1374 @ 0,0 且 isMaximized() 返回 true），却被写成合法配置。
  // 所以所有几何采样必须门控到这个标志位之后。
  let shown = false
  const devUrl = process.env['ELECTRON_RENDERER_URL']

  const win = new BrowserWindow({
    ...initialBounds(state),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    // 自绘标题栏（docs/04 §2.1）：去掉系统标题栏，窗口控制由渲染层发起。
    // Linux/Windows 用 titleBarStyle:'hidden' —— 实测同样能隐藏原生标题栏，
    // 但保留系统边框，因此边缘拖拽缩放是原生的（frame:false 在 Wayland 下会失去缩放能力）。
    // macOS 用 frame:false：否则 titleBarStyle:'hidden' 会保留红色交通灯，
    // 与我们自绘的三个按钮重复。
    ...(process.platform === 'darwin'
      ? { frame: false as const }
      : { titleBarStyle: 'hidden' as const }),
    resizable: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0F0F10' : '#FAFAFA',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  /**
   * 只在窗口存活且已稳定时采样。
   * 关键约束：绝不在关闭/退出阶段采样 —— Wayland 下 isMaximized() 在销毁过程中
   * 会返回 true、getNormalBounds() 会返回合成器给的假值（实测存下过 1264×1374 @ 0,0，
   * 而当时窗口是 1000×700 @ 200,150）。退出时只落盘最后一次合法采样。
   */
  const sample = (): void => {
    if (!shown || win.isDestroyed()) return
    const next: WindowState = { ...state, ...sampleBounds(win) }
    if (!isPlausible(next)) {
      logger.warn('[window] ignored implausible bounds', {
        width: next.width,
        height: next.height,
        maximized: next.maximized
      })
      return
    }
    state = next
    onStateChange(state)
  }

  // 拖拽窗口会以帧频率触发 move/resize，300ms 节流避免把 config.json 写爆
  const schedule = (): void => {
    if (!shown) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      sample()
    }, 300)
  }

  const flushState = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    // 不重新采样，只把最后合法的值写下去
    onStateChange(state)
  }

  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('close', flushState)

  // 标题栏图标需要实时跟随最大化/焦点状态
  const pushUiState = (): void => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send('window:state', readUiState(win))
  }
  win.on('maximize', pushUiState)
  win.on('unmaximize', pushUiState)
  win.on('focus', pushUiState)
  win.on('blur', pushUiState)
  win.webContents.on('did-finish-load', pushUiState)

  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize()
    win.show()
    shown = true

    // 首次可信采样：顺便把被夹回屏幕内的值写回去，实现配置自愈
    sample()

    const primary = screen.getPrimaryDisplay()
    logger.info('[window] shown', {
      bounds: win.getBounds(),
      normal: win.getNormalBounds(),
      maximized: win.isMaximized(),
      workArea: primary.workArea,
      scaleFactor: primary.scaleFactor
    })
  })

  // 只允许应用自身的页面；外链与新窗口一律拦下（确认对话框在 M4 补）
  win.webContents.setWindowOpenHandler(({ url }) => {
    logger.warn('[window] blocked window.open', url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
    logger.warn('[window] blocked navigation', url)
  })

  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 去掉了应用菜单，DevTools 的默认快捷键也跟着没了；开发期手动补回
  win.webContents.on('before-input-event', (event, input) => {
    if (app.isPackaged || input.type !== 'keyDown') return
    const isDevTools =
      input.key === 'F12' ||
      ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i')
    if (!isDevTools) return
    event.preventDefault()
    win.webContents.toggleDevTools()
  })

  logger.info('[window] created', { dev: Boolean(devUrl), bounds: win.getBounds() })

  return { window: win, flushState }
}

/**
 * 恢复上次的位置，但必须确认它仍落在当前某块屏幕内——
 * 否则拔掉外接显示器后窗口会跑到不存在的坐标系里，用户根本抓不回来。
 */
function initialBounds(state: WindowState): {
  width: number
  height: number
  x?: number
  y?: number
} {
  const display = (state.x !== null && state.y !== null
    ? screen.getDisplayMatching({ x: state.x, y: state.y, width: state.width, height: state.height })
    : screen.getPrimaryDisplay()
  ).workArea

  // 先夹到当前屏幕内：历史配置可能来自另一块更大的显示器，直接拿宽高会超出可视区
  const width = Math.min(Math.max(MIN_WINDOW_WIDTH, state.width), display.width)
  const height = Math.min(Math.max(MIN_WINDOW_HEIGHT, state.height), display.height)

  if (state.x !== null && state.y !== null && isReachable(state.x, state.y, width, height)) {
    return { width, height, x: state.x, y: state.y }
  }
  // 不传 x/y，交给 Electron 居中
  return { width, height }
}

function isPlausible(state: WindowState): boolean {
  if (state.width < MIN_WINDOW_WIDTH || state.height < MIN_WINDOW_HEIGHT) return false
  if (state.maximized) return true
  const area = screen.getDisplayMatching({
    x: state.x ?? 0,
    y: state.y ?? 0,
    width: state.width,
    height: state.height
  }).workArea
  // 最多容许超出 64px（装饰边框、任务栏预留差异）
  return state.width <= area.width + 64 && state.height <= area.height + 64
}

function isReachable(x: number, y: number, width: number, height: number): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX = Math.min(x + width, workArea.x + workArea.width) - Math.max(x, workArea.x)
    const overlapY = Math.min(y + height, workArea.y + workArea.height) - Math.max(y, workArea.y)
    // 至少 120×120 可见，才认为用户能抓住标题栏拖回来
    return overlapX >= 120 && overlapY >= 120
  })
}

/**
 * 读取窗口当前几何。调用时机只有两个：窗口刚创建完成、以及实时 move/resize/maximize 事件
 * —— 都不在关闭或退出阶段。
 */
function sampleBounds(
  win: BrowserWindow
): Pick<WindowState, 'width' | 'height' | 'x' | 'y' | 'maximized'> {
  const maximized = win.isMaximized()
  const bounds = maximized ? win.getNormalBounds() : win.getBounds()
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized
  }
}

/** 读取窗口 UI 状态。只用于标题栏图标，不参与持久化 */
export function readUiState(win: BrowserWindow): WindowUiState {
  return { maximized: win.isMaximized(), focused: win.isFocused() }
}

/** Windows 任务栏分组需要显式 AppUserModelID，macOS/Linux 无副作用 */
export function setAppIdentity(): void {
  app.setAppUserModelId('com.phoeshow.mydeepseekchat')
}
