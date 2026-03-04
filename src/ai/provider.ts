/**
 * AI provider priority: OpenAI → DeepSeek API → Ollama.
 * Set OPENAI_API_KEY for ChatGPT, or DEEPSEEK_API_KEY, or use local Ollama.
 */

import { config } from '../config';
import * as openai from './openai.client';
import * as deepseek from './deepseek.client';
import * as ollama from './ollama.client';

export type ChatMessage = openai.ChatMessage;

export function useOpenAI(): boolean {
  return Boolean(config.openai.apiKey?.trim());
}

export function useDeepSeek(): boolean {
  return Boolean(config.deepseek.apiKey?.trim());
}

export async function chat(messages: ChatMessage[], model?: string): Promise<string> {
  if (useOpenAI()) return openai.chat(messages, model);
  if (useDeepSeek()) return deepseek.chat(messages, model);
  return ollama.chat(messages, model);
}

export async function healthCheck(): Promise<boolean> {
  if (useOpenAI()) return openai.healthCheck();
  if (useDeepSeek()) return deepseek.healthCheck();
  return ollama.healthCheck();
}

export function getModelName(): string {
  if (useOpenAI()) return config.openai.model;
  if (useDeepSeek()) return config.deepseek.model;
  return config.ollama.model;
}
