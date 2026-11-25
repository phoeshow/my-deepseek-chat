import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatMessage, MessageStatus } from '@shared/types'
import { useChat, type LiveMessage } from '../store/chat'
import { Composer } from './Composer'
import { FontAwesomeIcon, Icon } from './icons'
import { MessageItem } from './MessageItem'
import { SessionMenu } from './SessionMenu'

export function ChatView(): React.JSX.Element {
  const sessions = useChat((state) => state.sessions)
  const activeSessionId = useChat((state) => state.activeSessionId)
  const messages = useChat((state) => state.messages)
  const live = useChat((state) => state.live)
  const error = useChat((state) => state.error)
  const setError = useChat((state) => state.setError)
  const recovered = useChat((state) => state.boot?.recoveredMessages ?? 0)
  const panelOpen = useChat((state) => state.panelOpen)
  const setPanelOpen = useChat((state) => state.setPanelOpen)
  const sidebarCollapsed = useChat((state) => state.boot?.config.window.sidebarCollapsed ?? false)
  const patchConfig = useChat((state) => state.patchConfig)
  const setDraft = useChat((state) => state.setDraft)
  const running = useChat((state) => state.run !== null)
  const [showRecovered, setShowRecovered] = useState(recovered > 0)

  const session = sessions.find((item) => item.id === activeSessionId) ?? null
  const rendered = useMemo(() => mergeLive(messages, live), [messages, live])
  const lastAssistantId = [...rendered].reverse().find((item) => item.role === 'assistant')?.id ?? null

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // 短会话直接渲染：多一层包裹只会让测量更脆。
  // 长会话（>80 条）才启用虚拟化，DOM 里只保留可视区附近的消息。
  const virtualize = rendered.length > VIRTUALIZE_THRESHOLD
  const virtualizer = useVirtualizer({
    count: rendered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 140,
    overscan: 6,
    enabled: virtualize
  })

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  useEffect(() => {
    if (!stickToBottom.current) return
    if (virtualize) {
      virtualizer.scrollToIndex(rendered.length - 1, { align: 'end' })
      return
    }
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [rendered, virtualize, virtualizer])


  return (
    <main className="flex min-w-0 flex-1 flex-col bg-surface">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-6">
        {sidebarCollapsed && (
          <button
            type="button"
            onClick={() => void patchConfig({ window: { sidebarCollapsed: false } })}
            className="rounded px-1.5 py-1 text-fg-subtle hover:text-fg"
            aria-label="展开侧栏"
            title="展开侧栏（Ctrl/⌘+B）"
          >
            <FontAwesomeIcon icon={Icon.sidebarExpand} className="text-[13px]" />
          </button>
        )}
        <span className="min-w-0 flex-1 truncate text-title font-medium">
          {session?.title ?? '新对话'}
        </span>
        <SessionMenu />
        {!panelOpen && (
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            className="rounded px-1.5 py-1 text-fg-subtle hover:text-fg"
            aria-label="展开参数面板"
            title="展开参数面板"
          >
            <FontAwesomeIcon icon={Icon.panelExpand} className="text-[13px]" />
          </button>
        )}
      </header>

      {showRecovered && (
        <div className="flex items-start gap-3 border-b border-line bg-surface px-6 py-2">
          <p className="min-w-0 flex-1 text-ui text-warn">
            上次生成被中断：{recovered} 条消息已标记为「已停止」，内容保留到中断前，可在对应消息上点「重新生成」。
          </p>
          <button
            type="button"
            onClick={() => setShowRecovered(false)}
            className="text-micro text-fg-subtle hover:text-fg"
          >
            关闭
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 border-b border-line bg-surface px-6 py-2">
          <p className="min-w-0 flex-1 text-ui text-danger">
            <span className="font-mono text-micro text-fg-subtle">[{error.code}] </span>
            {error.message}
          </p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-micro text-fg-subtle hover:text-fg"
          >
            关闭
          </button>
        </div>
      )}

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-6">
        <div className="mx-auto max-w-[760px] py-4">
          {rendered.length === 0 && <EmptyState onPick={setDraft} disabled={running} />}

          {virtualize ? (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((item) => {
                const message = rendered[item.index]
                if (!message) return null
                return (
                  <div
                    key={item.key}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${item.start}px)`
                    }}
                  >
                    <MessageItem message={message} isLastAssistant={message.id === lastAssistantId} />
                  </div>
                )
              })}
            </div>
          ) : (
            rendered.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                isLastAssistant={message.id === lastAssistantId}
              />
            ))
          )}
        </div>
      </div>

      <Composer />
    </main>
  )
}

/** 超过这个条数才启用虚拟化（docs/01 §4：500 条消息滚动不掉帧） */
const VIRTUALIZE_THRESHOLD = 80

const EXAMPLES = [
  '用三句话解释 SQLite 的 WAL 模式为什么适合流式写入',
  '帮我 review 这段 TypeScript 的类型设计',
  '把这个需求拆成可执行的开发任务清单'
]

/** 空态（docs/04 §4.9）：给三个可直接改写的示例，而不是一句干巴巴的提示 */
function EmptyState({
  onPick,
  disabled
}: {
  onPick: (text: string) => void
  disabled: boolean
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-4 py-16">
      <p className="text-display font-medium text-fg">今天想聊点什么？</p>
      <div className="flex w-full max-w-[520px] flex-col gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            disabled={disabled}
            onClick={() => onPick(example)}
            className="rounded-md border border-line px-3 py-2 text-left text-ui text-fg-muted hover:border-accent hover:text-fg disabled:opacity-50"
          >
            {example}
          </button>
        ))}
      </div>
      <p className="text-micro text-fg-subtle">Enter 发送，Shift+Enter 换行</p>
    </div>
  )
}

/**
 * 把"已落库消息"与"流式增量"合并成一份渲染数据。
 * 帧可能比 refreshThread 先到，所以要能把 live 里多出来的消息补进列表，
 * 否则新会话的第一句话会短暂消失。
 */
function mergeLive(messages: ChatMessage[], live: Record<string, LiveMessage>): ChatMessage[] {
  const merged = messages.map((message) => applyLive(message, live[message.id]))
  const known = new Set(merged.map((item) => item.id))

  for (const [id, entry] of Object.entries(live)) {
    if (known.has(id)) continue
    merged.push({
      id,
      sessionId: '',
      parentId: null,
      role: 'assistant',
      content: entry.text,
      reasoning: entry.reasoning || null,
      status: toStatus(entry.status),
      modelId: null,
      finishReason: null,
      error: entry.error
        ? {
            code: entry.error.code as NonNullable<ChatMessage['error']>['code'],
            message: entry.error.message
          }
        : null,
      tokens: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
  }
  return merged
}

function applyLive(message: ChatMessage, entry: LiveMessage | undefined): ChatMessage {
  if (!entry) return message
  return {
    ...message,
    content: entry.text || message.content,
    reasoning: entry.reasoning || message.reasoning,
    status: toStatus(entry.status),
    error: entry.error
      ? { code: entry.error.code as NonNullable<ChatMessage['error']>['code'], message: entry.error.message }
      : message.error
  }
}

function toStatus(status: LiveMessage['status']): MessageStatus {
  return status === 'done' ? 'complete' : status
}
