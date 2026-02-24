import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError, ErrorCodes } from '../utils/errors';

type Source = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const data = req[source];
    try {
      const parsed = schema.parse(data);
      req[source] = parsed;
      next();
    } catch (e) {
      if (e instanceof ZodError) {
        const errors = e.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));
        next(
          new AppError(400, 'Validation failed', ErrorCodes.VALIDATION, errors)
        );
        return;
      }
      next(e);
    }
  };
}
