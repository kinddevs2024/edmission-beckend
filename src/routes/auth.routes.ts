import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { authRateLimiter } from '../middlewares/rateLimit.middleware';
import { requireDb } from '../middlewares/requireDb.middleware';
import {
  registerSchema,
  loginSchema,
  loginByPhoneSchema,
  phoneRegisterStartSchema,
  telegramAuthStartSchema,
  telegramAuthVerifySchema,
  telegramAuthVerifyLinkSchema,
  telegramAuthVerifyReadySchema,
  googleAuthSchema,
  yandexAuthSchema,
  yandexAccessTokenAuthSchema,
  verifyEmailCodeSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  setPasswordSchema,
  changePasswordSchema,
} from '../validators/auth.validator';

const router = Router();

router.use(authRateLimiter);
router.use(requireDb);

router.post(
  '/register',
  validate(registerSchema.shape.body, 'body'),
  authController.register
);
router.post(
  '/login',
  validate(loginSchema.shape.body, 'body'),
  authController.login
);
router.post(
  '/login-phone',
  validate(loginByPhoneSchema.shape.body, 'body'),
  authController.loginByPhone
);
router.post(
  '/register-phone/start',
  validate(phoneRegisterStartSchema.shape.body, 'body'),
  authController.startPhoneRegistration
);
router.get(
  '/register-phone/:registrationId/status',
  authController.phoneRegistrationStatus
);
router.post(
  '/register-phone/complete',
  authController.completePhoneRegistration
);
router.post(
  '/google',
  validate(googleAuthSchema.shape.body, 'body'),
  authController.googleAuth
);
router.post(
  '/yandex',
  validate(yandexAuthSchema.shape.body, 'body'),
  authController.yandexAuth
);
router.post(
  '/yandex/access-token',
  validate(yandexAccessTokenAuthSchema.shape.body, 'body'),
  authController.yandexAccessTokenAuth
);
router.post(
  '/telegram/start',
  validate(telegramAuthStartSchema.shape.body, 'body'),
  authController.startTelegramAuth
);
router.post(
  '/telegram/verify',
  validate(telegramAuthVerifySchema.shape.body, 'body'),
  authController.verifyTelegramAuth
);
router.post(
  '/telegram/verify-link',
  validate(telegramAuthVerifyLinkSchema.shape.body, 'body'),
  authController.verifyTelegramAuthLink
);
router.post(
  '/telegram/verify-ready',
  validate(telegramAuthVerifyReadySchema.shape.body, 'body'),
  authController.verifyTelegramAuthReady
);
router.post('/refresh', authController.refresh);
router.post('/logout', authMiddleware, authController.logout);
router.get('/me', authMiddleware, authController.me);
router.patch('/me', authMiddleware, authController.patchMe);
router.get('/verify-email', authController.verifyEmail);
router.post(
  '/verify-email',
  validate(verifyEmailCodeSchema.shape.body, 'body'),
  authController.verifyEmailByCode
);
router.post(
  '/verify-email/resend',
  validate(resendVerificationSchema.shape.body, 'body'),
  authController.resendVerificationCode
);
router.post(
  '/forgot-password',
  validate(forgotPasswordSchema.shape.body, 'body'),
  authController.forgotPassword
);
router.post(
  '/reset-password',
  validate(resetPasswordSchema.shape.body, 'body'),
  authController.resetPassword
);
router.post(
  '/set-password',
  authMiddleware,
  validate(setPasswordSchema.shape.body, 'body'),
  authController.setPassword
);
router.post(
  '/change-password',
  authMiddleware,
  validate(changePasswordSchema.shape.body, 'body'),
  authController.changePassword
);
router.post('/2fa/setup', authMiddleware, authController.setup2FA);
router.post('/2fa/verify', authMiddleware, authController.verify2FA);
router.post('/2fa/disable', authMiddleware, authController.disable2FA);

export default router;
