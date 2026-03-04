import { buildContext } from '../ai/context.builder';
import { getSystemPrompt } from '../ai/prompts';
import * as aiProvider from '../ai/provider';
import * as subscriptionService from './subscription.service';
import { AIConversation } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';
import { logger } from '../utils/logger';
import type { Role } from '../types/role';

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatInput {
  message: string;
  history?: ChatHistoryItem[];
  selectedText?: string;
}

const MAX_HISTORY_MESSAGES = 20;

export async function chat(userId: string, role: Role, input: ChatInput): Promise<string> {
  if (role !== 'student' && role !== 'university') {
    throw new AppError(403, 'AI chat is available for students and universities only', ErrorCodes.FORBIDDEN);
  }

  const context = await buildContext(userId, role);
  const systemPrompt = getSystemPrompt(role, context);

  let conv = await AIConversation.findOne({ userId, role }).lean();
  const savedMessages: ChatHistoryItem[] = conv && Array.isArray((conv as { messages?: { role: string; content: string }[] }).messages)
    ? (conv as { messages: { role: string; content: string }[] }).messages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    : [];
  const history = (input.history?.length ? input.history : savedMessages).slice(-16);

  let userContent = input.message.trim();
  if (input.selectedText?.trim()) {
    userContent = `[The user selected this part of your previous answer and is asking about it]\n"${input.selectedText.trim()}"\n\nUser's question: ${userContent}`;
  }

  const messages: aiProvider.ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userContent },
  ];

  try {
    const model = await subscriptionService.getChatModel(userId, role);
    const reply = await aiProvider.chat(messages, model);

    await AIConversation.findOneAndUpdate(
      { userId, role },
      { $push: { messages: { $each: [{ role: 'user', content: input.message.trim() }, { role: 'assistant', content: reply }] } } },
      { upsert: true }
    );

    return reply;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg }, 'AI chat error');
    if (msg === 'AI_TIMEOUT') {
      throw new AppError(504, 'AI response timeout', ErrorCodes.AI_TIMEOUT);
    }
    if (msg.includes('insufficient_quota') || msg.includes('Insufficient quota')) {
      throw new AppError(503, 'AI quota exceeded. Please check your API credits.', ErrorCodes.AI_UNAVAILABLE);
    }
    if (msg.includes('is not set') || msg.includes('invalid_api_key') || msg.includes('Invalid API key') || msg.includes('401')) {
      throw new AppError(503, 'AI API key is missing or invalid.', ErrorCodes.AI_UNAVAILABLE);
    }
    if (msg.includes('429') || msg.includes('rate_limit')) {
      throw new AppError(503, 'AI rate limit exceeded. Try again later.', ErrorCodes.AI_UNAVAILABLE);
    }
    if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      throw new AppError(503, 'AI service unreachable. Check server network.', ErrorCodes.AI_UNAVAILABLE);
    }
    throw new AppError(503, `AI service unavailable: ${msg}`, ErrorCodes.AI_UNAVAILABLE);
  }
}
