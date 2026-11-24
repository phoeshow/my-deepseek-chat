import { createServer } from 'node:http'

/**
 * 假 DeepSeek 服务，供 scripts/smoke-chat.ts 与 scripts/e2e-ui.mjs 使用。
 * 只实现被测到的两个端点：GET /models 与 POST /chat/completions（SSE）。
 *
 * 刻意制造三种真实世界会出现的情况，用来验证解析器的健壮性：
 *   1. 一个 JSON 事件被拆到两个 TCP 包里（分包）
 *   2. CRLF 行尾
 *   3. 思维链 → 正文 → finish → usage → [DONE] 的完整序列
 *
 * 故障注入：Authorization 传 `Bearer sk-fail-<status>` 即返回对应 HTTP 状态。
 * 这样可以测 401/402/429/500 的映射，而不必污染 baseUrl（带 query 的 baseUrl 会拼坏路径）。
 */

const PORT = Number(process.env.MOCK_PORT ?? 8787)
const CHUNK_DELAY = Number(process.env.MOCK_DELAY ?? 20)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function failingStatus(req) {
  const match = /^Bearer\s+sk-fail-(\d{3})$/.exec(req.headers.authorization ?? '')
  return match ? Number(match[1]) : null
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  const failStatus = failingStatus(req)

  if (url.pathname === '/models') {
    if (failStatus) return json(res, failStatus, { error: { message: `mock failure ${failStatus}` } })
    return json(res, 200, {
      object: 'list',
      data: [
        { id: 'mock-flash', object: 'model', name: 'Mock Flash', context_window: 1048576 },
        { id: 'mock-pro', object: 'model', name: 'Mock Pro', max_output_tokens: 32768 }
      ]
    })
  }

  if (url.pathname !== '/chat/completions' || req.method !== 'POST') {
    res.writeHead(404)
    return res.end()
  }

  req.on('data', () => undefined)
  req.on('end', async () => {
    if (failStatus) {
      return json(res, failStatus, { error: { message: `mock failure ${failStatus}` } })
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })

    const events = [
      'data: {"choices":[{"delta":{"reasoning_content":"先确认需求。"}}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"reasoning_content":"再组织语言。"}}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"content":"，世界。"}}]}\r\n\r\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\n',
      'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":8,"prompt_cache_hit_tokens":96}}\r\n\r\n',
      'data: [DONE]\r\n\r\n'
    ]

    for (const [index, event] of events.entries()) {
      await sleep(CHUNK_DELAY)
      if (index === 2) {
        const half = Math.floor(event.length / 2)
        res.write(event.slice(0, half))
        await sleep(CHUNK_DELAY)
        res.write(event.slice(half))
      } else {
        res.write(event)
      }
    }
    res.end()
  })

  req.on('error', () => undefined)
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`mock deepseek on http://127.0.0.1:${PORT}\n`)
})
