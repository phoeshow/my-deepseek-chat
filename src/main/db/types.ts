import type Database from 'better-sqlite3'

/** 单独抽出来，避免 migrations 与 db/index 循环引用 */
export type SqliteDb = Database.Database

export interface Migration {
  /** 从 1 开始递增，与 PRAGMA user_version 对应 */
  version: number
  name: string
  up: (db: SqliteDb) => void
}
