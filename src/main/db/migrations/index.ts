import type { Migration } from '../types'
import { up as addFts } from './002_add_fts'
import { up as init } from './001_init'

/**
 * 迁移清单。只向前，不写 down；新增迁移一律追加到数组末尾。
 *
 * 两条纪律：
 * - version 必须严格递增，且**已发布的迁移不许再改**（改了只有新装机生效，老库永远 drift）
 * - 每条迁移必须能处理"迁移前的脏数据"，必要时先清洗再收紧约束
 *
 * 改完这里请跑 `pnpm test:migrations`：它会为每个历史版本造库并验证升级路径。
 */
export const migrations: readonly Migration[] = [
  { version: 1, name: '001_init', up: init },
  { version: 2, name: '002_add_fts', up: addFts }
]
