import { Router } from 'express';
import * as studentController from '../controllers/student.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { validateObjectId, validateUniversityId } from '../middlewares/validateObjectId.middleware';
import * as studentValidator from '../validators/student.validator';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('student'));

router.get('/profile', studentController.getProfile);
router.patch('/profile', validate(studentValidator.updateProfileSchema.shape.body, 'body'), studentController.updateProfile);
router.get('/dashboard', studentController.getDashboard);
router.get('/universities', studentController.getUniversities);
router.get('/universities/:id', validateUniversityId('id'), studentController.getUniversityById);
router.post('/universities/:id/interest', validateUniversityId('id'), studentController.addInterest);
router.get('/interests/limit', studentController.getInterestLimit);
router.get('/interests/university-ids', studentController.getInterestedUniversityIds);
router.get('/applications', studentController.getApplications);
router.get('/offers', studentController.getOffers);
router.post('/offers/:id/accept', validateObjectId('id'), studentController.acceptOffer);
router.post('/offers/:id/decline', validateObjectId('id'), studentController.declineOffer);
router.get('/recommendations', studentController.getRecommendations);
router.get('/compare', studentController.getCompare);
router.get('/documents', studentController.getMyDocuments);
router.post('/documents', validate(studentValidator.documentSchema.shape.body, 'body'), studentController.addDocument);
router.get('/schools', studentController.listSchools);
router.post('/schools/:counsellorUserId/request', validateObjectId('counsellorUserId'), studentController.requestToJoinSchool);

export default router;
