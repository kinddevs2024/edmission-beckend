import { Request, Response, NextFunction } from 'express';
import { getSettings } from '../services/settings.service';
import { verifyAccessToken } from '../utils/jwt';

/** Auth paths that stay available during maintenance (signup + verification). */
const MAINTENANCE_AUTH_ALLOW: Array<{ path: string; methods?: string[] }> = [
  { path: '/auth/login', methods: ['POST'] },
  { path: '/auth/refresh', methods: ['POST'] },
  { path: '/auth/register', methods: ['POST'] },
  { path: '/auth/verify-email', methods: ['GET', 'POST'] },
  { path: '/auth/verify-email/resend', methods: ['POST'] },
  { path: '/auth/google', methods: ['POST'] },
  { path: '/auth/apple', methods: ['POST'] },
  { path: '/auth/yandex', methods: ['POST'] },
  { path: '/auth/yandex/access-token', methods: ['POST'] },
  { path: '/auth/register-phone/start', methods: ['POST'] },
  { path: '/auth/register-phone/complete', methods: ['POST'] },
  { path: '/auth/forgot-password', methods: ['POST'] },
  { path: '/auth/reset-password', methods: ['POST'] },
];

function isMaintenanceAuthAllowed(path: string, method: string): boolean {
  return MAINTENANCE_AUTH_ALLOW.some(
    (entry) => entry.path === path && (!entry.methods || entry.methods.includes(method))
  );
}

/** When maintenance mode is on, only health, auth login/refresh/register and admin users are allowed. */
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
  if (isMaintenanceAuthAllowed(path, method)) {
    next();
    return;
  }
  if (path === '/options/status' && method === 'GET') {
    next();
    return;
  }
  if (path === '/options/profile-criteria' && method === 'GET') {
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
      if (payload.role === 'admin' || payload.role === 'manager' || payload.role === 'counsellor_coordinator') {
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
