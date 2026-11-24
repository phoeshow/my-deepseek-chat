import { useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '../store/chat'

/**
 * ⌘/Ctrl+K 会话快速切换（docs/05 S8）。
 * 只做「按标题模糊过滤 + ↑↓ 选择 + Enter 跳转」，不做全文搜索——后者是 v1.1 的 FTS。
 */
export function QuickSwitch({ onClose }: { onClose: () => void }): React.JSX.Element {
  const sessions = useChat((state) => state.sessions)
  const selectSession = useChat((state) => state.selectSession)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sessions
    return sessions.filter((session) => session.title.toLowerCase().includes(needle))
  }, [sessions, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setCursor(0)
  }, [query])

  const choose = (id: string | undefined): void => {
    if (!id) return
    void selectSession(id)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 pt-[15vh]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="快速切换会话"
        className="w-[520px] max-w-[90vw] overflow-hidden rounded-lg border border-line bg-surface shadow-md"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setCursor((value) => Math.min(value + 1, matches.length - 1))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setCursor((value) => Math.max(value - 1, 0))
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              choose(matches[cursor]?.id)
            }
          }}
          placeholder="搜索会话标题…"
          className="w-full border-b border-line bg-surface px-4 py-3 text-body text-fg outline-none placeholder:text-fg-subtle"
        />
        <ul className="max-h-[50vh] overflow-y-auto p-1">
          {matches.length === 0 && (
            <li className="px-3 py-4 text-center text-ui text-fg-subtle">没有匹配的会话</li>
          )}
          {matches.map((session, index) => (
            <li key={session.id}>
              <button
                type="button"
                onMouseEnter={() => setCursor(index)}
                onClick={() => choose(session.id)}
                className={`flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-ui ${
                  index === cursor ? 'bg-accent-subtle text-fg' : 'text-fg-muted'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
                <span className="shrink-0 text-micro text-fg-subtle">{session.messageCount} 条</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
