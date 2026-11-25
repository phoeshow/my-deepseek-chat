#!/usr/bin/env node
/**
 * 清理构建产物与 agent 临时文件。
 *
 *   pnpm clean              清 tmp/ 与 release/
 *   pnpm clean --tmp-only   只清 tmp/（保留构建产物）
 *   pnpm clean --release-only  只清 release/
 *
 * 用 Node 而不是 rm -rf：package.json 的 scripts 在 Windows 上也会被调用，
 * 而 rm -rf 在 cmd.exe 里不存在。
 */
import { readdirSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const onlyTmp = process.argv.includes('--tmp-only')
const onlyRelease = process.argv.includes('--release-only')
const targets = []

if (!onlyRelease) targets.push({ dir: join(root, 'tmp'), keep: ['.gitignore'] })
if (!onlyTmp) targets.push({ dir: join(root, 'release'), keep: [] })

let removed = 0

for (const { dir, keep } of targets) {
  if (!existsSync(dir)) {
    console.log(`跳过（不存在）：${dir}`)
    continue
  }

  for (const entry of readdirSync(dir)) {
    if (keep.includes(entry)) continue
    rmSync(join(dir, entry), { recursive: true, force: true })
    removed += 1
  }
  console.log(`已清理：${dir}`)
}

// tmp/ 是 agent 的临时工作区，清空后保持可用
const tmpDir = join(root, 'tmp')
mkdirSync(tmpDir, { recursive: true })
const tmpIgnore = join(tmpDir, '.gitignore')
if (!existsSync(tmpIgnore)) {
  writeFileSync(tmpIgnore, '# 目录本身入库（保证 clone 后存在），内容一律忽略\n*\n!.gitignore\n')
}

console.log(`完成，共删除 ${removed} 项`)
