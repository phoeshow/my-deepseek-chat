import { writeFile } from 'node:fs/promises'
import { dialog, type BrowserWindow } from 'electron'
import { getThread } from '../db/repo/message'
import { listSessions, mustGetSession } from '../db/repo/session'
import { logger } from '../logger'
import { renderSessionMarkdown, renderSessionsJson, safeFileName } from './export-render'

/**
 * 导出（docs/03 §7）。
 *
 * 两条硬性要求：
 * 1. **不导出 API Key**。JSON 里连 baseUrl 都不写——它可能指向内网地址。
 * 2. 导出的是**主线**（当前 active_leaf_id 回溯出来的链），不导出被淘汰的兄弟分支；
 *    需要完整历史时走"全量 JSON"以外的备份手段（v1.1 再补）。
 */
export type ExportFormat = 'md' | 'json'

export interface ExportResult {
  path: string | null
  bytes: number
}

export async function exportSession(
  win: BrowserWindow | null,
  sessionId: string,
  format: ExportFormat,
  includeReasoning: boolean
): Promise<ExportResult> {
  const session = mustGetSession(sessionId)
  const messages = getThread(sessionId, session.activeLeafId)

  const content =
    format === 'md'
      ? renderSessionMarkdown(session, messages, includeReasoning)
      : renderSessionsJson([{ session, messages }])

  const saved = await save(win, `${safeFileName(session.title)}.${format}`, content, format)
  if (saved) logger.info(`[export] session ${sessionId} → ${saved} (${format})`)
  return { path: saved, bytes: saved ? Buffer.byteLength(content, 'utf8') : 0 }
}

export async function exportAll(win: BrowserWindow | null): Promise<ExportResult> {
  // 归档是“收起”不是“删除”：全量导出必须包含，否则用户会以为数据丢了（ADR-24）
  const sessions = listSessions(true)
  const payload = sessions.map((session) => ({
    session,
    messages: getThread(session.id, session.activeLeafId)
  }))

  const content = renderSessionsJson(payload)
  const name = `my-deepseek-chat-${new Date().toISOString().slice(0, 10)}.json`
  const saved = await save(win, name, content, 'json')
  if (saved) logger.info(`[export] all sessions → ${saved} (${payload.length} 个会话)`)
  return { path: saved, bytes: saved ? Buffer.byteLength(content, 'utf8') : 0 }
}

async function save(
  win: BrowserWindow | null,
  defaultName: string,
  content: string,
  format: ExportFormat
): Promise<string | null> {
  const options = {
    defaultPath: defaultName,
    filters:
      format === 'md'
        ? [{ name: 'Markdown', extensions: ['md'] }]
        : [{ name: 'JSON', extensions: ['json'] }]
  }

  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)

  if (result.canceled || !result.filePath) return null
  await writeFile(result.filePath, content, 'utf8')
  return result.filePath
}

