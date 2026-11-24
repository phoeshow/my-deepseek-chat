import { useState } from 'react'
import { useChat } from '../store/chat'

interface Props {
  onOpenSettings: () => void
}

export function Sidebar({ onOpenSettings }: Props): React.JSX.Element {
  const sessions = useChat((state) => state.sessions)
  const activeId = useChat((state) => state.activeSessionId)
  const running = useChat((state) => state.run)
  const createSession = useChat((state) => state.createSession)
  const selectSession = useChat((state) => state.selectSession)
  const removeSession = useChat((state) => state.removeSession)
  const [confirming, setConfirming] = useState<string | null>(null)

  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-r border-line bg-canvas">
      <div className="flex h-12 shrink-0 items-center px-4">
        <span className="text-title font-medium">DeepSeek</span>
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={() => void createSession()}
          className="w-full rounded-sm px-3 py-2 text-left text-ui text-fg-muted hover:bg-surface-hover hover:text-fg"
        >
          ＋ 新对话
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 && (
          <p className="px-3 py-6 text-center text-ui text-fg-subtle">还没有对话</p>
        )}
        <ul>
          {sessions.map((session) => {
            const active = session.id === activeId
            const isRunning = running?.sessionId === session.id
            return (
              <li key={session.id} className="group relative">
                <button
                  type="button"
                  onClick={() => void selectSession(session.id)}
                  className={`flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-ui ${
                    active
                      ? 'bg-accent-subtle text-fg'
                      : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{session.title}</span>
                  {isRunning && (
                    <span aria-label="生成中" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(session.id)}
                  className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded px-1.5 text-micro text-fg-subtle hover:text-danger group-hover:block"
                  aria-label="删除会话"
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="border-t border-line px-3 py-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="w-full rounded-sm px-3 py-2 text-left text-ui text-fg-muted hover:bg-surface-hover hover:text-fg"
        >
          ⚙ 设置
        </button>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
          <div className="w-[320px] rounded-lg border border-line bg-surface p-4">
            <p className="text-body text-fg">删除这个会话？</p>
            <p className="mt-1 text-ui text-fg-muted">消息会一并删除，无法恢复。</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="rounded-sm px-3 py-1.5 text-ui text-fg-muted hover:bg-surface-hover"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  void removeSession(confirming)
                  setConfirming(null)
                }}
                className="rounded-sm bg-danger px-3 py-1.5 text-ui text-white"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
