import { Request, Response, NextFunction } from 'express';
import * as counsellorService from '../services/counsellor.service';

export async function getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const data = await counsellorService.getCounsellorProfile(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const data = await counsellorService.updateCounsellorProfile(req.user.id, {
      schoolName: body.schoolName,
      schoolDescription: body.schoolDescription,
      country: body.country,
      city: body.city,
      isPublic: body.isPublic,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function listSchools(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = (req.query && typeof req.query === 'object') ? req.query : {};
    const data = await counsellorService.listSchools({
      search: typeof query.search === 'string' ? query.search : undefined,
      page: typeof query.page === 'string' ? parseInt(query.page, 10) : undefined,
      limit: typeof query.limit === 'string' ? parseInt(query.limit, 10) : undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function createStudent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const data = await counsellorService.createStudentByCounsellor(req.user.id, body);
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function listMyStudents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const query = (req.query && typeof req.query === 'object') ? req.query : {};
    const data = await counsellorService.listMyStudents(req.user.id, {
      page: typeof query.page === 'string' ? parseInt(query.page, 10) : undefined,
      limit: typeof query.limit === 'string' ? parseInt(query.limit, 10) : undefined,
      search: typeof query.search === 'string' ? query.search : undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateMyStudent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const studentUserId = req.params.studentUserId;
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const data = await counsellorService.updateMyStudent(req.user.id, studentUserId, body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function deleteMyStudent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    await counsellorService.deleteMyStudent(req.user.id, req.params.studentUserId);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

export async function listJoinRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const query = (req.query && typeof req.query === 'object') ? req.query : {};
    const data = await counsellorService.listJoinRequests(req.user.id, {
      status: typeof query.status === 'string' ? query.status : undefined,
      page: typeof query.page === 'string' ? parseInt(query.page, 10) : undefined,
      limit: typeof query.limit === 'string' ? parseInt(query.limit, 10) : undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function acceptJoinRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    await counsellorService.acceptJoinRequest(req.user.id, req.params.requestId);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
}

export async function rejectJoinRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    await counsellorService.rejectJoinRequest(req.user.id, req.params.requestId);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
}

/** Add interest (application to university) on behalf of a student. */
export async function addInterestForStudent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const studentUserId = req.params.studentUserId;
    const universityId = req.params.universityId; // university profile id
    const data = await counsellorService.addInterestOnBehalfOfStudent(req.user.id, studentUserId, universityId);
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}
