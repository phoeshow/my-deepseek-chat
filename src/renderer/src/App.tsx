import { useEffect, useState } from 'react'
import { useChat } from './store/chat'
import { ChatView } from './components/ChatView'
import { Onboarding } from './components/Onboarding'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'

export function App(): React.JSX.Element {
  const ready = useChat((state) => state.ready)
  const boot = useChat((state) => state.boot)
  const init = useChat((state) => state.init)
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
      <div className="flex h-full items-center justify-center text-ui text-fg-subtle">正在初始化…</div>
    )
  }

  if (!boot.hasKey) return <Onboarding />

  return (
    <div className="flex h-full text-ui">
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
      <ChatView onOpenSettings={() => setSettingsOpen(true)} />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
