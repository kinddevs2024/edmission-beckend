import { Router } from 'express';
import * as chatController from '../controllers/chat.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { validateObjectId } from '../middlewares/validateObjectId.middleware';
import * as chatValidator from '../validators/chat.validator';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('student', 'university'));

router.get('/', chatController.getChats);
router.post('/', validate(chatValidator.createChatSchema.shape.body, 'body'), chatController.createChat);
router.get('/:chatId/messages', validateObjectId('chatId'), chatController.getMessages);
router.post('/:chatId/messages', validateObjectId('chatId'), validate(chatValidator.sendMessageSchema.shape.body, 'body'), chatController.sendMessage);
router.post('/:chatId/read', validateObjectId('chatId'), chatController.markRead);
router.post('/:chatId/accept', validateObjectId('chatId'), validate(chatValidator.acceptStudentSchema.shape.body, 'body'), chatController.acceptStudent);

export default router;
