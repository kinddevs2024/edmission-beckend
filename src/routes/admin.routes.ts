import { Router } from 'express';
import * as adminController from '../controllers/admin.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('admin'));

router.get('/dashboard', adminController.getDashboard);
router.get('/users', adminController.getUsers);
router.patch('/users/:id/suspend', adminController.suspendUser);
router.get('/universities/verification', adminController.getVerificationQueue);
router.post('/universities/:id/verify', adminController.verifyUniversity);
router.get('/scholarships', adminController.getScholarships);
router.get('/logs', adminController.getLogs);
router.get('/health', adminController.getHealth);

router.get('/subscriptions', adminController.getSubscriptions);
router.get('/subscriptions/:userId', adminController.getSubscriptionByUser);
router.patch('/subscriptions/:userId', adminController.updateSubscription);

router.get('/tickets', adminController.getTickets);
router.get('/tickets/:id', adminController.getTicket);
router.patch('/tickets/:id/status', adminController.updateTicketStatus);
router.post('/tickets/:id/reply', adminController.addTicketReply);
router.get('/documents/pending', adminController.getPendingDocuments);
router.patch('/documents/:id/review', adminController.reviewDocument);

export default router;
