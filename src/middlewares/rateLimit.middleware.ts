import rateLimit from 'express-rate-limit';
import { config } from '../config';

/**
 * In development/test, auth/global rate limits are off so login/register UX is never blocked.
 * In production, limits are high enough for normal use; set DISABLE_RATE_LIMIT=true to turn off (e.g. load tests).
 */
export function isRateLimitingDisabled(): boolean {
  if (config.nodeEnv !== 'production') return true;
  const v = process.env.DISABLE_RATE_LIMIT?.toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

const skipWhenDisabled = (): boolean => isRateLimitingDisabled();

export const globalApiRateLimiter = rateLimit({
  skip: skipWhenDisabled,
  windowMs: 60 * 1000,
  max: 800,
  message: { message: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRateLimiter = rateLimit({
  skip: skipWhenDisabled,
  windowMs: 15 * 60 * 1000,
  max: 2500,
  message: { message: 'Too many attempts', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Public avatar upload (registration) */
export const uploadAvatarRateLimiter = rateLimit({
  skip: skipWhenDisabled,
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: { message: 'Too many uploads', code: 'RATE_LIMIT_EXCEEDED' },
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
