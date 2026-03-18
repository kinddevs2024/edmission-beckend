import { Router } from 'express';
import * as publicController from '../controllers/public.controller';
import { requireDb } from '../middlewares/requireDb.middleware';

const router = Router();

router.use(requireDb);

/** Public stats for landing page - no auth required */
router.get('/stats', publicController.getStats);

/** Public trusted university logos for landing page - no auth required */
router.get('/trusted-university-logos', publicController.getTrustedUniversityLogos);

/** Public landing certificates (university + student) - no auth required */
router.get('/landing-certificates', publicController.getLandingCertificates);

export default router;
