import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../logger'
import { migrations } from './migrations'
import type { Migration, SqliteDb } from './types'

let instance: SqliteDb | null = null
let recoveredOnBoot = 0

export function dbFilePath(dataDir: string): string {
  return join(dataDir, 'chat.db')
}

/**
 * 打开（或创建）数据库并跑完缺失的迁移。
 * PRAGMA 选择见 docs/03 §2：WAL 让"流式期间持续写 + UI 同时读"不互斥。
 */
export function initDatabase(dataDir: string): SqliteDb {
  mkdirSync(dataDir, { recursive: true })
  const file = dbFilePath(dataDir)

  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  const applied = applyMigrations(db)

  // 启动自愈（docs/03 §4.3）：任何残留的 streaming 都意味着上次进程没正常结束
  recoveredOnBoot = db
    .prepare(`UPDATE messages SET status = 'aborted', updated_at = ? WHERE status = 'streaming'`)
    .run(Date.now()).changes
  if (recoveredOnBoot > 0) {
    logger.warn(`[db] recovered ${recoveredOnBoot} interrupted message(s) → aborted`)
  }

  logger.info(
    `[db] ready at ${file} (schema v${currentVersion(db)}, ${applied} migration(s) applied, ` +
      `foreign_keys=${String(db.pragma('foreign_keys', { simple: true }))})`
  )

  instance = db
  return db
}

export function recoveredMessageCount(): number {
  return recoveredOnBoot
}

export function getDb(): SqliteDb {
  if (!instance) throw new Error('database not initialized')
  return instance
}

export function closeDatabase(): void {
  if (!instance) return
  try {
    instance.close()
    logger.info('[db] closed')
  } finally {
    instance = null
  }
}

function currentVersion(db: SqliteDb): number {
  return db.pragma('user_version', { simple: true }) as number
}

/**
 * 逐条应用缺失迁移，全部包在一个事务里：任一条失败则整批回滚，
 * 避免出现"schema 改了一半"的半坏库。
 *
 * list 参数是为了让迁移测试能注入一条会失败的迁移，验证这个事务真的生效。
 */
export function applyMigrations(
  db: SqliteDb,
  list: readonly Migration[] = migrations
): number {
  const from = currentVersion(db)
  const pending = list.filter((m) => m.version > from)
  if (pending.length === 0) return 0

  const run = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db)
      // user_version 不支持参数化绑定，值来自我们自己定义的常量数组
      db.pragma(`user_version = ${migration.version}`)
      logger.info(`[db] migrated → v${migration.version} (${migration.name})`)
    }
  })
  run()

  return pending.length
}
