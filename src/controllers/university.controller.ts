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

export async function getStudentProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const studentId = req.params.studentId as string;
    const data = await universityService.getStudentProfileForUniversity(req.user.id, studentId);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getStudents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const { page, limit, skills, interests, hobbies, country, city, languages, certType, certMinScore } = req.query;
    const toArray = (v: unknown): string[] =>
      v == null ? [] : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : Array.isArray(v) ? v.map(String) : [];
    const data = await universityService.getStudents(req.user.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      skills: toArray(skills),
      interests: toArray(interests),
      hobbies: toArray(hobbies),
      country: typeof country === 'string' ? country : undefined,
      city: typeof city === 'string' ? city : undefined,
      languages: toArray(languages),
      certType: typeof certType === 'string' ? certType : undefined,
      certMinScore: typeof certMinScore === 'string' ? certMinScore : undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getFunnelAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await universityService.getFunnelAnalytics(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getPipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const { skills, interests, hobbies } = req.query;
    const toArray = (v: unknown): string[] =>
      v == null ? [] : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : Array.isArray(v) ? v.map(String) : [];
    const data = await universityService.getPipeline(req.user.id, {
      skills: toArray(skills),
      interests: toArray(interests),
      hobbies: toArray(hobbies),
    });
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
    const body = req.body as { name?: string; coveragePercent?: number; maxSlots?: number; deadline?: string; eligibility?: string };
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : '';
    const coveragePercent = typeof body.coveragePercent === 'number' ? body.coveragePercent : NaN;
    const maxSlots = typeof body.maxSlots === 'number' ? body.maxSlots : NaN;
    if (!name || Number.isNaN(coveragePercent) || Number.isNaN(maxSlots)) {
      res.status(400).json({ message: 'name, coveragePercent and maxSlots are required' });
      return;
    }
    const payload = {
      name,
      coveragePercent,
      maxSlots,
      deadline: body.deadline ? new Date(body.deadline) : undefined,
      eligibility: typeof body.eligibility === 'string' ? body.eligibility : undefined,
    };
    const data = await universityService.createScholarship(req.user.id, payload);
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
