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
    role: z.enum(['student', 'university', 'school_counsellor']),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms' }) }),
    name: z.string().optional().transform((v) => (v === '' || v == null ? undefined : v)),
    avatarUrl: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  }),
});

export const verifyEmailCodeSchema = z.object({
  body: z.object({
    email: z.string().email(),
    code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string(),
  }),
});

export const phoneSchema = z
  .string()
  .min(7, 'Phone is too short')
  .max(20, 'Phone is too long')
  .regex(/^\+?[0-9()\-\s]+$/, 'Invalid phone format');

export const phoneRegisterStartSchema = z.object({
  body: z.object({
    phone: phoneSchema,
    password: passwordSchema,
    role: z.enum(['student', 'university']),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms' }) }),
    firstName: z.string().optional().transform((v) => (v === '' || v == null ? undefined : v)),
    lastName: z.string().optional().transform((v) => (v === '' || v == null ? undefined : v)),
    avatarUrl: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  }),
});

export const phoneRegisterStatusSchema = z.object({
  params: z.object({
    registrationId: z.string().length(24, 'Invalid registration id'),
  }),
});

export const phoneRegisterCompleteSchema = z.object({
  body: z.object({
    registrationId: z.string().length(24, 'Invalid registration id'),
  }),
});

export const loginByPhoneSchema = z.object({
  body: z.object({
    phone: phoneSchema,
    password: z.string(),
  }),
});

/** Sign in / sign up with Google Identity Services (JWT credential). */
export const googleAuthSchema = z.object({
  body: z.object({
    idToken: z.string().min(20, 'Invalid credential'),
    /** Required only when creating a new account (registration). Omit on login — role comes from DB. */
    role: z.enum(['student', 'university']).optional(),
    /** Required when creating a new account (registration). Optional when linking to an existing user. */
    acceptTerms: z.boolean().optional(),
  }),
});

/** Sign in / sign up with Yandex OAuth 2.0 (authorization code from redirect flow). */
export const yandexAuthSchema = z.object({
  body: z.object({
    code: z.string().min(4, 'Invalid authorization code'),
    redirectUri: z.string().url('Invalid redirect URI'),
    role: z.enum(['student', 'university']).optional(),
    acceptTerms: z.boolean().optional(),
  }),
});

/** Yandex Passport SDK (YaAuthSuggest) — implicit token, then server calls login.yandex.ru/info. */
export const yandexAccessTokenAuthSchema = z.object({
  body: z.object({
    accessToken: z.string().min(10, 'Invalid access token'),
    role: z.enum(['student', 'university']).optional(),
    acceptTerms: z.boolean().optional(),
  }),
});

export const telegramAuthVerifySchema = z.object({
  body: z.object({
    sessionId: z.string().regex(/^[a-f0-9]{32}$/i, 'Invalid session id'),
    code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
  }),
});

export const telegramAuthStartSchema = z.object({
  body: z.object({
    role: z.enum(['student', 'university']).optional(),
  }),
});

export const telegramAuthVerifyLinkSchema = z.object({
  body: z.object({
    sessionId: z.string().regex(/^[a-f0-9]{32}$/i, 'Invalid session id'),
    token: z.string().regex(/^[a-f0-9]{48}$/i, 'Invalid link token'),
  }),
});

export const telegramAuthVerifyReadySchema = z.object({
  body: z.object({
    sessionId: z.string().regex(/^[a-f0-9]{32}$/i, 'Invalid session id'),
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

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
  }),
});

export type RegisterBody = z.infer<typeof registerSchema>['body'];
export type LoginBody = z.infer<typeof loginSchema>['body'];
export type LoginByPhoneBody = z.infer<typeof loginByPhoneSchema>['body'];
export type PhoneRegisterStartBody = z.infer<typeof phoneRegisterStartSchema>['body'];
export type GoogleAuthBody = z.infer<typeof googleAuthSchema>['body'];
export type YandexAuthBody = z.infer<typeof yandexAuthSchema>['body'];
export type YandexAccessTokenAuthBody = z.infer<typeof yandexAccessTokenAuthSchema>['body'];
export type TelegramAuthStartBody = z.infer<typeof telegramAuthStartSchema>['body'];
export type TelegramAuthVerifyBody = z.infer<typeof telegramAuthVerifySchema>['body'];
export type TelegramAuthVerifyLinkBody = z.infer<typeof telegramAuthVerifyLinkSchema>['body'];
export type TelegramAuthVerifyReadyBody = z.infer<typeof telegramAuthVerifyReadySchema>['body'];
export type ForgotPasswordBody = z.infer<typeof forgotPasswordSchema>['body'];
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>['body'];
