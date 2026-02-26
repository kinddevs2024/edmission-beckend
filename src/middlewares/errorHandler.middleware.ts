import { Request, Response, NextFunction } from 'express';
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

  logger.error(err, 'Unhandled error');

  const body: ApiErrorBody = {
    message: 'Internal server error',
    code: ErrorCodes.INTERNAL_ERROR,
    errors: undefined,
  };
  sendErrorResponse(res, 500, body);
}
