import rateLimit from 'express-rate-limit';
import { config } from '../config';

export const globalApiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.nodeEnv === 'production' ? 120 : 500,
  message: { message: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.nodeEnv === 'production' ? 80 : 200,
  message: { message: 'Too many attempts', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Public avatar upload (registration) - strict limit per IP */
export const uploadAvatarRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
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
