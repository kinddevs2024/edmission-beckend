import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service';
import * as twoFactorService from '../services/twoFactor.service';
import { config } from '../config';
import type { AppleAuthBody, GoogleAuthBody, YandexAuthBody, YandexAccessTokenAuthBody } from '../validators/auth.validator';
import {
  loginSchema,
  loginByPhoneSchema,
  phoneCodeStartSchema,
  phoneCodeVerifySchema,
  phoneRegisterStartSchema,
  phoneRegisterStatusSchema,
  phoneRegisterCompleteSchema,
  registerSchema,
  telegramAuthStartSchema,
  telegramAuthVerifySchema,
  telegramAuthVerifyLinkSchema,
  telegramAuthVerifyReadySchema,
  mobileWebAuthExchangeSchema,
  verifyEmailCodeSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  resetPasswordTelegramCodeSchema,
  setPasswordSchema,
  changePasswordSchema,
  linkEmailStartSchema,
  linkEmailVerifySchema,
} from '../validators/auth.validator';

type AuthResultWithRefreshToken = {
  refreshToken?: string;
};

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function setRefreshTokenCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
}

function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
    path: '/api/auth',
  });
}

function setRefreshCookieIfPresent(res: Response, result: AuthResultWithRefreshToken): void {
  if (typeof result.refreshToken === 'string' && result.refreshToken) {
    setRefreshTokenCookie(res, result.refreshToken);
  }
}

export async function register(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = registerSchema.shape.body.parse(req.body);
    const result = await authService.register(data);
    setRefreshCookieIfPresent(res, result);
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
    setRefreshCookieIfPresent(res, result);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function loginByPhone(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = loginByPhoneSchema.shape.body.parse(req.body);
    const result = await authService.loginByPhone(data);
    setRefreshCookieIfPresent(res, result);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function startMobileWebAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Authorization required' });
      return;
    }
    const result = await authService.createMobileWebAuthSession(userId);
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
}

export async function exchangeMobileWebAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = mobileWebAuthExchangeSchema.shape.body.parse(req.body);
    const result = await authService.exchangeMobileWebAuthSession(data);
    setRefreshCookieIfPresent(res, result);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function startPhoneCodeAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = phoneCodeStartSchema.shape.body.parse(req.body);
    const result = await authService.startPhoneCodeAuth({ ...data, language: req.locale });
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
}

export async function verifyPhoneCodeAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = phoneCodeVerifySchema.shape.body.parse(req.body);
    const result = await authService.verifyPhoneCodeAuth(data);
    setRefreshCookieIfPresent(res, result);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function startPhoneRegistration(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = phoneRegisterStartSchema.shape.body.parse(req.body);
    const result = await authService.startPhoneRegistration(data);
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
}

export async function phoneRegistrationStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { registrationId } = phoneRegisterStatusSchema.shape.params.parse(req.params);
    const result = await authService.getPhoneRegistrationStatus(registrationId);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function completePhoneRegistration(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = phoneRegisterCompleteSchema.shape.body.parse(req.body);
    const result = await authService.completePhoneRegistration(data);
    setRefreshCookieIfPresent(res, result);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function googleAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.loginWithGoogle(req.body as GoogleAuthBody);
    setRefreshCookieIfPresent(res, result);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function appleAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.loginWithApple(req.body as AppleAuthBody);
    setRefreshCookieIfPresent(res, result);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function yandexAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.loginWithYandex(req.body as YandexAuthBody);
    setRefreshCookieIfPresent(res, result);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function yandexAccessTokenAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.loginWithYandexAccessToken(req.body as YandexAccessTokenAuthBody);
    setRefreshCookieIfPresent(res, result);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function startTelegramAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = telegramAuthStartSchema.shape.body.parse(req.body);
    const result = await authService.startTelegramWebsiteAuthSession({ ...data, language: req.locale });
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
}

