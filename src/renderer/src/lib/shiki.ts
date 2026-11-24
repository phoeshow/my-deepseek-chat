import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

import githubLight from 'shiki/themes/github-light.mjs'
import githubDark from 'shiki/themes/github-dark.mjs'

/**
 * 代码高亮。
 *
 * 体积策略：只用 `shiki/core` + 显式语言模块，不 import 'shiki' 全量包。
 * 语言**全部按需加载**：实测把 8 种常用语言静态打进主 chunk 会让首屏从 240KB 涨到 1.3MB，
 * 而真正用到的语言往往只有一两种。首次遇到某语言时 dynamic import 对应 chunk，
 * 加载失败就退回纯文本——高亮失效不该影响读消息。
 *
 * 主题策略：同时载入亮/暗两套主题并输出 CSS 变量（defaultColor: false），
 * 由 `light-dark()` 在 CSS 层切换，因此切换主题不需要重新高亮。
 */
const LAZY_LANGS: Record<string, () => Promise<unknown>> = {
  bash: () => import('shiki/langs/bash.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs')
}

/** 代码块语言标注的常见别名 */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'tsx',
  ts: 'typescript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  py: 'python',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  'c#': 'csharp',
  rs: 'rust',
  golang: 'go'
}

let highlighter: HighlighterCore | null = null
let initializing: Promise<HighlighterCore | null> | null = null
const loaded = new Set<string>()
const failed = new Set<string>()

export function normalizeLang(lang: string | undefined): string {
  const raw = (lang ?? '').trim().toLowerCase()
  if (!raw) return 'text'
  return ALIASES[raw] ?? raw
}

async function getHighlighter(): Promise<HighlighterCore | null> {
  if (highlighter) return highlighter
  if (initializing) return initializing

  initializing = (async () => {
    try {
      highlighter = await createHighlighterCore({
        themes: [githubLight, githubDark],
        langs: [],
        // JS 正则引擎不依赖 wasm，省一个 ~600KB 的资源文件；代价是对极少数
        // 依赖 Oniguruma 特性的语法支持略差，对本项目够用
        engine: createJavaScriptRegexEngine()
      })
      return highlighter
    } catch (err) {
      console.warn('[shiki] 初始化失败，代码块将退回纯文本', err)
      return null
    }
  })()

  return initializing
}

async function ensureLanguage(instance: HighlighterCore, lang: string): Promise<boolean> {
  if (loaded.has(lang)) return true
  if (failed.has(lang)) return false

  const loader = LAZY_LANGS[lang]
  if (!loader) {
    failed.add(lang)
    return false
  }

  try {
    const mod = (await loader()) as { default: Parameters<HighlighterCore['loadLanguage']>[0] }
    await instance.loadLanguage(mod.default)
    loaded.add(lang)
    return true
  } catch (err) {
    console.warn(`[shiki] 加载语言 ${lang} 失败`, err)
    failed.add(lang)
    return false
  }
}

/** 返回高亮后的 HTML；失败或未知语言返回 null（调用方退回 <pre>） */
export async function highlightCode(code: string, lang: string): Promise<string | null> {
  const instance = await getHighlighter()
  if (!instance) return null

  const resolved = normalizeLang(lang)
  if (resolved !== 'text' && !(await ensureLanguage(instance, resolved))) {
    // 语言不支持：用纯文本渲染，至少排版正确
    return render(instance, code, 'text')
  }

  return render(instance, code, resolved === 'text' ? 'text' : resolved)
}

function render(instance: HighlighterCore, code: string, lang: string): string | null {
  try {
    return instance.codeToHtml(code, {
      lang,
      themes: { light: 'github-light', dark: 'github-dark' },
      // 只输出 --shiki-light / --shiki-dark 变量，具体颜色交给 CSS 的 light-dark()
      defaultColor: false
    })
  } catch (err) {
    console.warn('[shiki] 高亮失败', err)
    return null
  }
}
