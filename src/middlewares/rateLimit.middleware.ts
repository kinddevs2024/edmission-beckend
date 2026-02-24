import rateLimit from 'express-rate-limit';
import { config } from '../config';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Too many attempts', code: 'RATE_LIMIT_EXCEEDED' },
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
