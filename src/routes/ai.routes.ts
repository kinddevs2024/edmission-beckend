import { Router } from 'express';
import * as aiController from '../controllers/ai.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { aiChatRateLimiter } from '../middlewares/rateLimit.middleware';
import { validate } from '../middlewares/validate.middleware';
import * as aiValidator from '../validators/ai.validator';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('student', 'university', 'admin', 'school_counsellor', 'counsellor_coordinator', 'manager'));

router.get('/status', aiController.status);
router.use(aiChatRateLimiter);
router.post('/chat', validate(aiValidator.chatSchema.shape.body, 'body'), aiController.chat);

export default router;
