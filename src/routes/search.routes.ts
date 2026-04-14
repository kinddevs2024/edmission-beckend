import { Router } from 'express';
import * as searchController from '../controllers/search.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { searchRateLimiter } from '../middlewares/rateLimit.middleware';

const router = Router();

router.use(authMiddleware);
router.use(searchRateLimiter);
router.get('/', searchController.search);

export default router;
