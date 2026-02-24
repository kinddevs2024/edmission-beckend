import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { authRateLimiter } from '../middlewares/rateLimit.middleware';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../validators/auth.validator';

const router = Router();

router.use(authRateLimiter);

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
router.post('/refresh', authController.refresh);
router.post('/logout', authMiddleware, authController.logout);
router.get('/me', authMiddleware, authController.me);
router.get('/verify-email', authController.verifyEmail);
router.post('/verify-email/resend', authMiddleware, (_req, res) => {
  res.json({ message: 'TODO: resend verification email' });
});
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

export default router;
