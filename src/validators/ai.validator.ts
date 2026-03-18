import { z } from 'zod';

export const chatSchema = z.object({
  body: z.object({
    message: z.string().min(1).max(10000),
    history: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string(),
        })
      )
      .max(50)
      .optional(),
    selectedText: z.string().max(2000).optional(),
    sessionId: z.string().min(1).max(120).optional(),
  }),
});
