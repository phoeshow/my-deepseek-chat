import type { SqliteDb } from '../types'

/**
 * 001 · 初始 schema
 * 与 docs/03-数据模型.md §3 严格对应。改这里之前先改文档。
 */
export const up = (db: SqliteDb): void => {
  db.exec(`
    CREATE TABLE sessions (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL DEFAULT '新对话',
      model_id        TEXT,
      thinking        INTEGER,
      effort          TEXT,
      system_prompt   TEXT,
      temperature     REAL,
      max_tokens      INTEGER,
      active_leaf_id  TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      archived_at     INTEGER
    );

    CREATE INDEX idx_sessions_updated ON sessions(archived_at, updated_at DESC);

    CREATE TABLE messages (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      parent_id     TEXT REFERENCES messages(id) ON DELETE CASCADE,
      role          TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
      content       TEXT NOT NULL DEFAULT '',
      reasoning     TEXT,
      status        TEXT NOT NULL DEFAULT 'complete'
                    CHECK (status IN ('streaming','complete','aborted','error')),
      model_id      TEXT,
      finish_reason TEXT,
      error_json    TEXT,
      tokens_json   TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE INDEX idx_msg_thread ON messages(session_id, parent_id, created_at);
    CREATE INDEX idx_msg_parent ON messages(parent_id);
    CREATE INDEX idx_msg_status ON messages(status) WHERE status = 'streaming';

    CREATE TABLE usage_log (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id        TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      message_id        TEXT,
      model_id          TEXT NOT NULL,
      prompt_tokens     INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens  INTEGER,
      cache_hit_tokens  INTEGER,
      cache_miss_tokens INTEGER,
      duration_ms       INTEGER,
      first_token_ms    INTEGER,
      created_at        INTEGER NOT NULL
    );

    CREATE INDEX idx_usage_session ON usage_log(session_id, created_at);
    CREATE INDEX idx_usage_time ON usage_log(created_at);

    CREATE TABLE kv (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
}
