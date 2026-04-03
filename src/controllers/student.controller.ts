import { Request, Response, NextFunction } from 'express';
import * as studentService from '../services/student.service';
import * as studentDocumentService from '../services/studentDocument.service';
import * as counsellorService from '../services/counsellor.service';

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
    const {
      page,
      limit,
      country,
      search,
      sort,
      hasScholarship,
      facultyCodes,
      degreeLevels,
      programLanguages,
      targetStudentCountries,
      minTuition,
      maxTuition,
      minEstablishedYear,
      maxEstablishedYear,
      minStudentCount,
      maxStudentCount,
      requirementsQuery,
      programQuery,
      useProfileFilters,
    } = req.query;
    const useProfile = useProfileFilters === undefined || useProfileFilters === '1' || useProfileFilters === 'true';
    const data = await studentService.getUniversities(req.user.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      country: typeof country === 'string' ? country : undefined,
      search: typeof search === 'string' ? search : undefined,
      sort: typeof sort === 'string' ? sort : undefined,
      hasScholarship: hasScholarship === '1' || hasScholarship === 'true' ? true : undefined,
      facultyCodes: splitCsvParam(facultyCodes),
      degreeLevels: splitCsvParam(degreeLevels),
      programLanguages: splitCsvParam(programLanguages),
      targetStudentCountries: splitCsvParam(targetStudentCountries),
      minTuition: typeof minTuition === 'string' && minTuition.trim() ? Number(minTuition) : undefined,
      maxTuition: typeof maxTuition === 'string' && maxTuition.trim() ? Number(maxTuition) : undefined,
      minEstablishedYear: typeof minEstablishedYear === 'string' && minEstablishedYear.trim() ? Number(minEstablishedYear) : undefined,
      maxEstablishedYear: typeof maxEstablishedYear === 'string' && maxEstablishedYear.trim() ? Number(maxEstablishedYear) : undefined,
      minStudentCount: typeof minStudentCount === 'string' && minStudentCount.trim() ? Number(minStudentCount) : undefined,
      maxStudentCount: typeof maxStudentCount === 'string' && maxStudentCount.trim() ? Number(maxStudentCount) : undefined,
      requirementsQuery: typeof requirementsQuery === 'string' ? requirementsQuery : undefined,
      programQuery: typeof programQuery === 'string' ? programQuery : undefined,
      useProfileFilters: useProfile,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getUniversityCountries(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await studentService.getUniversityCountries();
    res.json({ data });
  } catch (e) {
    next(e);
  }
}

function splitCsvParam(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  const list = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
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

export async function getUniversityFlyers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await studentService.getUniversityFlyers(req.user.id, req.params.id);
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

export async function getInterestLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await studentService.getInterestLimit(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getInterestedUniversityIds(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const ids = await studentService.getInterestedUniversityIds(req.user.id);
    res.json({ ids });
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

export async function waitOnOffer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await studentService.waitOnOffer(req.user.id, req.params.id);
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

export async function addDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await studentDocumentService.addDocument(req.user.id, req.body);
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function getMyDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await studentDocumentService.getMyDocuments(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await studentDocumentService.updateDocument(req.user.id, req.params.id, req.body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function deleteDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    await studentDocumentService.deleteDocument(req.user.id, req.params.id);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

/** List schools (counsellors with public profile) for student to request to join. */
export async function listSchools(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = (req.query && typeof req.query === 'object') ? req.query : {};
    const data = await counsellorService.listSchools({
      search: typeof query.search === 'string' ? query.search : undefined,
      page: typeof query.page === 'string' ? parseInt(query.page, 10) : undefined,
      limit: typeof query.limit === 'string' ? parseInt(query.limit, 10) : undefined,
      studentUserId: req.user?.id,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

/** Request to join a school (link to school counsellor). */
export async function requestToJoinSchool(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const counsellorUserId = req.params.counsellorUserId;
    await counsellorService.requestToJoinSchool(req.user.id, counsellorUserId);
    res.json({ success: true, message: 'Request sent' });
  } catch (e) {
    next(e);
  }
}

/** List pending school invitations (schools that invited this student). */
export async function listSchoolInvitations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const data = await counsellorService.listSchoolInvitationsForStudent(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

/** Accept a school invitation. */
export async function acceptSchoolInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const data = await counsellorService.acceptSchoolInvitation(req.user.id, req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

/** Decline a school invitation. */
export async function declineSchoolInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const data = await counsellorService.declineSchoolInvitation(req.user.id, req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}
