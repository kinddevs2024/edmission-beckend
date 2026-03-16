import multer from 'multer';
import { Router } from 'express';
import * as adminController from '../controllers/admin.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole, requireAdminOnly } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { validateObjectId } from '../middlewares/validateObjectId.middleware';
import * as adminValidator from '../validators/admin.validator';

const router = Router();

const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.originalname?.toLowerCase().endsWith('.xlsx');
    if (ok) cb(null, true);
    else cb(new Error('Only .xlsx files are allowed'));
  },
});

router.use(authMiddleware);
router.use(requireRole('admin', 'school_counsellor'));

router.get('/dashboard', adminController.getDashboard);
router.get('/analytics/university-interests', adminController.getUniversityInterestAnalytics);
router.get('/users', validate(adminValidator.usersQuerySchema, 'query'), adminController.getUsers);
router.post('/users', requireAdminOnly, validate(adminValidator.createUserSchema.shape.body, 'body'), adminController.createUser);
router.get('/users/:id', validateObjectId('id'), adminController.getUser);
router.patch('/users/:id', requireAdminOnly, validateObjectId('id'), validate(adminValidator.updateUserSchema.shape.body, 'body'), adminController.updateUser);
router.delete('/users/:id', requireAdminOnly, validateObjectId('id'), adminController.deleteUser);
router.post('/users/:id/reset-password', requireAdminOnly, validateObjectId('id'), validate(adminValidator.resetPasswordSchema.shape.body, 'body'), adminController.resetUserPassword);
router.patch('/users/:id/suspend', requireAdminOnly, validateObjectId('id'), validate(adminValidator.suspendUserSchema.shape.body, 'body'), adminController.suspendUser);
router.get('/users/:id/student-profile', validateObjectId('id'), adminController.getStudentProfileByUser);
router.patch('/users/:id/student-profile', requireAdminOnly, validateObjectId('id'), adminController.updateStudentProfileByUser);
router.get('/users/:id/university-profile', validateObjectId('id'), adminController.getUniversityProfileByUser);
router.patch('/users/:id/university-profile', requireAdminOnly, validateObjectId('id'), adminController.updateUniversityProfileByUser);
router.get('/universities/verification', adminController.getVerificationQueue);
router.post('/universities/:id/verify', requireAdminOnly, validateObjectId('id'), validate(adminValidator.verifyUniversitySchema.shape.body, 'body'), adminController.verifyUniversity);
router.get('/universities/template', adminController.downloadUniversitiesTemplate);
router.post('/universities/import', requireAdminOnly, (req, res, next) => {
  uploadExcel.single('file')(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, adminController.uploadUniversitiesExcel);
router.get('/universities', validate(adminValidator.catalogUniversitiesQuerySchema, 'query'), adminController.getCatalogUniversities);
router.post('/universities', requireAdminOnly, validate(adminValidator.createCatalogUniversitySchema.shape.body, 'body'), adminController.createCatalogUniversity);
router.get('/universities/:id', validateObjectId('id'), adminController.getCatalogUniversity);
router.patch('/universities/:id', requireAdminOnly, validateObjectId('id'), validate(adminValidator.updateCatalogUniversitySchema.shape.body, 'body'), adminController.updateCatalogUniversity);
router.delete('/universities/:id', requireAdminOnly, validateObjectId('id'), adminController.deleteCatalogUniversity);
router.get('/university-requests', adminController.getUniversityVerificationRequests);
router.post('/university-requests/:id/approve', requireAdminOnly, validateObjectId('id'), adminController.approveUniversityRequest);
router.post('/university-requests/:id/reject', requireAdminOnly, validateObjectId('id'), adminController.rejectUniversityRequest);
router.get('/scholarships', adminController.getScholarships);
router.get('/logs', validate(adminValidator.logsQuerySchema, 'query'), adminController.getLogs);
router.get('/health', adminController.getHealth);

router.get('/subscriptions', validate(adminValidator.subscriptionsQuerySchema, 'query'), adminController.getSubscriptions);
router.get('/subscriptions/:userId', validateObjectId('userId'), adminController.getSubscriptionByUser);
router.patch('/subscriptions/:userId', requireAdminOnly, validateObjectId('userId'), validate(adminValidator.updateSubscriptionSchema.shape.body, 'body'), adminController.updateSubscription);

router.get('/tickets', validate(adminValidator.ticketsQuerySchema, 'query'), adminController.getTickets);
router.get('/tickets/:id', validateObjectId('id'), adminController.getTicket);
router.patch('/tickets/:id/status', requireAdminOnly, validateObjectId('id'), validate(adminValidator.updateTicketStatusSchema.shape.body, 'body'), adminController.updateTicketStatus);
router.post('/tickets/:id/reply', requireAdminOnly, validateObjectId('id'), validate(adminValidator.addTicketReplySchema.shape.body, 'body'), adminController.addTicketReply);
router.get('/documents/pending', adminController.getPendingDocuments);
router.patch('/documents/:id/review', requireAdminOnly, validateObjectId('id'), validate(adminValidator.reviewDocumentSchema.shape.body, 'body'), adminController.reviewDocument);

router.get('/offers', validate(adminValidator.offersQuerySchema, 'query'), adminController.getOffers);
router.patch('/offers/:id/status', requireAdminOnly, validateObjectId('id'), validate(adminValidator.updateOfferStatusSchema.shape.body, 'body'), adminController.updateOfferStatus);
router.get('/interests', validate(adminValidator.interestsQuerySchema, 'query'), adminController.getInterests);
router.patch('/interests/:id/status', requireAdminOnly, validateObjectId('id'), validate(adminValidator.updateInterestStatusSchema.shape.body, 'body'), adminController.updateInterestStatus);
router.get('/chats', validate(adminValidator.chatsQuerySchema, 'query'), adminController.getChats);
router.get('/chats/:id/messages', validateObjectId('id'), validate(adminValidator.chatMessagesQuerySchema, 'query'), adminController.getChatMessages);
router.post('/chats/:id/messages', requireAdminOnly, validateObjectId('id'), validate(adminValidator.sendChatMessageSchema.shape.body, 'body'), adminController.sendChatMessage);

router.get('/investors', adminController.getInvestors);
router.post('/investors', requireAdminOnly, validate(adminValidator.createInvestorSchema.shape.body, 'body'), adminController.createInvestor);
router.delete('/investors/:id', requireAdminOnly, validateObjectId('id'), adminController.deleteInvestor);

router.get('/landing-certificates', adminController.listLandingCertificates);
router.post('/landing-certificates', requireAdminOnly, validate(adminValidator.createLandingCertificateSchema.shape.body, 'body'), adminController.createLandingCertificate);
router.patch('/landing-certificates/:id', requireAdminOnly, validateObjectId('id'), validate(adminValidator.updateLandingCertificateSchema.shape.body, 'body'), adminController.updateLandingCertificate);
router.delete('/landing-certificates/:id', requireAdminOnly, validateObjectId('id'), adminController.deleteLandingCertificate);

router.get('/settings', requireAdminOnly, adminController.getSettings);
router.patch('/settings', requireAdminOnly, validate(adminValidator.updateSettingsSchema.shape.body, 'body'), adminController.updateSettings);

export default router;
