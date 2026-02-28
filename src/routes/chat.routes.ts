import { Router } from 'express';
import * as chatController from '../controllers/chat.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

router.use(authMiddleware);

router.get('/', chatController.getChats);
router.get('/:chatId/messages', chatController.getMessages);
router.post('/:chatId/messages', chatController.sendMessage);
router.post('/:chatId/read', chatController.markRead);

export default router;
