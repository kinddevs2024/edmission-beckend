import { Request, Response, NextFunction } from 'express';
import * as aiProvider from '../ai/provider';
import * as aiService from '../services/ai.service';

const AI_SESSION_LIMIT = 10;
const aiSessionUsage = new Map<string, { count: number; updatedAt: number }>();

function enforceSessionLimit(userId: string, sessionId?: string) {
  if (!sessionId) return null;
  const now = Date.now();
  for (const [key, value] of aiSessionUsage.entries()) {
    if (now - value.updatedAt > 12 * 60 * 60 * 1000) {
      aiSessionUsage.delete(key);
    }
  }
  const key = `${userId}:${sessionId}`;
  const current = aiSessionUsage.get(key) ?? { count: 0, updatedAt: now };
  if (current.count >= AI_SESSION_LIMIT) {
    return `Question limit reached (${AI_SESSION_LIMIT}). Refresh the page to reset it.`;
  }
  aiSessionUsage.set(key, { count: current.count + 1, updatedAt: now });
  return null;
}

export async function status(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ok = await aiProvider.healthCheck();
    res.json({ ok, model: aiProvider.getModelName() });
  } catch (e) {
    next(e);
  }
}

export async function chat(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const body = req.body as { message?: string; history?: { role: string; content: string }[]; selectedText?: string; sessionId?: string; stream?: boolean };
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
    const sessionLimitError = enforceSessionLimit(req.user.id, typeof body.sessionId === 'string' ? body.sessionId : undefined);
    if (sessionLimitError) {
      res.status(429).json({ message: sessionLimitError });
      return;
    }
    const stream = Boolean(body.stream);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof (res as { flushHeaders?: () => void }).flushHeaders === 'function') {
        (res as { flushHeaders: () => void }).flushHeaders();
      }

      const resWithFlush = res as unknown as { flush?: () => void };
      const flush = typeof resWithFlush.flush === 'function' ? resWithFlush.flush : null;
      try {
        for await (const chunk of aiService.chatStream(req.user.id, req.user.role, {
          message: message.trim(),
          history,
          selectedText: typeof body.selectedText === 'string' ? body.selectedText : undefined,
        })) {
          const payload = JSON.stringify({ t: chunk.type, d: chunk.text });
          res.write(`data: ${payload}\n\n`);
          if (flush) flush();
        }
        res.write('data: {"t":"done"}\n\n');
        if (flush) flush();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res.write(`data: ${JSON.stringify({ t: 'error', d: msg })}\n\n`);
      } finally {
        res.end();
      }
      return;
    }

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
