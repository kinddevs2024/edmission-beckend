import { Router } from 'express';
import * as searchController from '../controllers/search.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

router.use(authMiddleware);
router.get('/', searchController.search);

export default router;
