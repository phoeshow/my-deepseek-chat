import { useRef, useState } from 'react'
import { useChat } from '../store/chat'
import { Switch } from './Switch'

export function Composer(): React.JSX.Element {
  const text = useChat((state) => state.draft)
  const setText = useChat((state) => state.setDraft)
  const running = useChat((state) => state.run)
  const send = useChat((state) => state.send)
  const abort = useChat((state) => state.abort)
  const activeSessionId = useChat((state) => state.activeSessionId)
  const messages = useChat((state) => state.messages)
  const startEditMessage = useChat((state) => state.startEditMessage)
  const config = useChat((state) => state.boot?.config)
  const session = useChat((state) =>
    state.sessions.find((item) => item.id === state.activeSessionId)
  )
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  /**
   * 三级思考开关的最内层（docs/05 T2）：只影响**下一条**消息，
   * 发出去之后立刻回到会话/全局生效值，不污染会话设定。
   */
  const [thinkingOverride, setThinkingOverride] = useState<boolean | null>(null)
  const effectiveThinking = session?.thinking ?? config?.defaultThinking ?? true
  const currentThinking = thinkingOverride ?? effectiveThinking
  const overridden = thinkingOverride !== null && thinkingOverride !== effectiveThinking

  const canSend = text.trim().length > 0 && !running && Boolean(activeSessionId)

  const submit = (): void => {
    if (!canSend) return
    const value = text
    const overrides = overridden ? { thinking: currentThinking } : undefined
    setText('')
    setThinkingOverride(null)
    void send(value, overrides)
    // 发送后把输入框缩回两行
    if (textareaRef.current) textareaRef.current.style.height = ''
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // AGENTS.md / docs/04 §6：Enter 发送、Shift+Enter 换行
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
      return
    }
    // 输入框为空时 ↑ 直接编辑最后一条用户消息（docs/04 §6）
    if (event.key === 'ArrowUp' && text.length === 0 && !running) {
      const lastUser = [...messages].reverse().find((item) => item.role === 'user')
      if (lastUser) {
        event.preventDefault()
        startEditMessage(lastUser.id)
        return
      }
    }
    if (event.key === 'Escape' && running) {
      event.preventDefault()
      void abort()
    }
  }

  const resize = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setText(event.target.value)
    const el = event.target
    el.style.height = ''
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  return (
    // 输入区独立成带：更深的底色 + 顶部实线，和对话区有明确分界
    <div className="shrink-0 border-t border-line bg-canvas px-6 pb-3 pt-3">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={resize}
        onKeyDown={onKeyDown}
        // 初始两行：高度本身就是"可以多行"的暗示
        rows={2}
        placeholder={activeSessionId ? '输入消息，Enter 发送，Shift+Enter 换行' : '先新建一个会话'}
        disabled={!activeSessionId}
        className="max-h-[200px] w-full resize-none rounded-lg border border-line bg-surface px-3.5 py-2.5 text-body text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-accent disabled:opacity-60"
      />

      {/* 控件独立一行、靠右：与输入框分离，不挤在输入区域里 */}
      <div className="mt-2 flex items-center justify-end gap-4">
        <div className="flex select-none items-center gap-2 text-micro text-fg-muted">
          {/* 文字只是视觉标签；可访问名称由开关自己的 aria-label 提供 */}
          <span aria-hidden="true" className={currentThinking ? 'text-fg' : ''}>
            深度思考
          </span>
          <Switch
            checked={currentThinking}
            onChange={(next) => setThinkingOverride(next)}
            label="深度思考"
            title={
              overridden
                ? '深度思考：仅本条生效，发送后恢复会话设定'
                : '深度思考：跟随会话/全局设定，点击仅对本条生效'
            }
          />
        </div>

        {overridden && <span className="text-micro text-accent">仅本条生效</span>}

        {running ? (
          <button
            type="button"
            onClick={() => void abort()}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-line px-3.5 font-mono text-micro font-semibold leading-none tracking-wide text-fg transition-transform hover:bg-surface-hover active:scale-90"
            aria-label="停止生成"
            title="停止生成（Esc）"
          >
            停止
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className="btn-send inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-accent px-3.5 font-mono text-micro font-semibold leading-none tracking-wide text-white hover:bg-accent-hover disabled:bg-line disabled:text-fg-subtle"
            aria-label="发送"
            title="发送（Enter）"
          >
            Enter
          </button>
        )}
      </div>
    </div>
  )
}
