import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { authRateLimiter } from '../middlewares/rateLimit.middleware';
import * as telegramController from '../controllers/telegram.controller';

const router = Router();

router.use(authMiddleware);
router.use(authRateLimiter);
router.use(requireRole('student', 'university', 'school_counsellor', 'admin', 'counsellor_coordinator', 'manager'));

router.get('/status', telegramController.getStatus);
router.post('/link-code', telegramController.createLinkCode);
router.delete('/link', telegramController.unlink);

export default router;
