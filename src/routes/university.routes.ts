import { Router } from 'express';
import * as universityController from '../controllers/university.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('university'));

router.get('/profile', universityController.getProfile);
router.put('/profile', universityController.updateProfile);
router.get('/dashboard', universityController.getDashboard);
router.get('/analytics/funnel', universityController.getFunnelAnalytics);
router.get('/students/:studentId/profile', universityController.getStudentProfile);
router.get('/students', universityController.getStudents);
router.get('/pipeline', universityController.getPipeline);
router.patch('/interests/:id', universityController.updateInterest);
router.get('/scholarships', universityController.getScholarships);
router.post('/scholarships', universityController.createScholarship);
router.patch('/scholarships/:id', universityController.updateScholarship);
router.delete('/scholarships/:id', universityController.deleteScholarship);
router.post('/offers', universityController.createOffer);
router.get('/recommendations', universityController.getRecommendations);

router.get('/faculties', universityController.getFaculties);
router.post('/faculties', universityController.createFaculty);
router.get('/faculties/:id', universityController.getFacultyById);
router.patch('/faculties/:id', universityController.updateFaculty);
router.delete('/faculties/:id', universityController.deleteFaculty);

export default router;
