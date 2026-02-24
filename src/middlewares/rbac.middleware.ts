import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AppError, ErrorCodes } from '../utils/errors';

export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, 'Authorization required', ErrorCodes.UNAUTHORIZED));
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      next(new AppError(403, 'Insufficient permissions', ErrorCodes.FORBIDDEN));
      return;
    }
    next();
  };
}
