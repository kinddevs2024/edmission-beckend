import type { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { User } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';
import type { Role } from '../types/role';

const HEADER = 'x-act-as-university';

/**
 * Lets `university_multi_manager` call university APIs by sending `X-Act-As-University: <universityUserId>`.
 * Rewrites `req.user.id` / `req.user.role` to the target university for downstream handlers.
 * Real manager id is stored on `req.universityDelegation`.
 */
export async function resolveUniversityActAs(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next();
      return;
    }
    if (req.user.role === 'university') {
      next();
      return;
    }
    if (req.user.role !== 'university_multi_manager') {
      next();
      return;
    }

    const raw = req.get(HEADER) ?? (typeof req.headers[HEADER] === 'string' ? req.headers[HEADER] : '');
    const actAs = String(raw ?? '').trim();
    if (!mongoose.Types.ObjectId.isValid(actAs)) {
      next(new AppError(400, 'Valid X-Act-As-University header is required', ErrorCodes.VALIDATION));
      return;
    }

    const manager = await User.findById(req.user.id)
      .select('managedUniversityUserIds universityMultiManagerApproved role')
      .lean();
    if (!manager || (manager as { role?: string }).role !== 'university_multi_manager') {
      next(new AppError(403, 'Insufficient permissions', ErrorCodes.FORBIDDEN));
      return;
    }
    if (!(manager as { universityMultiManagerApproved?: boolean }).universityMultiManagerApproved) {
      next(new AppError(403, 'Multi-university manager is not approved by an administrator', ErrorCodes.FORBIDDEN));
      return;
    }

    const allowed = ((manager as { managedUniversityUserIds?: unknown[] }).managedUniversityUserIds ?? []).map((id) =>
      String(id)
    );
    if (!allowed.includes(actAs)) {
      next(new AppError(403, 'You are not assigned to this university account', ErrorCodes.FORBIDDEN));
      return;
    }

    const managerUserId = req.user.id;
    req.universityDelegation = { managerUserId };
    Object.assign(req.user, { id: actAs, role: 'university' as Role });
    next();
  } catch (e) {
    next(e);
  }
}
