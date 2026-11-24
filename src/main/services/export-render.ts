import type { ChatMessage, SessionSummary } from '@shared/types'

/**
 * 导出的纯渲染函数（不碰 fs / dialog），因此可以被冒烟测试直接调用。
 *
 * 安全约束写在类型和命名上：这里能拿到的只有会话与消息，
 * 拿不到 API Key 与 baseUrl——从源头上杜绝"导出文件里带密钥"。
 */

export function renderSessionMarkdown(
  session: SessionSummary,
  messages: ChatMessage[],
  includeReasoning: boolean
): string {
  const lines: string[] = [
    `# ${session.title}`,
    '',
    `- 会话 ID: ${session.id}`,
    `- 模型: ${session.modelId ?? '（继承默认）'}`,
    `- 创建: ${formatTime(session.createdAt)}`,
    `- 导出: ${formatTime(Date.now())}`,
    ''
  ]

  for (const message of messages) {
    const who = message.role === 'user' ? '用户' : message.role === 'assistant' ? 'DeepSeek' : '系统'
    const icon = message.role === 'user' ? '👤' : '✦'
    lines.push('---', '', `## ${icon} ${who} · ${formatTime(message.createdAt)}`, '')

    if (includeReasoning && message.reasoning) {
      lines.push(
        '<details>',
        '<summary>思考过程</summary>',
        '',
        message.reasoning,
        '',
        '</details>',
        ''
      )
    }

    lines.push(message.content.trim() || '（空）', '')
  }

  return `${lines.join('\n')}\n`
}

export function renderSessionsJson(
  payload: { session: SessionSummary; messages: ChatMessage[] }[]
): string {
  const body = {
    format: 'my-deepseek-chat.export',
    version: 1,
    exportedAt: Date.now(),
    sessions: payload.map(({ session, messages }) => ({
      id: session.id,
      title: session.title,
      modelId: session.modelId,
      thinking: session.thinking,
      effort: session.effort,
      temperature: session.temperature,
      maxTokens: session.maxTokens,
      systemPrompt: session.systemPrompt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      archivedAt: session.archivedAt,
      messages: messages.map((message) => ({
        id: message.id,
        parentId: message.parentId,
        role: message.role,
        content: message.content,
        reasoning: message.reasoning,
        status: message.status,
        modelId: message.modelId,
        finishReason: message.finishReason,
        tokens: message.tokens,
        createdAt: message.createdAt
      }))
    }))
  }

  // 刻意不写 baseUrl 与任何密钥信息
  return `${JSON.stringify(body, null, 2)}\n`
}

export function formatTime(epochMs: number): string {
  const date = new Date(epochMs)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 文件名要能跨平台：Windows 禁止 \ / : * ? " < > | */
export function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|\n\r\t]/g, '_').slice(0, 60) || 'conversation'
}
