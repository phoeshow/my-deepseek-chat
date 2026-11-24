import { useEffect, useState } from 'react'
import type { BootstrapInfo, EncryptionStatus } from '@shared/types'

type BootstrapState =
  | { status: 'loading' }
  | { status: 'ready'; info: BootstrapInfo }
  | { status: 'error'; message: string }

export function App(): React.JSX.Element {
  const [state, setState] = useState<BootstrapState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void window.api.bootstrap().then((res) => {
      if (cancelled) return
      setState(
        res.ok
          ? { status: 'ready', info: res.data }
          : { status: 'error', message: res.message }
      )
    })
    return () => {
      cancelled = true
    }
  }, [])

  // theme = 'system' 时移除属性，让 CSS 的 light-dark() 自动跟随系统
  useEffect(() => {
    if (state.status !== 'ready') return
    const { theme } = state.info.config
    if (theme === 'system') delete document.documentElement.dataset['theme']
    else document.documentElement.dataset['theme'] = theme
  }, [state])

  const sidebarWidth = state.status === 'ready' ? state.info.config.window.sidebarWidth : 240
  const panelWidth = state.status === 'ready' ? state.info.config.window.panelWidth : 280

  return (
    <div className="flex h-full text-ui">
      <aside
        className="flex shrink-0 flex-col border-r border-line bg-canvas"
        style={{ width: sidebarWidth }}
      >
        <div className="flex h-12 items-center px-4">
          <span className="text-title font-medium">DeepSeek</span>
        </div>
        <div className="px-3">
          <div className="rounded-sm px-3 py-2 text-fg-subtle">＋ 新对话</div>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 text-center text-fg-subtle">
          还没有对话
        </div>
        <div className="border-t border-line px-4 py-3 text-fg-subtle">⚙ 设置</div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-surface">
        <header className="flex h-12 shrink-0 items-center border-b border-line px-6">
          <span className="text-title font-medium">环境自检</span>
          <span className="ml-3 rounded-full bg-accent-subtle px-2 py-0.5 text-micro font-medium text-accent">
            M0
          </span>
        </header>
        <div className="flex-1 overflow-auto px-6 py-6">
          <div className="mx-auto max-w-[760px]">
            {state.status === 'loading' && (
              <p className="text-fg-subtle">正在初始化主进程…</p>
            )}
            {state.status === 'error' && (
              <div className="rounded-md border border-danger/40 p-4 text-danger">
                启动失败：{state.message}
              </div>
            )}
            {state.status === 'ready' && <StatusPanel info={state.info} />}
          </div>
        </div>
      </main>

      <aside
        className="flex shrink-0 flex-col border-l border-line bg-canvas"
        style={{ width: panelWidth }}
      >
        <div className="flex h-12 items-center px-4">
          <span className="text-ui font-semibold text-fg-muted">运行信息</span>
        </div>
        <div className="px-4 text-meta text-fg-subtle">
          <p className="mb-2">后续里程碑将在此显示上下文预算、缓存命中与参数调节。</p>
        </div>
      </aside>
    </div>
  )
}

function StatusPanel({ info }: { info: BootstrapInfo }): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-md border border-line">
      <Row label="数据库" value={`已就绪 · ${info.sessionCount} 个会话`} tone="ok" />
      <Row label="数据目录" value={info.dataDir} mono />
      <Row
        label="API Key"
        value={info.hasKey ? '已配置' : '未配置'}
        tone={info.hasKey ? 'ok' : 'warn'}
      />
      <Row
        label="密钥加密"
        value={encryptionLabel(info.encryption)}
        tone={info.encryption.available && !info.encryption.weak ? 'ok' : 'warn'}
      />
      <Row label="默认模型" value={info.config.defaultModelId ?? '未设置'} mono />
      <Row label="API 地址" value={info.config.baseUrl} mono />
      <Row label="主题" value={themeLabel(info.config.theme)} />
      <Row
        label="版本"
        value={`app ${info.appVersion} · Electron ${info.electronVersion} · Node ${info.nodeVersion} · Chromium ${info.chromeVersion}`}
        mono
      />
      <Row label="平台" value={info.platform} mono />
    </div>
  )
}

function themeLabel(theme: BootstrapInfo['config']['theme']): string {
  if (theme === 'system') return '跟随系统'
  return theme === 'dark' ? '深色' : '浅色'
}

/**
 * basic_text 后端用固定口令加密，安全性等同明文，
 * 所以不能因为 available=true 就显示成绿色（见 src/main/services/secret.ts 注释）。
 */
function encryptionLabel(encryption: EncryptionStatus): string {
  if (!encryption.available) return '不可用 —— 将以明文存储并 chmod 600'
  if (encryption.weak) {
    return `弱加密（${encryption.backend ?? 'basic_text'}）—— 等同明文，建议安装 libsecret 或 kwallet`
  }
  return `可用（${encryption.backend ?? '系统密钥链'}）`
}

function Row({
  label,
  value,
  mono = false,
  tone
}: {
  label: string
  value: string
  mono?: boolean
  tone?: 'ok' | 'warn'
}): React.JSX.Element {
  const toneClass =
    tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-fg'
  return (
    <div className="flex gap-6 border-b border-line-subtle px-4 py-2.5 text-ui last:border-b-0">
      <span className="w-24 shrink-0 text-fg-muted">{label}</span>
      <span className={`min-w-0 break-all ${toneClass} ${mono ? 'font-mono text-meta' : ''}`}>
        {value}
      </span>
    </div>
  )
}
