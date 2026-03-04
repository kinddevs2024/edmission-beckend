/**
 * AI provider: DeepSeek API (if DEEPSEEK_API_KEY set) or Ollama (fallback).
 * No Ollama needed when using DeepSeek API — just set the key.
 */

import { config } from '../config';
import * as deepseek from './deepseek.client';
import * as ollama from './ollama.client';

export type ChatMessage = deepseek.ChatMessage;

export function useDeepSeek(): boolean {
  return Boolean(config.deepseek.apiKey?.trim());
}

export async function chat(messages: ChatMessage[], model?: string): Promise<string> {
  if (useDeepSeek()) {
    return deepseek.chat(messages, model);
  }
  return ollama.chat(messages, model);
}

export async function healthCheck(): Promise<boolean> {
  if (useDeepSeek()) {
    return deepseek.healthCheck();
  }
  return ollama.healthCheck();
}

export function getModelName(): string {
  if (useDeepSeek()) {
    return config.deepseek.model;
  }
  return config.ollama.model;
}
