import { Router } from 'express';
import * as paymentController from '../controllers/payment.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import * as paymentValidator from '../validators/payment.validator';

const router = Router();

router.post('/create-checkout-session', authMiddleware, requireRole('student', 'university'), validate(paymentValidator.createCheckoutSessionSchema.shape.body, 'body'), paymentController.createCheckoutSession);

router.post('/webhook', paymentController.webhook);

export default router;
