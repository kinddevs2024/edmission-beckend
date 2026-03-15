/**
 * OpenAI API (ChatGPT).
 * Set OPENAI_API_KEY and the assistant uses ChatGPT.
 */

import { config } from '../config'
import { logger } from '../utils/logger'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** OpenAI tool definition for chat completions. */
export type OpenAITool = {
  type: 'function'
  function: { name: string; description: string; parameters: { type: 'object'; properties?: Record<string, unknown>; required?: string[] } }
}

/** Message that can include tool_calls (assistant) or tool result (tool). */
type OpenAIMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string }

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const { apiKey, model: defaultModel, chatTimeoutMs } = config.openai
const MAX_TOOL_ITERATIONS = 5

export async function chat(messages: ChatMessage[], _model?: string): Promise<string> {
  if (!apiKey?.trim()) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  const body = {
    model: defaultModel,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), chatTimeoutMs)

  try {
    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const text = await res.text()
      logger.warn({ status: res.status, body: text }, 'OpenAI API error')
      let errMsg = `OpenAI API error: ${res.status}`
      try {
        const errJson = JSON.parse(text) as { error?: { message?: string } }
        if (errJson.error?.message) errMsg = errJson.error.message
      } catch (_) { /* ignore */ }
      throw new Error(errMsg)
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    }
    if (data.error?.message) {
      throw new Error(data.error.message)
    }
    const content = data.choices?.[0]?.message?.content ?? ''
    return typeof content === 'string' ? content : String(content)
  } catch (e) {
    clearTimeout(timeout)
    if (e instanceof Error) {
      if (e.name === 'AbortError') {
        logger.warn('OpenAI request timeout')
        throw new Error('AI_TIMEOUT')
      }
      throw e
    }
    throw e
  }
}

export type StreamChunk = { type: 'content' | 'thinking'; text: string }

/** Stream chat: yields content chunks. */
export async function* chatStream(
  messages: ChatMessage[],
  _model?: string
): AsyncGenerator<StreamChunk, void, unknown> {
  if (!apiKey?.trim()) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  const body = {
    model: defaultModel,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), chatTimeoutMs)

  try {
    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const text = await res.text()
      logger.warn({ status: res.status, body: text }, 'OpenAI API error')
      throw new Error(`OpenAI API error: ${res.status}`)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error('OpenAI stream body is not readable')

    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === 'data: [DONE]') continue
        if (!trimmed.startsWith('data: ')) continue
        try {
          const data = JSON.parse(trimmed.slice(6)) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>
          }
          const content = data.choices?.[0]?.delta?.content
          if (typeof content === 'string' && content.length > 0) {
            yield { type: 'content', text: content }
          }
        } catch (_) {
          /* skip malformed */
        }
      }
    }
  } catch (e) {
    clearTimeout(timeout)
    if (e instanceof Error) {
      if (e.name === 'AbortError') {
        logger.warn('OpenAI request timeout')
        throw new Error('AI_TIMEOUT')
      }
      throw e
    }
    throw e
  }
}

/**
 * Chat with tool support: if the model returns tool_calls, executes them and calls the API again until no tool_calls or max iterations.
 */
export async function chatWithTools(
  messages: ChatMessage[],
  tools: OpenAITool[],
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  modelOverride?: string
): Promise<string> {
  if (!apiKey?.trim()) {
    throw new Error('OPENAI_API_KEY is not set')
  }
  const model = modelOverride?.trim() || defaultModel
  let apiMessages: OpenAIMessage[] = messages.map((m) =>
    m.role === 'assistant' ? { role: 'assistant' as const, content: m.content } : { role: m.role, content: m.content }
  )

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const body: Record<string, unknown> = {
      model,
      messages: apiMessages,
      stream: false,
    }
    if (tools.length > 0) body.tools = tools

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), chatTimeoutMs)

    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const text = await res.text()
      logger.warn({ status: res.status, body: text }, 'OpenAI API error')
      let errMsg = `OpenAI API error: ${res.status}`
      try {
        const errJson = JSON.parse(text) as { error?: { message?: string } }
        if (errJson.error?.message) errMsg = errJson.error.message
      } catch (_) {
        /* ignore */
      }
      throw new Error(errMsg)
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null
          tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
        }
        finish_reason?: string
      }>
      error?: { message?: string }
    }
    if (data.error?.message) {
      throw new Error(data.error.message)
    }

    const choice = data.choices?.[0]
    const msg = choice?.message
    const toolCalls = msg?.tool_calls?.length ? msg.tool_calls : undefined

    if (!toolCalls?.length) {
      const content = msg?.content ?? ''
      return typeof content === 'string' ? content : String(content)
    }

    apiMessages.push({
      role: 'assistant',
      content: msg?.content ?? null,
      tool_calls: toolCalls,
    })

    for (const tc of toolCalls) {
      let result: string
      try {
        const args = (() => {
          try {
            return (JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>) || {}
          } catch {
            return {}
          }
        })()
        result = await executeTool(tc.function.name, args)
      } catch (e) {
        result = e instanceof Error ? e.message : String(e)
      }
      apiMessages.push({ role: 'tool', tool_call_id: tc.id, content: result })
    }
  }

  return 'Tool loop reached max iterations. Please try again with a simpler question.'
}

export async function healthCheck(): Promise<boolean> {
  return Boolean(apiKey?.trim())
}
