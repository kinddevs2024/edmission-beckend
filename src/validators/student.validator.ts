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

const languageLevelSchema = z.object({
  language: z.string(),
  level: z.string(),
});

const schoolAttendedSchema = z.object({
  country: z.string().optional(),
  institutionName: z.string().optional(),
  institutionType: z.enum(['school', 'university']).optional(),
  educationLevel: z.string().optional(),
  gradingScheme: z.string().optional(),
  gradeScale: z.number().optional(),
  gradeAverage: z.number().optional(),
  primaryLanguage: z.string().optional(),
  attendedFrom: z.string().optional(),
  attendedTo: z.string().optional(),
  degreeName: z.string().optional(),
});

export const updateProfileSchema = z.object({
  body: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    birthDate: z.string().optional(),
    country: z.string().optional(),
    city: z.string().optional(),
    gradeLevel: z.string().optional(),
    gpa: z.union([z.number().min(0).max(5), z.string()]).optional(),
    languageLevel: z.string().optional(),
    languages: z.array(languageLevelSchema).optional(),
    bio: z.string().optional(),
    avatarUrl: z.string().optional(),
    budgetAmount: z.union([z.number(), z.string()]).optional(),
    budgetCurrency: z.string().optional(),
    educationStatus: z.enum(['in_school', 'finished_school', 'in_university', 'finished_university']).optional(),
    schoolCompleted: z.boolean().optional(),
    schoolName: z.string().optional(),
    graduationYear: z.number().optional(),
    gradingScheme: z.string().optional(),
    gradeScale: z.number().optional(),
    highestEducationLevel: z.string().optional(),
    targetDegreeLevel: z.enum(['bachelor', 'master', 'phd']).optional(),
    schoolsAttended: z.array(schoolAttendedSchema).optional(),
    skills: z.array(z.string()).optional(),
    interests: z.array(z.string()).optional(),
    hobbies: z.array(z.string()).optional(),
    experiences: z.array(experienceSchema).optional(),
    portfolioWorks: z.array(portfolioWorkSchema).optional(),
    interestedFaculties: z.array(z.string()).optional(),
    preferredCountries: z.array(z.string()).optional(),
    profileVisibility: z.enum(['private', 'public']).optional(),
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

const pageFormatSchema = z.enum(['A4_PORTRAIT', 'A4_LANDSCAPE', 'LETTER', 'CUSTOM']);

export const documentSchema = z.object({
  body: z.object({
    type: z.string().min(1),
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

export const updateDocumentSchema = z.object({
  body: z.object({
    type: z.string().min(1).optional(),
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

export const compareQuerySchema = z.object({
  query: z.object({
    ids: z.string().optional(),
  }),
});
