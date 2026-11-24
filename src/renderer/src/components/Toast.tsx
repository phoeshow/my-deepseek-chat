import { useEffect } from 'react'
import { useChat } from '../store/chat'

/** 轻量提示条：导出结果之类的成功反馈，3 秒后自动消失 */
export function Toast(): React.JSX.Element | null {
  const notice = useChat((state) => state.notice)
  const clearNotice = useChat((state) => state.clearNotice)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(clearNotice, 3200)
    return () => clearTimeout(timer)
  }, [notice, clearNotice])

  if (!notice) return null

  return (
    <div
      role="status"
      className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border border-line bg-surface px-4 py-2 text-ui text-fg shadow-md"
    >
      {notice}
    </div>
  )
}
