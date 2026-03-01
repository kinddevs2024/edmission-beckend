import { Request, Response, NextFunction } from 'express';
import * as chatService from '../services/chat.service';
import { getIO } from '../socket';

export async function createChat(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const body = (req.body || {}) as { studentId?: string; universityId?: string };
    const result = await chatService.getOrCreateChatForUser(req.user.id, body);
    const formatted = await chatService.getOneChatFormatted(String(result.chatId), req.user.id);
    res.status(201).json(formatted);
  } catch (e) {
    next(e);
  }
}

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

export async function sendMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const body = (req.body || {}) as { text?: string; type?: string; attachmentUrl?: string; metadata?: Record<string, unknown> };
    const params =
      body.type === 'voice' || body.type === 'emotion' || body.type === 'system'
        ? { type: body.type as 'voice' | 'emotion' | 'system', text: body.text, attachmentUrl: body.attachmentUrl, metadata: body.metadata }
        : (body.text ?? '').trim();
    const result = await chatService.saveMessage(req.params.chatId, req.user.id, params);
    const msg = result.message as Record<string, unknown>;
    const id = msg._id != null ? String(msg._id) : msg.id;
    const payload = {
      ...msg,
      id,
      text: msg.message ?? msg.text ?? '',
      type: msg.type ?? 'text',
      attachmentUrl: msg.attachmentUrl,
      metadata: msg.metadata,
    };
    const io = getIO();
    if (io) io.to(`chat:${req.params.chatId}`).emit('new_message', { chatId: req.params.chatId, message: payload });
    res.status(201).json(payload);
  } catch (e) {
    next(e);
  }
}

export async function acceptStudent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const body = (req.body || {}) as { positionType?: string; positionLabel?: string; congratulatoryMessage?: string };
    const positionType = (body.positionType === 'budget' || body.positionType === 'grant' || body.positionType === 'other')
      ? body.positionType
      : 'other';
    const result = await chatService.acceptStudent(req.params.chatId, req.user.id, {
      positionType,
      positionLabel: body.positionLabel,
      congratulatoryMessage: body.congratulatoryMessage ?? '',
    });
    const msg = result.message as Record<string, unknown>;
    const messagePayload = { ...msg, id: msg.id ?? msg._id, text: msg.message ?? msg.text };
    const io = getIO();
    if (io) io.to(`chat:${req.params.chatId}`).emit('new_message', { chatId: req.params.chatId, message: messagePayload });
    res.status(201).json({
      message: messagePayload,
      chat: result.chat,
    });
  } catch (e) {
    next(e);
  }
}
