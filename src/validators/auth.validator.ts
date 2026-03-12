import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((p) => /[A-Z]/.test(p), 'Password must contain at least one uppercase letter')
  .refine((p) => /[a-z]/.test(p), 'Password must contain at least one lowercase letter')
  .refine((p) => /\d/.test(p), 'Password must contain at least one number');

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: passwordSchema,
    role: z.enum(['student', 'university']),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms' }) }),
    name: z.string().optional().transform((v) => (v === '' || v == null ? undefined : v)),
    avatarUrl: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  }),
});

export const verifyEmailCodeSchema = z.object({
  body: z.object({
    email: z.string().email(),
    code: z.string().length(6, 'Code must be 6 digits'),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string(),
  }),
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().optional(),
  }),
});

export const resendVerificationSchema = z.object({
  body: z.object({
    email: z.string().email(),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email(),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string(),
    newPassword: passwordSchema,
  }),
});

export const setPasswordSchema = z.object({
  body: z.object({
    newPassword: passwordSchema,
  }),
});

export type RegisterBody = z.infer<typeof registerSchema>['body'];
export type LoginBody = z.infer<typeof loginSchema>['body'];
export type ForgotPasswordBody = z.infer<typeof forgotPasswordSchema>['body'];
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>['body'];
