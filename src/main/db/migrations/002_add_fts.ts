import type { SqliteDb } from '../types'

/**
 * 002 · 全文索引（为 v1.1 的跨会话搜索铺路）
 *
 * 三个容易做错的地方，都在这里固定下来：
 *
 * 1. **必须回填存量数据**。只建虚表和触发器的话，迁移之前就存在的消息永远搜不到，
 *    表现是"只能搜到昨天以后的对话"——这是加 FTS 最常见的翻车方式。
 *
 * 2. **必须用外部内容表**（content='messages'）。否则消息表与索引表各存一份正文，
 *    正文被流式更新时要写两遍，而且容易不一致。
 *
 * 3. **tokenize 用 trigram 而不是 unicode61**。unicode61 会把一整句中文当成一个词，
 *    中文搜索基本不可用；trigram 支持子串匹配，中英混排都能搜（代价是查询词至少 3 个字符）。
 */
export const up = (db: SqliteDb): void => {
  db.exec(`
    CREATE VIRTUAL TABLE messages_fts USING fts5(
      content,
      reasoning,
      content='messages',
      content_rowid='rowid',
      tokenize='trigram'
    );

    -- 回填迁移前就存在的消息
    INSERT INTO messages_fts(rowid, content, reasoning)
    SELECT rowid, content, COALESCE(reasoning, '') FROM messages;

    CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content, reasoning)
      VALUES (new.rowid, new.content, COALESCE(new.reasoning, ''));
    END;

    CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content, reasoning)
      VALUES ('delete', old.rowid, old.content, COALESCE(old.reasoning, ''));
    END;

    CREATE TRIGGER messages_fts_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content, reasoning)
      VALUES ('delete', old.rowid, old.content, COALESCE(old.reasoning, ''));
      INSERT INTO messages_fts(rowid, content, reasoning)
      VALUES (new.rowid, new.content, COALESCE(new.reasoning, ''));
    END;
  `)
}
