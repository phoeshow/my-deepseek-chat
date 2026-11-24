import { randomUUID } from 'node:crypto'
import type { SessionSummary } from '@shared/types'
import { getDb } from '../index'

interface SessionRow {
  id: string
  title: string
  model_id: string | null
  thinking: number | null
  effort: string | null
  system_prompt: string | null
  temperature: number | null
  max_tokens: number | null
  active_leaf_id: string | null
  created_at: number
  updated_at: number
  archived_at: number | null
  message_count: number
}

const SELECT = `
  SELECT s.id, s.title, s.model_id, s.thinking, s.effort, s.system_prompt,
         s.temperature, s.max_tokens, s.active_leaf_id, s.created_at, s.updated_at,
         s.archived_at,
         (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
  FROM sessions s
`

function toSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    title: row.title,
    modelId: row.model_id,
    thinking: row.thinking === null ? null : row.thinking === 1,
    effort: (row.effort as SessionSummary['effort']) ?? null,
    activeLeafId: row.active_leaf_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    messageCount: row.message_count
  }
}

export function countSessions(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS count FROM sessions').get() as
    | { count: number }
    | undefined
  return row?.count ?? 0
}

export function listSessions(): SessionSummary[] {
  const rows = getDb()
    .prepare(`${SELECT} ORDER BY s.updated_at DESC`)
    .all() as SessionRow[]
  return rows.map(toSummary)
}

export function getSession(id: string): SessionSummary | null {
  const row = getDb().prepare(`${SELECT} WHERE s.id = ?`).get(id) as SessionRow | undefined
  return row ? toSummary(row) : null
}

export function createSession(input: {
  modelId?: string | null
  thinking?: boolean | null
}): SessionSummary {
  const now = Date.now()
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO sessions (id, title, model_id, thinking, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, '新对话', input.modelId ?? null, input.thinking == null ? null : input.thinking ? 1 : 0, now, now)

  const created = getSession(id)
  if (!created) throw new Error('会话创建后立即丢失')
  return created
}

export function renameSession(id: string, title: string): SessionSummary {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('标题不能为空')
  getDb()
    .prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
    .run(trimmed.slice(0, 120), Date.now(), id)
  return mustGetSession(id)
}

export function deleteSession(id: string): void {
  // messages / 子节点依赖 ON DELETE CASCADE，前提是 foreign_keys=ON（见 db/index.ts）
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

/** 发送成功后把主线游标推到新的 assistant 消息上 */
export function setActiveLeaf(sessionId: string, leafId: string): void {
  getDb()
    .prepare('UPDATE sessions SET active_leaf_id = ?, updated_at = ? WHERE id = ?')
    .run(leafId, Date.now(), sessionId)
}

export function mustGetSession(id: string): SessionSummary {
  const session = getSession(id)
  if (!session) throw new Error(`会话不存在：${id}`)
  return session
}
