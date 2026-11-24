/**
 * 通过 CDP 驱动真实界面做端到端验证：新建会话 → 输入 → 回车 → 断言流式渲染。
 *
 * 前置：应用已用 --remote-debugging-port=9222 启动，且 mock 服务在跑。
 * 由 scripts/run-e2e-ui.sh 编排，一般不单独调用。
 *
 * 为什么不用 xdotool：Wayland 下合成器不接受对原生窗口的合成键事件，
 * 而 CDP 的 Input.dispatchKeyEvent 是发给渲染进程的真实事件，React 能正常收到。
 */

const CDP_ENDPOINT = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222'
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

console.log(`\n结果：${failures === 0 ? '全部通过' : `${failures} 项失败`}`)
client.ws.close()
process.exit(failures === 0 ? 0 : 1)
