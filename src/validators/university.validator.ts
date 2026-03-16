import { z } from 'zod';
import { objectIdZod } from '../utils/validators';

export const updateInterestSchema = z.object({
  body: z.object({
    status: z.enum(['under_review', 'chat_opened', 'offer_sent', 'rejected', 'accepted']),
  }),
});

export const createScholarshipSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    coveragePercent: z.number().min(0).max(100),
    maxSlots: z.number().min(0),
    deadline: z.string().optional(),
    eligibility: z.string().max(2000).optional(),
  }),
});

export const createOfferSchema = z.object({
  body: z.object({
    studentId: objectIdZod,
    scholarshipId: objectIdZod.optional(),
    coveragePercent: z.number().min(0).max(100),
    deadline: z.string().optional(),
    certificateTemplateId: objectIdZod.optional(),
    certificateData: z.record(z.string(), z.string()).optional(),
  }),
});

export const createOfferTemplateSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    layoutKey: z.enum(['classic', 'modern', 'minimal']).optional(),
    primaryColor: z.string().max(50).optional(),
    accentColor: z.string().max(50).optional(),
    backgroundImageUrl: z.string().max(500).optional(),
    bodyTemplate: z.string().min(1).max(5000),
    titleTemplate: z.string().max(500).optional(),
    isDefault: z.boolean().optional(),
  }),
});

export const updateOfferTemplateSchema = z.object({
  body: z.object({
    name: z.string().max(200).optional(),
    layoutKey: z.enum(['classic', 'modern', 'minimal']).optional(),
    primaryColor: z.string().max(50).optional(),
    accentColor: z.string().max(50).optional(),
    backgroundImageUrl: z.string().max(500).optional(),
    bodyTemplate: z.string().max(5000).optional(),
    titleTemplate: z.string().max(500).optional(),
    isDefault: z.boolean().optional(),
  }).strict(),
});

export const verificationRequestSchema = z.object({
  body: z.object({
    universityId: objectIdZod.optional(),
    universityCatalogId: objectIdZod.optional(),
    universityName: z.string().max(200).optional(),
    establishedYear: z.number().optional(),
  }),
});

const programItemSchema = z.object({
  name: z.string().optional(),
  degreeLevel: z.string().optional(),
  field: z.string().optional(),
  durationYears: z.number().optional(),
  tuitionFee: z.number().optional(),
  language: z.string().optional(),
  entryRequirements: z.string().optional(),
});

export const updateProfileSchema = z.object({
  body: z.object({
    universityName: z.string().max(200).optional(),
    tagline: z.string().max(200).optional(),
    establishedYear: z.number().optional(),
    studentCount: z.number().optional(),
    country: z.string().max(100).optional(),
    city: z.string().max(100).optional(),
    description: z.string().max(5000).optional(),
    logoUrl: z.string().url().optional(),
    onboardingCompleted: z.boolean().optional(),
    facultyCodes: z.array(z.string()).max(50).optional(),
    facultyItems: z.record(z.array(z.string())).optional(),
    targetStudentCountries: z.array(z.string()).max(50).optional(),
    minLanguageLevel: z.string().max(50).optional(),
    tuitionPrice: z.number().min(0).optional(),
    programs: z.array(programItemSchema).max(50).optional(),
  }).strict(),
});

export const updateScholarshipSchema = z.object({
  body: z.object({
    name: z.string().max(200).optional(),
    coveragePercent: z.number().min(0).max(100).optional(),
    maxSlots: z.number().min(0).optional(),
    deadline: z.string().optional(),
    eligibility: z.string().max(2000).optional(),
  }).strict(),
});
