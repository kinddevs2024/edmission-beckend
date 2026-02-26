import { Router, type Request, type Response } from 'express';
import authRoutes from './auth.routes';
import studentRoutes from './student.routes';
import universityRoutes from './university.routes';
import adminRoutes from './admin.routes';
import chatRoutes from './chat.routes';
import aiRoutes from './ai.routes';
import notificationRoutes from './notification.routes';

const router = Router();

/** Health check под /api/health — для проверки доступности API с фронта */
router.get('/health', (_req: Request, res: Response) => {
  const ip = (_req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || _req.socket?.remoteAddress || '';
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ip,
  });
});

router.use('/auth', authRoutes);
router.use('/student', studentRoutes);
router.use('/university', universityRoutes);
router.use('/admin', adminRoutes);
router.use('/chat', chatRoutes);
router.use('/ai', aiRoutes);
router.use('/notifications', notificationRoutes);

export default router;
