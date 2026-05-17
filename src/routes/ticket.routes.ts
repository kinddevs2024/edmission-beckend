import { Router } from 'express';
import * as ticketController from '../controllers/ticket.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { resolveUniversityActAs } from '../middlewares/universityActAs.middleware';
import { validate } from '../middlewares/validate.middleware';
import { validateObjectId } from '../middlewares/validateObjectId.middleware';
import * as ticketValidator from '../validators/ticket.validator';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('student', 'university', 'university_multi_manager', 'multi_university_admin', 'school_counsellor'));
router.use(resolveUniversityActAs);

router.post('/', validate(ticketValidator.createTicketSchema.shape.body, 'body'), ticketController.create);
router.get('/', ticketController.getMyTickets);
router.get('/:id', validateObjectId('id'), ticketController.getTicket);
router.post('/:id/reply', validateObjectId('id'), validate(ticketValidator.addReplySchema.shape.body, 'body'), ticketController.addReply);

export default router;
