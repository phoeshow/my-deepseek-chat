import { useState } from 'react'
import { useChat } from '../store/chat'
import { IpcError } from '../lib/ipc'

export function Onboarding(): React.JSX.Element {
  const boot = useChat((state) => state.boot)
  const saveKey = useChat((state) => state.saveKey)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await saveKey(apiKey.trim())
    } catch (err) {
      setError(err instanceof IpcError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-surface px-6">
      <div className="w-full max-w-[420px]">
        <h1 className="text-display font-semibold">先配置 DeepSeek API Key</h1>
        <p className="mt-2 text-ui text-fg-muted">
          Key 只会保存在本机，不会上传到任何第三方服务。保存后会立即拉取可用模型列表。
        </p>

        <div className="mt-6 flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && apiKey.trim().length >= 8) void submit()
            }}
            placeholder="sk-..."
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2.5 font-mono text-meta text-fg outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={apiKey.trim().length < 8 || busy}
            className="rounded-md bg-accent px-4 text-ui text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>

        {error && <p className="mt-3 text-ui text-danger">{error}</p>}

        {boot && !boot.encryption.available && (
          <p className="mt-3 text-micro text-warn">
            系统密钥链不可用，Key 将以明文存储并 chmod 600。安装 gnome-keyring / libsecret 可解决。
          </p>
        )}
        {boot?.encryption.weak && (
          <p className="mt-3 text-micro text-warn">
            当前为弱加密（{boot.encryption.backend ?? 'basic_text'}），安全性等同明文。
          </p>
        )}
      </div>
    </div>
  )
}
