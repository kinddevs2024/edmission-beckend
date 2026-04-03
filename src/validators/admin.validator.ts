import { z } from 'zod';
import { objectIdZod } from '../utils/validators';

/** Accepts full URLs (http/https) or relative paths (/api/uploads/...) from file uploads */
const absoluteOrRelativeUrlSchema = z.string().min(1).refine(
  (value) => {
    const normalized = value.trim();
    if (!normalized) return false;
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      try {
        new URL(normalized);
        return true;
      } catch {
        return false;
      }
    }
    return normalized.startsWith('/');
  },
  { message: 'Invalid url' }
);

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((p) => /[A-Z]/.test(p), 'Password must contain at least one uppercase letter')
  .refine((p) => /[a-z]/.test(p), 'Password must contain at least one lowercase letter')
  .refine((p) => /\d/.test(p), 'Password must contain at least one number');

export const createUserSchema = z.object({
  body: z.object({
    role: z.enum(['student', 'university', 'admin', 'school_counsellor']),
    email: z.string().email(),
    password: passwordSchema.optional(),
    name: z.string().max(200).optional(),
  }),
});

export const updateUserSchema = z.object({
  body: z.object({
    name: z.string().max(200).optional(),
    role: z.enum(['student', 'university', 'admin', 'school_counsellor']).optional(),
    emailVerified: z.boolean().optional(),
    suspended: z.boolean().optional(),
  }).strict(),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    password: passwordSchema,
  }),
});

export const suspendUserSchema = z.object({
  body: z.object({
    suspend: z.boolean().optional(),
  }),
});

export const verifyUniversitySchema = z.object({
  body: z.object({
    approve: z.boolean(),
  }),
});

export const updateOfferStatusSchema = z.object({
  body: z.object({
    status: z.enum(['pending', 'accepted', 'declined']),
  }),
});

export const updateInterestStatusSchema = z.object({
  body: z.object({
    status: z.string().min(1),
  }),
});

export const updateTicketStatusSchema = z.object({
  body: z.object({
    status: z.string().min(1),
  }),
});

export const addTicketReplySchema = z.object({
  body: z.object({
    message: z.string().min(1).max(5000),
  }),
});

export const reviewDocumentSchema = z.object({
  body: z.object({
    decision: z.enum(['approved', 'rejected']),
    rejectionReason: z.string().max(1000).optional(),
  }),
});

/** Parsed against req.query (flat), not { query: {...} } */
export const adminStudentDocumentsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
});

export const updateSubscriptionSchema = z.object({
  body: z.object({
    plan: z.string().optional(),
    status: z.string().optional(),
    trialEndsAt: z.string().optional(),
    currentPeriodEnd: z.string().optional(),
  }),
});

export const createInvestorSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    logoUrl: z.string().url().optional(),
    websiteUrl: z.string().url().optional(),
    description: z.string().max(1000).optional(),
    order: z.number().optional(),
  }),
});

const globalFacultyBodySchema = z.object({
  name: z.string().min(1).max(200),
  items: z.array(z.string().max(200)).max(100).optional(),
  order: z.number().optional(),
}).strict();

const updateGlobalFacultyBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  items: z.array(z.string().max(200)).max(100).optional(),
  order: z.number().optional(),
}).strict();

export const createGlobalFacultySchema = z.object({
  body: globalFacultyBodySchema,
});

export const updateGlobalFacultySchema = z.object({
  body: updateGlobalFacultyBodySchema,
});

export const idParamSchema = z.object({ id: objectIdZod });
export const userIdParamSchema = z.object({ userId: objectIdZod });

const programSchema = z.object({
  name: z.string(),
  degreeLevel: z.string().optional(),
  field: z.string().optional(),
  durationYears: z.number().optional(),
  tuitionFee: z.number().optional(),
  language: z.string().optional(),
  entryRequirements: z.string().optional(),
});

const scholarshipCatalogSchema = z.object({
  name: z.string(),
  coveragePercent: z.number().min(0).max(100),
  maxSlots: z.number().min(0),
  deadline: z.string().optional(),
  eligibility: z.string().optional(),
});

const customFacultyCatalogSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  items: z.array(z.string()).max(100).optional(),
  order: z.number().optional(),
});

const universityDocumentCatalogSchema = z.object({
  documentType: z.string(),
  fileUrl: absoluteOrRelativeUrlSchema,
  status: z.string().optional(),
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().optional(),
});