export async function verifyTelegramAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = telegramAuthVerifySchema.shape.body.parse(req.body);
    const result = await authService.verifyTelegramWebsiteAuthCode(data);
    setRefreshCookieIfPresent(res, result);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function verifyTelegramAuthLink(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = telegramAuthVerifyLinkSchema.shape.body.parse(req.body);
    const result = await authService.verifyTelegramWebsiteAuthLink(data);
    setRefreshCookieIfPresent(res, result);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function verifyTelegramAuthReady(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = telegramAuthVerifyReadySchema.shape.body.parse(req.body);
    const result = await authService.verifyTelegramWebsiteAuthReady(data);
    if ('ready' in result && result.ready === false) {
      res.status(202).json(result);
      return;
    }
    setRefreshCookieIfPresent(res, result);
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
    clearRefreshTokenCookie(res);
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
          smsApplicationUpdates: body.notificationPreferences.smsApplicationUpdates,
        }
      : undefined;
    const onboardingTutorialSeen = body.onboardingTutorialSeen && typeof body.onboardingTutorialSeen === 'object'
      ? {
          ...(body.onboardingTutorialSeen.student === true && { student: true }),
          ...(body.onboardingTutorialSeen.university === true && { university: true }),
        }
      : undefined;
    const phone = typeof body.phone === 'string' ? body.phone.trim() : undefined;
    const socialLinks = body.socialLinks && typeof body.socialLinks === 'object'
      ? {
          telegram: typeof body.socialLinks.telegram === 'string' ? body.socialLinks.telegram.trim() : undefined,
          instagram: typeof body.socialLinks.instagram === 'string' ? body.socialLinks.instagram.trim() : undefined,
          linkedin: typeof body.socialLinks.linkedin === 'string' ? body.socialLinks.linkedin.trim() : undefined,
          facebook: typeof body.socialLinks.facebook === 'string' ? body.socialLinks.facebook.trim() : undefined,
          whatsapp: typeof body.socialLinks.whatsapp === 'string' ? body.socialLinks.whatsapp.trim() : undefined,
        }
      : undefined;
    const patch: { name?: string; phone?: string; socialLinks?: { telegram?: string; instagram?: string; linkedin?: string; facebook?: string; whatsapp?: string }; notificationPreferences?: { emailApplicationUpdates?: boolean; emailTrialReminder?: boolean; smsApplicationUpdates?: boolean }; onboardingTutorialSeen?: { student?: boolean; university?: boolean } } = { name, phone, notificationPreferences };
    if (socialLinks !== undefined) patch.socialLinks = socialLinks;
    if (onboardingTutorialSeen !== undefined && Object.keys(onboardingTutorialSeen).length > 0) {
      patch.onboardingTutorialSeen = onboardingTutorialSeen;
    }
    const user = await authService.updateMe(req.user.id, patch);
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

export async function verifyEmailByCode(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email, code } = verifyEmailCodeSchema.shape.body.parse(req.body);
    const result = await authService.verifyEmailByCode(email, code);
    setRefreshCookieIfPresent(res, result);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function resendVerificationCode(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email } = resendVerificationSchema.shape.body.parse(req.body);
    const result = await authService.resendVerificationCode(email);
    res.json(result);
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
    const result = await authService.forgotPassword(email);
    res.json(result);
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

export async function resetPasswordWithTelegramCode(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = resetPasswordTelegramCodeSchema.shape.body.parse(req.body);
    await authService.resetPasswordWithTelegramCode(data);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
}

export async function setPassword(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const { newPassword } = setPasswordSchema.shape.body.parse(req.body);
    const result = await authService.setPassword(req.user.id, newPassword);
    setRefreshCookieIfPresent(res, result);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function changePassword(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const { currentPassword, newPassword } = changePasswordSchema.shape.body.parse(req.body);
    const result = await authService.changePassword(req.user.id, currentPassword, newPassword);
    setRefreshCookieIfPresent(res, result);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function startLinkEmail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const data = linkEmailStartSchema.shape.body.parse(req.body);
    const result = await authService.startLinkEmail(req.user.id, data.email);
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
}

export async function verifyLinkEmail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const data = linkEmailVerifySchema.shape.body.parse(req.body);
    const result = await authService.verifyLinkEmail(req.user.id, data.email, data.code);
    res.json(result);
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
