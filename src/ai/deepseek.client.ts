/**
 * DeepSeek Cloud API (OpenAI-compatible).
 * No Ollama needed — just set DEEPSEEK_API_KEY and the assistant works.
 * Docs: https://api-docs.deepseek.com/api/create-chat-completion
 */

import { config } from '../config';
import { logger } from '../utils/logger';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const { apiKey, model: defaultModel, chatTimeoutMs } = config.deepseek;

export type StreamChunk = { type: 'content' | 'thinking'; text: string };

export async function chat(messages: ChatMessage[], _model?: string): Promise<string> {
  if (!apiKey?.trim()) {
    throw new Error('DEEPSEEK_API_KEY is not set');
  }

  const body = {
    model: defaultModel,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), chatTimeoutMs);

  try {
    const res = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text();
      logger.warn({ status: res.status, body: text }, 'DeepSeek API error');
      throw new Error(`DeepSeek API error: ${res.status}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; content?: string }>;
      error?: { message?: string };
    };
    if (data.error?.message) {
      throw new Error(data.error.message);
    }
    const content = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.content ?? '';
    return typeof content === 'string' ? content : String(content);
  } catch (e) {
    clearTimeout(timeout);
    if (e instanceof Error) {
      if (e.name === 'AbortError') {
        logger.warn('DeepSeek request timeout');
        throw new Error('AI_TIMEOUT');
      }
      throw e;
    }
    throw e;
  }
}

/** Stream chat: yields content and optionally reasoning/thinking chunks (e.g. DeepSeek R1). */
export async function* chatStream(
  messages: ChatMessage[],
  _model?: string
): AsyncGenerator<StreamChunk, void, unknown> {
  if (!apiKey?.trim()) {
    throw new Error('DEEPSEEK_API_KEY is not set');
  }

  const body = {
    model: defaultModel,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), chatTimeoutMs);

  try {
    const res = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text();
      logger.warn({ status: res.status, body: text }, 'DeepSeek API error');
      throw new Error(`DeepSeek API error: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('DeepSeek stream body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const json = JSON.parse(trimmed.slice(6)) as {
            choices?: Array<{
              delta?: { content?: string; reasoning_content?: string };
            }>;
            error?: { message?: string };
          };
          if (json.error?.message) throw new Error(json.error.message);
          const delta = json.choices?.[0]?.delta;
          if (delta?.reasoning_content) {
            yield { type: 'thinking', text: delta.reasoning_content };
          }
          if (delta?.content) {
            yield { type: 'content', text: delta.content };
          }
        } catch (_) {
          /* skip malformed lines */
        }
      }
    }
  } catch (e) {
    clearTimeout(timeout);
    if (e instanceof Error) {
      if (e.name === 'AbortError') {
        logger.warn('DeepSeek request timeout');
        throw new Error('AI_TIMEOUT');
      }
      throw e;
    }
    throw e;
  }
}

export async function healthCheck(): Promise<boolean> {
  return Boolean(apiKey?.trim());
}
