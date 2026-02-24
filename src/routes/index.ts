import { Router } from 'express';
import authRoutes from './auth.routes';
import studentRoutes from './student.routes';
import universityRoutes from './university.routes';
import adminRoutes from './admin.routes';
import chatRoutes from './chat.routes';
import aiRoutes from './ai.routes';
import notificationRoutes from './notification.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/student', studentRoutes);
router.use('/university', universityRoutes);
router.use('/admin', adminRoutes);
router.use('/chat', chatRoutes);
router.use('/ai', aiRoutes);
router.use('/notifications', notificationRoutes);

export default router;
