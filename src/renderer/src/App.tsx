import { useEffect, useRef, useState } from 'react'
import { useChat } from './store/chat'
import { ChatView } from './components/ChatView'
import { Onboarding } from './components/Onboarding'
import { ParamPanel } from './components/ParamPanel'
import { QuickSwitch } from './components/QuickSwitch'
import { Resizer } from './components/Resizer'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { Toast } from './components/Toast'

/** 分栏宽度边界（docs/04 §2） */
const SIDEBAR = { default: 240, min: 200, max: 320 }
const PANEL = { default: 280, min: 240, max: 360 }

export function App(): React.JSX.Element {
  const ready = useChat((state) => state.ready)
  const boot = useChat((state) => state.boot)
  const init = useChat((state) => state.init)
  const error = useChat((state) => state.error)
  const applyFrame = useChat((state) => state.applyFrame)
  const createSession = useChat((state) => state.createSession)
  const patchConfig = useChat((state) => state.patchConfig)
  const abort = useChat((state) => state.abort)
  const regenerate = useChat((state) => state.regenerate)
  const messages = useChat((state) => state.messages)
  const running = useChat((state) => state.run !== null)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)

  const sidebarCollapsed = boot?.config.window.sidebarCollapsed ?? false
  const panelCollapsed = boot?.config.window.panelCollapsed ?? false

  // 拖拽期间只改本地状态，松手才写配置，避免每帧一次磁盘写入
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR.default)
  const [panelWidth, setPanelWidth] = useState(PANEL.default)
  const seeded = useRef(false)

  useEffect(() => {
    if (!boot) return
    if (!seeded.current) {
      seeded.current = true
      setSidebarWidth(boot.config.window.sidebarWidth)
      setPanelWidth(boot.config.window.panelWidth)
    }
  }, [boot])

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    return window.api.chat.onFrame(applyFrame)
  }, [applyFrame])

  // theme = 'system' 时移除属性，让 CSS 的 light-dark() 跟随系统
  useEffect(() => {
    const theme = boot?.config.theme ?? 'system'
    if (theme === 'system') delete document.documentElement.dataset['theme']
    else document.documentElement.dataset['theme'] = theme
  }, [boot])

  // 全局快捷键（docs/04 §6）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()

      if (key === 'n') {
        event.preventDefault()
        void createSession()
        return
      }
      if (key === 'b') {
        event.preventDefault()
        void patchConfig({ window: { sidebarCollapsed: !sidebarCollapsed } })
        return
      }
      if (key === 'k') {
        event.preventDefault()
        setQuickOpen((value) => !value)
        return
      }
      if (key === ',') {
        event.preventDefault()
        setSettingsOpen(true)
        return
      }
      if (key === '.') {
        event.preventDefault()
        if (running) void abort()
        return
      }
      if (key === 'r') {
        // 默认行为是刷新页面，这里改成"重新生成最后一条回答"
        event.preventDefault()
        const lastAssistant = [...messages].reverse().find((item) => item.role === 'assistant')
        if (lastAssistant && !running) void regenerate(lastAssistant.id)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    abort,
    createSession,
    messages,
    patchConfig,
    regenerate,
    running,
    sidebarCollapsed
  ])

  if (!ready || !boot) {
    return (
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
          {error ? (
            <>
              <p className="text-display font-medium text-fg">启动失败</p>
              <p className="max-w-[520px] text-center text-ui text-danger">
                <span className="font-mono text-micro text-fg-subtle">[{error.code}] </span>
                {error.message}
              </p>
              <p className="max-w-[520px] text-center text-micro text-fg-subtle">
                数据目录可能不可写或已损坏。可先检查磁盘空间，再点重试。
              </p>
              <button
                type="button"
                onClick={() => void init()}
                className="rounded-md bg-accent px-4 py-1.5 text-ui text-white hover:bg-accent-hover"
              >
                重试
              </button>
            </>
          ) : (
            <p className="text-ui text-fg-subtle">正在初始化…</p>
          )}
        </div>
      </div>
    )
  }

  if (!boot.hasKey) {
    return (
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="min-h-0 flex-1">
          <Onboarding />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col text-ui">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {!sidebarCollapsed && (
          <>
            <Sidebar width={sidebarWidth} onOpenSettings={() => setSettingsOpen(true)} />
            <Resizer
              side="left"
              width={sidebarWidth}
              min={SIDEBAR.min}
              max={SIDEBAR.max}
              onChange={setSidebarWidth}
              onCommit={(width) => void patchConfig({ window: { sidebarWidth: width } })}
            />
          </>
        )}

        <ChatView />

        {!panelCollapsed && (
          <>
            <Resizer
              side="right"
              width={panelWidth}
              min={PANEL.min}
              max={PANEL.max}
              onChange={setPanelWidth}
              onCommit={(width) => void patchConfig({ window: { panelWidth: width } })}
            />
            <ParamPanel width={panelWidth} />
          </>
        )}
      </div>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {quickOpen && <QuickSwitch onClose={() => setQuickOpen(false)} />}
      <Toast />
    </div>
  )
}
