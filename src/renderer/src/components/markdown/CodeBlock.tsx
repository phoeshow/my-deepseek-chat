import { useEffect, useMemo, useState } from 'react'
import { highlightCode, normalizeLang } from '../../lib/shiki'

interface Props {
  code: string
  lang: string
  /** 流式中的代码块要防抖，否则每帧重新高亮会拖垮滚动 */
  streaming?: boolean
}

const MAX_HIGHLIGHT_CHARS = 20_000
const STREAMING_DEBOUNCE_MS = 180

export function CodeBlock({ code, lang, streaming = false }: Props): React.JSX.Element {
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const label = useMemo(() => normalizeLang(lang), [lang])

  // 流式期间每次内容变化都重新高亮太贵：静默 180ms 后再算一次
  const [deferredCode, setDeferredCode] = useState(code)
  useEffect(() => {
    if (!streaming) {
      setDeferredCode(code)
      return
    }
    const timer = setTimeout(() => setDeferredCode(code), STREAMING_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [code, streaming])

  useEffect(() => {
    let cancelled = false
    if (deferredCode.length > MAX_HIGHLIGHT_CHARS) {
      setHtml(null)
      return
    }
    void highlightCode(deferredCode, lang).then((result) => {
      if (!cancelled) setHtml(result)
    })
    return () => {
      cancelled = true
    }
  }, [deferredCode, lang])

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="my-3 overflow-hidden rounded-md border border-line">
      <div className="flex h-8 items-center justify-between border-b border-line-subtle bg-code-bg px-3">
        <span className="text-micro uppercase tracking-wide text-fg-subtle">{label}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="text-micro text-fg-subtle hover:text-fg"
        >
          {copied ? '✓ 已复制' : '复制'}
        </button>
      </div>
      <div className="overflow-x-auto bg-code-bg p-3 text-meta leading-relaxed">
        {html ? (
          // shiki 输出已转义代码文本，不含未过滤的用户 HTML
          <div className="shiki-block" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="font-mono">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  )
}
