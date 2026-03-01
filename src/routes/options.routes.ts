import { Router } from 'express';
import * as optionsController from '../controllers/options.controller';

const router = Router();

router.get('/profile-criteria', optionsController.getProfileCriteria);

export default router;
