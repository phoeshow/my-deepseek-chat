import { useEffect, useState } from 'react'
import { useChat } from '../store/chat'
import { IpcError } from '../lib/ipc'

interface Props {
  onClose: () => void
}

export function SettingsDialog({ onClose }: Props): React.JSX.Element {
  const boot = useChat((state) => state.boot)
  const models = useChat((state) => state.models)
  const saveKey = useChat((state) => state.saveKey)
  const testKey = useChat((state) => state.testKey)
  const refreshModels = useChat((state) => state.refreshModels)
  const patchConfig = useChat((state) => state.patchConfig)

  const [apiKey, setApiKey] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | 'models' | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const encryption = boot?.encryption
  const hasKey = boot?.hasKey ?? false

  // 模态弹层必须有 Esc 关闭与 dialog 语义（docs/04 §7）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const run = async (
    kind: 'save' | 'test' | 'models',
    action: () => Promise<void>,
    success: string
  ): Promise<void> => {
    setBusy(kind)
    setNotice(null)
    try {
      await action()
      setNotice({ tone: 'ok', text: success })
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof IpcError ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        className="w-[520px] max-w-full rounded-lg border border-line bg-surface"
      >
        <header className="flex h-12 items-center justify-between border-b border-line px-4">
          <span className="text-title font-medium">设置</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 text-fg-subtle hover:text-fg"
            aria-label="关闭设置"
          >
            ×
          </button>
        </header>

        <div className="space-y-5 px-4 py-4">
          <section>
            <label htmlFor="api-key" className="text-ui font-semibold text-fg-muted">
              DeepSeek API Key
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="api-key"
                type={reveal ? 'text' : 'password'}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={hasKey ? '已配置，留空则保持不变' : 'sk-...'}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-3 py-2 font-mono text-meta text-fg outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => setReveal((value) => !value)}
                className="rounded-sm border border-line px-3 text-ui text-fg-muted hover:bg-surface-hover"
              >
                {reveal ? '隐藏' : '显示'}
              </button>
              <button
                type="button"
                disabled={apiKey.trim().length < 8 || busy !== null}
                onClick={() =>
                  void run('save', async () => {
                    await saveKey(apiKey.trim())
                    setApiKey('')
                  }, '已保存 API Key')
                }
                className="rounded-sm bg-accent px-3 text-ui text-white hover:bg-accent-hover disabled:opacity-40"
              >
                {busy === 'save' ? '保存中…' : '保存'}
              </button>
            </div>
            <p className="mt-2 text-micro text-fg-subtle">
              {encryption?.available
                ? encryption.weak
                  ? `弱加密（${encryption.backend ?? 'basic_text'}）—— 等同明文，建议安装 libsecret 或 kwallet`
                  : `加密存储（${encryption.backend ?? '系统密钥链'}）`
                : '系统密钥链不可用，将以明文存储并 chmod 600'}
            </p>
          </section>

          <section className="border-t border-line-subtle pt-4">
            <span className="text-ui font-semibold text-fg-muted">主题</span>
            <div className="mt-2 flex gap-1">
              {(
                [
                  ['system', '跟随系统'],
                  ['light', '浅色'],
                  ['dark', '深色']
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => void patchConfig({ theme: value })}
                  aria-pressed={boot?.config.theme === value}
                  className={`flex-1 rounded-sm border px-2 py-1.5 text-ui ${
                    boot?.config.theme === value
                      ? 'border-accent bg-accent-subtle text-accent'
                      : 'border-line text-fg-muted hover:text-fg'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="border-t border-line-subtle pt-4">
            <div className="flex items-center justify-between">
              <span className="text-ui font-semibold text-fg-muted">连接</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!hasKey || busy !== null}
                  onClick={() => void run('test', () => testKey(), '连接成功，模型列表已更新')}
                  className="rounded-sm border border-line px-3 py-1.5 text-ui text-fg-muted hover:bg-surface-hover disabled:opacity-40"
                >
                  {busy === 'test' ? '测试中…' : '测试连接'}
                </button>
                <button
                  type="button"
                  disabled={!hasKey || busy !== null}
                  onClick={() => void run('models', () => refreshModels(), '模型列表已刷新')}
                  className="rounded-sm border border-line px-3 py-1.5 text-ui text-fg-muted hover:bg-surface-hover disabled:opacity-40"
                >
                  {busy === 'models' ? '刷新中…' : '刷新模型'}
                </button>
              </div>
            </div>
            <p className="mt-2 text-micro text-fg-subtle">API 地址：{boot?.config.baseUrl}</p>
            <p className="mt-1 text-micro text-fg-subtle">
              可用模型：{models.length > 0 ? `${models.length} 个` : '尚未拉取'}
            </p>
          </section>

          {notice && (
            <p className={`text-ui ${notice.tone === 'ok' ? 'text-ok' : 'text-danger'}`}>
              {notice.text}
            </p>
          )}

          <section className="border-t border-line-subtle pt-4 text-micro text-fg-subtle">
            <p>数据目录：{boot?.dataDir}</p>
            <p className="mt-1">
              版本：app {boot?.appVersion} · Electron {boot?.electronVersion} · Node{' '}
              {boot?.nodeVersion}
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
