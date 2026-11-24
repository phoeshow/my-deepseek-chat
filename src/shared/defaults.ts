import type { AppConfig } from './types'

export const CONFIG_VERSION = 1

/** 与 docs/04-视觉规范.md §2 的栅格参数保持一致 */
export const DEFAULT_CONFIG: AppConfig = {
  version: CONFIG_VERSION,
  baseUrl: 'https://api.deepseek.com',
  defaultModelId: null,
  defaultThinking: false,
  defaultEffort: 'high',
  theme: 'system',
  autoTitle: true,
  window: {
    width: 1280,
    height: 840,
    x: null,
    y: null,
    maximized: false,
    sidebarWidth: 240,
    panelWidth: 280,
    sidebarCollapsed: false,
    panelCollapsed: false
  }
}

/** docs/04 §2：最小窗口 960×640 */
export const MIN_WINDOW_WIDTH = 960
export const MIN_WINDOW_HEIGHT = 640
