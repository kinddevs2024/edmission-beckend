import { Request, Response, NextFunction } from 'express';
import * as counsellorService from '../services/counsellor.service';

function parseQueryNumber(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  return undefined
}

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
      page: parseQueryNumber(query.page),
      limit: parseQueryNumber(query.limit),
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

export async function getStudentProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const data = await counsellorService.getStudentProfile(req.user.id, req.params.studentUserId);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getStudentUniversities(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const query = (req.query && typeof req.query === 'object') ? req.query : {};
    const rawUseProfile = query.useProfileFilters;
    const useProfileFilters =
      rawUseProfile === undefined
        ? undefined
        : rawUseProfile === '1' || rawUseProfile === 'true';

    const data = await counsellorService.getStudentUniversities(req.user.id, req.params.studentUserId, {
      page: parseQueryNumber(query.page),
      limit: parseQueryNumber(query.limit),
      country: typeof query.country === 'string' ? query.country : undefined,
      city: typeof query.city === 'string' ? query.city : undefined,
      useProfileFilters,
    });
    res.json(data);
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
      page: parseQueryNumber(query.page),
      limit: parseQueryNumber(query.limit),
      search: typeof query.search === 'string' ? query.search : undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function downloadStudentsTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const buffer = counsellorService.getCounsellorStudentsExcelTemplateBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="counsellor_students_template.xlsx"');
    res.send(buffer);
  } catch (e) {
    next(e);
  }
}

export async function downloadStudentsExcel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const buffer = await counsellorService.getCounsellorStudentsExcelExportBuffer(req.user.id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="my_students.xlsx"');
    res.send(buffer);
  } catch (e) {
    next(e);
  }
}

export async function uploadStudentsExcel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    if (!req.file?.buffer) {
      res.status(400).json({ message: 'No file uploaded. Use form field "file" with an .xlsx file.' });
      return;
    }
    const result = await counsellorService.importCounsellorStudentsFromExcel(req.user.id, req.file.buffer);
    res.status(200).json(result);
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

export async function generateTempPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const data = await counsellorService.generateTempPasswordForStudent(req.user.id, req.params.studentUserId);
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

export async function listMyApplications(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const query = (req.query && typeof req.query === 'object') ? req.query : {};
    const data = await counsellorService.listMyApplications(req.user.id, {
      page: typeof query.page === 'string' ? parseInt(query.page, 10) : undefined,
      limit: typeof query.limit === 'string' ? parseInt(query.limit, 10) : undefined,
      status: typeof query.status === 'string' ? query.status : undefined,
      studentUserId: typeof query.studentUserId === 'string' ? query.studentUserId : undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function listMyOffers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const query = (req.query && typeof req.query === 'object') ? req.query : {};
    const data = await counsellorService.listMyOffers(req.user.id, {
      page: typeof query.page === 'string' ? parseInt(query.page, 10) : undefined,
      limit: typeof query.limit === 'string' ? parseInt(query.limit, 10) : undefined,
      status: typeof query.status === 'string' ? query.status : undefined,
      type: typeof query.type === 'string' ? query.type : undefined,
      studentUserId: typeof query.studentUserId === 'string' ? query.studentUserId : undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

/** Search existing students (not in my school) for invite. */
export async function searchStudentsForInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const query = (req.query && typeof req.query === 'object') ? req.query : {};
    const data = await counsellorService.searchStudentsForInvite(req.user.id, {
      search: typeof query.search === 'string' ? query.search : '',
      limit: typeof query.limit === 'string' ? parseInt(query.limit, 10) : undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

/** Invite existing student to my school. Sends request; student must accept or decline. */
export async function inviteStudent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const userId = (req.body && typeof req.body === 'object' && req.body.userId) ? req.body.userId : '';
    const data = await counsellorService.inviteStudentToSchool(req.user.id, userId);
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

/** List invitations I sent (pending = awaiting response; accepted/declined = already responded). */
export async function listMyInvitations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const query = (req.query && typeof req.query === 'object') ? req.query : {};
    const data = await counsellorService.listMyInvitations(req.user.id, {
      status: (query.status === 'pending' || query.status === 'accepted' || query.status === 'declined') ? query.status : undefined,
      page: typeof query.page === 'string' ? parseInt(query.page, 10) : undefined,
      limit: typeof query.limit === 'string' ? parseInt(query.limit, 10) : undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

/** Cancel a pending school invitation. */
export async function cancelSchoolInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    await counsellorService.cancelSchoolInvitation(req.user.id, req.params.invitationId);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
}

/** List documents of a student. */
export async function getStudentDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const data = await counsellorService.getStudentDocuments(req.user.id, req.params.studentUserId);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

/** Add document for a student (approved by default). */
export async function addStudentDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const data = await counsellorService.addDocumentForStudent(req.user.id, req.params.studentUserId, {
      type: body.type,
      source: body.source,
      fileUrl: body.fileUrl,
      name: body.name,
      certificateType: body.certificateType,
      score: body.score,
      previewImageUrl: body.previewImageUrl,
      canvasJson: body.canvasJson,
      pageFormat: body.pageFormat,
      width: body.width,
      height: body.height,
      editorVersion: body.editorVersion,
    });
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

/** Update document of a student. */
export async function updateStudentDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const data = await counsellorService.updateDocumentForStudent(
      req.user.id,
      req.params.studentUserId,
      req.params.documentId,
      {
        type: body.type,
        source: body.source,
        fileUrl: body.fileUrl,
        name: body.name,
        certificateType: body.certificateType,
        score: body.score,
        previewImageUrl: body.previewImageUrl,
        canvasJson: body.canvasJson,
        pageFormat: body.pageFormat,
        width: body.width,
        height: body.height,
        editorVersion: body.editorVersion,
      }
    );
    res.json(data);
  } catch (e) {
    next(e);
  }
}

/** Delete a document of a student. */
export async function deleteStudentDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    await counsellorService.deleteDocumentForStudent(req.user.id, req.params.studentUserId, req.params.documentId);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}
