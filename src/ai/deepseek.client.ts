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

export async function healthCheck(): Promise<boolean> {
  return Boolean(apiKey?.trim());
}
