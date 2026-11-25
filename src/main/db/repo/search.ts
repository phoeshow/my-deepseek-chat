import { getDb } from '../index'

/**
 * 全文搜索（依赖迁移 002_add_fts 建的 messages_fts）。
 *
 * 三个决定：
 * 1. **trigram 分词要求查询至少 3 个字符**，短于此的词 FTS 不会命中（也不报错），
 *    所以 <3 字符走 LIKE 兜底，保证用户敲一个字也能看到反馈。
 * 2. **snippet 用列索引 -1**（让 FTS 自己挑匹配得最好的列），这样命中"思维链"时
 *    也能给出可读的片段，而不是返回正文开头。
 * 3. **高亮标记用 \u0001 / \u0002 而不是 HTML**：渲染层按标记切分后自己套 <mark>，
 *    避免把数据库内容当 HTML 注入。
 */

export const HIGHLIGHT_START = '\u0001'
export const HIGHLIGHT_END = '\u0002'

/** FTS 查询里至少要这么多个字符，否则走 LIKE */
const FTS_MIN_LENGTH = 3

export interface MessageHit {
  kind: 'message'
  sessionId: string
  sessionTitle: string
  messageId: string
  role: string
  /** 带 \u0001…\u0002 高亮标记的片段 */
  snippet: string
  createdAt: number
}

export interface SessionHit {
  kind: 'session'
  sessionId: string
  sessionTitle: string
  updatedAt: number
}

export type SearchHit = MessageHit | SessionHit

interface MessageRow {
  message_id: string
  session_id: string
  session_title: string
  role: string
  created_at: number
  snip: string
}

interface SessionRow {
  id: string
  title: string
  updated_at: number
}

export function searchConversations(rawQuery: string, limit = 30): SearchHit[] {
  const query = rawQuery.trim()
  if (!query) return []

  const db = getDb()
  const like = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

  // 标题命中：命中会话名时优先把它排在前面，用户往往记得自己起过什么名字
  const sessions = db
    .prepare(
      `SELECT id, title, updated_at FROM sessions
       WHERE title LIKE ? ESCAPE '\\'
       ORDER BY updated_at DESC
       LIMIT 8`
    )
    .all(like) as SessionRow[]

  const rows =
    query.length >= FTS_MIN_LENGTH
      ? searchWithFts(query, limit)
      : searchWithLike(like, limit)

  return [
    ...sessions.map<SessionHit>((row) => ({
      kind: 'session',
      sessionId: row.id,
      sessionTitle: row.title,
      updatedAt: row.updated_at
    })),
    ...rows.map<MessageHit>((row) => ({
      kind: 'message',
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      messageId: row.message_id,
      role: row.role,
      snippet: row.snip,
      createdAt: row.created_at
    }))
  ]
}

function searchWithFts(query: string, limit: number): MessageRow[] {
  // 整串当短语查询：既避免用户输入里的 * - " 被当成 FTS 语法，又更符合搜索直觉
  const phrase = `"${query.replace(/"/g, '""')}"`

  try {
    return getDb()
      .prepare(
        `SELECT m.id AS message_id, m.session_id, s.title AS session_title,
                m.role, m.created_at,
                snippet(messages_fts, -1, ?, ?, '…', 16) AS snip
         FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
         JOIN sessions s ON s.id = m.session_id
         WHERE messages_fts MATCH ?
         ORDER BY bm25(messages_fts)
         LIMIT ?`
      )
      .all(HIGHLIGHT_START, HIGHLIGHT_END, phrase, limit) as MessageRow[]
  } catch {
    // FTS 语法异常（极少见）时降级为 LIKE，而不是把错误抛给界面
    return searchWithLike(`%${query}%`, limit)
  }
}

function searchWithLike(like: string, limit: number): MessageRow[] {
  return getDb()
    .prepare(
      `SELECT m.id AS message_id, m.session_id, s.title AS session_title,
              m.role, m.created_at,
              substr(m.content, 1, 120) AS snip
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       WHERE m.content LIKE ? ESCAPE '\\'
       ORDER BY m.created_at DESC
       LIMIT ?`
    )
    .all(like, limit) as MessageRow[]
}
