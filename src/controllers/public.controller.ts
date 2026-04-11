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

export async function getTrustedUniversityLogos(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as { limit?: number; offset?: number };
    const limit = q.limit ?? 25;
    const offset = q.offset ?? 0;
    const logos = await publicService.getTrustedUniversityLogos({ limit, offset });
    res.json(logos);
  } catch (e) {
    next(e);
  }
}

export async function trackSiteVisit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { visitorId: string; path?: string };
    await publicService.recordSiteVisit({
      visitorId: body.visitorId,
      path: body.path,
      user: req.user ? { id: req.user.id, role: req.user.role } : null,
    });
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}
