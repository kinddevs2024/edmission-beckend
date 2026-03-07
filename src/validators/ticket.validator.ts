import { z } from 'zod';
import { objectIdZod } from '../utils/validators';

export const createTicketSchema = z.object({
  body: z.object({
    subject: z.string().min(1).max(200),
    message: z.string().min(1).max(5000),
  }),
});

export const ticketIdParamSchema = z.object({
  id: objectIdZod,
});

export const addReplySchema = z.object({
  body: z.object({
    message: z.string().min(1).max(5000),
  }),
});
