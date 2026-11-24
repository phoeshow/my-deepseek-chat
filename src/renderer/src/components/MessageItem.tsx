import { useState } from 'react'
import type { ChatMessage } from '@shared/types'
import { useChat } from '../store/chat'

interface Props {
  message: ChatMessage
  isLastAssistant: boolean
}

export function MessageItem({ message, isLastAssistant }: Props): React.JSX.Element {
  const regenerate = useChat((state) => state.regenerate)
  const running = useChat((state) => state.run !== null)
  const [copied, setCopied] = useState(false)

  const isUser = message.role === 'user'

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`group py-3 ${isUser ? 'flex justify-end' : ''}`}>
      <div className={isUser ? 'max-w-[70%]' : 'w-full'}>
        {!isUser && (
          <div className="mb-1 flex items-center gap-2">
            <span aria-hidden="true" className="text-meta text-fg-subtle">
              ✦
            </span>
            <span className="text-micro text-fg-subtle">{message.modelId ?? 'DeepSeek'}</span>
          </div>
        )}

        {!isUser && message.reasoning ? <ReasoningBlock text={message.reasoning} /> : null}

        <div
          className={
            isUser
              ? 'rounded-md bg-bubble px-3.5 py-2.5 text-body whitespace-pre-wrap break-words'
              : 'text-body whitespace-pre-wrap break-words'
          }
        >
          {message.content}
          {message.status === 'streaming' && (
            <span className="ml-0.5 inline-block h-[1.1em] w-0.5 translate-y-[0.15em] animate-pulse bg-accent align-middle" />
          )}
        </div>

        {message.status === 'aborted' && !isUser && (
          <p className="mt-1 text-micro text-fg-subtle">已停止</p>
        )}
        {message.status === 'error' && !isUser && (
          <p className="mt-1 text-micro text-danger">{message.error?.message ?? '生成失败'}</p>
        )}

        <div className="mt-1 flex h-6 items-center gap-3 text-micro text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100">
          <button type="button" onClick={() => void copy()} className="hover:text-fg">
            {copied ? '✓ 已复制' : '复制'}
          </button>
          {isLastAssistant && message.status !== 'streaming' && (
            <button
              type="button"
              onClick={() => void regenerate(message.id)}
              disabled={running}
              className="hover:text-fg disabled:opacity-40"
            >
              重新生成
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** docs/04 §4.3：默认折叠，左竖线 + 次要色小字 */
function ReasoningBlock({ text }: { text: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-micro text-fg-subtle hover:text-fg-muted"
        aria-expanded={open}
      >
        {open ? '▾' : '▸'} 已思考
      </button>
      {open && (
        <div className="mt-1 border-l-2 border-line-subtle pl-3 text-ui whitespace-pre-wrap break-words text-fg-muted">
          {text}
        </div>
      )}
    </div>
  )
}
