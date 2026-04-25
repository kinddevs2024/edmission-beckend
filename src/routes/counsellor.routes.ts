import multer from 'multer';
import { Router } from 'express';
import * as counsellorController from '../controllers/counsellor.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { validateObjectId, validateUniversityId } from '../middlewares/validateObjectId.middleware';
import * as counsellorValidator from '../validators/counsellor.validator';

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
router.use(requireRole('school_counsellor'));

router.get('/profile', counsellorController.getProfile);
router.patch('/profile', validate(counsellorValidator.counsellorProfileSchema.shape.body, 'body'), counsellorController.updateProfile);

router.get('/students/search-invite', validate(counsellorValidator.searchStudentsForInviteQuerySchema, 'query'), counsellorController.searchStudentsForInvite);
router.post('/students/invite', validate(counsellorValidator.inviteStudentSchema.shape.body, 'body'), counsellorController.inviteStudent);
router.get('/students/template', counsellorController.downloadStudentsTemplate);
router.get('/students/export', counsellorController.downloadStudentsExcel);
router.post('/students/import', (req, res, next) => {
  uploadExcel.single('file')(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, counsellorController.uploadStudentsExcel);
router.post('/students', validate(counsellorValidator.createStudentByCounsellorSchema.shape.body, 'body'), counsellorController.createStudent);
router.get('/students', validate(counsellorValidator.listMyStudentsQuerySchema, 'query'), counsellorController.listMyStudents);
router.get('/students/:studentUserId/universities', validateObjectId('studentUserId'), validate(counsellorValidator.listStudentUniversitiesQuerySchema, 'query'), counsellorController.getStudentUniversities);
router.get('/students/:studentUserId', validateObjectId('studentUserId'), counsellorController.getStudentProfile);
router.patch('/students/:studentUserId', validateObjectId('studentUserId'), validate(counsellorValidator.updateMyStudentSchema.shape.body, 'body'), counsellorController.updateMyStudent);
router.post('/students/:studentUserId/generate-temp-password', validateObjectId('studentUserId'), counsellorController.generateTempPassword);
router.delete('/students/:studentUserId', validateObjectId('studentUserId'), counsellorController.deleteMyStudent);
router.get('/students/:studentUserId/documents', validateObjectId('studentUserId'), counsellorController.getStudentDocuments);
router.post('/students/:studentUserId/documents', validateObjectId('studentUserId'), validate(counsellorValidator.addDocumentForStudentSchema.shape.body, 'body'), counsellorController.addStudentDocument);
router.patch('/students/:studentUserId/documents/:documentId', validateObjectId('studentUserId'), validateObjectId('documentId'), validate(counsellorValidator.updateDocumentForStudentSchema.shape.body, 'body'), counsellorController.updateStudentDocument);
router.delete('/students/:studentUserId/documents/:documentId', validateObjectId('studentUserId'), validateObjectId('documentId'), counsellorController.deleteStudentDocument);

router.get('/applications', validate(counsellorValidator.listMyApplicationsQuerySchema, 'query'), counsellorController.listMyApplications);
router.get('/offers', validate(counsellorValidator.listMyOffersQuerySchema, 'query'), counsellorController.listMyOffers);

router.get('/invitations', validate(counsellorValidator.listMyInvitationsQuerySchema, 'query'), counsellorController.listMyInvitations);
router.post('/invitations/:invitationId/cancel', validateObjectId('invitationId'), counsellorController.cancelSchoolInvitation);
router.get('/join-requests', validate(counsellorValidator.listJoinRequestsQuerySchema, 'query'), counsellorController.listJoinRequests);
router.post('/join-requests/:requestId/accept', validateObjectId('requestId'), counsellorController.acceptJoinRequest);
router.post('/join-requests/:requestId/reject', validateObjectId('requestId'), counsellorController.rejectJoinRequest);

/** Add interest (application) to university on behalf of a student. */
router.post('/students/:studentUserId/interests/:universityId', validateObjectId('studentUserId'), validateUniversityId('universityId'), counsellorController.addInterestForStudent);

export default router;
