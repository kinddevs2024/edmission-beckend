import { Request, Response, NextFunction } from 'express';
import * as studentService from '../services/student.service';

export async function getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await studentService.getProfile(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await studentService.updateProfile(req.user.id, req.body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await studentService.getDashboard(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getUniversities(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const { page, limit, country } = req.query;
    const data = await studentService.getUniversities(req.user.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      country: country as string,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getUniversityById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await studentService.getUniversityById(req.user.id, req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function addInterest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await studentService.addInterest(req.user.id, req.params.id);
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function getApplications(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await studentService.getApplications(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getOffers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await studentService.getOffers(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function acceptOffer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await studentService.acceptOffer(req.user.id, req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function declineOffer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await studentService.declineOffer(req.user.id, req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getRecommendations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await studentService.getRecommendations(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getCompare(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const ids = (req.query.ids as string)?.split(',').filter(Boolean) || [];
    const data = await studentService.getCompare(req.user.id, ids);
    res.json(data);
  } catch (e) {
    next(e);
  }
}
