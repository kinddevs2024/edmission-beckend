import { Request, Response, NextFunction } from 'express';
import * as ticketService from '../services/ticket.service';

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const userId = req.user.id;
    const role = req.user!.role as 'student' | 'university';
    const { subject, message } = req.body;
    if (!subject?.trim() || !message?.trim()) {
      res.status(400).json({ message: 'Subject and message are required' });
      return;
    }
    const data = await ticketService.createTicket(userId, role, { subject, message });
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function getMyTickets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const { page, limit, status } = req.query;
    const data = await ticketService.getMyTickets(req.user.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status: status as string,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getTicket(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await ticketService.getTicketById(req.params.id, req.user!.id, false);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function addReply(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const { message } = req.body;
    if (!message?.trim()) {
      res.status(400).json({ message: 'Message is required' });
      return;
    }
    const data = await ticketService.addReply(req.params.id, req.user.id, req.user.role as 'student' | 'university', message, false);
    res.json(data);
  } catch (e) {
    next(e);
  }
}
