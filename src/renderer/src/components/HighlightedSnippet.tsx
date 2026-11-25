/**
 * 搜索命中的高亮片段。
 *
 * 片段里的命中处由主进程用 \u0001 / \u0002 包裹（不是 HTML），
 * 这里按标记切分后自己套 <mark>——数据库内容永远当纯文本处理，没有注入风险。
 */
export function HighlightedSnippet({ text }: { text: string }): React.JSX.Element {
  const segments = text.split(/\u0001|\u0002/)

  // split 会丢掉分隔符，所以用奇偶位置还原"是否高亮"
  let highlighted = text.startsWith('\u0001')
  const parts: React.ReactNode[] = []

  for (const [index, segment] of segments.entries()) {
    if (index > 0) highlighted = !highlighted
    if (!segment) continue
    parts.push(
      highlighted ? (
        <mark key={index} className="rounded-sm bg-accent-subtle px-0.5 text-accent">
          {segment}
        </mark>
      ) : (
        <span key={index}>{segment}</span>
      )
    )
  }

  return <>{parts.length > 0 ? parts : text}</>
}
