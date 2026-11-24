import { useEffect, useState } from 'react'
import { useChat } from './store/chat'
import { ChatView } from './components/ChatView'
import { Onboarding } from './components/Onboarding'
import { ParamPanel } from './components/ParamPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'

export function App(): React.JSX.Element {
  const ready = useChat((state) => state.ready)
  const boot = useChat((state) => state.boot)
  const init = useChat((state) => state.init)
  const error = useChat((state) => state.error)
  const applyFrame = useChat((state) => state.applyFrame)
  const [settingsOpen, setSettingsOpen] = useState(false)

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
        <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
        <ChatView />
        <ParamPanel />
      </div>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
