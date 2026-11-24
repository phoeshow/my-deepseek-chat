import { isValidElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'

interface Props {
  content: string
  /** 生成中：代码块高亮防抖，链接不可点之前已存在 */
  streaming?: boolean
}

/**
 * Markdown 渲染。
 *
 * 安全边界：不启用 rehype-raw，因此模型输出的 HTML 一律按文本处理；
 * 链接不直接导航（窗口被 Electron 拦），而是交给主进程做协议校验 + 确认弹窗。
 */
export function MarkdownRenderer({ content, streaming = false }: Props): React.JSX.Element {
  return (
    <div className={`markdown-body${streaming ? ' is-streaming' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <CodeFence streaming={streaming}>{children}</CodeFence>,
          a: ({ href, children }) => (
            <ExternalLink href={href ?? ''}>{children}</ExternalLink>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table>{children}</table>
            </div>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

/** react-markdown 把代码块包成 <pre><code class="language-x">，这里拆出语言与正文 */
function CodeFence({
  children,
  streaming
}: {
  children: ReactNode
  streaming: boolean
}): React.JSX.Element {
  const child = Array.isArray(children) ? children[0] : children

  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    return <pre className="my-3 overflow-x-auto rounded-md border border-line p-3">{children}</pre>
  }

  const className = child.props.className ?? ''
  const match = /language-([\w+#-]+)/.exec(className)
  const raw = child.props.children
  const code = (Array.isArray(raw) ? raw.join('') : String(raw ?? '')).replace(/\n$/, '')

  return <CodeBlock code={code} lang={match?.[1] ?? 'text'} streaming={streaming} />
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }): React.JSX.Element {
  const isHttp = /^https?:\/\//i.test(href)
  if (!isHttp) {
    // 非 http(s) 协议一律不渲染成链接，避免 javascript: / file: 之类的诱导
    return <span className="underline decoration-line">{children}</span>
  }

  return (
    <button
      type="button"
      onClick={() => void window.api.system.openExternal(href)}
      className="text-accent underline hover:no-underline"
      title={href}
    >
      {children}
    </button>
  )
}
