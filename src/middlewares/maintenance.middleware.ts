import { Request, Response, NextFunction } from 'express';
import { getSettings } from '../services/settings.service';
import { verifyAccessToken } from '../utils/jwt';

/** When maintenance mode is on, only health, auth login/refresh and admin users are allowed. */
export async function maintenanceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const path = req.path;
  const method = req.method;

  if (path === '/health') {
    next();
    return;
  }
  if (path === '/auth/login' && method === 'POST') {
    next();
    return;
  }
  if (path === '/auth/refresh' && method === 'POST') {
    next();
    return;
  }
  if (path === '/options/status' && method === 'GET') {
    next();
    return;
  }

  const settings = await getSettings();
  if (!settings.maintenanceMode) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) {
    try {
      const payload = verifyAccessToken(token);
      if (payload.role === 'admin') {
        next();
        return;
      }
    } catch {
      /* invalid token -> treat as non-admin */
    }
  }

  res.status(503).json({
    message: 'Site is under maintenance. Please try again later.',
    code: 'MAINTENANCE',
  });
}
