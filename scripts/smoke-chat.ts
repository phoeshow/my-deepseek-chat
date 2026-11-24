import { app } from 'electron'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatFrame } from '../src/shared/types'
import { abort, regenerate, send, setFrameSink } from '../src/main/chat/service'
import { closeDatabase, getDb, initDatabase, recoveredMessageCount } from '../src/main/db'
import * as messagesRepo from '../src/main/db/repo/message'
import { countSiblings, getThread } from '../src/main/db/repo/message'
import * as sessions from '../src/main/db/repo/session'
import { initModels, rememberModels } from '../src/main/services/models'
import { getKey, initSecret, setKey } from '../src/main/services/secret'
import { initSettings, updateConfig } from '../src/main/services/settings'

/**
 * M1 冒烟测试：不碰真实 DeepSeek，用本地 mock SSE 服务驱动完整链路
 * （ChatService → ContextBuilder → SSE 解析 → SQLite 落库 → 帧广播）。
 *
 * 必须跑在 Electron 运行时里，因为 better-sqlite3 是按 Electron ABI 编译的。
 * 数据写进临时目录，绝不动用户真实的 ~/.config/my-deepseek-chat。
 *
 * 运行：pnpm smoke
 */

let failures = 0

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ✓ ${name}`)
  } else {
    failures += 1
    console.log(`  ✗ ${name}`, detail ?? '')
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function startMockServer(): Promise<{ close: () => Promise<void>; port: number }> {
  const server = createServer((req, res) => {
    if (!(req.url ?? '').startsWith('/chat/completions')) {
      res.writeHead(404).end()
      return
    }

    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', async () => {
      const parsedBody = JSON.parse(body) as Record<string, unknown>
      mockRequests.push(parsedBody)
      // 慢速模式：留出足够时间窗观察“流式期间是否已经增量落库”
      const delay = parsedBody.model === 'mock-slow' ? 300 : 15
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const events = [
        'data: {"choices":[{"delta":{"reasoning_content":"先确认需求。"}}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_content":"再组织语言。"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"，世界。"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":8,"prompt_cache_hit_tokens":96}}\n\n',
        'data: [DONE]\n\n'
      ]
      for (const event of events) {
        await sleep(delay)
        res.write(event)
      }
      res.end()
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
          })
      })
    })
  })
}

const mockRequests: Record<string, unknown>[] = []

interface Waiter {
  resolve: (frame: ChatFrame) => void
  predicate: (frame: ChatFrame) => boolean
}

const waiters: Waiter[] = []

function waitForFrame(predicate: (frame: ChatFrame) => boolean): Promise<ChatFrame> {
  return new Promise((resolve) => {
    waiters.push({ resolve, predicate })
  })
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'ds-smoke-'))
  const mock = await startMockServer()

  try {
    initDatabase(dataDir)
    initSettings(dataDir)
    initSecret(dataDir)
    initModels(dataDir)
    updateConfig({ baseUrl: `http://127.0.0.1:${mock.port}` })
    rememberModels([{ id: 'mock-flash', name: 'Mock Flash', contextWindow: 1_048_576, maxOutputTokens: null }])

    setFrameSink((frame) => {
      for (const waiter of [...waiters]) {
        if (waiter.predicate(frame)) {
          waiters.splice(waiters.indexOf(waiter), 1)
          waiter.resolve(frame)
        }
      }
    })

    console.log('\n[1] 密钥存取')
    await setKey('sk-smoke-test-key')
    const stored = await getKey()
    check('setKey / getKey 往返一致', stored === 'sk-smoke-test-key')

    console.log('\n[2] 一轮完整对话')
    const session = sessions.createSession({ modelId: 'mock-flash', thinking: true })
    const sent = await send({ sessionId: session.id, parentId: null, text: '你好' })
    check('send 立即返回三个 id', Boolean(sent.requestId && sent.userMessageId && sent.assistantMessageId))

    const endFrame = await waitForFrame(
      (frame) => frame.requestId === sent.requestId && frame.type === 'end'
    )
    check('收到 end 帧且 reason=stop', endFrame.type === 'end' && endFrame.reason === 'stop', endFrame)

    const thread = getThread(session.id, sessions.mustGetSession(session.id).activeLeafId)
    check('主线落库为 user + assistant 两条', thread.length === 2, thread.length)
    check('用户消息内容正确', thread[0]?.content === '你好', thread[0]?.content)
    check('助手正文正确', thread[1]?.content === '你好，世界。', thread[1]?.content)
    check('思维链落库（后续带 tools 时必须回传）', thread[1]?.reasoning === '先确认需求。再组织语言。', thread[1]?.reasoning)
    check('终态为 complete', thread[1]?.status === 'complete', thread[1]?.status)
    check('tokens 已记录', thread[1]?.tokens?.prompt === 120 && thread[1]?.tokens?.completion === 8, thread[1]?.tokens)
    check('会话标题取首句（不再是"新对话"）', sessions.mustGetSession(session.id).title === '你好')

    const usageRow = getDb().prepare('SELECT * FROM usage_log').all() as { cache_hit_tokens: number }[]
    check('usage_log 写入 1 行且含缓存命中', usageRow.length === 1 && usageRow[0]?.cache_hit_tokens === 96, usageRow)

    console.log('\n[3] 请求体契约')
    const lastBody = mockRequests.at(-1)
    check('声明 stream=true', lastBody?.stream === true)
    check('声明 include_usage', JSON.stringify(lastBody?.stream_options) === '{"include_usage":true}')
    check('thinking 开启时传 type=enabled', JSON.stringify(lastBody?.thinking) === '{"type":"enabled"}')
    check('thinking 开启时传 reasoning_effort', typeof lastBody?.reasoning_effort === 'string', lastBody?.reasoning_effort)

    console.log('\n[4] 中途停止')
    const second = await send({ sessionId: session.id, parentId: null, text: '再来一次' })
    await waitForFrame((frame) => frame.requestId === second.requestId && frame.type === 'text')
    const abortedFrame = waitForFrame(
      (frame) => frame.requestId === second.requestId && frame.type === 'end'
    )
    check('abort() 返回 true', abort(second.requestId) === true)
    const abortEnd = await abortedFrame
    check('中止后 end 帧 reason=aborted', abortEnd.type === 'end' && abortEnd.reason === 'aborted', abortEnd)

    const afterAbort = getThread(session.id, sessions.mustGetSession(session.id).activeLeafId)
    const abortedMessage = afterAbort.at(-1)
    check('中止的消息标记为 aborted', abortedMessage?.status === 'aborted', abortedMessage?.status)
    check('中止保留已收到的部分内容', (abortedMessage?.content.length ?? 0) > 0, abortedMessage?.content)

    console.log('\n[5] 重新生成')
    const beforeRegenerate = countSiblings(session.id, abortedMessage?.parentId ?? null)
    const regen = await regenerate(abortedMessage?.id ?? '')
    await waitForFrame((frame) => frame.requestId === regen.requestId && frame.type === 'end')
    const afterRegenerate = countSiblings(session.id, abortedMessage?.parentId ?? null)
    check(
      '同 parent 下新增 assistant 兄弟节点（旧回答保留）',
      afterRegenerate === beforeRegenerate + 1,
      { beforeRegenerate, afterRegenerate }
    )

    const finalThread = getThread(session.id, sessions.mustGetSession(session.id).activeLeafId)
    check('主线游标已指向新的回答', finalThread.at(-1)?.id === regen.assistantMessageId, finalThread.at(-1)?.id)

    console.log('\n[6] 并发保护')
    const first = await send({ sessionId: session.id, parentId: null, text: '并发 A' })
    let secondError: string | null = null
    try {
      await send({ sessionId: session.id, parentId: null, text: '并发 B' })
    } catch (err) {
      secondError = err instanceof Error ? err.message : String(err)
    }
    check('同一会话的第二个请求被拒绝', secondError !== null, secondError)
    abort(first.requestId)
    await waitForFrame((frame) => frame.requestId === first.requestId && frame.type === 'end')
    console.log('\n[7] 启动自愈')
    const orphan = sessions.createSession({ modelId: 'mock-flash', thinking: null })
    const orphanMessage = messagesRepo.insertMessage({
      sessionId: orphan.id,
      parentId: null,
      role: 'assistant',
      status: 'streaming',
      modelId: 'mock-flash'
    })
    closeDatabase()
    initDatabase(dataDir)
    const healed = messagesRepo.getMessage(orphanMessage.id)
    check('残留 streaming 被标记为 aborted', healed?.status === 'aborted', healed?.status)
    check('自愈计数可上报给渲染层', recoveredMessageCount() === 1, recoveredMessageCount())

    console.log('\n[8] 增量落库（200ms / 32 帧）')
    const slowSession = sessions.createSession({ modelId: 'mock-slow', thinking: false })
    const slowSent = await send({ sessionId: slowSession.id, parentId: null, text: '慢速流' })
    await waitForFrame((frame) => frame.requestId === slowSent.requestId && frame.type === 'text')
    // 首帧文本到达后再等 300ms：定时器 200ms 应已触发一次落库
    await sleep(300)
    const duringStream = messagesRepo.getMessage(slowSent.assistantMessageId)
    check(
      '生成过程中数据库已有部分内容',
      (duringStream?.content.length ?? 0) > 0,
      duringStream?.content
    )
    check('此时状态仍为 streaming', duringStream?.status === 'streaming', duringStream?.status)
    await waitForFrame((frame) => frame.requestId === slowSent.requestId && frame.type === 'end')
    const afterStream = messagesRepo.getMessage(slowSent.assistantMessageId)
    check('结束后完整内容覆盖增量内容', afterStream?.content === '你好，世界。', afterStream?.content)

    console.log('\n[9] 会话级设定')
    const configured = sessions.updateSession(session.id, {
      temperature: 0.3,
      maxTokens: 512,
      thinking: false,
      effort: 'low'
    })
    check('temperature 写入会话', configured.temperature === 0.3, configured.temperature)
    check('maxTokens 写入会话', configured.maxTokens === 512, configured.maxTokens)
    check('thinking 写入会话', configured.thinking === false, configured.thinking)
    check('effort 写入会话', configured.effort === 'low', configured.effort)

    const configuredSend = await send({ sessionId: session.id, parentId: null, text: '带参数的请求' })
    await waitForFrame((frame) => frame.requestId === configuredSend.requestId && frame.type === 'end')
    const configuredBody = mockRequests.at(-1)
    check('请求体带上会话 temperature', configuredBody?.temperature === 0.3, configuredBody?.temperature)
    check('请求体带上会话 max_tokens', configuredBody?.max_tokens === 512, configuredBody?.max_tokens)
    check(
      '会话设定为关闭时 thinking=disabled',
      JSON.stringify(configuredBody?.thinking) === '{"type":"disabled"}',
      configuredBody?.thinking
    )
    check(
      '关闭思考时不发送 reasoning_effort',
      configuredBody?.reasoning_effort === undefined,
      configuredBody?.reasoning_effort
    )

  } finally {
    closeDatabase()
    await mock.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
}

app.whenReady().then(async () => {
  try {
    await main()
  } catch (err) {
    failures += 1
    console.error('\n冒烟测试抛出异常：', err)
  }
  console.log(`\n结果：${failures === 0 ? '全部通过' : `${failures} 项失败`}`)
  app.exit(failures === 0 ? 0 : 1)
})
