import path from 'path';
import express, { Router, type Request, type Response } from 'express';
import { config } from '../config';
import { maintenanceMiddleware } from '../middlewares/maintenance.middleware';
import authRoutes from './auth.routes';
import studentRoutes from './student.routes';
import universityRoutes from './university.routes';
import adminRoutes from './admin.routes';
import counsellorRoutes from './counsellor.routes';
import chatRoutes from './chat.routes';
import aiRoutes from './ai.routes';
import notificationRoutes from './notification.routes';
import uploadRoutes from './upload.routes';
import ticketRoutes from './ticket.routes';
import optionsRoutes from './options.routes';
import paymentRoutes from './payment.routes';
import publicRoutes from './public.routes';

const router = Router();

router.use(maintenanceMiddleware);

/** Static uploads - filenames are UUIDs (unguessable). TODO: add auth for sensitive files. */
router.use('/uploads', express.static(path.resolve(config.uploadDir)));

/** Health check под /api/health — для проверки доступности API с фронта */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

router.use('/auth', authRoutes);
router.use('/student', studentRoutes);
router.use('/university', universityRoutes);
router.use('/admin', adminRoutes);
router.use('/counsellor', counsellorRoutes);
router.use('/chat', chatRoutes);
router.use('/ai', aiRoutes);
router.use('/notifications', notificationRoutes);
router.use('/upload', uploadRoutes);
router.use('/tickets', ticketRoutes);
router.use('/options', optionsRoutes);
router.use('/payment', paymentRoutes);
router.use('/public', publicRoutes);

export default router;
