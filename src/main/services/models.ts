import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { ModelInfo } from '@shared/types'
import { logger } from '../logger'

/**
 * 模型列表：启动时拉取、本地缓存兜底（docs/02 §?）。
 *
 * 代码里绝不出现模型名字面量（AGENTS.md §3.3）：
 * DeepSeek 的 deepseek-chat / deepseek-reasoner 已进入弃用过渡期，
 * 写死任何一个都意味着某天全线报错。
 */
const modelSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  context_window: z.number().optional(),
  max_output_tokens: z.number().optional()
})

const responseSchema = z.object({
  data: z.array(modelSchema)
})

interface CacheFile {
  fetchedAt: number
  models: ModelInfo[]
}

const cacheSchema = z.object({
  fetchedAt: z.number(),
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      contextWindow: z.number().nullable(),
      maxOutputTokens: z.number().nullable()
    })
  )
})

let cachePath = ''
let models: ModelInfo[] = []

export function initModels(dataDir: string): void {
  cachePath = join(dataDir, 'models.json')
  models = readCache()
  if (models.length > 0) logger.info(`[models] loaded ${models.length} model(s) from cache`)
}

export function getModels(): ModelInfo[] {
  return models
}

export async function fetchModels(apiKey: string, baseUrl: string): Promise<ModelInfo[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(describeFailure(response.status, body))
  }

  const parsed = responseSchema.safeParse(await response.json())
  if (!parsed.success) throw new Error('模型列表格式无法识别')

  return parsed.data.data.map((item) => ({
    id: item.id,
    name: item.name ?? item.id,
    contextWindow: item.context_window ?? null,
    maxOutputTokens: item.max_output_tokens ?? null
  }))
}

/** 拉取成功则写缓存并切换内存态；失败时由调用方决定是否回退缓存 */
export function rememberModels(next: ModelInfo[]): void {
  models = next
  if (!cachePath) return
  const payload: CacheFile = { fetchedAt: Date.now(), models: next }
  const tmp = `${cachePath}.tmp`
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  renameSync(tmp, cachePath)
}

function readCache(): ModelInfo[] {
  if (!cachePath || !existsSync(cachePath)) return []
  try {
    const parsed = cacheSchema.safeParse(JSON.parse(readFileSync(cachePath, 'utf8')))
    return parsed.success ? parsed.data.models : []
  } catch (err) {
    logger.warn('[models] failed to read cache', err)
    return []
  }
}

function describeFailure(status: number, body: string): string {
  if (status === 401) return 'API Key 无效（401）'
  if (status === 402) return '账户余额不足（402）'
  if (status === 429) return '请求被限流（429）'
  if (status >= 500) return `服务端错误（${status}）`
  return `模型列表请求失败（${status}）：${body.slice(0, 200)}`
}
