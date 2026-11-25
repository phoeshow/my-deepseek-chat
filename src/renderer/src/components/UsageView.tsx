import { useEffect, useState } from 'react'
import type { UsageRange, UsageSummary } from '@shared/types'
import { formatTokens } from './ParamPanel'
import { useChat } from '../store/chat'

/**
 * 用量仪表盘（v1.1）。
 *
 * 既定事实：
 * - 只统计 tokens / 缓存命中 / 延迟，**不换算费用**（价格会变，写死单价会误导）
 * - 趋势图**固定近 7 天**；上方的范围筛选只作用于卡片与两张明细表，
 *   这样"趋势"的口径不随筛选变化
 * - 图表用 CSS 柱状自己画：只有 7 根柱子，为它引一个图表库不值（100KB+）
 */
const RANGES: readonly { value: UsageRange; label: string }[] = [
  { value: 'today', label: '今日' },
  { value: '7d', label: '近 7 天' },
  { value: 'all', label: '全部' }
]

export function UsageView(): React.JSX.Element {
  const [range, setRange] = useState<UsageRange>('7d')
  const [data, setData] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const setView = useChat((state) => state.setView)
  const selectSession = useChat((state) => state.selectSession)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void window.api.usage
      .summary(range)
      .then((result) => {
        if (cancelled) return
        if (result.ok) setData(result.data)
        else setError(result.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [range])

  const totals = data?.totals
  const cacheRate =
    totals && totals.cacheHitTokens + totals.cacheMissTokens > 0
      ? totals.cacheHitTokens / (totals.cacheHitTokens + totals.cacheMissTokens)
      : null
  const hasData = (totals?.requests ?? 0) > 0

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-surface">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-6">
        <span className="min-w-0 flex-1 truncate text-title font-medium">用量</span>
        <button
          type="button"
          onClick={() => setView('chat')}
          className="rounded px-2 py-1 text-micro text-fg-subtle hover:text-fg"
        >
          返回对话
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[760px] space-y-6">
          <div className="flex items-center gap-1">
            {RANGES.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setRange(item.value)}
                aria-pressed={range === item.value}
                className={`rounded-sm border px-3 py-1 text-micro ${
                  range === item.value
                    ? 'border-accent bg-accent-subtle text-accent'
                    : 'border-line text-fg-muted hover:text-fg'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {error && <p className="text-ui text-danger">{error}</p>}
          {loading && <p className="text-ui text-fg-subtle">加载中…</p>}

          {!loading && !hasData && (
            <p className="py-10 text-center text-ui text-fg-subtle">
              这个时间范围内还没有请求记录
            </p>
          )}

          {!loading && hasData && totals && (
            <>
              <section className="grid grid-cols-3 gap-3">
                <Card
                  label="请求数"
                  value={String(totals.requests)}
                  hint={
                    totals.avgDurationMs !== null
                      ? `均耗时 ${(totals.avgDurationMs / 1000).toFixed(1)}s`
                      : undefined
                  }
                />
                <Card
                  label="tokens"
                  value={formatTokens(totals.promptTokens + totals.completionTokens)}
                  hint={`输入 ${formatTokens(totals.promptTokens)} · 输出 ${formatTokens(totals.completionTokens)}`}
                />
                <Card
                  label="缓存命中"
                  value={cacheRate === null ? '—' : `${Math.round(cacheRate * 100)}%`}
                  hint={
                    totals.avgFirstTokenMs !== null
                      ? `均首字 ${(totals.avgFirstTokenMs / 1000).toFixed(1)}s`
                      : undefined
                  }
                />
              </section>

              <section>
                <h2 className="mb-2 text-ui font-semibold text-fg-muted">近 7 天 tokens</h2>
                <DailyBars daily={data?.daily ?? []} />
              </section>

              <section>
                <h2 className="mb-2 text-ui font-semibold text-fg-muted">按模型</h2>
                <div className="overflow-x-auto rounded-md border border-line">
                  <table className="w-full text-ui">
                    <thead>
                      <tr className="border-b border-line bg-canvas text-fg-muted">
                        <Th>模型</Th>
                        <Th align="right">请求</Th>
                        <Th align="right">输入</Th>
                        <Th align="right">输出</Th>
                        <Th align="right">推理</Th>
                        <Th align="right">缓存命中</Th>
                        <Th align="right">均首字</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.byModel.map((row) => (
                        <tr key={row.modelId} className="border-b border-line-subtle last:border-0">
                          <Td mono>{row.modelId}</Td>
                          <Td align="right">{row.requests}</Td>
                          <Td align="right">{formatTokens(row.prompt)}</Td>
                          <Td align="right">{formatTokens(row.completion)}</Td>
                          <Td align="right">{row.reasoning ? formatTokens(row.reasoning) : '—'}</Td>
                          <Td align="right">
                            {row.cacheHit + row.cacheMiss > 0
                              ? `${Math.round((row.cacheHit / (row.cacheHit + row.cacheMiss)) * 100)}%`
                              : '—'}
                          </Td>
                          <Td align="right">
                            {row.avgFirstToken === null
                              ? '—'
                              : `${(row.avgFirstToken / 1000).toFixed(1)}s`}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h2 className="mb-2 text-ui font-semibold text-fg-muted">开销最高的会话</h2>
                <ul className="overflow-hidden rounded-md border border-line">
                  {(data?.topSessions.length ?? 0) === 0 && (
                    <li className="px-3 py-3 text-ui text-fg-subtle">暂无数据</li>
                  )}
                  {data?.topSessions.map((row) => (
                    <li key={row.sessionId} className="border-b border-line-subtle last:border-0">
                      <button
                        type="button"
                        onClick={() => {
                          void selectSession(row.sessionId)
                          setView('chat')
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-hover"
                      >
                        <span className="min-w-0 flex-1 truncate text-ui text-fg">{row.title}</span>
                        <span className="shrink-0 font-mono text-micro text-fg-muted">
                          {formatTokens(row.tokens)}
                        </span>
                        <span className="w-12 shrink-0 text-right text-micro text-fg-subtle">
                          {row.requests} 次
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

function Card({
  label,
  value,
  hint
}: {
  label: string
  value: string
  hint?: string
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-line px-4 py-3">
      <p className="text-micro text-fg-subtle">{label}</p>
      <p className="mt-1 font-mono text-display font-semibold leading-tight text-fg">{value}</p>
      {hint && <p className="mt-1 text-micro text-fg-subtle">{hint}</p>}
    </div>
  )
}

/**
 * 纯 CSS 柱状图：柱高按最大值归一化，最小可见高度 2px（避免全 0 时看不见）。
 * 用 title 属性承载精确值，不额外做 tooltip —— 7 根柱子的信息量不值得。
 */
function DailyBars({ daily }: { daily: { day: string; tokens: number }[] }): React.JSX.Element {
  const max = Math.max(...daily.map((item) => item.tokens), 1)
  const weekday = ['日', '一', '二', '三', '四', '五', '六']

  // 柱子与日期标签必须共用同一个 grid，否则两套对齐规则会让它们错位
  return (
    <div className="rounded-md border border-line px-4 pb-3 pt-4">
      <div className="grid grid-cols-7 items-end gap-3">
        {daily.map((item) => (
          <div key={item.day} className="flex h-24 items-end justify-center">
            <div
              title={`${item.day}：${formatTokens(item.tokens)} tokens`}
              className="w-6 rounded-sm bg-accent"
              style={{ height: `${Math.max((item.tokens / max) * 88, item.tokens > 0 ? 4 : 2)}px` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-3">
        {daily.map((item) => (
          <span key={item.day} className="text-center text-micro text-fg-subtle">
            {weekday[new Date(`${item.day}T00:00:00`).getDay()]}
          </span>
        ))}
      </div>
    </div>
  )
}

function Th({
  children,
  align = 'left'
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
}): React.JSX.Element {
  return (
    <th
      className={`px-3 py-2 text-micro font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  align = 'left',
  mono = false
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
  mono?: boolean
}): React.JSX.Element {
  return (
    <td
      className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'} ${
        mono ? 'font-mono text-meta' : ''
      } text-fg`}
    >
      {children}
    </td>
  )
}
