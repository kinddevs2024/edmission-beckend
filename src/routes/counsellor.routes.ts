import { Router } from 'express';
import * as counsellorController from '../controllers/counsellor.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { validateObjectId } from '../middlewares/validateObjectId.middleware';
import * as counsellorValidator from '../validators/counsellor.validator';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('school_counsellor'));

router.get('/profile', counsellorController.getProfile);
router.patch('/profile', validate(counsellorValidator.counsellorProfileSchema.shape.body, 'body'), counsellorController.updateProfile);

router.get('/students/search-invite', validate(counsellorValidator.searchStudentsForInviteQuerySchema, 'query'), counsellorController.searchStudentsForInvite);
router.post('/students/invite', validate(counsellorValidator.inviteStudentSchema.shape.body, 'body'), counsellorController.inviteStudent);
router.post('/students', validate(counsellorValidator.createStudentByCounsellorSchema.shape.body, 'body'), counsellorController.createStudent);
router.get('/students', validate(counsellorValidator.listMyStudentsQuerySchema, 'query'), counsellorController.listMyStudents);
router.get('/students/:studentUserId', validateObjectId('studentUserId'), counsellorController.getStudentProfile);
router.patch('/students/:studentUserId', validateObjectId('studentUserId'), validate(counsellorValidator.updateMyStudentSchema.shape.body, 'body'), counsellorController.updateMyStudent);
router.post('/students/:studentUserId/generate-temp-password', validateObjectId('studentUserId'), counsellorController.generateTempPassword);
router.delete('/students/:studentUserId', validateObjectId('studentUserId'), counsellorController.deleteMyStudent);
router.get('/students/:studentUserId/documents', validateObjectId('studentUserId'), counsellorController.getStudentDocuments);
router.post('/students/:studentUserId/documents', validateObjectId('studentUserId'), validate(counsellorValidator.addDocumentForStudentSchema.shape.body, 'body'), counsellorController.addStudentDocument);
router.delete('/students/:studentUserId/documents/:documentId', validateObjectId('studentUserId'), validateObjectId('documentId'), counsellorController.deleteStudentDocument);

router.get('/invitations', validate(counsellorValidator.listMyInvitationsQuerySchema, 'query'), counsellorController.listMyInvitations);
router.get('/join-requests', validate(counsellorValidator.listJoinRequestsQuerySchema, 'query'), counsellorController.listJoinRequests);
router.post('/join-requests/:requestId/accept', validateObjectId('requestId'), counsellorController.acceptJoinRequest);
router.post('/join-requests/:requestId/reject', validateObjectId('requestId'), counsellorController.rejectJoinRequest);

/** Add interest (application) to university on behalf of a student. */
router.post('/students/:studentUserId/interests/:universityId', validateObjectId('studentUserId'), validateObjectId('universityId'), counsellorController.addInterestForStudent);

export default router;