export const createCatalogUniversitySchema = z.object({
  body: z.object({
    universityName: z.string().min(1).max(200),
    tagline: z.string().max(200).optional(),
    establishedYear: z.number().optional(),
    studentCount: z.number().optional(),
    country: z.string().max(100).optional(),
    city: z.string().max(100).optional(),
    description: z.string().max(5000).optional(),
    logoUrl: absoluteOrRelativeUrlSchema.optional(),
    facultyCodes: z.array(z.string()).max(50).optional(),
    facultyItems: z.record(z.array(z.string())).optional(),
    targetStudentCountries: z.array(z.string()).max(50).optional(),
    programs: z.array(programSchema).max(50).optional(),
    scholarships: z.array(scholarshipCatalogSchema).max(30).optional(),
    customFaculties: z.array(customFacultyCatalogSchema).max(100).optional(),
    documents: z.array(universityDocumentCatalogSchema).max(100).optional(),
    minLanguageLevel: z.string().max(50).optional(),
    tuitionPrice: z.number().min(0).optional(),
  }).strict(),
});

export const updateCatalogUniversitySchema = z.object({
  body: z.object({
    universityName: z.string().min(1).max(200).optional(),
    tagline: z.string().max(200).optional(),
    establishedYear: z.number().optional(),
    studentCount: z.number().optional(),
    country: z.string().max(100).optional(),
    city: z.string().max(100).optional(),
    description: z.string().max(5000).optional(),
    logoUrl: absoluteOrRelativeUrlSchema.optional(),
    facultyCodes: z.array(z.string()).max(50).optional(),
    facultyItems: z.record(z.array(z.string())).optional(),
    targetStudentCountries: z.array(z.string()).max(50).optional(),
    programs: z.array(programSchema).max(50).optional(),
    scholarships: z.array(scholarshipCatalogSchema).max(30).optional(),
    customFaculties: z.array(customFacultyCatalogSchema).max(100).optional(),
    documents: z.array(universityDocumentCatalogSchema).max(100).optional(),
    minLanguageLevel: z.string().max(50).optional(),
    tuitionPrice: z.number().min(0).optional(),
  }).strict(),
});

export const usersQuerySchema = z.object({
  page: z.coerce.number().min(1).max(500).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  role: z.string().optional(),
});

export const catalogUniversitiesQuerySchema = z.object({
  page: z.coerce.number().min(1).max(500).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  search: z.string().max(100).optional(),
});

export const offersQuerySchema = z.object({
  page: z.coerce.number().min(1).max(500).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  status: z.string().max(50).optional(),
});

export const interestsQuerySchema = z.object({
  page: z.coerce.number().min(1).max(500).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  status: z.string().max(50).optional(),
});

export const chatsQuerySchema = z.object({
  page: z.coerce.number().min(1).max(500).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  universityId: z.string().max(50).optional(),
});

export const chatMessagesQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(200).optional(),
});

export const sendChatMessageSchema = z.object({
  body: z.object({
    text: z.string().min(1, 'Text is required'),
  }),
});

export const ticketsQuerySchema = z.object({
  page: z.coerce.number().min(1).max(500).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  status: z.string().max(50).optional(),
  role: z.string().max(50).optional(),
});

export const logsQuerySchema = z.object({
  page: z.coerce.number().min(1).max(500).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  type: z.string().max(50).optional(), // maps to action in ActivityLog
  userId: z.string().max(100).optional(),
});

export const analyticsOverviewQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const subscriptionsQuerySchema = z.object({
  page: z.coerce.number().min(1).max(500).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  role: z.string().max(50).optional(),
  plan: z.string().max(50).optional(),
  status: z.string().max(50).optional(),
});

export const updateSettingsSchema = z.object({
  body: z.object({
    requireAccountConfirmation: z.boolean().optional(),
    requireEmailVerification: z.boolean().optional(),
    maintenanceMode: z.boolean().optional(),
  }).strict(),
});

const imageUrlSchema = z.string().min(1).refine(
  (value) => {
    const normalized = value.trim();
    if (!normalized) return false;
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      try {
        new URL(normalized);
        return true;
      } catch {
        return false;
      }
    }
    return normalized.startsWith('/');
  },
  { message: 'Invalid url' }
);

export const createLandingCertificateSchema = z.object({
  body: z.object({
    type: z.enum(['university', 'student']),
    title: z.string().min(1).max(200),
    imageUrl: imageUrlSchema,
    order: z.number().optional(),
  }).strict(),
});

export const updateLandingCertificateSchema = z.object({
  body: z.object({
    type: z.enum(['university', 'student']).optional(),
    title: z.string().min(1).max(200).optional(),
    imageUrl: imageUrlSchema.optional(),
    order: z.number().optional(),
  }).strict(),
});
