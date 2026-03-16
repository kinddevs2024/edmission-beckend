import { Request, Response, NextFunction } from 'express';
import * as universityService from '../services/university.service';
import * as facultyService from '../services/faculty.service';

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
    const { page, limit, skills, interests, hobbies, country, city, languages, certType, certMinScore, minBudget, maxBudget, useProfileFilters } = req.query;
    const useProfile = useProfileFilters === undefined || useProfileFilters === '1' || useProfileFilters === 'true';
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
      minBudget: minBudget != null ? Number(minBudget) : undefined,
      maxBudget: maxBudget != null ? Number(maxBudget) : undefined,
      useProfileFilters: useProfile,
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
    const body = req.body as {
      studentId: string;
      scholarshipId?: string;
      coveragePercent: number;
      deadline?: string;
      certificateTemplateId?: string;
      certificateData?: Record<string, string>;
    };
    const data = await universityService.createOffer(req.user.id, {
      ...body,
      deadline: body.deadline ? new Date(body.deadline) : undefined,
    });
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function listOfferTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await universityService.listOfferTemplates(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function createOfferTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await universityService.createOfferTemplate(req.user.id, req.body);
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateOfferTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await universityService.updateOfferTemplate(req.user.id, req.params.id, req.body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function deleteOfferTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    await universityService.deleteOfferTemplate(req.user.id, req.params.id);
    res.status(204).send();
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

export async function getFaculties(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await facultyService.getFaculties(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getFacultyById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await facultyService.getFacultyById(req.user.id, req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function createFaculty(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const body = req.body as { name?: string; description?: string; order?: number };
    const data = await facultyService.createFaculty(req.user.id, {
      name: body.name ?? '',
      description: body.description ?? '',
      order: body.order,
    });
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateFaculty(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await facultyService.updateFaculty(req.user.id, req.params.id, req.body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function deleteFaculty(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    await facultyService.deleteFaculty(req.user.id, req.params.id);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

export async function getCatalog(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { search, country } = req.query;
    const data = await universityService.getCatalogUniversities({
      search: typeof search === 'string' ? search : undefined,
      country: typeof country === 'string' ? country : undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function createVerificationRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const body = req.body as { universityId?: string; universityCatalogId?: string; universityName?: string; establishedYear?: number };
    const universityId = body.universityId ?? body.universityCatalogId;
    if (universityId) {
      const data = await universityService.createVerificationRequest(req.user.id, universityId);
      res.status(201).json(data);
      return;
    }
    if (body.universityName != null && String(body.universityName).trim() !== '') {
      const data = await universityService.createVerificationRequest(req.user.id, {
        universityName: String(body.universityName).trim(),
        establishedYear: body.establishedYear != null ? Number(body.establishedYear) : undefined,
      });
      res.status(201).json(data);
      return;
    }
    res.status(400).json({ message: 'universityId or universityName required' });
  } catch (e) {
    next(e);
  }
}
