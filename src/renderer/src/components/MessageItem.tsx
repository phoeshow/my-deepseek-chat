import { useState } from 'react'
import type { ChatMessage } from '@shared/types'
import { useChat } from '../store/chat'
import { FontAwesomeIcon, Icon } from './icons'
import { MarkdownRenderer } from './markdown/MarkdownRenderer'

interface Props {
  message: ChatMessage
  isLastAssistant: boolean
}

export function MessageItem({ message, isLastAssistant }: Props): React.JSX.Element {
  const regenerate = useChat((state) => state.regenerate)
  const running = useChat((state) => state.run !== null)
  const [copied, setCopied] = useState(false)

  const isUser = message.role === 'user'
  const streaming = message.status === 'streaming'

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
            <FontAwesomeIcon
              icon={Icon.assistant}
              className="text-[9px] text-fg-subtle"
              aria-hidden="true"
            />
            <span className="text-micro text-fg-subtle">{message.modelId ?? 'DeepSeek'}</span>
          </div>
        )}

        {!isUser && (message.reasoning || streaming) ? (
          <ReasoningBlock
            text={message.reasoning ?? ''}
            durationMs={message.tokens?.reasoningMs}
            streaming={streaming}
          />
        ) : null}

        <div className={isUser ? 'rounded-md bg-bubble px-3.5 py-2.5' : ''}>
          <MarkdownRenderer content={message.content} streaming={streaming} />
        </div>

        {message.status === 'aborted' && !isUser && (
          <p className="mt-1 text-micro text-fg-subtle">
            已停止
            {message.content.length > 0 ? '（已保留中断前内容）' : ''}
          </p>
        )}
        {message.status === 'error' && !isUser && (
          <p className="mt-1 text-micro text-danger">{message.error?.message ?? '生成失败'}</p>
        )}

        <div className="mt-1 flex h-6 items-center gap-3 text-micro text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1 hover:text-fg"
          >
            <FontAwesomeIcon icon={copied ? Icon.copied : Icon.copy} className="text-[10px]" />
            {copied ? '已复制' : '复制'}
          </button>
          {isLastAssistant && !streaming && (
            <button
              type="button"
              onClick={() => void regenerate(message.id)}
              disabled={running}
              className="inline-flex items-center gap-1 hover:text-fg disabled:opacity-40"
            >
              <FontAwesomeIcon icon={Icon.regenerate} className="text-[10px]" />
              重新生成
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * 思维链（docs/04 §4.3）：默认折叠，左竖线 + 次要色小字。
 * 生成中显示「正在思考…」并做微光扫过；结束后显示真实耗时。
 */
function ReasoningBlock({
  text,
  durationMs,
  streaming
}: {
  text: string
  durationMs?: number
  streaming: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)

  const label = streaming
    ? '正在思考…'
    : durationMs !== undefined
      ? `已思考 ${(durationMs / 1000).toFixed(1)}s`
      : '思维链'

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`text-micro ${streaming ? 'shimmer text-fg-muted' : 'text-fg-subtle hover:text-fg-muted'}`}
        aria-expanded={open}
      >
        <FontAwesomeIcon
          icon={open ? Icon.reasoningOpen : Icon.reasoningClosed}
          className="mr-1.5 text-[8px]"
          aria-hidden="true"
        />
        {label}
      </button>

      {open && (
        <div className="mt-1 border-l-2 border-line-subtle pl-3 text-ui leading-relaxed whitespace-pre-wrap break-words text-fg-muted">
          {text || '（模型尚未输出思考内容）'}
        </div>
      )}
    </div>
  )
}
