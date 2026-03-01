import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service';
import * as twoFactorService from '../services/twoFactor.service';
import { loginSchema, registerSchema, refreshSchema, forgotPasswordSchema, resetPasswordSchema } from '../validators/auth.validator';

export async function register(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = registerSchema.shape.body.parse(req.body);
    const result = await authService.register(data);
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
}

export async function login(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = loginSchema.shape.body.parse(req.body);
    const result = await authService.login(data);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function refresh(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const refreshToken =
      req.body?.refreshToken ||
      req.cookies?.refreshToken;
    if (!refreshToken) {
      res.status(400).json({ message: 'Refresh token required' });
      return;
    }
    const result = await authService.refresh(refreshToken);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function logout(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const refreshToken = req.body?.refreshToken || req.cookies?.refreshToken;
    if (req.user) {
      await authService.logout(req.user.id, refreshToken);
    }
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

export async function me(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const user = await authService.getMe(req.user.id);
    res.json(user);
  } catch (e) {
    next(e);
  }
}

export async function patchMe(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const notificationPreferences = body.notificationPreferences && typeof body.notificationPreferences === 'object'
      ? {
          emailApplicationUpdates: body.notificationPreferences.emailApplicationUpdates,
          emailTrialReminder: body.notificationPreferences.emailTrialReminder,
        }
      : undefined;
    const user = await authService.updateMe(req.user.id, { name, notificationPreferences });
    res.json(user);
  } catch (e) {
    next(e);
  }
}

export async function verifyEmail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.query.token as string;
    if (!token) {
      res.status(400).json({ message: 'Token required' });
      return;
    }
    await authService.verifyEmail(token);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
}

export async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email } = forgotPasswordSchema.shape.body.parse(req.body);
    await authService.forgotPassword(email);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
}

export async function resetPassword(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { token, newPassword } = resetPasswordSchema.shape.body.parse(req.body);
    await authService.resetPassword(token, newPassword);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
}

export async function setup2FA(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const result = await twoFactorService.setup2FA(req.user.id);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function verify2FA(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const code = req.body?.code;
    if (!code || typeof code !== 'string') {
      res.status(400).json({ message: 'Code required' });
      return;
    }
    const ok = await twoFactorService.verifyAndEnable2FA(req.user.id, code);
    if (!ok) {
      res.status(400).json({ message: 'Invalid code' });
      return;
    }
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
}

export async function disable2FA(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const code = req.body?.code;
    if (!code || typeof code !== 'string') {
      res.status(400).json({ message: 'Code required' });
      return;
    }
    const ok = await twoFactorService.disable2FA(req.user.id, code);
    if (!ok) {
      res.status(400).json({ message: 'Invalid code' });
      return;
    }
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
}
