import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@shared/types'
import { useChat } from '../store/chat'
import { FontAwesomeIcon, Icon } from './icons'
import { MarkdownRenderer } from './markdown/MarkdownRenderer'

interface Props {
  message: ChatMessage
  isLastAssistant: boolean
  /** 从搜索结果跳转过来时短暂高亮 */
  highlighted?: boolean
}

export function MessageItem({
  message,
  isLastAssistant,
  highlighted = false
}: Props): React.JSX.Element {
  const regenerate = useChat((state) => state.regenerate)
  const switchVersion = useChat((state) => state.switchVersion)
  const editMessage = useChat((state) => state.editMessage)
  const startEditMessage = useChat((state) => state.startEditMessage)
  const cancelEditMessage = useChat((state) => state.cancelEditMessage)
  const editing = useChat((state) => state.editingMessageId === message.id)
  const running = useChat((state) => state.run !== null)
  const [copied, setCopied] = useState(false)

  const isUser = message.role === 'user'
  const streaming = message.status === 'streaming'
  const versions = message.versions

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      id={`msg-${message.id}`}
      className={`group scroll-mt-6 rounded-md py-3 transition-colors ${
        isUser ? 'flex justify-end' : ''
      } ${highlighted ? 'bg-accent-subtle/35' : ''}`}
    >
      <div className={isUser ? (editing ? 'w-full' : 'max-w-[70%]') : 'w-full'}>
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

        <div
          className={
            isUser
              ? `rounded-md px-3.5 py-2.5 ${
                  editing
                    ? 'border border-accent bg-surface'
                    : 'bg-bubble'
                }`
              : ''
          }
        >
          {editing ? (
            <InlineEditor
              initialValue={message.content}
              disabled={running}
              onCancel={cancelEditMessage}
              onSubmit={(text) => void editMessage(message.id, text)}
            />
          ) : (
            <MarkdownRenderer content={message.content} streaming={streaming} />
          )}
        </div>

        {!editing && versions && versions.total > 1 && (
          <div
            className="mt-1 flex items-center gap-1 text-micro text-fg-subtle"
            aria-label={`版本 ${versions.index} / ${versions.total}`}
          >
            <button
              type="button"
              onClick={() => void switchVersion(message.id, 'prev')}
              disabled={versions.index <= 1 || running}
              aria-label="上一个版本"
              className="rounded px-1 hover:text-fg disabled:opacity-30"
            >
              <FontAwesomeIcon icon={Icon.chevronLeft} className="text-[9px]" />
            </button>
            <span className="font-mono tabular-nums">
              {versions.index}/{versions.total}
            </span>
            <button
              type="button"
              onClick={() => void switchVersion(message.id, 'next')}
              disabled={versions.index >= versions.total || running}
              aria-label="下一个版本"
              className="rounded px-1 hover:text-fg disabled:opacity-30"
            >
              <FontAwesomeIcon icon={Icon.chevronRight} className="text-[9px]" />
            </button>
          </div>
        )}

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
          {isUser && !streaming && !editing && (
            <button
              type="button"
              onClick={() => startEditMessage(message.id)}
              disabled={running}
              className="inline-flex items-center gap-1 hover:text-fg disabled:opacity-40"
            >
              <FontAwesomeIcon icon={Icon.edit} className="text-[10px]" />
              编辑
            </button>
          )}
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
 * 行内编辑（docs/04 §4.14）。
 *
 * 独立组件而不是在 MessageItem 里堆 state：草稿必须在**挂载时**就带着原文，
 * 否则“打开后设 draft”的那一帧里光标会被放到 0，用户得自己按 End。
 */
function InlineEditor({
  initialValue,
  disabled,
  onCancel,
  onSubmit
}: {
  initialValue: string
  disabled: boolean
  onCancel: () => void
  onSubmit: (text: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(initialValue)
  const ref = useRef<HTMLTextAreaElement>(null)

  // 打开即聚焦，光标置末尾；只在挂载时做一次
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  // 自动增高，上限 320px，超出后内部滚动
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [draft])

  const canSave = draft.trim().length > 0 && draft.trim() !== initialValue.trim() && !disabled

  return (
    <div className="w-full">
      <textarea
        ref={ref}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // Enter 保存并发送、Shift+Enter 换行、Esc 取消（docs/04 §4.14）
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (canSave) onSubmit(draft)
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        rows={2}
        aria-label="编辑消息内容"
        className="max-h-[320px] w-full resize-none bg-transparent text-body leading-relaxed text-fg"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <span className="mr-auto text-micro text-fg-subtle">Enter 保存并发送 · Esc 取消</span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-sm px-2 py-1 text-micro text-fg-muted hover:bg-surface-hover hover:text-fg"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => onSubmit(draft)}
          disabled={!canSave}
          className="rounded-sm bg-accent px-2.5 py-1 text-micro text-white disabled:bg-line disabled:text-fg-subtle"
        >
          保存并发送
        </button>
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
