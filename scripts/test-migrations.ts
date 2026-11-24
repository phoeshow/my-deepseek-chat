import { app } from 'electron'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyMigrations, closeDatabase, initDatabase } from '../src/main/db'
import { migrations } from '../src/main/db/migrations'
import type { Migration } from '../src/main/db/types'

/**
 * 迁移测试（docs/05 §M4.7）。
 *
 * 要证明的四件事：
 * 1. 每个历史版本（v1…vN-1）都能升到最新，且**数据不丢**
 * 2. 升级是**幂等**的：再启动一次不应重复执行
 * 3. 迁移是**原子**的：任何一条失败则整批回滚，不会留下半坏的库
 * 4. 新结构对**迁移前就存在的数据**有效（FTS 必须回填，否则搜不到老消息）
 *
 * 另外顺手钉住 v1 的结构快照：如果谁图省事直接改 001_init.ts，
 * 新装机是对的、老库却永远 drift，这里会立刻失败。
 *
 * 运行：pnpm test:migrations（必须跑在 Electron 里，better-sqlite3 是 Electron ABI）
 */

let failures = 0

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ✓ ${name}`)
  } else {
    failures += 1
    console.log(`  ✗ ${name}`, detail ?? '')
  }
}

const LATEST = migrations.reduce((max, item) => Math.max(max, item.version), 0)

/** v1 的结构快照：任何对 001_init.ts 的原地修改都会让这里失败 */
const V1_SCHEMA: Record<string, string[]> = {
  sessions: [
    'id', 'title', 'model_id', 'thinking', 'effort', 'system_prompt',
    'temperature', 'max_tokens', 'active_leaf_id', 'created_at', 'updated_at', 'archived_at'
  ],
  messages: [
    'id', 'session_id', 'parent_id', 'role', 'content', 'reasoning', 'status',
    'model_id', 'finish_reason', 'error_json', 'tokens_json', 'created_at', 'updated_at'
  ],
  usage_log: [
    'id', 'session_id', 'message_id', 'model_id', 'prompt_tokens', 'completion_tokens',
    'reasoning_tokens', 'cache_hit_tokens', 'cache_miss_tokens', 'duration_ms',
    'first_token_ms', 'created_at'
  ],
  kv: ['key', 'value', 'updated_at']
}

interface Fixture {
  sessionId: string
  userId: string
  assistantId: string
}

/** 用显式 SQL 造数据：不依赖 repo，避免 repo 随最新表结构演进后测试失真 */
function insertFixture(db: Database.Database): Fixture {
  const now = Date.now()
  const ids: Fixture = { sessionId: 'sess-legacy', userId: 'msg-user', assistantId: 'msg-assistant' }

  db.prepare(
    `INSERT INTO sessions (id, title, model_id, thinking, active_leaf_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(ids.sessionId, '历史会话', 'legacy-model', 1, ids.assistantId, now - 1000, now)

  db.prepare(
    `INSERT INTO messages (id, session_id, parent_id, role, content, status, created_at, updated_at)
     VALUES (?, ?, NULL, 'user', ?, 'complete', ?, ?)`
  ).run(ids.userId, ids.sessionId, '迁移测试的问题', now - 1000, now - 1000)

  db.prepare(
    `INSERT INTO messages (id, session_id, parent_id, role, content, reasoning, status, model_id,
                           finish_reason, tokens_json, created_at, updated_at)
     VALUES (?, ?, ?, 'assistant', ?, ?, 'complete', 'legacy-model', 'stop', ?, ?, ?)`
  ).run(
    ids.assistantId,
    ids.sessionId,
    ids.userId,
    '这个回答讲的是增量落库的时机。',
    '先确认需求。',
    JSON.stringify({ prompt: 10, completion: 20 }),
    now - 900,
    now - 900
  )

  return ids
}

