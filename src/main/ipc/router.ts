import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { z } from 'zod'
import type { AppErrorCode, BootstrapInfo, Result } from '@shared/types'
import { recoveredMessageCount } from '../db'
import { countSessions } from '../db/repo/session'
import * as messages from '../db/repo/message'
import * as sessions from '../db/repo/session'
import * as chat from '../chat/service'
import { logger } from '../logger'
import { fetchModels, getModels, rememberModels } from '../services/models'
import { clearKey, encryptionStatus, getKey, hasKey, setKey } from '../services/secret'
import { getConfig, patchConfig } from '../services/settings'
import { readUiState } from '../window'

export interface RouterContext {
  dataDir: string
  getWindow: () => BrowserWindow | null
}

/** 所有入参都必须过 zod（AGENTS.md §3.8），这里是唯一的校验入口 */
const apiKeySchema = z.string().min(8).max(500)
const idSchema = z.string().uuid()

export function registerIpc(ctx: RouterContext): void {
  handle('app:bootstrap', z.void(), async (): Promise<BootstrapInfo> => ({
    config: getConfig(),
    hasKey: hasKey(),
    encryption: await encryptionStatus(),
    sessionCount: countSessions(),
    recoveredMessages: recoveredMessageCount(),
    dataDir: ctx.dataDir,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? '',
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome ?? '',
    platform: process.platform
  }))

  // ---- 设置 ----
  handle(
    'settings:update',
    z.object({
      patch: z.object({
        theme: z.enum(['system', 'light', 'dark']).optional(),
        defaultModelId: z.string().min(1).nullable().optional(),
        defaultThinking: z.boolean().optional(),
        defaultEffort: z.enum(['low', 'high', 'max']).optional(),
        autoTitle: z.boolean().optional(),
        window: z
          .object({
            sidebarWidth: z.number().int().min(160).max(500).optional(),
            panelWidth: z.number().int().min(200).max(600).optional(),
            sidebarCollapsed: z.boolean().optional(),
            panelCollapsed: z.boolean().optional()
          })
          .optional()
      })
    }),
    (input) => patchConfig(input.patch)
  )

  // ---- 密钥 ----
  handle('secret:status', z.void(), async () => ({
    ...(await encryptionStatus()),
    hasKey: hasKey()
  }))

  handle('secret:set', apiKeySchema, async (apiKey) => {
    await setKey(apiKey)
    return { hasKey: hasKey() }
  })

  handle('secret:clear', z.void(), () => {
    clearKey()
    return { hasKey: hasKey() }
  })

  handle('secret:test', z.void(), async () => {
    const key = await getKey()
    if (!key) throw new Error('尚未配置 API Key')
    const models = await fetchModels(key, getConfig().baseUrl)
    rememberModels(models)
    return { modelCount: models.length, models }
  })

  // ---- 模型 ----
  handle('models:refresh', z.void(), async () => {
    const key = await getKey()
    if (!key) throw new Error('尚未配置 API Key')
    try {
      const models = await fetchModels(key, getConfig().baseUrl)
      rememberModels(models)
      return { models, source: 'remote' as const }
    } catch (err) {
      // 离线或接口异常时退回缓存：能选模型、能看历史，只是发不出请求
      const cached = getModels()
      if (cached.length === 0) throw err
      logger.warn('[models] refresh failed, falling back to cache', err)
      return { models: cached, source: 'cache' as const }
    }
  })

  // ---- 会话 ----
  handle('session:list', z.void(), () => sessions.listSessions())

  handle(
    'session:create',
    z
      .object({ modelId: z.string().min(1).nullish(), thinking: z.boolean().nullish() })
      .optional(),
    (input) =>
      sessions.createSession({
        modelId: input?.modelId ?? getConfig().defaultModelId,
        thinking: input?.thinking ?? null
      })
  )

  handle('session:rename', z.object({ id: idSchema, title: z.string().min(1).max(120) }), (input) =>
    sessions.renameSession(input.id, input.title)
  )

  handle(
    'session:update',
    z.object({
      id: idSchema,
      // 传 null 表示回退到全局默认，所以每个字段都允许 nullable
      patch: z.object({
        modelId: z.string().min(1).nullable().optional(),
        thinking: z.boolean().nullable().optional(),
        effort: z.enum(['low', 'high', 'max']).nullable().optional(),
        temperature: z.number().min(0).max(2).nullable().optional(),
        maxTokens: z.number().int().min(1).max(1_000_000).nullable().optional(),
        systemPrompt: z.string().max(20_000).nullable().optional()
      })
    }),
    (input) => sessions.updateSession(input.id, input.patch)
  )

  handle('session:delete', z.object({ id: idSchema }), (input) => {
    sessions.deleteSession(input.id)
    return { id: input.id }
  })

  // ---- 消息 ----
  handle(
    'message:thread',
    z.object({ sessionId: idSchema, leafId: z.string().uuid().nullish() }),
    (input) => {
      const session = sessions.mustGetSession(input.sessionId)
      return messages.getThread(input.sessionId, input.leafId ?? session.activeLeafId)
    }
  )

  // ---- 对话 ----
  handle(
    'chat:send',
    z.object({
      sessionId: idSchema,
      parentId: z.string().uuid().nullish(),
      text: z.string().min(1).max(200_000),
      overrides: z
        .object({
          thinking: z.boolean().optional(),
          effort: z.enum(['low', 'high', 'max']).optional(),
          temperature: z.number().min(0).max(2).optional(),
          maxTokens: z.number().int().min(1).optional()
        })
        .optional()
    }),
    (input) =>
      chat.send({
        sessionId: input.sessionId,
        parentId: input.parentId ?? null,
        text: input.text,
        ...(input.overrides ? { overrides: input.overrides } : {})
      })
  )

  handle('chat:abort', z.object({ requestId: z.string().uuid() }), (input) => ({
    aborted: chat.abort(input.requestId)
  }))

  handle('chat:regenerate', z.object({ assistantMessageId: idSchema }), (input) =>
    chat.regenerate(input.assistantMessageId)
  )

  // ---- 外链（docs/01 R5）----
  handle('shell:open-external', z.object({ url: z.string().url().max(2048) }), async (input) => {
    const parsed = new URL(input.url)
    // 只放行 http(s)：file:/javascript: 之类的协议会变成任意代码执行入口
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('只允许打开 http(s) 链接')
    }
    const win = ctx.getWindow()
    const options = {
      type: 'question' as const,
      buttons: ['在浏览器中打开', '取消'],
      defaultId: 1,
      cancelId: 1,
      message: '在外部浏览器中打开这个链接？',
      detail: input.url
    }
    const { response } = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options)

    if (response !== 0) return { opened: false }
    await shell.openExternal(input.url)
    return { opened: true }
  })

  // ---- 自绘标题栏（docs/04 §2.1）----
  handle('window:minimize', z.void(), () => {
    ctx.getWindow()?.minimize()
    return { ok: true as const }
  })

  handle('window:toggle-maximize', z.void(), () => {
    const win = ctx.getWindow()
    if (!win) return { maximized: false }
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return { maximized: win.isMaximized() }
  })

  handle('window:close', z.void(), () => {
    ctx.getWindow()?.close()
    return { ok: true as const }
  })

  handle('window:get-state', z.void(), () => {
    const win = ctx.getWindow()
    return win ? readUiState(win) : { maximized: false, focused: false }
  })

  logger.info('[ipc] registered 21 channels')
}

