import type { Migration } from '../types'
import { up as init } from './001_init'

/**
 * 迁移清单。只向前，不写 down；新增迁移一律追加到数组末尾。
 * 数组顺序即执行顺序，version 必须严格递增且与 docs/03 §6 的记录一致。
 */
export const migrations: readonly Migration[] = [
  { version: 1, name: '001_init', up: init }
]
