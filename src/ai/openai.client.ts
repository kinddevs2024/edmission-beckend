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

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const { apiKey, model: defaultModel, chatTimeoutMs } = config.openai

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

export async function healthCheck(): Promise<boolean> {
  return Boolean(apiKey?.trim())
}
