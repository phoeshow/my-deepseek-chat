import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FontAwesomeIcon, Icon } from './icons'

interface Props {
  /** 无障碍名称，读屏会念它 */
  label: string
  /** tooltip 内容 */
  children: React.ReactNode
  /** tooltip 宽度，默认 260 */
  width?: number
}

/**
 * 说明图标 + 悬浮提示。
 *
 * 为什么用 portal + position:fixed：参数面板内部是 `overflow-y-auto`，
 * 绝对定位的浮层会被滚动容器裁掉。挂到 body 上再按图标位置定位，就没有裁剪问题。
 *
 * 交互：鼠标移入 / 键盘聚焦都打开，移出 / 失焦 / Esc 关闭。
 */
export function InfoTip({ label, children, width = 260 }: Props): React.JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)

  const open = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return

    const GAP = 8
    const MARGIN = 12
    // 估算高度用于纵向夹取，避免浮层超出窗口底部
    const estimatedHeight = 300

    let left: number
    let top = rect.top

    if (rect.right + GAP + width <= window.innerWidth - MARGIN) {
      // 优先放右侧：不遮挡正在解释的控件
      left = rect.right + GAP
    } else if (rect.left - GAP - width >= MARGIN) {
      // 右侧放不下就放左侧（参数面板在最右，走这条分支）
      left = rect.left - GAP - width
    } else {
      // 两侧都放不下：回落到下方并夹到窗口内
      left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - width - MARGIN))
      top = rect.bottom + GAP
    }

    top = Math.max(MARGIN, Math.min(top, window.innerHeight - estimatedHeight - MARGIN))
    setAnchor({ top, left })
  }, [width])

  const close = useCallback(() => setAnchor(null), [])

  useEffect(() => {
    if (!anchor) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    // 窗口尺寸变化时直接收起，避免浮层错位
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', close)
    }
  }, [anchor, close])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        onMouseEnter={open}
        onFocus={open}
        onMouseLeave={close}
        onBlur={close}
        className="text-fg-subtle transition-colors hover:text-fg focus-visible:text-fg"
      >
        <FontAwesomeIcon icon={Icon.info} className="text-[11px]" />
      </button>

      {anchor &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-50 rounded-md border border-line bg-surface p-3 text-micro leading-relaxed text-fg shadow-md"
            style={{ top: anchor.top, left: anchor.left, width }}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  )
}
