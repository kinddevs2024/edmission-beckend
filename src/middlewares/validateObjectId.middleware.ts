import { Request, Response, NextFunction } from 'express';
import { isValidObjectId } from '../utils/validators';
import { AppError, ErrorCodes } from '../utils/errors';

/** Validate that req.params[idParam] is a valid MongoDB ObjectId */
export function validateObjectId(idParam = 'id') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const id = req.params[idParam];
    if (!id || !isValidObjectId(id)) {
      next(new AppError(400, `Invalid ${idParam}`, ErrorCodes.VALIDATION));
      return;
    }
    next();
  };
}
