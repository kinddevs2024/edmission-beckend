import type { NextFunction, Request, Response } from 'express';
import { localizeApiBody, resolveApiLocale } from '../i18n/apiMessages';

export function apiLocaleMiddleware(req: Request, res: Response, next: NextFunction): void {
  const headerLocale = req.headers['x-user-language'] ?? req.headers['accept-language'];
  req.locale = resolveApiLocale(Array.isArray(headerLocale) ? headerLocale[0] : headerLocale);

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => originalJson(localizeApiBody(body, req.locale!))) as Response['json'];

  next();
}
