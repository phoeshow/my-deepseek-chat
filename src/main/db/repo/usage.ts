import { getDb } from '../index'
import type { TokenUsage, UsageRange, UsageSummary } from '@shared/types'

export function insertUsage(input: {
  sessionId: string
  messageId: string
  modelId: string
  usage: TokenUsage
}): void {
  const { usage } = input
  getDb()
    .prepare(
      `INSERT INTO usage_log (
         session_id, message_id, model_id, prompt_tokens, completion_tokens,
         reasoning_tokens, cache_hit_tokens, cache_miss_tokens,
         duration_ms, first_token_ms, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.sessionId,
      input.messageId,
      input.modelId,
      usage.prompt,
      usage.completion,
      usage.reasoning ?? null,
      usage.cacheHit ?? null,
      usage.cacheMiss ?? null,
      usage.durationMs ?? null,
      usage.firstTokenMs ?? null,
      Date.now()
    )
}

/**
 * 用量聚合（v1.1 仪表盘）。
 *
 * 说明两点：
 * 1. **不换算费用**：只看事实数据（tokens / 缓存命中 / 延迟）。价格会变，
 *    写死单价迟早误导人，需要时再做成可配置。
 * 2. **趋势图固定近 7 天**，时间筛选只作用于上方的卡片与下方两张表。
 *    这样"趋势"这件事始终是同一段窗口，不同范围不会让柱子口径变化。
 */
export function usageSummary(range: UsageRange): UsageSummary {
  const db = getDb()
  const since = rangeStart(range)

  const totalsRow = db
    .prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(prompt_tokens), 0) AS prompt,
              COALESCE(SUM(completion_tokens), 0) AS completion,
              COALESCE(SUM(reasoning_tokens), 0) AS reasoning,
              COALESCE(SUM(cache_hit_tokens), 0) AS cacheHit,
              COALESCE(SUM(cache_miss_tokens), 0) AS cacheMiss,
              AVG(first_token_ms) AS avgFirstToken,
              AVG(duration_ms) AS avgDuration
       FROM usage_log
       WHERE created_at >= ?`
    )
    .get(since) as
    | {
        requests: number
        prompt: number
        completion: number
        reasoning: number
        cacheHit: number
        cacheMiss: number
        avgFirstToken: number | null
        avgDuration: number | null
      }
    | undefined

  const byModel = db
    .prepare(
      `SELECT model_id AS modelId,
              COUNT(*) AS requests,
              COALESCE(SUM(prompt_tokens), 0) AS prompt,
              COALESCE(SUM(completion_tokens), 0) AS completion,
              COALESCE(SUM(reasoning_tokens), 0) AS reasoning,
              COALESCE(SUM(cache_hit_tokens), 0) AS cacheHit,
              COALESCE(SUM(cache_miss_tokens), 0) AS cacheMiss,
              AVG(first_token_ms) AS avgFirstToken
       FROM usage_log
       WHERE created_at >= ?
       GROUP BY model_id
       ORDER BY SUM(prompt_tokens + completion_tokens) DESC`
    )
    .all(since) as UsageSummary['byModel']

  const topSessions = db
    .prepare(
      `SELECT u.session_id AS sessionId,
              COALESCE(s.title, '（已删除的会话）') AS title,
              COUNT(*) AS requests,
              COALESCE(SUM(u.prompt_tokens + u.completion_tokens), 0) AS tokens
       FROM usage_log u
       LEFT JOIN sessions s ON s.id = u.session_id
       WHERE u.created_at >= ? AND u.session_id IS NOT NULL
       GROUP BY u.session_id
       ORDER BY tokens DESC
       LIMIT 5`
    )
    .all(since) as UsageSummary['topSessions']

  const dailyRows = db
    .prepare(
      `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day,
              COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS tokens
       FROM usage_log
       WHERE created_at >= ?
       GROUP BY day`
    )
    .all(daysBackStart(7)) as { day: string; tokens: number }[]

  const byDay = new Map(dailyRows.map((row) => [row.day, row.tokens]))
  const daily = lastNDays(7).map((day) => ({ day, tokens: byDay.get(day) ?? 0 }))

  return {
    range,
    totals: {
      requests: totalsRow?.requests ?? 0,
      promptTokens: totalsRow?.prompt ?? 0,
      completionTokens: totalsRow?.completion ?? 0,
      reasoningTokens: totalsRow?.reasoning ?? 0,
      cacheHitTokens: totalsRow?.cacheHit ?? 0,
      cacheMissTokens: totalsRow?.cacheMiss ?? 0,
      avgFirstTokenMs: totalsRow?.avgFirstToken ?? null,
      avgDurationMs: totalsRow?.avgDuration ?? null
    },
    daily,
    byModel,
    topSessions
  }
}

function rangeStart(range: UsageRange): number {
  const now = new Date()
  if (range === 'all') return 0
  if (range === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return daysBackStart(7)
}

/** 近 n 天（含今天）的本地零点时间戳 */
function daysBackStart(days: number): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime()
}

/** 近 n 天的本地日期键（YYYY-MM-DD），与 SQL 里的 date(...,'localtime') 对齐 */
function lastNDays(days: number): string[] {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const result: string[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
    result.push(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`)
  }
  return result
}
