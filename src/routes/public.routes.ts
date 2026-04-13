import { Router } from 'express';
import * as publicController from '../controllers/public.controller';
import { optionalAuthMiddleware } from '../middlewares/auth.middleware';
import { requireDb } from '../middlewares/requireDb.middleware';
import { validateObjectId, validateUniversityId } from '../middlewares/validateObjectId.middleware';
import { validate } from '../middlewares/validate.middleware';
import { publicVisitRateLimiter } from '../middlewares/rateLimit.middleware';
import * as publicValidator from '../validators/public.validator';

const router = Router();

router.use(requireDb);

/** Public stats for landing page - no auth required */
router.get('/stats', publicController.getStats);

/** Public share cards for social preview (Telegram, YouTube, etc.) */
router.get('/share/university/:id', validateUniversityId('id'), publicController.getUniversitySharePreview);
router.get('/share/student/:id', validateObjectId('id'), publicController.getStudentSharePreview);

/** Public trusted university logos for landing page - no auth required */
router.get(
  '/trusted-university-logos',
  validate(publicValidator.trustedLogosQuerySchema, 'query'),
  publicController.getTrustedUniversityLogos
);

/** Public landing certificates (university + student) - no auth required */
router.get('/landing-certificates', publicController.getLandingCertificates);

/** Public lightweight site visit tracking. */
router.post(
  '/analytics/visit',
  publicVisitRateLimiter,
  optionalAuthMiddleware,
  validate(publicValidator.trackSiteVisitSchema, 'body'),
  publicController.trackSiteVisit
);

export default router;
