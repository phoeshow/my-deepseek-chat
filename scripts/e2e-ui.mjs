/**
 * 通过 CDP 驱动真实界面做端到端验证：新建会话 → 输入 → 回车 → 断言流式渲染。
 *
 * 前置：应用已用 --remote-debugging-port=9222 启动，且 mock 服务在跑。
 * 由 scripts/run-e2e-ui.sh 编排，一般不单独调用。
 *
 * 为什么不用 xdotool：Wayland 下合成器不接受对原生窗口的合成键事件，
 * 而 CDP 的 Input.dispatchKeyEvent 是发给渲染进程的真实事件，React 能正常收到。
 */

import { writeFile } from 'node:fs/promises'

const CDP_ENDPOINT = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222'
const SHOT_PATH = process.env.E2E_SHOT ?? '/tmp/my-deepseek-chat-e2e.png'
const PROMPT = '你好，验证一下流式'
const EXPECTED_REPLY = '你好，世界。'
const EXPECTED_REASONING = '先确认需求'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function findPage() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await (await fetch(`${CDP_ENDPOINT}/json/list`)).json()
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // 应用还没起来，继续等
    }
    await sleep(500)
  }
  throw new Error('找不到可调试页面：应用是否以 --remote-debugging-port 启动？')
}

function connect(url) {
  const ws = new WebSocket(url)
  let nextId = 0
  const pending = new Map()

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = message.id ? pending.get(message.id) : undefined
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  })

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  return { ws, ready, send }
}

const page = await findPage()
const client = connect(page.webSocketDebuggerUrl)
await client.ready
await client.send('Runtime.enable')

const evaluate = async (expression) => {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}

const bodyText = () => evaluate('document.body.innerText')

const VK = { b: 66, k: 75, n: 78, r: 82, comma: 188, period: 190, Escape: 27 }

/** 发送一次真实按键（modifiers: 1=Alt, 2=Ctrl, 4=Meta） */
async function pressKey(key, modifiers = 0) {
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key
  const vk = VK[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0)
  for (const type of ['keyDown', 'keyUp']) {
    await client.send('Input.dispatchKeyEvent', {
      type,
      key: key === 'Escape' ? 'Escape' : key,
      code: key === ',' ? 'Comma' : key === '.' ? 'Period' : code,
      modifiers,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk
    })
  }
  await sleep(350)
}

/** 轮询等待某个表达式为真（流式/异步高亮后都用它） */
async function waitFor(expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true
    await sleep(200)
  }
  return false
}

/** 轮询等待页面出现指定文本（重载/异步渲染后都用它） */
async function waitForText(needle, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await bodyText()).includes(needle)) return true
    await sleep(250)
  }
  return false
}

let failures = 0
const check = (name, ok, detail) => {
  if (ok) {
    console.log(`  ✓ ${name}`)
  } else {
    failures += 1
    console.log(`  ✗ ${name}`, detail ?? '')
  }
}

console.log('\n[1] 初始态')
check('已跳过引导页', !(await bodyText()).includes('先配置 DeepSeek API Key'))

// 入口唯一原则（docs/04 §2）：设置只能在左栏底部出现一次
check(
  '设置入口只有一个',
  (await evaluate(
    `[...document.querySelectorAll('button')].filter((b) => b.textContent.trim().includes('设置')).length`
  )) === 1
)

console.log('\n[2] 新建会话')
await evaluate(
  `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('新对话'))?.click()`
)
await sleep(800)
check('会话出现在左栏', (await bodyText()).includes('新对话'))

console.log('\n[3] 输入并回车发送')
await evaluate(`document.querySelector('textarea').focus()`)
await client.send('Input.insertText', { text: PROMPT })
await sleep(200)
for (const type of ['keyDown', 'keyUp']) {
  await client.send('Input.dispatchKeyEvent', {
    type,
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13
  })
}

console.log('\n[4] 等待流式完成')
let body = ''
let sawReasoning = false
const deadline = Date.now() + 15000
while (Date.now() < deadline) {
  body = await bodyText()
  if (body.includes('已思考')) sawReasoning = true
  if (body.includes(EXPECTED_REPLY)) break
  await sleep(250)
}
check('用户消息已上屏', body.includes(PROMPT))
check('助手正文已渲染', body.includes(EXPECTED_REPLY), body.slice(0, 300))
check('思维链折叠块出现', sawReasoning)
check('输入框已清空', (await evaluate(`document.querySelector('textarea').value`)) === '')

console.log('\n[5] 思维链可展开')
await evaluate(
  `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('已思考'))?.click()`
)
await sleep(300)
check('展开后可见 reasoning 正文', (await bodyText()).includes(EXPECTED_REASONING))

