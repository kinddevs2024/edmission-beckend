import { z } from 'zod';
import { objectIdZod } from '../utils/validators';

const experienceSchema = z.object({
  type: z.enum(['volunteer', 'internship', 'work']),
  title: z.string().optional(),
  organization: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  description: z.string().optional(),
});

const portfolioWorkSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  fileUrl: z.string().optional(),
  linkUrl: z.string().optional(),
});

export const updateProfileSchema = z.object({
  body: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    birthDate: z.string().optional(),
    country: z.string().optional(),
    gradeLevel: z.string().optional(),
    gpa: z.number().min(0).max(5).optional(),
    languageLevel: z.string().optional(),
    bio: z.string().optional(),
    avatarUrl: z.string().optional(),
    schoolCompleted: z.boolean().optional(),
    schoolName: z.string().optional(),
    graduationYear: z.number().optional(),
    skills: z.array(z.string()).optional(),
    interests: z.array(z.string()).optional(),
    hobbies: z.array(z.string()).optional(),
    experiences: z.array(experienceSchema).optional(),
    portfolioWorks: z.array(portfolioWorkSchema).optional(),
  }).strict(),
});

export const interestSchema = z.object({
  params: z.object({ id: objectIdZod }),
});

export const offerActionSchema = z.object({
  params: z.object({ id: objectIdZod }),
});

/** Accepts full URLs (http/https) or absolute paths (/api/uploads/...). */
const fileUrlSchema = z.string().min(1).refine(
  (val) => /^https?:\/\//.test(val) || (val.startsWith('/') && val.length > 1),
  { message: 'Invalid url' }
);

export const documentSchema = z.object({
  body: z.object({
    type: z.string().min(1),
    fileUrl: fileUrlSchema,
  }),
});

export const compareQuerySchema = z.object({
  query: z.object({
    ids: z.string().optional(),
  }),
});
