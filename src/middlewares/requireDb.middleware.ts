import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AppError, ErrorCodes } from '../utils/errors';

/** Возвращает 503, если MongoDB не подключена. Избегает таймаута 10s на операциях. */
export function requireDb(_req: Request, _res: Response, next: NextFunction): void {
  if (mongoose.connection.readyState !== 1) {
    next(
      new AppError(
        503,
        'Database unavailable. Start MongoDB locally or set MONGODB_URI in .env',
        ErrorCodes.INTERNAL_ERROR
      )
    );
    return;
  }
  next();
}