console.log('\n[6] 自绘标题栏')
const hasClose = await evaluate(`Boolean(document.querySelector('button[aria-label="关闭"]'))`)
const hasMinimize = await evaluate(`Boolean(document.querySelector('button[aria-label="最小化"]'))`)
check('存在最小化与关闭按钮', hasClose && hasMinimize)

// 不假设初始是否已最大化：平铺式桌面（GNOME 自动平铺）会在 show 后把窗口最大化，
// 图标必须跟随主进程真实状态，而不是本地假设。所以只断言“相对翻转”。
const currentLabel = () =>
  evaluate(
    `document.querySelector('button[aria-label="还原"]') ? '还原' : document.querySelector('button[aria-label="最大化"]') ? '最大化' : ''`
  )

const initial = await currentLabel()
check('最大化按钮有明确状态', initial === '最大化' || initial === '还原', initial)

await evaluate(`document.querySelector('button[aria-label="${initial}"]')?.click()`)
await sleep(900)
const flipped = await currentLabel()
check(
  `点击后状态翻转（${initial} → ${flipped || '无'}）`,
  (initial === '最大化' && flipped === '还原') || (initial === '还原' && flipped === '最大化'),
  flipped
)

await evaluate(`document.querySelector('button[aria-label="${flipped}"]')?.click()`)
await sleep(900)
check(`再点击恢复为「${initial}」`, (await currentLabel()) === initial, await currentLabel())

console.log('\n[7] Markdown 与代码高亮')
await evaluate(`document.querySelector('textarea').focus()`)
await client.send('Input.insertText', { text: '给我一段 markdown 示例' })
await sleep(150)
for (const type of ['keyDown', 'keyUp']) {
  await client.send('Input.dispatchKeyEvent', {
    type,
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13
  })
}
check('Markdown 回复已渲染', await waitForText('渲染示例'))
check('表格渲染为 table 元素', await waitFor(`Boolean(document.querySelector('.markdown-body table'))`))
// 高亮是按需加载语言后才出现的，必须等 shiki 真正产出 HTML
check(
  '代码块已高亮（shiki）',
  await waitFor(`Boolean(document.querySelector('.shiki-block'))`, 10000)
)
check(
  '代码块语言标签与复制按钮',
  await waitFor(
    `[...document.querySelectorAll('button')].some((b) => b.textContent === '复制')`,
    5000
  )
)
check(
  '行内代码渲染为 code 元素',
  await waitFor(`Boolean(document.querySelector('.markdown-body :not(pre) > code'))`, 5000)
)

console.log('\n[8] 参数面板与预算条')
check('右栏参数面板存在', (await bodyText()).includes('参数'))
check('温度控件存在', await evaluate(`Boolean(document.querySelector('#temperature'))`))
check('上下文预算已渲染', (await bodyText()).includes('上下文'))
check('缓存命中百分比已渲染', /缓存命中\s*\d+%/.test(await bodyText()))

console.log('\n[9] 本条临时思考开关')
const pressedBefore = await evaluate(
  `document.querySelector('button[aria-pressed][title*="深度思考"]')?.getAttribute('aria-pressed')`
)
await evaluate(`document.querySelector('button[aria-pressed][title*="深度思考"]')?.click()`)
await sleep(300)
const pressedAfter = await evaluate(
  `document.querySelector('button[aria-pressed][title*="深度思考"]')?.getAttribute('aria-pressed')`
)
check(
  `点击后临时状态翻转（${pressedBefore} → ${pressedAfter}）`,
  pressedBefore !== pressedAfter
)

console.log('\n[10] 主题切换')
await evaluate(
  `[...document.querySelectorAll('aside button')].find((b) => b.textContent.includes('设置'))?.click()`
)
await sleep(500)
check('设置弹层已打开', (await bodyText()).includes('主题'))

await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '浅色')?.click()`)
await sleep(500)
check('切到浅色（data-theme=light）', (await evaluate(`document.documentElement.dataset.theme`)) === 'light')

await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '深色')?.click()`)
await sleep(400)
check('切回深色（data-theme=dark）', (await evaluate(`document.documentElement.dataset.theme`)) === 'dark')

// 关闭设置弹层：限定在 dialog 内，避免选中标题栏或侧栏里同名的按钮
await evaluate(`document.querySelector('[role="dialog"] button[aria-label="关闭设置"]')?.click()`)
await sleep(400)
check('设置弹层已关闭', !(await bodyText()).includes('DeepSeek API Key'))

console.log('\n[11] 重命名并持久化')
await evaluate(
  `[...document.querySelectorAll('aside button')].find((b) => b.title === '双击重命名')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`
)
await sleep(300)
check('双击后进入编辑态', await evaluate(`Boolean(document.querySelector('aside input'))`))

