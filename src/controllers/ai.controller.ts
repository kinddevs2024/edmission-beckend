import { Request, Response, NextFunction } from 'express';
import * as aiService from '../services/ai.service';

export async function chat(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const message = (req.body?.message ?? '') as string;
    if (!message.trim()) {
      res.status(400).json({ message: 'Message is required' });
      return;
    }
    const reply = await aiService.chat(req.user.id, req.user.role, message.trim());
    res.json({ reply });
  } catch (e) {
    next(e);
  }
}
