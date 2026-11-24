import { useEffect, useState } from 'react'
import { useChat } from '../store/chat'
import { IpcError } from '../lib/ipc'
import { FontAwesomeIcon, Icon } from './icons'

interface Props {
  onClose: () => void
}

type Busy = 'save' | 'test' | 'models' | 'baseUrl' | 'export' | 'clear' | null

export function SettingsDialog({ onClose }: Props): React.JSX.Element {
  const boot = useChat((state) => state.boot)
  const models = useChat((state) => state.models)
  const saveKey = useChat((state) => state.saveKey)
  const testKey = useChat((state) => state.testKey)
  const refreshModels = useChat((state) => state.refreshModels)
  const patchConfig = useChat((state) => state.patchConfig)
  const reloadAll = useChat((state) => state.reloadAll)
  const showNotice = useChat((state) => state.showNotice)

  const [apiKey, setApiKey] = useState('')
  const [reveal, setReveal] = useState(false)
  const [baseUrl, setBaseUrl] = useState(boot?.config.baseUrl ?? '')
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const encryption = boot?.encryption
  const hasKey = boot?.hasKey ?? false
  const config = boot?.config

  // 模态弹层必须有 Esc 关闭与 dialog 语义（docs/04 §7）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const run = async (
    kind: Busy,
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
        className="flex max-h-full w-[560px] max-w-full flex-col rounded-lg border border-line bg-surface"
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
          <span className="text-title font-medium">设置</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 text-fg-subtle hover:text-fg"
            aria-label="关闭设置"
          >
            <FontAwesomeIcon icon={Icon.close} className="text-[12px]" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
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
                  void run(
                    'save',
                    async () => {
                      await saveKey(apiKey.trim())
                      setApiKey('')
                    },
                    '已保存 API Key'
                  )
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
            <label htmlFor="base-url" className="text-ui font-semibold text-fg-muted">
              API 地址
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="base-url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                spellCheck={false}
                className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-3 py-2 font-mono text-meta text-fg outline-none focus:border-accent"
              />
              <button
                type="button"
                disabled={busy !== null || baseUrl.trim() === config?.baseUrl}
                onClick={() =>
                  void run(
                    'baseUrl',
                    async () => {
                      await patchConfig({ baseUrl: baseUrl.trim() })
                      await refreshModels().catch(() => undefined)
                    },
                    'API 地址已更新'
                  )
                }
                className="rounded-sm border border-line px-3 text-ui text-fg-muted hover:bg-surface-hover disabled:opacity-40"
              >
                {busy === 'baseUrl' ? '保存中…' : '保存'}
              </button>
            </div>
            <p className="mt-2 text-micro text-fg-subtle">
              只支持 http(s)。改地址后可兼容任意 OpenAI 兼容服务。
            </p>
          </section>

          <section className="border-t border-line-subtle pt-4">
            <span className="text-ui font-semibold text-fg-muted">默认设定（新会话继承）</span>

            <div className="mt-2 flex items-center justify-between">
              <span className="text-ui text-fg-muted">默认模型</span>
              <select
                value={config?.defaultModelId ?? ''}
                onChange={(event) =>
                  void patchConfig({ defaultModelId: event.target.value || null })
                }
                className="max-w-[260px] rounded-sm border border-line bg-surface px-2 py-1 text-ui text-fg outline-none focus:border-accent"
              >
                <option value="">首个可用模型</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-2 flex items-center justify-between">
              <span className="text-ui text-fg-muted">默认深度思考</span>
              <div className="flex gap-1">
                {([false, true] as const).map((value) => (
                  <button
                    key={String(value)}
                    type="button"
                    onClick={() => void patchConfig({ defaultThinking: value })}
                    aria-pressed={config?.defaultThinking === value}
                    className={`rounded-sm border px-3 py-1 text-micro ${
                      config?.defaultThinking === value
                        ? 'border-accent bg-accent-subtle text-accent'
                        : 'border-line text-fg-muted hover:text-fg'
                    }`}
                  >
                    {value ? '开' : '关'}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between">
              <span className="text-ui text-fg-muted">默认思考强度</span>
              <div className="flex gap-1">
                {(['low', 'high', 'max'] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => void patchConfig({ defaultEffort: level })}
                    aria-pressed={config?.defaultEffort === level}
                    className={`rounded-sm border px-3 py-1 text-micro ${
                      config?.defaultEffort === level
                        ? 'border-accent bg-accent-subtle text-accent'
                        : 'border-line text-fg-muted hover:text-fg'
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between">
              <span className="text-ui text-fg-muted">首轮自动生成标题</span>
              <button
                type="button"
                onClick={() => void patchConfig({ autoTitle: !config?.autoTitle })}
                aria-pressed={config?.autoTitle ?? true}
                className={`rounded-sm border px-3 py-1 text-micro ${
                  config?.autoTitle
                    ? 'border-accent bg-accent-subtle text-accent'
                    : 'border-line text-fg-muted hover:text-fg'
                }`}
              >
                {config?.autoTitle ? '开' : '关'}
              </button>
            </div>
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
                  aria-pressed={config?.theme === value}
                  className={`flex-1 rounded-sm border px-2 py-1.5 text-ui ${
                    config?.theme === value
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
            <p className="mt-2 text-micro text-fg-subtle">
              可用模型：{models.length > 0 ? `${models.length} 个` : '尚未拉取'}
            </p>
          </section>

          <section className="border-t border-line-subtle pt-4">
            <span className="text-ui font-semibold text-fg-muted">数据</span>
            <p className="mt-2 break-all text-micro text-fg-subtle">{boot?.dataDir}</p>

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  void run(
                    null,
                    async () => {
                      const result = await window.api.data.openDataDir()
                      if (!result.ok) throw new IpcError(result.code, result.message)
                    },
                    '已打开数据目录'
                  )
                }
                className="rounded-sm border border-line px-3 py-1.5 text-ui text-fg-muted hover:bg-surface-hover"
              >
                打开目录
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    'export',
                    async () => {
                      const result = await window.api.data.exportAll()
                      if (!result.ok) throw new IpcError(result.code, result.message)
                      showNotice(
                        result.data.path
                          ? `已导出全部会话（${Math.round(result.data.bytes / 1024)} KB）`
                          : '已取消导出'
                      )
                    },
                    '导出完成'
                  )
                }
                className="rounded-sm border border-line px-3 py-1.5 text-ui text-fg-muted hover:bg-surface-hover disabled:opacity-40"
              >
                {busy === 'export' ? '导出中…' : '导出全部（JSON）'}
              </button>
            </div>

            <div className="mt-4 rounded-sm border border-danger/40 p-3">
              <p className="text-ui text-fg">清空全部会话</p>
              <p className="mt-1 text-micro text-fg-subtle">
                删除所有会话与消息，保留设置与 API Key。此操作不可撤销，建议先导出。
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  placeholder="输入 DELETE 确认"
                  aria-label="清空确认输入"
                  className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 py-1 font-mono text-micro text-fg outline-none focus:border-danger"
                />
                <button
                  type="button"
                  disabled={confirmText !== 'DELETE' || busy !== null}
                  onClick={() =>
                    void run(
                      'clear',
                      async () => {
                        const result = await window.api.data.clearConversations()
                        if (!result.ok) throw new IpcError(result.code, result.message)
                        setConfirmText('')
                        await reloadAll()
                        showNotice(`已清空 ${result.data.deleted} 个会话`)
                      },
                      '会话已清空'
                    )
                  }
                  className="rounded-sm bg-danger px-3 py-1 text-ui text-white disabled:opacity-40"
                >
                  {busy === 'clear' ? '清空中…' : '清空'}
                </button>
              </div>
            </div>
          </section>

          {notice && (
            <p className={`text-ui ${notice.tone === 'ok' ? 'text-ok' : 'text-danger'}`}>
              {notice.text}
            </p>
          )}

          <section className="border-t border-line-subtle pt-4 text-micro text-fg-subtle">
            <p>
              版本：app {boot?.appVersion} · Electron {boot?.electronVersion} · Node{' '}
              {boot?.nodeVersion}
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
