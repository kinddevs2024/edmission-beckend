import { Router } from 'express';
import * as chatController from '../controllers/chat.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { resolveUniversityActAs } from '../middlewares/universityActAs.middleware';
import { validate } from '../middlewares/validate.middleware';
import { validateObjectId } from '../middlewares/validateObjectId.middleware';
import * as chatValidator from '../validators/chat.validator';

const router = Router();

router.use(authMiddleware);
router.use(resolveUniversityActAs);
router.use(requireRole('student', 'university', 'university_multi_manager', 'school_counsellor'));

router.get('/', chatController.getChats);
router.post('/', validate(chatValidator.createChatSchema.shape.body, 'body'), chatController.createChat);
router.get('/:chatId/messages', validateObjectId('chatId'), chatController.getMessages);
router.post('/:chatId/messages', validateObjectId('chatId'), validate(chatValidator.sendMessageSchema.shape.body, 'body'), chatController.sendMessage);
router.patch(
  '/:chatId/messages/:messageId',
  validate(chatValidator.messageIdParamSchema, 'params'),
  validate(chatValidator.updateMessageSchema.shape.body, 'body'),
  chatController.updateMessage
);
router.delete(
  '/:chatId/messages/:messageId',
  validate(chatValidator.messageIdParamSchema, 'params'),
  validate(chatValidator.deleteMessageSchema.shape.body, 'body'),
  chatController.deleteMessage
);
router.post('/:chatId/read', validateObjectId('chatId'), chatController.markRead);
router.post('/:chatId/accept', validateObjectId('chatId'), validate(chatValidator.acceptStudentSchema.shape.body, 'body'), chatController.acceptStudent);

export default router;
