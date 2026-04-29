import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, ErrorCodes } from '../utils/errors';
import { logger } from '../utils/logger';
import type { ApiErrorBody } from '../types/api.types';

function sendErrorResponse(res: Response, statusCode: number, body: ApiErrorBody): void {
  if (res.headersSent) return;
  try {
    res.status(statusCode).setHeader('Content-Type', 'application/json').json(body);
  } catch (e) {
    logger.error(e, 'Failed to send error response');
    if (!res.headersSent) {
      res.status(statusCode).setHeader('Content-Type', 'application/json').end(JSON.stringify(body));
    }
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (res.headersSent) {
    logger.error(err, 'Error after response already sent');
    return;
  }

  if (err instanceof AppError) {
    const body: ApiErrorBody = {
      message: err.message,
      code: err.code,
      errors: err.errors,
    };
    sendErrorResponse(res, err.statusCode, body);
    return;
  }

  const maybeHttp = err as Error & {
    status?: number;
    statusCode?: number;
    code?: string;
    type?: string;
    message?: string;
  };
  if (
    maybeHttp.status === 413 ||
    maybeHttp.statusCode === 413 ||
    maybeHttp.code === 'LIMIT_FILE_SIZE' ||
    maybeHttp.type === 'entity.too.large'
  ) {
    sendErrorResponse(res, 413, {
      message:
        maybeHttp.code === 'LIMIT_FILE_SIZE'
          ? 'Uploaded file is too large. Maximum upload size is 50 MB.'
          : 'Request body is too large. Try a smaller file or contact support.',
      code: ErrorCodes.VALIDATION,
    });
    return;
  }

  if (maybeHttp.code === 'ETIMEDOUT' || (maybeHttp.statusCode === 503 && /timeout/i.test(maybeHttp.message || ''))) {
    sendErrorResponse(res, 504, {
      message: 'Request timeout',
      code: ErrorCodes.REQUEST_TIMEOUT,
    });
    return;
  }

  if (err instanceof ZodError) {
    const errors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    sendErrorResponse(res, 400, {
      message: 'Validation failed',
      code: ErrorCodes.VALIDATION,
      errors,
    });
    return;
  }

  logger.error(err, 'Unhandled error');

  const message =
    process.env.NODE_ENV === 'development' && err instanceof Error
      ? err.message
      : 'Internal server error';
  const body: ApiErrorBody = {
    message,
    code: ErrorCodes.INTERNAL_ERROR,
    errors: undefined,
  };
  sendErrorResponse(res, 500, body);
}
