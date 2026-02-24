import { Router } from 'express';
import * as aiController from '../controllers/ai.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { aiChatRateLimiter } from '../middlewares/rateLimit.middleware';

const router = Router();

router.use(authMiddleware);
router.use(aiChatRateLimiter);

router.post('/chat', aiController.chat);

export default router;
