/**
 * AI provider priority: OpenAI → Gemini → DeepSeek API → Ollama.
 */

import { config } from '../config';
import * as openai from './openai.client';
import * as gemini from './gemini.client';
import * as deepseek from './deepseek.client';
import * as ollama from './ollama.client';

export type ChatMessage = openai.ChatMessage;

export type StreamChunk = { type: 'content' | 'thinking'; text: string };

export function useOpenAI(): boolean {
  return Boolean(config.openai.apiKey?.trim());
}

export function useGemini(): boolean {
  return Boolean(config.gemini.apiKey?.trim());
}

export function useDeepSeek(): boolean {
  return Boolean(config.deepseek.apiKey?.trim());
}

export async function chat(messages: ChatMessage[], model?: string): Promise<string> {
  if (useOpenAI()) return openai.chat(messages, model);
  if (useGemini()) return gemini.chat(messages, model);
  if (useDeepSeek()) return deepseek.chat(messages, model);
  return ollama.chat(messages, model);
}

/** Stream chat: yields content (and optionally thinking) chunks for all providers. */
export async function* chatStream(
  messages: ChatMessage[],
  model?: string
): AsyncGenerator<StreamChunk, void, unknown> {
  if (useOpenAI()) {
    yield* openai.chatStream(messages, model);
    return;
  }
  if (useGemini()) {
    yield* gemini.chatStream(messages, model);
    return;
  }
  if (useDeepSeek()) {
    yield* deepseek.chatStream(messages, model);
    return;
  }
  yield* ollama.chatStream(messages, model);
}

export async function healthCheck(): Promise<boolean> {
  if (useOpenAI()) return openai.healthCheck();
  if (useGemini()) return gemini.healthCheck();
  if (useDeepSeek()) return deepseek.healthCheck();
  return ollama.healthCheck();
}

export function getModelName(): string {
  if (useOpenAI()) return config.openai.model;
  if (useGemini()) return config.gemini.model;
  if (useDeepSeek()) return config.deepseek.model;
  return config.ollama.model;
}
