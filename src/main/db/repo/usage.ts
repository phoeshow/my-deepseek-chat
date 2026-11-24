import { getDb } from '../index'
import type { TokenUsage } from '@shared/types'

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
