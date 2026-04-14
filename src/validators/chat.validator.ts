import { z } from 'zod';
import { objectIdZod } from '../utils/validators';

export const createChatSchema = z.object({
  body: z.object({
    studentId: objectIdZod.optional(),
    universityId: objectIdZod.optional(),
  }),
});

export const chatIdParamSchema = z.object({
  chatId: objectIdZod,
});

export const messageIdParamSchema = z.object({
  chatId: objectIdZod,
  messageId: objectIdZod,
});

export const sendMessageSchema = z.object({
  body: z.object({
    text: z.string().max(4000).optional(),
    type: z.enum(['text', 'voice', 'emotion']).optional(),
    attachmentUrl: z.string().url().max(2048).optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
});

export const updateMessageSchema = z.object({
  body: z.object({
    text: z.string().trim().min(1).max(4000),
  }),
});

export const deleteMessageSchema = z.object({
  body: z.object({
    scope: z.enum(['me', 'everyone']).default('me'),
  }),
});

export const acceptStudentSchema = z.object({
  body: z.object({
    positionType: z.string().optional(),
    positionLabel: z.string().max(120).optional(),
    congratulatoryMessage: z.string().max(2000).optional(),
  }),
});
