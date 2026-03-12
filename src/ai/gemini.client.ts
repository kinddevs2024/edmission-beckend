/**
 * Google Gemini API (free tier available).
 * Set GEMINI_API_KEY and the assistant uses Gemini.
 */

import { config } from '../config'
import { logger } from '../utils/logger'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const { apiKey, model: defaultModel, chatTimeoutMs } = config.gemini

function buildContents(messages: ChatMessage[]): Array<{ role: string; parts: Array<{ text: string }> }> {
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []
  let systemText = ''
  for (const m of messages) {
    if (m.role === 'system') {
      systemText = m.content
      continue
    }
    const role = m.role === 'assistant' ? 'model' : 'user'
    contents.push({ role, parts: [{ text: m.content }] })
  }
  return contents
}

function getSystemInstruction(messages: ChatMessage[]): string | undefined {
  const sys = messages.find((m) => m.role === 'system')
  return sys?.content?.trim() || undefined
}

export async function chat(messages: ChatMessage[], _model?: string): Promise<string> {
  if (!apiKey?.trim()) {
    throw new Error('GEMINI_API_KEY is not set')
  }

  const systemInstruction = getSystemInstruction(messages)
  const filtered = messages.filter((m) => m.role !== 'system')
  const contents = buildContents(filtered.length ? filtered : messages)

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: 2048 },
  }
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${defaultModel}:generateContent?key=${apiKey.trim()}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), chatTimeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const text = await res.text()
      logger.warn({ status: res.status, body: text }, 'Gemini API error')
      throw new Error(`Gemini API error: ${res.status}`)
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      error?: { message?: string }
    }
    if (data.error?.message) {
      throw new Error(data.error.message)
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    return typeof text === 'string' ? text : String(text)
  } catch (e) {
    clearTimeout(timeout)
    if (e instanceof Error) {
      if (e.name === 'AbortError') {
        logger.warn('Gemini request timeout')
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
    throw new Error('GEMINI_API_KEY is not set')
  }

  const systemInstruction = getSystemInstruction(messages)
  const filtered = messages.filter((m) => m.role !== 'system')
  const contents = buildContents(filtered.length ? filtered : messages)

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: 2048 },
  }
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${defaultModel}:streamGenerateContent?key=${apiKey.trim()}&alt=sse`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), chatTimeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const text = await res.text()
      logger.warn({ status: res.status, body: text }, 'Gemini API error')
      throw new Error(`Gemini API error: ${res.status}`)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error('Gemini stream body is not readable')

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
        if (!trimmed.startsWith('data: ')) continue
        const payload = trimmed.slice(6)
        if (payload === '[DONE]' || payload === '') continue
        try {
          const data = JSON.parse(payload) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
          }
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text
          if (typeof text === 'string' && text.length > 0) {
            yield { type: 'content', text }
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
        logger.warn('Gemini request timeout')
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
