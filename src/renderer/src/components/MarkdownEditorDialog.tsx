import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon, Icon } from './icons'

interface Props {
  initialValue: string
  /** 把内容写回输入框并关闭；不发送 */
  onApply: (value: string) => void
  /** 纯关闭：丢弃本次编辑，输入框保持打开前的值 */
  onClose: () => void
}

/**
 * 大段提示词编辑器（docs/04 §4.15）。
 *
 * 三个刻意的约束：
 * 1. 关闭 = 丢弃：本地草稿只有点「使用内容」才会写回输入框。
 * 2. Esc/Enter 不关闭：长文本里 Enter 就是换行，误触关闭的代价是整段丢失。
 * 3. 不发送：发送永远是输入框的职责（ADR-26）。
 */
export function MarkdownEditorDialog({
  initialValue,
  onApply,
  onClose
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState(initialValue)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Markdown 编辑器"
        // 只吞掉 Esc：防止将来出现全局 Esc 关弹层时误关；Enter 在 textarea 里就是换行
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
        className="flex h-[70vh] w-[860px] max-w-[calc(100vw-96px)] flex-col rounded-lg border border-line bg-surface shadow-md"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <p className="text-body text-fg">Markdown 编辑器</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭编辑器"
            title="关闭并丢弃本次编辑"
            className="rounded px-1.5 py-1 text-fg-subtle hover:text-fg"
          >
            <FontAwesomeIcon icon={Icon.close} className="text-[12px]" />
          </button>
        </header>

        <div className="min-h-0 flex-1 p-4">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Markdown 内容"
            spellCheck={false}
            placeholder="在这里写 Markdown 提示词…"
            className="h-full w-full resize-none rounded-md border border-line bg-canvas p-3 font-mono text-body leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-accent"
          />
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-4 py-3">
          <p className="text-micro text-fg-subtle">关闭会丢弃本次编辑；使用后仍需在输入框发送</p>
          <button
            type="button"
            onClick={() => onApply(draft)}
            className="rounded-md bg-accent px-3 py-1.5 text-ui font-medium text-white hover:bg-accent-hover"
          >
            使用内容
          </button>
        </footer>
      </div>
    </div>
  )
}
