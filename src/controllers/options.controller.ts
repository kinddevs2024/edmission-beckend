import { Request, Response, NextFunction } from 'express';
import { ALLOWED_SKILLS, ALLOWED_INTERESTS, ALLOWED_HOBBIES } from '../constants/profileCriteria';
import * as settingsService from '../services/settings.service';
import * as studentService from '../services/student.service';

/** Public: returns maintenance mode so front can show maintenance page. */
export async function getPublicStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const settings = await settingsService.getSettings();
    res.json({ maintenanceMode: settings.maintenanceMode });
  } catch (e) {
    next(e);
  }
}

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

/** Public: countries where the platform has at least one catalog or verified university (student preferred destinations). */
export async function getUniversityHubCountries(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await studentService.getUniversityCountries();
    res.json({ data });
  } catch (e) {
    next(e);
  }
}
