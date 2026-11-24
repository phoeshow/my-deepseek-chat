import { app, ipcMain } from 'electron'
import type { BootstrapInfo, Result } from '@shared/types'
import { countSessions } from '../db/repo/session'
import { logger } from '../logger'
import { encryptionStatus, hasKey } from '../services/secret'
import { getConfig } from '../services/settings'

export interface RouterContext {
  dataDir: string
}

export function registerIpc(ctx: RouterContext): void {
  handle<BootstrapInfo>('app:bootstrap', async () => ({
    config: getConfig(),
    hasKey: hasKey(),
    encryption: await encryptionStatus(),
    sessionCount: countSessions(),
    dataDir: ctx.dataDir,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? '',
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome ?? '',
    platform: process.platform
  }))

  logger.info('[ipc] registered 1 channel')
}

/**
 * 统一信封（docs/02 §4）：渲染层永远只看到 { ok, data } 或 { ok, code, message }，
 * 裸的异常与堆栈留在主进程日志里。
 */
function handle<T>(channel: string, fn: () => T | Promise<T>): void {
  ipcMain.handle(channel, async (): Promise<Result<T>> => {
    try {
      return { ok: true, data: await fn() }
    } catch (err) {
      logger.error(`[ipc] ${channel} failed`, err)
      return {
        ok: false,
        code: 'UNKNOWN',
        message: err instanceof Error ? err.message : String(err)
      }
    }
  })
}
