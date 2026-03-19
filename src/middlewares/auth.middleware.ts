import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { User } from '../models';
import { supportedApiLocales } from '../i18n/apiMessages';
import { AppError, ErrorCodes } from '../utils/errors';

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

  try {
    const payload = verifyAccessToken(token);
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
    next();
  } catch {
    next(new AppError(401, 'Invalid or expired token', ErrorCodes.UNAUTHORIZED));
  }
}
