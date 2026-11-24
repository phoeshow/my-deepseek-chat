import { randomUUID } from 'node:crypto'
import type { ChatMessage, MessageRole, MessageStatus, TokenUsage } from '@shared/types'
import { getDb } from '../index'

interface MessageRow {
  id: string
  session_id: string
  parent_id: string | null
  role: string
  content: string
  reasoning: string | null
  status: string
  model_id: string | null
  finish_reason: string | null
  error_json: string | null
  tokens_json: string | null
  created_at: number
  updated_at: number
}

const COLUMNS = `
  id, session_id, parent_id, role, content, reasoning, status,
  model_id, finish_reason, error_json, tokens_json, created_at, updated_at
`

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    parentId: row.parent_id,
    role: row.role as MessageRole,
    content: row.content,
    reasoning: row.reasoning,
    status: row.status as MessageStatus,
    modelId: row.model_id,
    finishReason: row.finish_reason,
    error: row.error_json ? (JSON.parse(row.error_json) as ChatMessage['error']) : null,
    tokens: row.tokens_json ? (JSON.parse(row.tokens_json) as TokenUsage) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function insertMessage(input: {
  sessionId: string
  parentId: string | null
  role: MessageRole
  content?: string
  status?: MessageStatus
  modelId?: string | null
}): ChatMessage {
  const now = Date.now()
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO messages (id, session_id, parent_id, role, content, status, model_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.sessionId,
      input.parentId,
      input.role,
      input.content ?? '',
      input.status ?? 'complete',
      input.modelId ?? null,
      now,
      now
    )

  const created = getMessage(id)
  if (!created) throw new Error('消息写入后立即丢失')
  return created
}

export function getMessage(id: string): ChatMessage | null {
  const row = getDb().prepare(`SELECT ${COLUMNS} FROM messages WHERE id = ?`).get(id) as
    | MessageRow
    | undefined
  return row ? toMessage(row) : null
}

export interface MessagePatch {
  content?: string
  reasoning?: string | null
  status?: MessageStatus
  finishReason?: string | null
  error?: ChatMessage['error']
  tokens?: TokenUsage | null
}

export function updateMessage(id: string, patch: MessagePatch): void {
  const sets: string[] = []
  const values: unknown[] = []

  if (patch.content !== undefined) {
    sets.push('content = ?')
    values.push(patch.content)
  }
  if (patch.reasoning !== undefined) {
    sets.push('reasoning = ?')
    values.push(patch.reasoning)
  }
  if (patch.status !== undefined) {
    sets.push('status = ?')
    values.push(patch.status)
  }
  if (patch.finishReason !== undefined) {
    sets.push('finish_reason = ?')
    values.push(patch.finishReason)
  }
  if (patch.error !== undefined) {
    sets.push('error_json = ?')
    values.push(patch.error === null ? null : JSON.stringify(patch.error))
  }
  if (patch.tokens !== undefined) {
    sets.push('tokens_json = ?')
    values.push(patch.tokens === null ? null : JSON.stringify(patch.tokens))
  }

  if (sets.length === 0) return
  sets.push('updated_at = ?')
  values.push(Date.now(), id)

  getDb().prepare(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`).run(...values)
}

/**
 * 取主线（docs/03 §4.1）：从 leaf 沿 parent_id 向上回溯，再反转成正序。
 * v1 界面只展示这一条链，树的其它分支保留在库里。
 */
export function getThread(sessionId: string, leafId: string | null): ChatMessage[] {
  if (!leafId) {
    const rows = getDb()
      .prepare(
        `SELECT ${COLUMNS} FROM messages
         WHERE session_id = ? AND parent_id IS NULL
         ORDER BY created_at`
      )
      .all(sessionId) as MessageRow[]
    return rows.map(toMessage)
  }

  const rows = getDb()
    .prepare(
      `WITH RECURSIVE thread(id, parent_id, depth) AS (
         SELECT id, parent_id, 0 FROM messages WHERE id = ? AND session_id = ?
         -- 向上回溯父节点：m.id = t.parent_id。
         -- 写成 m.parent_id = t.id 会变成向下找子节点，只会返回叶子自己一条。
         UNION ALL
         SELECT m.id, m.parent_id, t.depth + 1
         FROM messages m JOIN thread t ON m.id = t.parent_id
       )
       SELECT messages.* FROM messages JOIN thread ON thread.id = messages.id
       ORDER BY thread.depth DESC`
    )
    .all(leafId, sessionId) as MessageRow[]

  return rows.map(toMessage)
}

/** 重新生成用：取同 parent 下已有的 assistant 兄弟数量，仅用于日志诊断 */
export function countSiblings(sessionId: string, parentId: string | null): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM messages
       WHERE session_id = ? AND parent_id IS ? AND role = 'assistant'`
    )
    .get(sessionId, parentId) as { count: number } | undefined
  return row?.count ?? 0
}
