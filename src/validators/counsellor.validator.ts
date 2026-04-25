import { z } from 'zod';
import { objectIdZod } from '../utils/validators';
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

export const listMyApplicationsQuerySchema = z.object({
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  status: z.enum(['interested', 'under_review', 'chat_opened', 'offer_sent', 'rejected', 'accepted']).optional(),
  studentUserId: objectIdZod.optional(),
});

export const listMyOffersQuerySchema = z.object({
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  type: z.enum(['offer', 'scholarship']).optional(),
  status: z.enum(['sent', 'viewed', 'accepted', 'declined', 'postponed', 'expired', 'revoked']).optional(),
  studentUserId: objectIdZod.optional(),
});

export const listStudentUniversitiesQuerySchema = z.object({
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(50).optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  useProfileFilters: z.union([z.coerce.number().min(0).max(1), z.enum(['true', 'false'])]).optional(),
});

export const listJoinRequestsQuerySchema = z.object({
  status: z.enum(['pending', 'accepted', 'rejected']).optional(),
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(50).optional(),
});

export const listMyInvitationsQuerySchema = z.object({
  status: z.enum(['pending', 'accepted', 'declined']).optional(),
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(50).optional(),
});

export const searchStudentsForInviteQuerySchema = z.object({
  search: z.string().min(1).max(200),
  limit: z.coerce.number().min(1).max(20).optional(),
});

export const inviteStudentSchema = z.object({
  body: z.object({ userId: objectIdZod }),
});

const docTypeEnum = z.enum(['transcript', 'diploma', 'language_certificate', 'course_certificate', 'passport', 'id_card', 'other']);
const fileUrlSchema = z.string().min(1).refine(
  (val) => /^https?:\/\//.test(val) || (val.startsWith('/') && val.length > 1),
  { message: 'Invalid url' }
);
const pageFormatSchema = z.enum(['A4_PORTRAIT', 'A4_LANDSCAPE', 'LETTER', 'CUSTOM']);
export const addDocumentForStudentSchema = z.object({
  body: z.object({
    type: docTypeEnum,
    source: z.enum(['upload', 'editor']).optional(),
    name: z.string().max(200).optional(),
    certificateType: z.string().max(100).optional(),
    score: z.string().max(100).optional(),
    fileUrl: fileUrlSchema.optional(),
    previewImageUrl: fileUrlSchema.optional(),
    canvasJson: z.string().min(1).optional(),
    pageFormat: pageFormatSchema.optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    editorVersion: z.string().max(20).optional(),
  }).superRefine((body, ctx) => {
    const source = body.source ?? (body.canvasJson ? 'editor' : 'upload');
    if (source === 'upload' && !body.fileUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fileUrl'],
        message: 'fileUrl is required for uploaded documents',
      });
    }
    if (source === 'editor' && !body.canvasJson) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['canvasJson'],
        message: 'canvasJson is required for editor documents',
      });
    }
  }),
});

export const updateDocumentForStudentSchema = z.object({
  body: z.object({
    type: docTypeEnum.optional(),
    source: z.enum(['upload', 'editor']).optional(),
    name: z.string().max(200).optional(),
    certificateType: z.string().max(100).optional(),
    score: z.string().max(100).optional(),
    fileUrl: fileUrlSchema.optional(),
    previewImageUrl: fileUrlSchema.optional(),
    canvasJson: z.string().min(1).optional(),
    pageFormat: pageFormatSchema.optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    editorVersion: z.string().max(20).optional(),
  }).strict(),
});