await evaluate(`document.querySelector('aside input')?.select()`)
await client.send('Input.insertText', { text: '重命名后的标题' })
await sleep(200)
for (const type of ['keyDown', 'keyUp']) {
  await client.send('Input.dispatchKeyEvent', {
    type,
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13
  })
}
await sleep(600)
check('左栏显示新标题', (await bodyText()).includes('重命名后的标题'))

await client.send('Page.reload')
await sleep(2500)
check('重载后标题仍在（已落库）', (await bodyText()).includes('重命名后的标题'))

console.log('\n[12] 模型切换持久化')
await evaluate(
  `[...document.querySelectorAll('header button')].find((b) => b.textContent.includes('Mock Flash'))?.click()`
)
await sleep(400)
check('会话设定弹层出现', (await bodyText()).includes('思考模式'))

await evaluate(
  `[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.includes('Mock Pro'))?.click()`
)
await sleep(600)
check(
  '模型胶囊更新为 Mock Pro',
  await evaluate(
    `[...document.querySelectorAll('header button')].some((b) => b.textContent.includes('Mock Pro'))`
  )
)

await client.send('Page.reload')
await sleep(2500)
check('重载后仍是 Mock Pro（会话级持久化）', await waitForText('Mock Pro', 8000))

// 用 CDP 自己截图：不依赖 grim/scrot，且能在关闭窗口前留下证据
await client.send('Page.enable')
const shot = await client.send('Page.captureScreenshot', { format: 'png' })
await writeFile(SHOT_PATH, Buffer.from(shot.data, 'base64'))
console.log(`截图 → ${SHOT_PATH}`)

console.log('\n[13] 分栏拖拽与宽度持久化')
// 右栏参数面板也是 <aside>，所以必须用侧栏独有的标记来定位
const sidebarWidth = () =>
  evaluate(`parseInt(document.querySelector('aside:has([aria-label="折叠侧栏"])')?.style.width || '0', 10)`)
const widthBefore = await sidebarWidth()
check('左栏初始宽度可读', widthBefore >= 200 && widthBefore <= 320, widthBefore)

await evaluate(`(() => {
  const el = document.querySelector('[role="separator"]')
  const rect = el.getBoundingClientRect()
  const base = { bubbles: true, pointerId: 1, pointerType: 'mouse' }
  el.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: rect.x + 1 }))
  el.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: rect.x + 41 }))
  el.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: rect.x + 41 }))
  return true
})()`)
await sleep(700)
const widthAfter = await sidebarWidth()
check(`拖拽后宽度变化（${widthBefore} → ${widthAfter}）`, widthAfter > widthBefore, widthAfter)

await client.send('Page.reload')
await sleep(2500)
check('重载后宽度已持久化', (await sidebarWidth()) === widthAfter, await sidebarWidth())

console.log('\n[14] 快捷键')
await pressKey('b', 2)
check('Ctrl+B 折叠侧栏', await evaluate(`!document.querySelector('[aria-label="折叠侧栏"]')`))
check('折叠后出现展开入口', await evaluate(`Boolean(document.querySelector('[aria-label="展开侧栏"]'))`))
await pressKey('b', 2)
check(
  '再按 Ctrl+B 恢复侧栏',
  await evaluate(`Boolean(document.querySelector('[aria-label="折叠侧栏"]'))`)
)

await pressKey('k', 2)
check('Ctrl+K 打开快速切换', await evaluate(`Boolean(document.querySelector('[role="dialog"][aria-label="快速切换会话"]'))`))
await pressKey('Escape')
check('Esc 关闭快速切换', await evaluate(`!document.querySelector('[role="dialog"][aria-label="快速切换会话"]')`))

await pressKey(',', 2)
check('Ctrl+, 打开设置', await evaluate(`Boolean(document.querySelector('[role="dialog"][aria-label="设置"]'))`))
await pressKey('Escape')
check('Esc 关闭设置', await evaluate(`!document.querySelector('[role="dialog"][aria-label="设置"]')`))

console.log('\n[15] 关闭按钮')
await evaluate(`document.querySelector('button[aria-label="关闭"]')?.click()`)
let closed = false
for (let attempt = 0; attempt < 24; attempt += 1) {
  await sleep(250)
  try {
    await fetch(`${CDP_ENDPOINT}/json/list`)
  } catch {
    closed = true
    break
  }
}
check('点击关闭后应用进程退出', closed)

console.log(`\n结果：${failures === 0 ? '全部通过' : `${failures} 项失败`}`)
client.ws.close()
process.exit(failures === 0 ? 0 : 1)
