import { Request, Response, NextFunction } from 'express';
import type { Role } from '../types/role';
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

/** Allow only admin (used for write operations; school_counsellor is read-only). */
export function requireAdminOnly(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new AppError(401, 'Authorization required', ErrorCodes.UNAUTHORIZED));
    return;
  }
  if (req.user.role !== 'admin') {
    next(new AppError(403, 'Admin only', ErrorCodes.FORBIDDEN));
    return;
  }
  next();
}

/** Allow admin-like account managers to modify user accounts. */
export function requireUserManager(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new AppError(401, 'Authorization required', ErrorCodes.UNAUTHORIZED));
    return;
  }
  if (!['admin', 'manager', 'counsellor_coordinator'].includes(req.user.role)) {
    next(new AppError(403, 'Insufficient permissions', ErrorCodes.FORBIDDEN));
    return;
  }
  next();
}
