import { config } from '../config';
import { logger } from '../utils/logger';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const { baseUrl, model, chatTimeoutMs } = config.ollama;

export async function chat(messages: ChatMessage[]): Promise<string> {
  const url = `${baseUrl}/api/chat`;
  const body = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), chatTimeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text();
      logger.warn({ status: res.status, url, body: text }, 'Ollama API error');
      throw new Error(`Ollama API error: ${res.status}`);
    }

    const data = (await res.json()) as { message?: { content?: string }; response?: string };
    const content = data.message?.content ?? data.response ?? '';
    return typeof content === 'string' ? content : String(content);
  } catch (e) {
    clearTimeout(timeout);
    if (e instanceof Error) {
      if (e.name === 'AbortError') {
        logger.warn('Ollama request timeout');
        throw new Error('AI_TIMEOUT');
      }
      throw e;
    }
    throw e;
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
