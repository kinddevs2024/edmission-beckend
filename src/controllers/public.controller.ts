import { Request, Response, NextFunction } from 'express';
import * as publicService from '../services/public.service';

export async function getLandingCertificates(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await publicService.getLandingCertificates();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await publicService.getPublicStats();
    res.json(stats);
  } catch (e) {
    next(e);
  }
}

export async function getTrustedUniversityLogos(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const logos = await publicService.getTrustedUniversityLogos();
    res.json(logos);
  } catch (e) {
    next(e);
  }
}

export async function trackSiteVisit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = (req.body ?? {}) as { visitorId?: string; path?: string };
    await publicService.recordSiteVisit({
      visitorId: String(body.visitorId ?? ''),
      path: body.path,
      user: req.user ? { id: req.user.id, role: req.user.role } : null,
    });
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}
