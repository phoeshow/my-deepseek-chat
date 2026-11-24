import { useRef, useState } from 'react'
import { useChat } from '../store/chat'

export function Composer(): React.JSX.Element {
  const [text, setText] = useState('')
  const running = useChat((state) => state.run)
  const send = useChat((state) => state.send)
  const abort = useChat((state) => state.abort)
  const activeSessionId = useChat((state) => state.activeSessionId)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const canSend = text.trim().length > 0 && !running && Boolean(activeSessionId)

  const submit = (): void => {
    if (!canSend) return
    const value = text
    setText('')
    void send(value)
    // 发送后立刻把输入框缩回去，避免光标停在高位
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // AGENTS.md / docs/04 §6：Enter 发送、Shift+Enter 换行
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
      return
    }
    if (event.key === 'Escape' && running) {
      event.preventDefault()
      void abort()
    }
  }

  const resize = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setText(event.target.value)
    const el = event.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  return (
    <div className="border-t border-line px-6 py-4">
      <div className="mx-auto flex max-w-[760px] items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={resize}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={activeSessionId ? '输入消息，Enter 发送，Shift+Enter 换行' : '先新建一个会话'}
          disabled={!activeSessionId}
          className="max-h-[200px] min-h-[52px] flex-1 resize-none rounded-lg border border-line bg-surface px-3.5 py-3 text-body text-fg outline-none placeholder:text-fg-subtle focus:border-accent disabled:opacity-60"
        />
        {running ? (
          <button
            type="button"
            onClick={() => void abort()}
            className="h-[52px] w-[52px] shrink-0 rounded-lg border border-line text-fg hover:bg-surface-hover"
            aria-label="停止生成"
          >
            ■
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className="h-[52px] w-[52px] shrink-0 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40"
            aria-label="发送"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  )
}
