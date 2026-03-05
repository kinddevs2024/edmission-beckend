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

export async function createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { role?: string; email?: string; password?: string; name?: string };
    const data = await adminService.createUser({
      role: body.role as 'student' | 'university' | 'admin',
      email: body.email ?? '',
      password: body.password ?? '',
      name: body.name,
    });
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function getUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getUserById(req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { name?: string; emailVerified?: boolean; suspended?: boolean };
    const data = await adminService.updateUser(req.params.id, body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.deleteUser(req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function resetUserPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { password?: string };
    const pwd = body.password ?? '';
    const data = await adminService.resetUserPassword(req.params.id, pwd);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getStudentProfileByUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getStudentProfileByUserId(req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateStudentProfileByUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.updateStudentProfileByUserId(req.params.id, req.body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getUniversityProfileByUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getUniversityProfileByUserId(req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateUniversityProfileByUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.updateUniversityProfileByUserId(req.params.id, req.body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getOffers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, status } = req.query;
    const data = await adminService.listOffers({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status: status as string,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateOfferStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { status?: 'pending' | 'accepted' | 'declined' };
    const data = await adminService.updateOfferStatus(req.params.id, body.status as 'pending' | 'accepted' | 'declined');
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getInterests(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, status } = req.query;
    const data = await adminService.listInterests({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status: status as string,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateInterestStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { status?: string };
    const data = await adminService.updateInterestStatus(req.params.id, String(body.status ?? ''));
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getChats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit } = req.query;
    const data = await adminService.listChats({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getChatMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { limit } = req.query;
    const data = await adminService.getChatMessages(req.params.id, { limit: limit ? Number(limit) : undefined });
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
    const raw = req.body.approve;
    const approve = raw === true || raw === 'true';
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
