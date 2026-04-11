import mongoSanitize from 'express-mongo-sanitize';
import { logger } from '../utils/logger';

/**
 * Strips/replaces MongoDB operator keys ($gt, $where, etc.) in body, query, and params
 * to reduce NoSQL injection risk (defense in depth alongside Zod + Mongoose).
 */
export const mongoInjectionSanitizer = mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ key, req }) => {
    logger.debug(
      { key, path: req.path, method: req.method },
      'Sanitized Mongo operator-like key in request'
    );
  },
});
