import { Router } from 'express';
import * as studentController from '../controllers/student.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('student'));

router.get('/profile', studentController.getProfile);
router.patch('/profile', studentController.updateProfile);
router.get('/dashboard', studentController.getDashboard);
router.get('/universities', studentController.getUniversities);
router.get('/universities/:id', studentController.getUniversityById);
router.post('/universities/:id/interest', studentController.addInterest);
router.get('/interests/limit', studentController.getInterestLimit);
router.get('/applications', studentController.getApplications);
router.get('/offers', studentController.getOffers);
router.post('/offers/:id/accept', studentController.acceptOffer);
router.post('/offers/:id/decline', studentController.declineOffer);
router.get('/recommendations', studentController.getRecommendations);
router.get('/compare', studentController.getCompare);
router.get('/documents', studentController.getMyDocuments);
router.post('/documents', studentController.addDocument);

export default router;
