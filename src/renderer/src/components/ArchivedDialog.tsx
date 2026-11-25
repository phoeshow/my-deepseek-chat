import { useEffect } from 'react'
import type { SessionSummary } from '@shared/types'
import { useChat } from '../store/chat'
import { FontAwesomeIcon, Icon } from './icons'

interface Props {
  onClose: () => void
  /** 删除复用左栏的二次确认，不在这里再写一套 */
  onDelete: (id: string) => void
}

/**
 * 已归档会话（docs/04 §4.13）。
 *
 * 归档是"收起"不是"删除"：这里只做恢复与删除，不提供导出——
 * 导出单会话仍在主列表的 ⋯ 菜单里，归档项恢复后即可使用。
 */
export function ArchivedDialog({ onClose, onDelete }: Props): React.JSX.Element {
  const sessions = useChat((state) => state.archivedSessions)
  const restoreSession = useChat((state) => state.restoreSession)
  const showNotice = useChat((state) => state.showNotice)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const restore = async (session: SessionSummary): Promise<void> => {
    await restoreSession(session.id)
    showNotice(`「${session.title}」已恢复到会话列表`)
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="已归档会话"
        onMouseDown={(event) => event.stopPropagation()}
        className="w-[420px] max-w-[calc(100vw-48px)] rounded-lg border border-line bg-surface"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="text-body text-fg">已归档会话</p>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label="关闭已归档"
            className="rounded px-1.5 py-1 text-fg-subtle hover:text-fg"
          >
            <FontAwesomeIcon icon={Icon.close} className="text-[12px]" />
          </button>
        </header>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {sessions.length === 0 && (
            <p className="px-3 py-8 text-center text-ui text-fg-subtle">还没有归档的会话</p>
          )}

          <ul>
            {sessions.map((session) => (
              <li
                key={session.id}
                className="flex items-center gap-3 rounded-sm px-3 py-2 hover:bg-surface-hover"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui text-fg">{session.title}</p>
                  <p className="mt-0.5 text-micro text-fg-subtle tabular-nums">
                    {session.messageCount} 条消息 · 归档于 {formatArchivedAt(session.archivedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void restore(session)}
                  className="shrink-0 rounded-sm px-2 py-1 text-ui text-accent hover:bg-accent-subtle"
                >
                  恢复
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(session.id)}
                  className="shrink-0 rounded-sm px-2 py-1 text-ui text-fg-muted hover:bg-surface-hover hover:text-danger"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function formatArchivedAt(timestamp: number | null): string {
  if (timestamp === null) return '未知时间'
  const date = new Date(timestamp)
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const dayMs = 86_400_000
  if (timestamp >= startOfToday) return '今天'
  if (timestamp >= startOfToday - dayMs) return '昨天'
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}
