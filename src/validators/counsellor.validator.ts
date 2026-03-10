import { z } from 'zod';

export const counsellorProfileSchema = z.object({
  body: z.object({
    schoolName: z.string().max(200).optional(),
    schoolDescription: z.string().max(2000).optional(),
    country: z.string().max(100).optional(),
    city: z.string().max(100).optional(),
    isPublic: z.boolean().optional(),
  }),
});

export const createStudentByCounsellorSchema = z.object({
  body: z.object({
    email: z.string().email(),
    name: z.string().max(200).optional(),
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
  }),
});

export const updateMyStudentSchema = z.object({
  body: z.object({
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    birthDate: z.string().optional(),
    country: z.string().max(100).optional(),
    city: z.string().max(100).optional(),
    gradeLevel: z.string().max(50).optional(),
    gpa: z.number().min(0).max(10).optional(),
    bio: z.string().max(5000).optional(),
    schoolName: z.string().max(200).optional(),
    graduationYear: z.number().int().min(1900).max(2100).optional(),
    avatarUrl: z.string().max(500).optional(),
  }),
});

export const listSchoolsQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(50).optional(),
});

export const listMyStudentsQuerySchema = z.object({
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  search: z.string().optional(),
});

export const listJoinRequestsQuerySchema = z.object({
  status: z.enum(['pending', 'accepted', 'rejected']).optional(),
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(50).optional(),
});
