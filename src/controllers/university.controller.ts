import { Request, Response, NextFunction } from 'express';
import * as universityService from '../services/university.service';

export async function getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await universityService.getProfile(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await universityService.updateProfile(req.user.id, req.body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await universityService.getDashboard(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getStudents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const { page, limit } = req.query;
    const data = await universityService.getStudents(req.user.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getPipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await universityService.getPipeline(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateInterest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const status = req.body.status as 'under_review' | 'chat_opened' | 'offer_sent' | 'rejected' | 'accepted';
    const data = await universityService.updateInterestStatus(req.user.id, req.params.id, status);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getScholarships(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await universityService.getScholarships(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function createScholarship(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await universityService.createScholarship(req.user.id, req.body);
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateScholarship(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await universityService.updateScholarship(req.user.id, req.params.id, req.body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function deleteScholarship(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    await universityService.deleteScholarship(req.user.id, req.params.id);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

export async function createOffer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const body = req.body as { studentId: string; scholarshipId?: string; coveragePercent: number; deadline?: string };
    const data = await universityService.createOffer(req.user.id, {
      ...body,
      deadline: body.deadline ? new Date(body.deadline) : undefined,
    });
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function getRecommendations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await universityService.getRecommendations(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}
