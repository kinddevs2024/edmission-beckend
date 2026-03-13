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
