import rateLimit from 'express-rate-limit';
import { config } from '../config';

/**
 * Production: limits on by default (mitigates brute-force, scraping, accidental DDoS).
 * Development: off unless ENABLE_RATE_LIMIT_IN_DEV=true.
 * DISABLE_RATE_LIMIT=true turns limits off in production (load tests only).
 */
export function isRateLimitingDisabled(): boolean {
  const v = process.env.DISABLE_RATE_LIMIT?.toLowerCase().trim();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  if (config.nodeEnv === 'production') return false;
  const devOn = process.env.ENABLE_RATE_LIMIT_IN_DEV?.toLowerCase().trim();
  return !(devOn === '1' || devOn === 'true' || devOn === 'yes');
}

const skipWhenDisabled = (): boolean => isRateLimitingDisabled();

export const globalApiRateLimiter = rateLimit({
  skip: skipWhenDisabled,
  windowMs: 60 * 1000,
  max: config.security.rateLimitGlobalMaxPerMinute,
  message: { message: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRateLimiter = rateLimit({
  skip: skipWhenDisabled,
  windowMs: 15 * 60 * 1000,
  max: config.security.rateLimitAuthMaxPer15Min,
  message: { message: 'Too many attempts', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Authenticated global search (expensive DB regex queries). */
export const searchRateLimiter = rateLimit({
  skip: skipWhenDisabled,
  windowMs: 60 * 1000,
  max: config.security.rateLimitSearchPerMinute,
  message: { message: 'Search rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `search:${req.user.id}` : `search:${req.ip || 'anonymous'}`),
});

/** Public avatar upload (registration) */
export const uploadAvatarRateLimiter = rateLimit({
  skip: skipWhenDisabled,
  windowMs: 15 * 60 * 1000,
  max: config.security.rateLimitUploadMaxPer15Min,
  message: { message: 'Too many uploads', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Authenticated general upload (documents, logos, etc.) — per user. */
export const uploadAuthenticatedRateLimiter = rateLimit({
  skip: skipWhenDisabled,
  windowMs: 15 * 60 * 1000,
  max: config.security.rateLimitUploadAuthMaxPer15Min,
  message: { message: 'Too many uploads', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `upload:${req.user.id}` : `upload:${req.ip || 'anonymous'}`),
});

/** Public POST /public/analytics/visit — writable endpoint, abuse = DB noise. */
export const publicVisitRateLimiter = rateLimit({
  skip: skipWhenDisabled,
  windowMs: 60 * 1000,
  max: config.security.rateLimitPublicVisitPerMinute,
  message: { message: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const aiChatRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.ollama.chatRateLimitPerMinute,
  message: { message: 'AI rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? req.user.id : req.ip || 'anonymous'),
});
