import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { uploadSingle } from '../middlewares/upload.middleware';
import * as uploadController from '../controllers/upload.controller';

const router = Router();

router.use(authMiddleware);
router.post('/', (req, res, next) => {
  uploadSingle(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, uploadController.uploadFile);

export default router;
