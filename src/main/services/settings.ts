import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { DEFAULT_CONFIG } from '@shared/defaults'
import type { AppConfig } from '@shared/types'
import { logger } from '../logger'

/**
 * config.json 只放非敏感设置（docs/03 §1）。API Key 走 SecretService。
 * 用 zod 校验是为了容忍用户手改文件：任何字段非法就回退默认值，
 * 而不是让整个应用因为一行 JSON 写错而启动失败。
 */
const windowStateSchema = z.object({
  width: z.number().int().min(400),
  height: z.number().int().min(300),
  x: z.number().int().nullable(),
  y: z.number().int().nullable(),
  maximized: z.boolean(),
  sidebarWidth: z.number().int().min(160).max(500),
  panelWidth: z.number().int().min(200).max(600),
  sidebarCollapsed: z.boolean(),
  panelCollapsed: z.boolean()
})

const configSchema = z.object({
  version: z.number().int(),
  baseUrl: z.string().url(),
  defaultModelId: z.string().min(1).nullable(),
  defaultThinking: z.boolean(),
  defaultEffort: z.enum(['low', 'high', 'max']),
  theme: z.enum(['system', 'light', 'dark']),
  autoTitle: z.boolean(),
  window: windowStateSchema
})

let config: AppConfig = structuredClone(DEFAULT_CONFIG)
let filePath = ''

export function configFilePath(dataDir: string): string {
  return join(dataDir, 'config.json')
}

export function initSettings(dataDir: string): AppConfig {
  mkdirSync(dataDir, { recursive: true })
  filePath = configFilePath(dataDir)

  if (!existsSync(filePath)) {
    saveConfig()
    logger.info('[settings] created default config.json')
    return config
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    const result = configSchema.safeParse(parsed)
    if (!result.success) {
      logger.warn('[settings] config.json invalid, falling back to defaults', result.error.issues)
      config = structuredClone(DEFAULT_CONFIG)
      saveConfig()
      return config
    }
    config = result.data
    logger.info('[settings] loaded', { theme: config.theme, baseUrl: config.baseUrl })
  } catch (err) {
    logger.error('[settings] failed to read config.json, using defaults', err)
    config = structuredClone(DEFAULT_CONFIG)
  }
  return config
}

export function getConfig(): AppConfig {
  return config
}

export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  config = { ...config, ...patch, version: DEFAULT_CONFIG.version }
  saveConfig()
  return config
}

/** 窗口状态变化非常频繁（拖拽时每帧都可能触发），由调用方负责节流 */
export function updateWindowState(state: AppConfig['window']): void {
  logger.debug('[settings] persist window state', {
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    maximized: state.maximized
  })
  config = { ...config, window: state }
  saveConfig()
}

/** 先写临时文件再 rename：避免断电时留下半截 JSON 把配置读坏 */
export function saveConfig(): void {
  if (!filePath) return
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  renameSync(tmp, filePath)
}
