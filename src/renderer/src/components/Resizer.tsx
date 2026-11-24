import { useCallback, useRef } from 'react'

interface Props {
  /** left = 拖左栏右边缘；right = 拖右栏左边缘 */
  side: 'left' | 'right'
  width: number
  min: number
  max: number
  onChange: (width: number) => void
  onCommit: (width: number) => void
}

/**
 * 分栏拖拽手柄（docs/04 §2）。
 *
 * 用 pointer capture 而不是监听 window 的 mousemove：指针拖出窗口或掠过内容区时
 * 事件仍会回到手柄，否则会出现"拖到一半卡住"的经典问题。
 */
export function Resizer({ side, width, min, max, onChange, onCommit }: Props): React.JSX.Element {
  const state = useRef<{ startX: number; startWidth: number } | null>(null)
  // pointerup 与 pointermove 常常在同一个 JS 任务里，此时 props.width 还是拖拽前的旧值；
  // 提交必须用 ref 里最近一次算出来的宽度，否则松手会把宽度写回起点。
  const latest = useRef(width)

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      latest.current = width
      // 指针捕获是增强项：合成事件或某些环境会抛 NotFoundError，不能因此中断拖拽
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        /* 忽略：没有捕获时仍能在手柄内部完成拖拽 */
      }
      state.current = { startX: event.clientX, startWidth: width }
    },
    [width]
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const current = state.current
      if (!current) return
      const delta =
        side === 'left' ? event.clientX - current.startX : current.startX - event.clientX
      const next = Math.min(Math.max(current.startWidth + delta, min), max)
      latest.current = next
      onChange(next)
    },
    [side, min, max, onChange]
  )

  const finish = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!state.current) return
      state.current = null
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      } catch {
        /* 同上 */
      }
      onCommit(latest.current)
    },
    [onCommit]
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整分栏宽度"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={() => onCommit(side === 'left' ? 240 : 280)}
      className="group relative z-10 -mx-0.5 w-1 shrink-0 cursor-col-resize touch-none select-none"
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent" />
    </div>
  )
}
