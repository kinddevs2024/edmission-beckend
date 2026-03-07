import { Router } from 'express';
import * as universityController from '../controllers/university.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { validateObjectId } from '../middlewares/validateObjectId.middleware';
import * as universityValidator from '../validators/university.validator';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('university'));

router.get('/catalog', universityController.getCatalog);
router.post('/verification-request', universityController.createVerificationRequest);

router.get('/profile', universityController.getProfile);
router.put('/profile', validate(universityValidator.updateProfileSchema.shape.body, 'body'), universityController.updateProfile);
router.get('/dashboard', universityController.getDashboard);
router.get('/analytics/funnel', universityController.getFunnelAnalytics);
router.get('/students/:studentId/profile', validateObjectId('studentId'), universityController.getStudentProfile);
router.get('/students', universityController.getStudents);
router.get('/pipeline', universityController.getPipeline);
router.patch('/interests/:id', validateObjectId('id'), validate(universityValidator.updateInterestSchema.shape.body, 'body'), universityController.updateInterest);
router.get('/scholarships', universityController.getScholarships);
router.post('/scholarships', validate(universityValidator.createScholarshipSchema.shape.body, 'body'), universityController.createScholarship);
router.patch('/scholarships/:id', validateObjectId('id'), validate(universityValidator.updateScholarshipSchema.shape.body, 'body'), universityController.updateScholarship);
router.delete('/scholarships/:id', validateObjectId('id'), universityController.deleteScholarship);
router.post('/offers', validate(universityValidator.createOfferSchema.shape.body, 'body'), universityController.createOffer);
router.get('/recommendations', universityController.getRecommendations);

router.get('/faculties', universityController.getFaculties);
router.post('/faculties', universityController.createFaculty);
router.get('/faculties/:id', validateObjectId('id'), universityController.getFacultyById);
router.patch('/faculties/:id', validateObjectId('id'), universityController.updateFaculty);
router.delete('/faculties/:id', validateObjectId('id'), universityController.deleteFaculty);

export default router;
