import { Request, Response, NextFunction } from 'express';
import * as searchService from '../services/search.service';

export async function search(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const role = (req.user as { role?: string })?.role ?? 'student';
    const userId = (req.user as { id?: string })?.id;
    const data = await searchService.globalSearch(q, role, userId);
    res.json(data);
  } catch (e) {
    next(e);
  }
}
