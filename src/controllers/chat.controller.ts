import { Request, Response, NextFunction } from 'express';
import * as chatService from '../services/chat.service';

export async function getChats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await chatService.getChats(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const { page, limit } = req.query;
    const data = await chatService.getMessages(req.params.chatId, req.user.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function markRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    await chatService.markRead(req.params.chatId, req.user.id);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
}
