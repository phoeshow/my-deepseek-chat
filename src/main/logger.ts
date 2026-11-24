import log from 'electron-log/main'
import { app } from 'electron'

/**
 * 日志脱敏。AGENTS.md §8 要求日志里不得出现 API Key，
 * 所以任何写入交通前先过一遍这个过滤器——宁可多抹，不可漏掉。
 */
const SCRUBBERS: readonly [RegExp, string][] = [
  [/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***'],
  [/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1***'],
  [/("?api[_-]?key"?\s*[:=]\s*)["']?[^"',\s}]+/gi, '$1***']
]

export function scrubLogValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return SCRUBBERS.reduce((acc, [re, replacement]) => acc.replace(re, replacement), value)
}

log.transports.file.level = 'info'
log.transports.console.level = app.isPackaged ? 'warn' : 'debug'
log.hooks.push((message) => {
  message.data = message.data.map(scrubLogValue)
  return message
})

export const logger = log.scope('app')
