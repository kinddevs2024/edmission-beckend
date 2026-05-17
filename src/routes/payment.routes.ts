import { Router } from 'express';
import * as paymentController from '../controllers/payment.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { resolveUniversityActAs } from '../middlewares/universityActAs.middleware';
import { validate } from '../middlewares/validate.middleware';
import * as paymentValidator from '../validators/payment.validator';

const router = Router();

router.post(
  '/create-checkout-session',
  authMiddleware,
  requireRole('student', 'university', 'university_multi_manager', 'multi_university_admin'),
  resolveUniversityActAs,
  validate(paymentValidator.createCheckoutSessionSchema.shape.body, 'body'),
  paymentController.createCheckoutSession
);

router.post('/webhook', paymentController.webhook);

export default router;
