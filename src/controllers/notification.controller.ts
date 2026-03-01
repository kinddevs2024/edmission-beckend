import { Request, Response, NextFunction } from 'express';
import * as notificationService from '../services/notification.service';

export async function getNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const { page, limit, type, unread } = req.query;
    const data = await notificationService.getNotifications(req.user.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      type: type ? String(type) : undefined,
      unread: unread === 'true' ? true : unread === 'false' ? false : undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function markRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await notificationService.markRead(req.user.id, req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function markAllRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    await notificationService.markAllRead(req.user.id);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
}

export async function deleteOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    await notificationService.deleteOne(req.user.id, req.params.id);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
}

export async function deleteBulk(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const body = (req.body || {}) as { ids?: string[]; readOnly?: boolean; beforeDate?: string };
    const result = await notificationService.deleteBulk(req.user.id, {
      ids: body.ids,
      readOnly: body.readOnly,
      beforeDate: body.beforeDate,
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
}
