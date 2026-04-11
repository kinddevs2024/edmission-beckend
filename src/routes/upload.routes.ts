import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { uploadSingle } from '../middlewares/upload.middleware';
import { uploadAvatarRateLimiter, uploadAuthenticatedRateLimiter } from '../middlewares/rateLimit.middleware';
import * as uploadController from '../controllers/upload.controller';

const router = Router();

/** Public avatar upload for registration (no auth, rate-limited) */
router.post('/avatar', uploadAvatarRateLimiter, (req, res, next) => {
  uploadSingle(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, uploadController.uploadFile);

router.use(authMiddleware);
router.post('/', uploadAuthenticatedRateLimiter, (req, res, next) => {
  uploadSingle(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, uploadController.uploadFile);

export default router;
