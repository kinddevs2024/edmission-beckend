import { Router } from 'express';
import * as adminController from '../controllers/admin.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('admin'));

router.get('/dashboard', adminController.getDashboard);
router.get('/users', adminController.getUsers);
router.post('/users', adminController.createUser);
router.get('/users/:id', adminController.getUser);
router.patch('/users/:id', adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);
router.post('/users/:id/reset-password', adminController.resetUserPassword);
router.patch('/users/:id/suspend', adminController.suspendUser);
router.get('/users/:id/student-profile', adminController.getStudentProfileByUser);
router.patch('/users/:id/student-profile', adminController.updateStudentProfileByUser);
router.get('/users/:id/university-profile', adminController.getUniversityProfileByUser);
router.patch('/users/:id/university-profile', adminController.updateUniversityProfileByUser);
router.get('/universities/verification', adminController.getVerificationQueue);
router.post('/universities/:id/verify', adminController.verifyUniversity);
router.get('/universities', adminController.getCatalogUniversities);
router.post('/universities', adminController.createCatalogUniversity);
router.get('/universities/:id', adminController.getCatalogUniversity);
router.patch('/universities/:id', adminController.updateCatalogUniversity);
router.get('/university-requests', adminController.getUniversityVerificationRequests);
router.post('/university-requests/:id/approve', adminController.approveUniversityRequest);
router.post('/university-requests/:id/reject', adminController.rejectUniversityRequest);
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

router.get('/offers', adminController.getOffers);
router.patch('/offers/:id/status', adminController.updateOfferStatus);
router.get('/interests', adminController.getInterests);
router.patch('/interests/:id/status', adminController.updateInterestStatus);
router.get('/chats', adminController.getChats);
router.get('/chats/:id/messages', adminController.getChatMessages);

router.get('/investors', adminController.getInvestors);
router.post('/investors', adminController.createInvestor);
router.delete('/investors/:id', adminController.deleteInvestor);

export default router;
