import { z } from 'zod';
import { objectIdZod } from '../utils/validators';

export const paginationQuery = z.object({
  page: z.coerce.number().min(1).max(500).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
});

export const idParam = z.object({
  id: objectIdZod,
});

export const userIdParam = z.object({
  userId: objectIdZod,
});

export const chatIdParam = z.object({
  chatId: objectIdZod,
});
