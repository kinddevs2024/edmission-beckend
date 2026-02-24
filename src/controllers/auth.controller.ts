import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service';
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
