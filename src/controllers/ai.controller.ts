import { Request, Response, NextFunction } from 'express';
import * as aiService from '../services/ai.service';

export async function chat(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const body = req.body as { message?: string; history?: { role: string; content: string }[]; selectedText?: string };
    const message = typeof body.message === 'string' ? body.message : '';
    if (!message.trim()) {
      res.status(400).json({ message: 'Message is required' });
      return;
    }
    const history = Array.isArray(body.history)
      ? body.history
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content) }))
      : undefined;
    const reply = await aiService.chat(req.user.id, req.user.role, {
      message: message.trim(),
      history,
      selectedText: typeof body.selectedText === 'string' ? body.selectedText : undefined,
    });
    res.json({ reply });
  } catch (e) {
    next(e);
  }
}