/** 造一个"历史库"：只跑到指定版本，并写入代表性数据 */
function buildLegacy(dataDir: string, upTo: number): Fixture {
  const db = new Database(join(dataDir, 'chat.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  for (const migration of migrations.filter((item) => item.version <= upTo)) {
    migration.up(db)
    db.pragma(`user_version = ${migration.version}`)
  }
  const fixture = insertFixture(db)
  db.close()
  return fixture
}

function openReadOnly(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('foreign_keys = ON')
  return db
}

function searchable(db: Database.Database, term: string): number {
  try {
    const row = db
      .prepare('SELECT COUNT(*) AS count FROM messages_fts WHERE messages_fts MATCH ?')
      .get(term) as { count: number } | undefined
    return row?.count ?? 0
  } catch {
    return -1
  }
}

function run(): void {
  const root = mkdtempSync(join(tmpdir(), 'ds-migrate-'))

  try {
    console.log(`\n[1] v1 结构快照（防止原地修改已发布迁移）`)
    {
      const dir = join(root, 'snapshot')
      mkdirp(dir)
      const db = new Database(join(dir, 'chat.db'))
      migrations.find((item) => item.version === 1)?.up(db)
      for (const [table, columns] of Object.entries(V1_SCHEMA)) {
        const actual = (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name)
        check(
          `${table} 列与 v1 快照一致`,
          actual.length === columns.length && columns.every((column) => actual.includes(column)),
          { expected: columns, actual }
        )
      }
      db.close()
    }

    for (let from = 1; from < LATEST; from += 1) {
      console.log(`\n[2] v${from} → v${LATEST} 升级`)
      const dir = join(root, `from-v${from}`)
      mkdirp(dir)
      const fixture = buildLegacy(dir, from)

      initDatabase(dir)
      const db = openReadOnly(join(dir, 'chat.db'))

      check(`user_version 升到 ${LATEST}`, (db.pragma('user_version', { simple: true }) as number) === LATEST)
      check('外键约束在迁移后仍开启', (db.pragma('foreign_keys', { simple: true }) as number) === 1)
      check('外键完整性检查通过', (db.pragma('foreign_key_check') as unknown[]).length === 0)

      const messages = db
        .prepare('SELECT id, content, reasoning, parent_id FROM messages ORDER BY created_at')
        .all() as { id: string; content: string; reasoning: string | null; parent_id: string | null }[]
      check('消息条数未变', messages.length === 2, messages.length)
      check(
        '正文与思维链未变',
        messages[1]?.content === '这个回答讲的是增量落库的时机。' &&
          messages[1]?.reasoning === '先确认需求。',
        messages[1]
      )
      check('树形 parent 链未断', messages[1]?.parent_id === fixture.userId, messages[1]?.parent_id)

      const session = db
        .prepare('SELECT active_leaf_id FROM sessions WHERE id = ?')
        .get(fixture.sessionId) as { active_leaf_id: string | null } | undefined
      check('active_leaf_id 仍指向真实消息', session?.active_leaf_id === fixture.assistantId, session)

      if (from < 2) {
        check('迁移前的老消息已被 FTS 索引（回填）', searchable(db, '增量落') === 1, searchable(db, '增量落'))
        check('思维链同样可被检索', searchable(db, '先确认') >= 1, searchable(db, '先确认'))

        // 触发器：迁移后新写入的消息也必须进索引
        const now = Date.now()
        db.prepare(
          `INSERT INTO messages (id, session_id, parent_id, role, content, status, created_at, updated_at)
           VALUES ('msg-new', ?, ?, 'user', '迁移之后新增的内容', 'complete', ?, ?)`
        ).run(fixture.sessionId, fixture.assistantId, now, now)
        check('新消息被触发器写入索引', searchable(db, '迁移之后') === 1, searchable(db, '迁移之后'))

        db.prepare(`UPDATE messages SET content = '内容被改写过了' WHERE id = 'msg-new'`).run()
        check('更新消息后索引同步', searchable(db, '内容被改') === 1 && searchable(db, '迁移之后') === 0)
      }

      db.close()

      // 幂等：再启动一次不应重复执行迁移
      closeDatabase()
      initDatabase(dir)
      const again = openReadOnly(join(dir, 'chat.db'))
      const stillThere = again.prepare('SELECT COUNT(*) AS count FROM messages').get() as { count: number }
      check('二次启动数据仍在', stillThere.count >= 2, stillThere.count)
      again.close()
      closeDatabase()
    }

    console.log('\n[3] 迁移失败必须整批回滚')
    {
      const dir = join(root, 'rollback')
      mkdirp(dir)
      buildLegacy(dir, 1)

      const db = new Database(join(dir, 'chat.db'))
      db.pragma('journal_mode = WAL')
      const broken: readonly Migration[] = [
        {
          version: 2,
          name: 'simulated_ok',
          up: (instance) => {
            instance.exec('CREATE TABLE migration_probe (id INTEGER PRIMARY KEY)')
          }
        },
        {
          version: 3,
          name: 'simulated_failure',
          up: (instance) => {
            instance.exec('CREATE TABLE another_probe (id INTEGER PRIMARY KEY)')
            // 故意违反唯一约束，让整批迁移失败
            instance.exec(
              "INSERT INTO kv (key, value, updated_at) VALUES ('dup', 'a', 0), ('dup', 'b', 0)"
            )
          }
        }
      ]

      let threw = false
      try {
        applyMigrations(db, broken)
      } catch {
        threw = true
      }

      check('坏迁移抛出异常', threw)
      check('user_version 未前进', (db.pragma('user_version', { simple: true }) as number) === 1)
      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
      ).map((row) => row.name)
      check('同批次内已成功的迁移也被回滚', !tables.includes('migration_probe'), tables)
      check('半途创建的表未残留', !tables.includes('another_probe'), tables)
      const survived = db.prepare('SELECT COUNT(*) AS count FROM messages').get() as { count: number }
      check('原有数据未受影响', survived.count === 2, survived.count)
      db.close()
    }
  } finally {
    closeDatabase()
    rmSync(root, { recursive: true, force: true })
  }
}

function mkdirp(path: string): void {
  // 迁移测试要造多个库，逐个建目录
  rmSync(path, { recursive: true, force: true })
  require('node:fs').mkdirSync(path, { recursive: true })
}

app.whenReady().then(() => {
  try {
    run()
  } catch (err) {
    failures += 1
    console.error('\n迁移测试抛出异常：', err)
  }
  console.log(`\n结果：${failures === 0 ? '全部通过' : `${failures} 项失败`}`)
  app.exit(failures === 0 ? 0 : 1)
})
