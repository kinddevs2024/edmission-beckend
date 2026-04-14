import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { slowDown } from 'express-slow-down';
import timeout from 'connect-timeout';
import { config } from '../config';
import { isRateLimitingDisabled } from './rateLimit.middleware';

/**
 * npm packages used for **inbound / perimeter** hardening (browser + raw HTTP clients).
 * Also wired in `app.ts`: helmet, cors, compression, body limits; see SECURITY.md.
 */
export const PERIMETER_SECURITY_NPM_PACKAGES = [
  'helmet',
  'cors',
  'compression',
  'express-rate-limit',
  'express-slow-down',
  'connect-timeout',
  'express-mongo-sanitize',
  'hpp',
  'cookie-parser',
  'bcrypt',
  'zod',
] as const;

function skipSoftThrottle(req: Request): boolean {
  if (isRateLimitingDisabled()) return true;
  const path = req.originalUrl.split('?')[0];
  if (path === '/api/health' || path === '/health') return true;
  if (path === '/api/payment/webhook') return true;
  return false;
}

/**
 * Soft throttle: after many requests per IP in the window, adds increasing delay (same family as express-rate-limit).
 * Runs before the hard global limiter so abusive clients slow down before hitting 429.
 */
export const apiSlowDown: RequestHandler = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: config.security.slowDownDelayAfter,
  delayMs: (used: number) =>
    Math.min(
      config.security.slowDownMaxDelayMs,
      Math.max(0, used - config.security.slowDownDelayAfter) * config.security.slowDownDelayStepMs
    ),
  maxDelayMs: config.security.slowDownMaxDelayMs,
  skip: (req) => skipSoftThrottle(req),
  validate: { delayMs: false },
});

function skipRequestTimeout(req: Request): boolean {
  const path = req.originalUrl.split('?')[0];
  if (path === '/health' || path === '/api/health') return true;
  if (path === '/api/payment/webhook') return true;
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('multipart/form-data')) return true;
  return false;
}

/**
 * Cuts off requests that never finish (slowloris-style abuse, hung handlers).
 * Skips health, Stripe webhook, and multipart uploads.
 */
export function apiRequestTimeoutMiddleware(): (
  req: Request,
  res: Response,
  next: NextFunction
) => void {
  const ms = config.security.apiRequestTimeoutMs;
  if (ms <= 0) {
    return (_req, _res, next) => next();
  }
  const handler = timeout(ms, { respond: true });
  return (req, res, next) => {
    if (skipRequestTimeout(req)) return next();
    return handler(req, res, next);
  };
}
