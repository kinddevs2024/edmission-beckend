import { Router } from 'express';
import * as ticketController from '../controllers/ticket.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('student', 'university'));

router.post('/', ticketController.create);
router.get('/', ticketController.getMyTickets);
router.get('/:id', ticketController.getTicket);
router.post('/:id/reply', ticketController.addReply);

export default router;
