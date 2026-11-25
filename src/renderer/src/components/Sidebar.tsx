import { useState } from 'react'
import type { SessionSummary } from '@shared/types'
import { useChat } from '../store/chat'
import { FontAwesomeIcon, Icon } from './icons'
import { SearchResults, SidebarSearch } from './SidebarSearch'

interface Props {
  width: number
  onOpenSettings: () => void
}

export function Sidebar({ width, onOpenSettings }: Props): React.JSX.Element {
  const sessions = useChat((state) => state.sessions)
  const activeId = useChat((state) => state.activeSessionId)
  const running = useChat((state) => state.run)
  const createSession = useChat((state) => state.createSession)
  const selectSession = useChat((state) => state.selectSession)
  const removeSession = useChat((state) => state.removeSession)
  const renameSession = useChat((state) => state.renameSession)
  const showNotice = useChat((state) => state.showNotice)
  const patchConfig = useChat((state) => state.patchConfig)

  const searchActive = useChat((state) => state.searchQuery.trim().length > 0)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const startRename = (id: string, title: string): void => {
    setMenuFor(null)
    setEditingId(id)
    setDraft(title)
  }

  const commitRename = async (): Promise<void> => {
    const id = editingId
    if (!id) return
    setEditingId(null)
    const title = draft.trim()
    if (!title) return
    await renameSession(id, title)
  }

  const exportSession = async (session: SessionSummary): Promise<void> => {
    setMenuFor(null)
    const result = await window.api.data.exportSession(session.id, 'md', true)
    if (!result.ok) {
      showNotice(`导出失败：${result.message}`)
      return
    }
    showNotice(result.data.path ? `已导出到 ${result.data.path}` : '已取消导出')
  }

  return (
    <aside
      className="flex shrink-0 flex-col border-r border-line bg-canvas"
      style={{ width }}
    >
      <SidebarSearch />

      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <button
          type="button"
          onClick={() => void patchConfig({ window: { sidebarCollapsed: true } })}
          className="rounded px-1.5 py-1 text-fg-subtle hover:text-fg"
          aria-label="折叠侧栏"
          title="折叠侧栏（Ctrl/⌘+B）"
        >
          <FontAwesomeIcon icon={Icon.sidebarCollapse} className="text-[11px]" />
        </button>
        <button
          type="button"
          onClick={() => void createSession()}
          className="rounded-sm px-2 py-1 text-ui text-fg-muted hover:bg-surface-hover hover:text-fg"
          title="新建会话（Ctrl/⌘+N）"
        >
          <FontAwesomeIcon icon={Icon.newChat} className="mr-1.5 text-[10px]" />
          新对话
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {/* 搜索进行中时列表区换成结果，骨架（搜索框 / 新建会话）保持不动 */}
        {searchActive && <SearchResults />}
        {!searchActive && sessions.length === 0 && (
          <p className="px-3 py-6 text-center text-ui text-fg-subtle">还没有对话</p>
        )}
        {!searchActive && (
          <ul>
          {sessions.map((session) => {
            const active = session.id === activeId
            const isRunning = running?.sessionId === session.id
            return (
              <li key={session.id} className="group relative">
                {editingId === session.id ? (
                  <input
                    autoFocus
                    aria-label="重命名会话"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => void commitRename()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void commitRename()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        setEditingId(null)
                      }
                    }}
                    maxLength={120}
                    className="w-full rounded-sm border border-accent bg-surface px-3 py-2 text-ui text-fg outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => void selectSession(session.id)}
                    onDoubleClick={() => startRename(session.id, session.title)}
                    title="双击重命名"
                    className={`flex w-full items-center gap-2 rounded-sm px-3 py-2 pr-7 text-left text-ui ${
                      active
                        ? 'bg-accent-subtle text-fg'
                        : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{session.title}</span>
                    {isRunning && (
                      <span
                        aria-label="生成中"
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                      />
                    )}
                  </button>
                )}

                {/* 会话操作收进一个 ⋯ 菜单：导出、重命名、删除，避免图标按钮堆一排 */}
                <button
                  type="button"
                  onClick={() => setMenuFor(menuFor === session.id ? null : session.id)}
                  className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded px-1.5 text-micro text-fg-subtle hover:text-fg group-hover:block"
                  aria-label="会话操作"
                  aria-haspopup="menu"
                  aria-expanded={menuFor === session.id}
                >
                  <FontAwesomeIcon icon={Icon.sessionMenu} className="text-[12px]" />
                </button>

                {menuFor === session.id && (
                  <div
                    role="menu"
                    className="absolute right-1 top-8 z-20 w-[150px] rounded-md border border-line bg-surface p-1 shadow-md"
                  >
                    <MenuItem onClick={() => void exportSession(session)}>导出 Markdown</MenuItem>
                    <MenuItem onClick={() => startRename(session.id, session.title)}>重命名</MenuItem>
                    <MenuItem
                      tone="danger"
                      onClick={() => {
                        setMenuFor(null)
                        setConfirming(session.id)
                      }}
                    >
                      删除会话
                    </MenuItem>
                  </div>
                )}
              </li>
            )
          })}
          </ul>
        )}
      </nav>

      <div className="border-t border-line px-3 py-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="w-full rounded-sm px-3 py-2 text-left text-ui text-fg-muted hover:bg-surface-hover hover:text-fg"
        >
          <FontAwesomeIcon icon={Icon.settings} className="mr-2 text-[11px]" />
          设置
        </button>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="删除会话确认"
            className="w-[320px] rounded-lg border border-line bg-surface p-4"
          >
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

function MenuItem({
  children,
  onClick,
  tone
}: {
  children: React.ReactNode
  onClick: () => void
  tone?: 'danger'
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full rounded-sm px-3 py-1.5 text-left text-ui ${
        tone === 'danger' ? 'text-danger hover:bg-surface-hover' : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}
