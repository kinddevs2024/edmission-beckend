import { Request, Response, NextFunction } from 'express';
import * as telegramService from '../services/telegram.service';

export async function getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await telegramService.getTelegramStatus(req.user.id);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

export async function createLinkCode(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await telegramService.createTelegramLinkCode(req.user.id);
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
}

export async function unlink(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    await telegramService.unlinkTelegram(req.user.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}
