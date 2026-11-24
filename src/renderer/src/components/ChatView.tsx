import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, MessageStatus } from '@shared/types'
import { useChat, type LiveMessage } from '../store/chat'
import { Composer } from './Composer'
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
  const [showRecovered, setShowRecovered] = useState(recovered > 0)

  const session = sessions.find((item) => item.id === activeSessionId) ?? null
  const rendered = useMemo(() => mergeLive(messages, live), [messages, live])
  const lastAssistantId = [...rendered].reverse().find((item) => item.role === 'assistant')?.id ?? null

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !stickToBottom.current) return
    el.scrollTop = el.scrollHeight
  }, [rendered])


  return (
    <main className="flex min-w-0 flex-1 flex-col bg-surface">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-6">
        <span className="min-w-0 flex-1 truncate text-title font-medium">
          {session?.title ?? '新对话'}
        </span>
        <SessionMenu />
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
          {rendered.length === 0 && (
            <p className="py-16 text-center text-ui text-fg-subtle">
              输入一句话开始对话，Enter 发送，Shift+Enter 换行。
            </p>
          )}
          {rendered.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              isLastAssistant={message.id === lastAssistantId}
            />
          ))}
        </div>
      </div>

      <Composer />
    </main>
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
