import { z } from 'zod';

export const updateProfileSchema = z.object({
  body: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    birthDate: z.string().datetime().optional().or(z.date().optional()),
    country: z.string().optional(),
    gradeLevel: z.string().optional(),
    gpa: z.number().min(0).max(5).optional(),
    languageLevel: z.string().optional(),
    bio: z.string().optional(),
    avatarUrl: z.string().url().optional(),
  }).strict(),
});

export const interestSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export const offerActionSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export const compareQuerySchema = z.object({
  query: z.object({
    ids: z.string().optional(),
  }),
});
