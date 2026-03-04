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

export async function healthCheck(): Promise<boolean> {
  return Boolean(apiKey?.trim())
}
