import { Request, Response, NextFunction } from 'express';
import { ALLOWED_SKILLS, ALLOWED_INTERESTS, ALLOWED_HOBBIES } from '../constants/profileCriteria';

export async function getProfileCriteria(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({
      skills: [...ALLOWED_SKILLS],
      interests: [...ALLOWED_INTERESTS],
      hobbies: [...ALLOWED_HOBBIES],
    });
  } catch (e) {
    next(e);
  }
}
