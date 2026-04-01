import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { User } from '../models';
import { supportedApiLocales } from '../i18n/apiMessages';
import { AppError, ErrorCodes } from '../utils/errors';
import type { Role } from '../types/role';

function applyAuthToRequest(req: Request, payload: { sub: string; email: string; role: Role }) {
  const locale = req.locale && supportedApiLocales.includes(req.locale) ? req.locale : undefined;
  req.user = {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    language: locale,
  };
  if (locale) {
    User.updateOne(
      { _id: payload.sub, language: { $ne: locale } },
      { $set: { language: locale } }
    ).catch(() => {});
  }
}

function tokenIssuedBeforePasswordChange(iat: number | undefined, passwordChangedAt: Date | string | undefined): boolean {
  if (!iat || !passwordChangedAt) return false;
  const changedAtMs = new Date(passwordChangedAt).getTime();
  if (Number.isNaN(changedAtMs)) return false;
  return iat * 1000 < changedAtMs;
}

export function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    next(new AppError(401, 'Authorization required', ErrorCodes.UNAUTHORIZED));
    return;
  }

  (async () => {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub).select('email role language passwordChangedAt').lean();
    if (!user) {
      next(new AppError(401, 'Invalid or expired token', ErrorCodes.UNAUTHORIZED));
      return;
    }
    if (tokenIssuedBeforePasswordChange(payload.iat, (user as { passwordChangedAt?: Date | string }).passwordChangedAt)) {
      next(new AppError(401, 'Invalid or expired token', ErrorCodes.UNAUTHORIZED));
      return;
    }
    applyAuthToRequest(req, {
      sub: payload.sub,
      email: String((user as { email?: string }).email ?? payload.email ?? ''),
      role: (user as { role: Role }).role,
    });
    const dbLanguage = String((user as { language?: string }).language ?? '').trim();
    if (req.user && dbLanguage && supportedApiLocales.includes(dbLanguage as (typeof supportedApiLocales)[number])) {
      req.user.language = dbLanguage as (typeof supportedApiLocales)[number];
    }
    next();
  })().catch(() => {
    next(new AppError(401, 'Invalid or expired token', ErrorCodes.UNAUTHORIZED));
  });
}

export function optionalAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    next();
    return;
  }

  (async () => {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub).select('email role language passwordChangedAt').lean();
    if (!user) {
      next();
      return;
    }
    if (tokenIssuedBeforePasswordChange(payload.iat, (user as { passwordChangedAt?: Date | string }).passwordChangedAt)) {
      next();
      return;
    }
    applyAuthToRequest(req, {
      sub: payload.sub,
      email: String((user as { email?: string }).email ?? payload.email ?? ''),
      role: (user as { role: Role }).role,
    });
    const dbLanguage = String((user as { language?: string }).language ?? '').trim();
    if (req.user && dbLanguage && supportedApiLocales.includes(dbLanguage as (typeof supportedApiLocales)[number])) {
      req.user.language = dbLanguage as (typeof supportedApiLocales)[number];
    }
    next();
  })().catch(() => {
    // Public endpoints can continue as anonymous if token is absent or invalid.
    next();
  });
}
