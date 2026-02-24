import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCodes } from '../utils/errors';
import { logger } from '../utils/logger';
import type { ApiErrorBody } from '../types/api.types';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    const body: ApiErrorBody = {
      message: err.message,
      code: err.code,
      errors: err.errors,
    };
    res.status(err.statusCode).json(body);
    return;
  }

  logger.error(err, 'Unhandled error');

  res.status(500).json({
    message: 'Internal server error',
    code: 'INTERNAL_ERROR',
  } as ApiErrorBody);
}
