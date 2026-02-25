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
