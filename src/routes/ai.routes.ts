import { Router } from 'express';
import * as aiController from '../controllers/ai.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { aiChatRateLimiter } from '../middlewares/rateLimit.middleware';
import { validate } from '../middlewares/validate.middleware';
import * as aiValidator from '../validators/ai.validator';

const router = Router();

router.get('/status', authMiddleware, aiController.status);

router.use(authMiddleware);
router.use(aiChatRateLimiter);
router.post('/chat', validate(aiValidator.chatSchema.shape.body, 'body'), aiController.chat);

export default router;
