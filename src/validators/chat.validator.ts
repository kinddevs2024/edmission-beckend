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
    text: z.string().optional(),
    type: z.enum(['text', 'voice', 'emotion']).optional(),
    attachmentUrl: z.string().url().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
});

export const updateMessageSchema = z.object({
  body: z.object({
    text: z.string().trim().min(1),
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
    positionLabel: z.string().optional(),
    congratulatoryMessage: z.string().optional(),
  }),
});
