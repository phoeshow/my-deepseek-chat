import { useEffect, useMemo, useState } from 'react'
import { useChat } from '../store/chat'
import { FontAwesomeIcon, Icon } from './icons'
import { InfoTip } from './InfoTip'

/**
 * 右栏参数面板（docs/04 §4.5/§4.6）。
 *
 * 温度 / 最大输出 / 系统提示词都属于**会话级**设定，写入后对后续轮次生效。
 * 上下文预算与缓存命中来自最近一次请求的 usage，本会话累计则由已落库消息聚合。
 */
export function ParamPanel({ width }: { width: number }): React.JSX.Element | null {
  const session = useChat((state) => state.sessions.find((item) => item.id === state.activeSessionId))
  const models = useChat((state) => state.models)
  const messages = useChat((state) => state.messages)
  const updateSession = useChat((state) => state.updateSession)
  const patchConfig = useChat((state) => state.patchConfig)

  const [temperature, setTemperature] = useState(session?.temperature ?? 1)
  const [maxTokens, setMaxTokens] = useState(session?.maxTokens ? String(session.maxTokens) : '')
  const [systemPrompt, setSystemPrompt] = useState(session?.systemPrompt ?? '')

  // 切换会话时用该会话的值重新填充控件
  useEffect(() => {
    setTemperature(session?.temperature ?? 1)
    setMaxTokens(session?.maxTokens ? String(session.maxTokens) : '')
    setSystemPrompt(session?.systemPrompt ?? '')
  }, [session?.id, session?.temperature, session?.maxTokens, session?.systemPrompt])

  const stats = useMemo(() => {
    const withTokens = messages.filter((message) => message.tokens !== null)
    const last = withTokens.at(-1)?.tokens ?? null
    const used = messages.reduce(
      (sum, message) => sum + (message.tokens ? message.tokens.prompt + message.tokens.completion : 0),
      0
    )
    const contextWindow =
      models.find((model) => model.id === (session?.modelId ?? models[0]?.id))?.contextWindow ?? null
    const usedContext = last ? last.prompt + last.completion : 0
    const cacheRate =
      last && last.prompt > 0 && last.cacheHit !== undefined ? last.cacheHit / last.prompt : null
    return { used, usedContext, contextWindow, cacheRate }
  }, [messages, models, session?.modelId])

  const commitNumber = (raw: string, fallback: number | null): void => {
    const parsed = Number.parseFloat(raw)
    const next = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 2) : fallback
    setTemperature(next ?? 1)
    void updateSession({ temperature: next })
  }

  return (
    <aside
      className="flex shrink-0 flex-col border-l border-line bg-canvas"
      style={{ width }}
    >
      <header className="flex h-12 shrink-0 items-center justify-between px-4">
        <span className="text-ui font-semibold text-fg-muted">参数</span>
        <button
          type="button"
          onClick={() => void patchConfig({ window: { panelCollapsed: true } })}
          className="rounded px-1.5 text-fg-subtle hover:text-fg"
          aria-label="折叠参数面板"
          title="折叠参数面板"
        >
          <FontAwesomeIcon icon={Icon.panelCollapse} className="text-[11px]" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <label htmlFor="temperature" className="text-ui text-fg-muted">
                温度
              </label>
              <InfoTip label="温度参数说明与官方推荐值">
                <TemperatureHelp />
              </InfoTip>
            </span>
            <span className="font-mono text-micro text-fg">{temperature.toFixed(1)}</span>
          </div>
          <input
            id="temperature"
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={temperature}
            onChange={(event) => setTemperature(Number(event.target.value))}
            onPointerUp={(event) => commitNumber((event.target as HTMLInputElement).value, 1)}
            onKeyUp={(event) => commitNumber((event.target as HTMLInputElement).value, 1)}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-line"
            style={{ accentColor: 'var(--color-accent)' }}
          />
          <div className="mt-1 flex justify-between text-micro text-fg-subtle">
            <span>精确 0</span>
            <span>发散 2</span>
          </div>
        </section>

        <section>
          <label htmlFor="max-tokens" className="text-ui text-fg-muted">
            最大输出
          </label>
          <input
            id="max-tokens"
            type="number"
            min={1}
            value={maxTokens}
            placeholder="不限制"
            onChange={(event) => setMaxTokens(event.target.value)}
            onBlur={() => {
              const parsed = Number.parseInt(maxTokens, 10)
              const next = Number.isFinite(parsed) && parsed > 0 ? parsed : null
              setMaxTokens(next ? String(next) : '')
              void updateSession({ maxTokens: next })
            }}
            className="mt-2 w-full rounded-sm border border-line bg-surface px-2 py-1.5 font-mono text-meta text-fg outline-none focus:border-accent"
          />
        </section>

        <section>
          <label htmlFor="system-prompt" className="text-ui text-fg-muted">
            系统提示词
          </label>
          <textarea
            id="system-prompt"
            value={systemPrompt}
            rows={4}
            placeholder="例如：回答尽量简洁，先给结论。"
            onChange={(event) => setSystemPrompt(event.target.value)}
            onBlur={() => {
              if (systemPrompt.trim() === (session?.systemPrompt ?? '')) return
              void updateSession({ systemPrompt: systemPrompt.trim() || null })
            }}
            className="mt-2 w-full resize-y rounded-sm border border-line bg-surface px-2 py-1.5 text-ui text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
          />
        </section>

        <section className="border-t border-line-subtle pt-4">
          <p className="text-ui font-semibold text-fg-muted">上下文</p>
          <ContextBar used={stats.usedContext} total={stats.contextWindow} />
          {stats.cacheRate !== null && (
            <p className="mt-2 text-micro text-fg-subtle">
              缓存命中 {Math.round(stats.cacheRate * 100)}%
            </p>
          )}
          <p className="mt-1 text-micro text-fg-subtle">
            本会话累计 {formatTokens(stats.used)} tokens
          </p>
        </section>
      </div>
    </aside>
  )
}

