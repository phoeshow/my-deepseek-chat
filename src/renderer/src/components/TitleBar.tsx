import { useCallback, useEffect, useState } from 'react'
import type { WindowUiState } from '@shared/types'
import { useChat } from '../store/chat'
import { FontAwesomeIcon, Icon } from './icons'

/**
 * 自绘标题栏（docs/04 §2.1）。
 *
 * 无边框窗口的三个必做项：
 * 1. 空白处必须 `-webkit-app-region: drag`，否则窗口拖不动
 * 2. 按钮必须 `no-drag`，否则点击会被当成拖拽起始动作吞掉
 * 3. 最大化图标要跟随真实状态，不能靠本地翻转（用户可能用快捷键或 WM 改窗口状态）
 */
export function TitleBar(): React.JSX.Element {
  const platform = useChat((state) => state.boot?.platform)
  const [windowState, setWindowState] = useState<WindowUiState>({
    maximized: false,
    focused: true
  })

  useEffect(() => {
    void window.api.windowControls.getState().then((result) => {
      if (result.ok) setWindowState(result.data)
    })
    return window.api.windowControls.onStateChange(setWindowState)
  }, [])

  const minimize = useCallback(() => {
    void window.api.windowControls.minimize()
  }, [])

  const toggleMaximize = useCallback(() => {
    void window.api.windowControls.toggleMaximize()
  }, [])

  const close = useCallback(() => {
    void window.api.windowControls.close()
  }, [])

  // macOS 惯例在左（且顺序是 关闭/最小化/最大化），其余平台在右
  const onLeft = platform === 'darwin'

  const controls = (
    <div className="app-no-drag flex items-stretch">
      {onLeft && <ControlButton label="关闭" tone="close" onClick={close} icon={Icon.close} />}
      <ControlButton label="最小化" onClick={minimize} icon={Icon.minimize} />
      <ControlButton
        label={windowState.maximized ? '还原' : '最大化'}
        onClick={toggleMaximize}
        icon={windowState.maximized ? Icon.restore : Icon.maximize}
      />
      {!onLeft && <ControlButton label="关闭" tone="close" onClick={close} icon={Icon.close} />}
    </div>
  )

  return (
    <header className="flex h-9 shrink-0 select-none items-stretch border-b border-line bg-canvas">
      {onLeft && controls}

      <div
        className="app-no-drag flex items-center gap-2 px-3"
        onDoubleClick={toggleMaximize}
        title="双击切换最大化"
      >
        <FontAwesomeIcon icon={Icon.assistant} className="text-[10px] text-fg-subtle" />
        <span className="text-ui font-medium text-fg-muted">DeepSeek</span>
      </div>

      {/* 空白区是唯一的拖拽区：品牌与按钮都让开，避免互相抢事件 */}
      <div className="app-drag min-w-0 flex-1" />

      {!onLeft && controls}
    </header>
  )
}

function ControlButton({
  label,
  icon,
  onClick,
  tone
}: {
  label: string
  icon: Parameters<typeof FontAwesomeIcon>[0]['icon']
  onClick: () => void
  tone?: 'close'
}): React.JSX.Element {
  const hover =
    tone === 'close' ? 'hover:bg-[#E81123] hover:text-white' : 'hover:bg-surface-hover'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`app-no-drag flex w-10 items-center justify-center text-fg-muted transition-colors ${hover}`}
    >
      <FontAwesomeIcon icon={icon} className="text-[10px]" />
    </button>
  )
}
