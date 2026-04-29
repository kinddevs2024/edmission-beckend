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
import searchRoutes from './search.routes';
import documentsRoutes from './documents.routes';
import telegramRoutes from './telegram.routes';

const router = Router();

router.use(maintenanceMiddleware);

function getUploadFrameAncestors(): string {
  const origins = new Set<string>(["'self'"]);
  for (const value of [config.frontendUrl, ...config.cors.origin]) {
    try {
      const url = new URL(value);
      origins.add(url.origin);
    } catch {
      // Ignore invalid origins; uploads should still be served.
    }
  }
  return Array.from(origins).join(' ');
}

/** Static uploads - filenames are UUIDs (unguessable). Harden static serving (no directory indexes / dotfiles). */
router.use(
  '/uploads',
  express.static(path.resolve(config.uploadDir), {
    dotfiles: 'deny',
    index: false,
    setHeaders: (res) => {
      // Uploaded PDFs need to render inside the app preview modal. Helmet's global
      // frame protections are right for API pages, but too strict for static files.
      res.removeHeader('X-Frame-Options');
      res.setHeader('Content-Security-Policy', `frame-ancestors ${getUploadFrameAncestors()}`);
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  })
);

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
router.use('/search', searchRoutes);
router.use('/documents', documentsRoutes);
router.use('/telegram', telegramRoutes);

export default router;
