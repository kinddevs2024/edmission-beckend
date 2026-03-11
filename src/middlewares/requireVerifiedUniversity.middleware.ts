import { Request, Response, NextFunction } from 'express';
import { UniversityProfile } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';

/** Blocks unverified university from accessing protected university routes. Use after auth + requireRole('university'). */
export async function requireVerifiedUniversity(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    next(new AppError(401, 'Authorization required', ErrorCodes.UNAUTHORIZED));
    return;
  }
  const profile = await UniversityProfile.findOne({ userId: req.user.id }).lean();
  if (!profile) {
    next(new AppError(403, 'University profile not found.', ErrorCodes.FORBIDDEN));
    return;
  }
  if (!(profile as { verified?: boolean }).verified) {
    next(
      new AppError(
        403,
        'Your university account must be verified by an administrator to access this resource.',
        ErrorCodes.FORBIDDEN
      )
    );
    return;
  }
  next();
}
