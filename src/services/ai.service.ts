import { buildContext } from '../ai/context.builder';
import { getSystemPrompt } from '../ai/prompts';
import * as aiProvider from '../ai/provider';
import { runTool, getOpenAIToolsDefinitions, getToolFallbackPromptAppendix, parseToolCall, type ToolName } from '../ai/tools';
import * as subscriptionService from './subscription.service';
import { AIConversation } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';
import { logger } from '../utils/logger';
import type { Role } from '../types/role';

export type StreamChunk = aiProvider.StreamChunk;

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
const MAX_TOOL_FALLBACK_ITERATIONS = 5;

/** When not using OpenAI: parse [TOOL:name]{json} from model reply, run tool, append result, call again. */
async function chatWithToolsFallback(
  initialMessages: aiProvider.ChatMessage[],
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  model?: string
): Promise<string> {
  let messages = initialMessages;
  let lastReply = '';
  for (let i = 0; i < MAX_TOOL_FALLBACK_ITERATIONS; i++) {
    lastReply = await aiProvider.chat(messages, model);
    const parsed = parseToolCall(lastReply);
    if (!parsed) return lastReply;
    let result: string;
    try {
      result = await executeTool(parsed.toolName, parsed.params);
    } catch (e) {
      result = e instanceof Error ? e.message : String(e);
    }
    messages = [
      ...messages,
      { role: 'assistant', content: lastReply },
      { role: 'user', content: `Tool result:\n${result}` },
    ];
  }
  return lastReply;
}

export async function chat(userId: string, role: Role, input: ChatInput): Promise<string> {
  const context = await buildContext(userId, role);
  const systemPrompt = getSystemPrompt(role, context);

  let conv = await AIConversation.findOne({ userId, role }).lean();
  const savedMessages: ChatHistoryItem[] = conv && Array.isArray((conv as { messages?: { role: string; content: string }[] }).messages)
    ? (conv as { messages: { role: string; content: string }[] }).messages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    : [];
  const history = (input.history?.length ? input.history : savedMessages).slice(-16);

  let userContent = input.message.trim();
  if (input.selectedText?.trim()) {
    const q = userContent || 'Please explain or elaborate on the selected part.';
    userContent = `[The user selected this part of your previous answer and is asking about it]\n"${input.selectedText.trim()}"\n\nUser's question: ${q}`;
  }

  const messages: aiProvider.ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userContent },
  ];

  try {
    const model = await subscriptionService.getChatModel(userId, role);
    const tools = getOpenAIToolsDefinitions(role);
    const executeTool = async (name: string, args: Record<string, unknown>) =>
      runTool(name as ToolName, args, userId, role);

    let reply: string;
    if (aiProvider.useOpenAI() && tools.length > 0) {
      reply = await aiProvider.chatWithTools(messages, tools, executeTool, model);
    } else if (tools.length > 0) {
      const appendix = getToolFallbackPromptAppendix(role);
      const messagesWithAppendix: aiProvider.ChatMessage[] = [
        { role: 'system', content: systemPrompt + '\n\n' + appendix },
        ...messages.slice(1),
      ];
      reply = await chatWithToolsFallback(messagesWithAppendix, executeTool, model);
    } else {
      reply = await aiProvider.chat(messages, model);
    }

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

/** Stream chat: yields chunks (content + optional thinking). Caller must handle errors. */
export async function* chatStream(
  userId: string,
  role: Role,
  input: ChatInput
): AsyncGenerator<StreamChunk, void, unknown> {
  const context = await buildContext(userId, role);
  const systemPrompt = getSystemPrompt(role, context);

  let conv = await AIConversation.findOne({ userId, role }).lean();
  const savedMessages: ChatHistoryItem[] = conv && Array.isArray((conv as { messages?: { role: string; content: string }[] }).messages)
    ? (conv as { messages: { role: string; content: string }[] }).messages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    : [];
  const history = (input.history?.length ? input.history : savedMessages).slice(-16);

  let userContent = input.message.trim();
  if (input.selectedText?.trim()) {
    const q = userContent || 'Please explain or elaborate on the selected part.';
    userContent = `[The user selected this part of your previous answer and is asking about it]\n"${input.selectedText.trim()}"\n\nUser's question: ${q}`;
  }

  const messages: aiProvider.ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userContent },
  ];

  const model = await subscriptionService.getChatModel(userId, role);
  let fullReply = '';
  try {
    for await (const chunk of aiProvider.chatStream(messages, model)) {
      if (chunk.type === 'content') fullReply += chunk.text;
      yield chunk;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg }, 'AI chat stream error');
    throw e;
  }

  if (fullReply) {
    await AIConversation.findOneAndUpdate(
      { userId, role },
      { $push: { messages: { $each: [{ role: 'user', content: input.message.trim() }, { role: 'assistant', content: fullReply }] } } },
      { upsert: true }
    );
  }
}
