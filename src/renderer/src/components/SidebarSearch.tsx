import { useEffect, useRef } from 'react'
import type { MessageHit, SearchHit } from '@shared/types'
import { useChat } from '../store/chat'
import { HighlightedSnippet } from './HighlightedSnippet'
import { FontAwesomeIcon, Icon } from './icons'

/**
 * 左栏顶部的搜索框 + 就地结果列表（v1.1）。
 *
 * 形态决定：搜索框在左栏，结果也留在左栏（替换会话列表），
 * 而不是另开浮层——入口与结果同处一侧，视线不需要来回跳。
 * ⌘K 只是"聚焦这个输入框"，全项目只有这一套搜索。
 */
export function SidebarSearch(): React.JSX.Element {
  const query = useChat((state) => state.searchQuery)
  const results = useChat((state) => state.searchResults)
  const nonce = useChat((state) => state.searchFocusNonce)
  const setSearchQuery = useChat((state) => state.setSearchQuery)
  const clearSearch = useChat((state) => state.clearSearch)
  const openSearchHit = useChat((state) => state.openSearchHit)
  const inputRef = useRef<HTMLInputElement>(null)

  // ⌘K：由 store 的自增计数驱动，避免把 ref 暴露到全局
  useEffect(() => {
    if (nonce === 0) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [nonce])

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      clearSearch()
      inputRef.current?.blur()
      return
    }
    if (event.key === 'Enter') {
      const first = results[0]
      if (first) {
        event.preventDefault()
        void openSearchHit(first)
      }
    }
  }

  return (
    <div className="px-3 pb-2">
      <div className="flex items-center gap-2 rounded-sm border border-line bg-surface px-2.5 py-1.5 focus-within:border-accent">
        <FontAwesomeIcon icon={Icon.search} className="text-[11px] text-fg-subtle" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="搜索会话与消息"
          aria-label="搜索会话与消息"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-ui text-fg outline-none placeholder:text-fg-subtle"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              clearSearch()
              inputRef.current?.focus()
            }}
            aria-label="清除搜索"
            className="text-fg-subtle hover:text-fg"
          >
            <FontAwesomeIcon icon={Icon.searchClear} className="text-[10px]" />
          </button>
        ) : (
          <kbd className="shrink-0 rounded border border-line px-1 font-mono text-[10px] text-fg-subtle">
            ⌘K
          </kbd>
        )}
      </div>

    </div>
  )
}

/**
 * 搜索结果列表。放在 Sidebar 的 nav 区域里渲染（而不是搜索框内部），
 * 这样"搜索框 → 新建会话 → 列表"的骨架在搜索时保持不变，内容只在列表区替换。
 */
export function SearchResults(): React.JSX.Element {
  const query = useChat((state) => state.searchQuery)
  const results = useChat((state) => state.searchResults)
  const searching = useChat((state) => state.searching)
  const openSearchHit = useChat((state) => state.openSearchHit)

  if (!query.trim()) return <></>
  if (searching) return <p className="px-3 py-2 text-micro text-fg-subtle">搜索中…</p>
  if (results.length === 0) {
    return <p className="px-3 py-2 text-micro text-fg-subtle">没有匹配的会话或消息</p>
  }

  return (
    <ul aria-label="搜索结果" className="space-y-0.5">
      {results.map((hit) => (
        <li key={hit.kind === 'session' ? `s-${hit.sessionId}` : `m-${hit.messageId}`}>
          {hit.kind === 'session' ? (
            <SessionRow hit={hit} onClick={() => void openSearchHit(hit)} />
          ) : (
            <MessageRow hit={hit} onClick={() => void openSearchHit(hit)} />
          )}
        </li>
      ))}
    </ul>
  )
}

function SessionRow({
  hit,
  onClick
}: {
  hit: Extract<SearchHit, { kind: 'session' }>
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1.5 text-left hover:bg-surface-hover"
    >
      <FontAwesomeIcon icon={Icon.search} className="shrink-0 text-[10px] text-fg-subtle" />
      <span className="min-w-0 flex-1 truncate text-ui text-fg">{hit.sessionTitle}</span>
      <span className="shrink-0 text-[10px] text-fg-subtle">会话</span>
    </button>
  )
}

function MessageRow({ hit, onClick }: { hit: MessageHit; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-sm px-1.5 py-1.5 text-left hover:bg-surface-hover"
    >
      <span className="block truncate text-micro text-fg-muted">{hit.sessionTitle}</span>
      <span className="mt-0.5 line-clamp-2 block text-micro leading-relaxed text-fg-subtle">
        <HighlightedSnippet text={hit.snippet} />
      </span>
    </button>
  )
}
