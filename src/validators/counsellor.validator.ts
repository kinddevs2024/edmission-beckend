import { z } from 'zod';
import { updateProfileSchema } from './student.validator';

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

/** Counsellor can update all student profile fields (same as student). */
export const updateMyStudentSchema = z.object({ body: updateProfileSchema.shape.body });

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