/**
 * 统一信封（docs/02 §4）：渲染层永远只看到 { ok, data } 或 { ok, code, message }。
 * schema 校验失败也算 VALIDATION，不把 zod 的原始堆栈泄给 UI。
 */
function handle<A, R>(channel: string, schema: z.ZodType<A>, fn: (args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, async (_event, raw: unknown): Promise<Result<R>> => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      logger.warn(`[ipc] ${channel} invalid args`, parsed.error.issues)
      return {
        ok: false,
        code: 'VALIDATION',
        message: `参数不合法：${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`
      }
    }

    try {
      return { ok: true, data: await fn(parsed.data) }
    } catch (err) {
      const code = mapErrorCode(err)
      const message = err instanceof Error ? err.message : String(err)
      if (code === 'UNKNOWN') logger.error(`[ipc] ${channel} failed`, err)
      else logger.warn(`[ipc] ${channel} → ${code}: ${message}`)
      return { ok: false, code, message }
    }
  })
}

function mapErrorCode(err: unknown): AppErrorCode {
  // ChatService 抛的都是 ChatError，它自带错误码；其余异常一律归为 UNKNOWN
  if (err instanceof Error && err.name === 'ChatError' && 'code' in err) {
    return (err as { code: AppErrorCode }).code
  }
  return 'UNKNOWN'
}
