import { buildContext } from '../ai/context.builder';
import { getSystemPrompt } from '../ai/prompts';
import * as ollama from '../ai/ollama.client';
import { AppError, ErrorCodes } from '../utils/errors';
import type { Role } from '../types/role';

export async function chat(userId: string, role: Role, userMessage: string): Promise<string> {
  if (role !== 'student' && role !== 'university') {
    throw new AppError(403, 'AI chat is available for students and universities only', ErrorCodes.FORBIDDEN);
  }

  const context = await buildContext(userId, role);
  const systemPrompt = getSystemPrompt(role, context);
  const messages: ollama.ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  try {
    const reply = await ollama.chat(messages);
    return reply;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'AI_TIMEOUT') {
      throw new AppError(504, 'AI response timeout', ErrorCodes.AI_TIMEOUT);
    }
    throw new AppError(503, 'AI service unavailable', ErrorCodes.AI_UNAVAILABLE);
  }
}
