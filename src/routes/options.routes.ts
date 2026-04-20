import { Router } from 'express';
import * as optionsController from '../controllers/options.controller';

const router = Router();

router.get('/status', optionsController.getPublicStatus);
router.get('/profile-criteria', optionsController.getProfileCriteria);
router.get('/university-countries', optionsController.getUniversityHubCountries);

export default router;
