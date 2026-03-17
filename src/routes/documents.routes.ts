import { Router } from 'express';
import * as documentsController from '../controllers/documents.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { requireVerifiedUniversity } from '../middlewares/requireVerifiedUniversity.middleware';
import { validate } from '../middlewares/validate.middleware';
import { validateObjectId } from '../middlewares/validateObjectId.middleware';
import * as documentsValidator from '../validators/documents.validator';

const router = Router();

router.use(authMiddleware);

router.get(
  '/templates',
  requireRole('university'),
  requireVerifiedUniversity,
  validate(documentsValidator.listTemplatesQuerySchema.shape.query, 'query'),
  documentsController.listTemplates
);
router.post(
  '/templates',
  requireRole('university'),
  requireVerifiedUniversity,
  validate(documentsValidator.createTemplateSchema.shape.body, 'body'),
  documentsController.createTemplate
);
router.get('/templates/:id', requireRole('university'), requireVerifiedUniversity, validateObjectId('id'), documentsController.getTemplate);
router.patch(
  '/templates/:id',
  requireRole('university'),
  requireVerifiedUniversity,
  validateObjectId('id'),
  validate(documentsValidator.updateTemplateSchema.shape.body, 'body'),
  documentsController.updateTemplate
);
router.delete('/templates/:id', requireRole('university'), requireVerifiedUniversity, validateObjectId('id'), documentsController.deleteTemplate);
router.post('/templates/:id/duplicate', requireRole('university'), requireVerifiedUniversity, validateObjectId('id'), documentsController.duplicateTemplate);
router.post(
  '/templates/:id/render-preview',
  requireRole('university'),
  requireVerifiedUniversity,
  validateObjectId('id'),
  validate(documentsValidator.renderTemplatePreviewSchema.shape.body, 'body'),
  documentsController.renderTemplatePreview
);

router.get(
  '/student-documents',
  requireRole('student', 'university'),
  validate(documentsValidator.listStudentDocumentsQuerySchema.shape.query, 'query'),
  documentsController.listStudentDocuments
);
router.post(
  '/student-documents/send',
  requireRole('university'),
  requireVerifiedUniversity,
  validate(documentsValidator.sendStudentDocumentSchema.shape.body, 'body'),
  documentsController.sendStudentDocument
);
router.get('/student-documents/:id', requireRole('student', 'university'), validateObjectId('id'), documentsController.getStudentDocument);
router.post('/student-documents/:id/view', requireRole('student'), validateObjectId('id'), documentsController.viewStudentDocument);
router.post('/student-documents/:id/accept', requireRole('student'), validateObjectId('id'), documentsController.acceptStudentDocument);
router.post('/student-documents/:id/decline', requireRole('student'), validateObjectId('id'), documentsController.declineStudentDocument);
router.post(
  '/student-documents/:id/postpone',
  requireRole('student'),
  validateObjectId('id'),
  validate(documentsValidator.postponeStudentDocumentSchema.shape.body, 'body'),
  documentsController.postponeStudentDocument
);
router.post('/student-documents/:id/revoke', requireRole('university'), requireVerifiedUniversity, validateObjectId('id'), documentsController.revokeStudentDocument);
router.delete('/student-documents/:id', requireRole('university'), requireVerifiedUniversity, validateObjectId('id'), documentsController.deleteStudentDocument);

export default router;
