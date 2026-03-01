import mongoose from 'mongoose';
import { Request, Response, NextFunction } from 'express';
import * as adminService from '../services/admin.service';

export async function getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getDashboard();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, role } = req.query;
    const data = await adminService.getUsers({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      role: role as string,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function suspendUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const suspend = req.body.suspend !== false;
    const data = await adminService.suspendUser(req.params.id, suspend);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getVerificationQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getVerificationQueue();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function verifyUniversity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const approve = req.body.approve !== false;
    const data = await adminService.verifyUniversity(req.params.id, approve);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getScholarships(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getScholarshipsMonitor();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, userId, action } = req.query;
    const data = await adminService.getLogs({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      userId: userId as string,
      action: action as string,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getHealth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database not connected');
    }
    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    next(e);
  }
}

export async function getSubscriptions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, role, plan, status } = req.query;
    const data = await adminService.getSubscriptions({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      role: role as string,
      plan: plan as string,
      status: status as string,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getSubscriptionByUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getSubscriptionByUser(req.params.userId);
    if (!data) {
      res.status(404).json({ message: 'Subscription not found' });
      return;
    }
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { plan, status, trialEndsAt, currentPeriodEnd } = req.body;
    const data = await adminService.updateUserSubscription(req.params.userId, {
      plan,
      status,
      trialEndsAt: trialEndsAt != null ? new Date(trialEndsAt) : undefined,
      currentPeriodEnd: currentPeriodEnd != null ? new Date(currentPeriodEnd) : undefined,
    });
    if (!data) {
      res.status(404).json({ message: 'Subscription not found' });
      return;
    }
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getTickets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, status, role } = req.query;
    const data = await adminService.getTickets({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status: status as string,
      role: role as string,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getTicket(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getTicketById(req.params.id, req.user!.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateTicketStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status } = req.body;
    if (!status) {
      res.status(400).json({ message: 'Status is required' });
      return;
    }
    const data = await adminService.updateTicketStatus(req.params.id, status);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function addTicketReply(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { message } = req.body;
    if (!message?.trim()) {
      res.status(400).json({ message: 'Message is required' });
      return;
    }
    const data = await adminService.addTicketReply(req.params.id, req.user!.id, message);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getPendingDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getPendingDocuments();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function reviewDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { decision, rejectionReason } = req.body;
    if (decision !== 'approved' && decision !== 'rejected') {
      res.status(400).json({ message: 'decision must be approved or rejected' });
      return;
    }
    const data = await adminService.reviewDocument(req.params.id, req.user!.id, decision, rejectionReason);
    res.json(data);
  } catch (e) {
    next(e);
  }
}
