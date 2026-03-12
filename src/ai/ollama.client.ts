import { config } from '../config';
import { logger } from '../utils/logger';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type StreamChunk = { type: 'content' | 'thinking'; text: string };

const { baseUrl, model: defaultModel, chatTimeoutMs } = config.ollama;

export async function chat(messages: ChatMessage[], model?: string): Promise<string> {
  const url = `${baseUrl}/api/chat`;
  const modelName = model ?? defaultModel;
  const body = {
    model: modelName,
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

/** Stream chat: yields content chunks. Ollama may send reasoning in message.content or separate. */
export async function* chatStream(
  messages: ChatMessage[],
  model?: string
): AsyncGenerator<StreamChunk, void, unknown> {
  const url = `${baseUrl}/api/chat`;
  const modelName = model ?? defaultModel;
  const body = {
    model: modelName,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
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

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('Ollama stream body is not readable');
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
        if (!trimmed) continue;
        try {
          const data = JSON.parse(trimmed) as {
            message?: { role?: string; content?: string };
            done?: boolean;
          };
          const content = data.message?.content;
          if (content != null && typeof content === 'string' && content.length > 0) {
            yield { type: 'content', text: content };
          }
        } catch (_) {
          /* skip */
        }
      }
    }
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
