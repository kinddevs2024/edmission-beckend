import { Router } from 'express';
import * as paymentController from '../controllers/payment.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';

const router = Router();

router.post('/create-checkout-session', authMiddleware, requireRole('student', 'university'), paymentController.createCheckoutSession);

router.post('/webhook', paymentController.webhook);

export default router;
