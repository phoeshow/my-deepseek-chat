import { useEffect, useRef, useState } from 'react'
import type { ReasoningEffort } from '@shared/types'
import { useChat } from '../store/chat'
import { FontAwesomeIcon, Icon } from './icons'

/**
 * 会话级设定（docs/05 §M2.6）：模型、思考模式、思考强度。
 * 写入跟随会话，切换会话后各自还原；三级开关的中间层就是这里。
 *
 * 参数面板（温度 / 最大输出）在 M3 的右栏统一做，这里只放影响“用哪个模型、要不要深度思考”的项。
 */
export function SessionMenu(): React.JSX.Element {
  const session = useChat((state) => state.sessions.find((item) => item.id === state.activeSessionId))
  const models = useChat((state) => state.models)
  const config = useChat((state) => state.boot?.config)
  const updateSession = useChat((state) => state.updateSession)
  const running = useChat((state) => state.run !== null)

  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭：弹层是自己写的，没有依赖 Radix 的 dismissable layer
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const modelId = session?.modelId ?? config?.defaultModelId ?? models[0]?.id ?? null
  const modelLabel = models.find((item) => item.id === modelId)?.name ?? '选择模型'

  // 三级开关的生效值：会话设定优先，未设定则继承全局默认
  const thinking = session?.thinking ?? config?.defaultThinking ?? false
  const effort = session?.effort ?? config?.defaultEffort ?? 'high'
  const inheritedThinking = session?.thinking === null || session?.thinking === undefined

  const apply = (patch: Parameters<typeof updateSession>[0]): void => {
    void updateSession(patch)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-micro text-fg-muted hover:border-accent hover:text-fg"
      >
        {modelLabel}
        <FontAwesomeIcon icon={Icon.chevronDown} className="text-[8px] text-fg-subtle" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="会话设定"
          className="absolute right-0 top-8 z-20 w-[260px] rounded-md border border-line bg-surface p-1 shadow-md"
        >
          <SectionLabel>模型</SectionLabel>
          <div className="max-h-[220px] overflow-y-auto">
            {models.length === 0 && (
              <p className="px-3 py-2 text-micro text-fg-subtle">尚未拉取模型列表，请到设置里刷新</p>
            )}
            {models.map((model) => (
              <Option
                key={model.id}
                selected={model.id === modelId}
                onSelect={() => apply({ modelId: model.id })}
              >
                <span className="min-w-0 flex-1 truncate">{model.name}</span>
                {model.contextWindow !== null && (
                  <span className="shrink-0 text-micro text-fg-subtle">
                    {formatContext(model.contextWindow)}
                  </span>
                )}
              </Option>
            ))}
          </div>

          <div className="my-1 border-t border-line-subtle" />

          <SectionLabel>
            思考模式
            {inheritedThinking && <span className="ml-1 text-fg-subtle">（继承全局：{thinking ? '开' : '关'}）</span>}
          </SectionLabel>
          <div className="flex gap-1 px-2 pb-1">
            <Segment selected={!thinking} onSelect={() => apply({ thinking: false })}>
              关闭
            </Segment>
            <Segment selected={thinking} onSelect={() => apply({ thinking: true })}>
              开启
            </Segment>
            {!inheritedThinking && (
              <Segment selected={false} onSelect={() => apply({ thinking: null })}>
                跟随全局
              </Segment>
            )}
          </div>

          {thinking && (
            <>
              <SectionLabel>思考强度</SectionLabel>
              <div className="flex gap-1 px-2 pb-1">
                {(['low', 'high', 'max'] as ReasoningEffort[]).map((level) => (
                  <Segment key={level} selected={effort === level} onSelect={() => apply({ effort: level })}>
                    {level}
                  </Segment>
                ))}
              </div>
            </>
          )}

          {running && (
            <p className="px-3 py-2 text-micro text-fg-subtle">生成中，设定将在下一轮生效</p>
          )}
        </div>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="px-3 pb-1 pt-2 text-micro font-medium text-fg-subtle">{children}</p>
}

function Option({
  selected,
  onSelect,
  children
}: {
  selected: boolean
  onSelect: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-left text-ui ${
        selected ? 'bg-accent-subtle text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
      }`}
    >
      <span className="flex w-3 shrink-0 justify-center text-accent">
        {selected && <FontAwesomeIcon icon={Icon.check} className="text-[9px]" />}
      </span>
      {children}
    </button>
  )
}

function Segment({
  selected,
  onSelect,
  children
}: {
  selected: boolean
  onSelect: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex-1 rounded-sm border px-2 py-1 text-micro ${
        selected
          ? 'border-accent bg-accent-subtle text-accent'
          : 'border-line text-fg-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
  return String(tokens)
}