/**
 * 温度说明（docs/04 §4.5）。
 * 取值来自 DeepSeek 官方「Temperature 设置」页，不是自定义经验值：
 * 代码/数学 0.0、数据抽取分析 1.0、通用对话 1.3、翻译 1.3、创意写作 1.5。
 * 另一个必须写清的点：思考模式下该参数不生效（传了不报错，但被忽略）。
 */
const TEMPERATURE_PRESETS: readonly [string, string][] = [
  ['代码生成 / 数学解题', '0.0'],
  ['数据抽取 / 分析', '1.0'],
  ['通用对话', '1.3'],
  ['翻译', '1.3'],
  ['创意类写作 / 诗歌', '1.5']
]

function TemperatureHelp(): React.JSX.Element {
  return (
    <div>
      <p className="font-medium text-fg">温度：0 – 2，默认 1.0</p>
      <p className="mt-1 text-fg-muted">
        越低越确定、越高越发散。官方建议只调温度或 top_p 其中之一。
      </p>
      <p className="mt-2 text-fg-subtle">DeepSeek 官方按场景推荐：</p>
      <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 font-mono">
        {TEMPERATURE_PRESETS.map(([scene, value]) => (
          <div key={scene} className="col-span-2 grid grid-cols-[1fr_auto] gap-x-3">
            <dt className="font-sans text-fg-muted">{scene}</dt>
            <dd className="text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-warn">思考模式开启时该参数不生效（不会报错，但被忽略）。</p>
    </div>
  )
}

function ContextBar({ used, total }: { used: number; total: number | null }): React.JSX.Element {
  if (total === null || total <= 0) {
    return <p className="mt-2 text-micro text-fg-subtle">未知上下文长度（模型信息未提供）</p>
  }

  const ratio = Math.min(used / total, 1)
  const tone = ratio >= 0.95 ? 'bg-danger' : ratio >= 0.8 ? 'bg-warn' : 'bg-accent'

  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between font-mono text-micro text-fg">
        <span>{formatTokens(used)}</span>
        <span className="text-fg-subtle">/ {formatTokens(total)}</span>
      </div>
      <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-line">
        <div className={`h-full ${tone}`} style={{ width: `${Math.max(ratio * 100, 1)}%` }} />
      </div>
      <p className="mt-1 text-micro text-fg-subtle">{(ratio * 100).toFixed(1)}% 已用</p>
    </div>
  )
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}
