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
    const rawLimit = req.query.limit;
    const parsedLimit = rawLimit !== undefined && rawLimit !== null && String(rawLimit) !== '' ? Number(rawLimit) : 25;
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 25;
    const rawOffset = req.query.offset;
    const parsedOffset = rawOffset !== undefined && rawOffset !== null && String(rawOffset) !== '' ? Number(rawOffset) : 0;
    const offset = Number.isFinite(parsedOffset) ? parsedOffset : 0;
    const logos = await publicService.getTrustedUniversityLogos({ limit, offset });
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
