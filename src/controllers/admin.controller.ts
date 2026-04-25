import mongoose from 'mongoose';
import { Request, Response, NextFunction } from 'express';
import * as adminService from '../services/admin.service';
import * as globalFacultyService from '../services/globalFaculty.service';
import * as settingsService from '../services/settings.service';
import * as documentsService from '../services/documents.service';
import * as universityService from '../services/university.service';

export async function getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getDashboard();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getUniversityInterestAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = req.query.limit ? Math.min(50, Math.max(1, Number(req.query.limit))) : 20;
    const data = await adminService.getUniversityInterestAnalytics(limit);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getAnalyticsOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { from, to } = req.query;
    const data = await adminService.getAnalyticsOverview({
      from: from as string | undefined,
      to: to as string | undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, role, status, search } = req.query;
    const data = await adminService.getUsers({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      role: role as string,
      status: status as string,
      search: typeof search === 'string' ? search : undefined,
    }, req.user);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { role?: string; email?: string; password?: string; name?: string };
    const data = await adminService.createUser({
      role: body.role as
        | 'student'
        | 'university'
        | 'university_multi_manager'
        | 'admin'
        | 'school_counsellor'
        | 'counsellor_coordinator'
        | 'manager',
      email: body.email ?? '',
      password: body.password ?? '',
      name: body.name,
    }, req.user);
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function getUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getUserById(req.params.id, req.user);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as {
      name?: string;
      role?:
        | 'student'
        | 'university'
        | 'university_multi_manager'
        | 'admin'
        | 'school_counsellor'
        | 'counsellor_coordinator'
        | 'manager';
      emailVerified?: boolean;
      suspended?: boolean;
      managedUniversityUserIds?: string[];
      universityMultiManagerApproved?: boolean;
    };
    const data = await adminService.updateUser(req.params.id, body, req.user);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.deleteUser(req.params.id, req.user);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function resetUserPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { password?: string };
    const pwd = body.password ?? '';
    const data = await adminService.resetUserPassword(req.params.id, pwd, req.user);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function downloadUsersTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const buffer = adminService.getUsersExcelTemplateBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="users_template.xlsx"');
    res.send(buffer);
  } catch (e) {
    next(e);
  }
}

export async function downloadAllUsersExcel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const buffer = await adminService.getUsersExcelExportBuffer(req.user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="users_export.xlsx"');
    res.send(buffer);
  } catch (e) {
    next(e);
  }
}

export async function previewUsersExcel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file?.buffer) {
      res.status(400).json({ message: 'No file uploaded. Use form field "file" with an .xlsx file.' });
      return;
    }
    const result = await adminService.previewUsersExcelImport(req.file.buffer, req.user);
    res.status(200).json(result);
  } catch (e) {
    next(e);
  }
}

export async function uploadUsersExcel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file?.buffer) {
      res.status(400).json({ message: 'No file uploaded. Use form field "file" with an .xlsx file.' });
      return;
    }
    const result = await adminService.importUsersFromExcel(req.file.buffer, req.user);
    res.status(200).json(result);
  } catch (e) {
    next(e);
  }
}

export async function getStudentProfileByUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getStudentProfileByUserId(req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateStudentProfileByUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.updateStudentProfileByUserId(req.params.id, req.body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getUniversityProfileByUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getUniversityProfileByUserId(req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateUniversityProfileByUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.updateUniversityProfileByUserId(req.params.id, req.body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getStudentDocumentsByUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getStudentDocumentsByUserId(req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function addStudentDocumentByUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
    const data = await adminService.addStudentDocumentByUserId(req.params.id, {
      type: String(body.type ?? ''),
      source: body.source as 'upload' | 'editor' | undefined,
      fileUrl: body.fileUrl as string | undefined,
      name: body.name as string | undefined,
      certificateType: body.certificateType as string | undefined,
      score: body.score as string | undefined,
      previewImageUrl: body.previewImageUrl as string | undefined,
      canvasJson: body.canvasJson as string | undefined,
      pageFormat: body.pageFormat as 'A4_PORTRAIT' | 'A4_LANDSCAPE' | 'LETTER' | 'CUSTOM' | undefined,
      width: body.width as number | undefined,
      height: body.height as number | undefined,
      editorVersion: body.editorVersion as string | undefined,
    });
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function deleteStudentDocumentByUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await adminService.deleteStudentDocumentByUserId(req.params.id, req.params.documentId);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

export async function getOffers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, status } = req.query;
    const data = await adminService.listOffers({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status: status as string,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateOfferStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { status?: 'pending' | 'accepted' | 'declined' };
    const data = await adminService.updateOfferStatus(req.params.id, body.status as 'pending' | 'accepted' | 'declined');
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getInterests(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, status } = req.query;
    const data = await adminService.listInterests({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status: status as string,
    }, req.user);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateInterestStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { status?: string };
    const data = await adminService.updateInterestStatus(req.params.id, String(body.status ?? ''));
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function openInterestChat(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.openInterestChat(req.params.id);
    res.status(200).json(data);
  } catch (e) {
    next(e);
  }
}

export async function getChats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, universityId } = req.query;
    const data = await adminService.listChats({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      universityId: typeof universityId === 'string' ? universityId : undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getChatMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { limit } = req.query;
    const data = await adminService.getChatMessages(req.params.id, { limit: limit ? Number(limit) : undefined });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function sendChatMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const body = (req.body || {}) as { text?: string };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      res.status(400).json({ error: 'Text is required' });
      return;
    }
    const result = await adminService.sendChatMessageAsUniversity(req.params.id, req.user.id, text);
    const msg = result.message as Record<string, unknown>;
    const payload = {
      ...msg,
      id: msg.id ?? msg._id,
      text: msg.message ?? msg.text ?? '',
    };
    const { getIO } = await import('../socket');
    const io = getIO();
    if (io) io.to(`chat:${req.params.id}`).emit('new_message', { chatId: req.params.id, message: payload });
    res.status(201).json(payload);
  } catch (e) {
    next(e);
  }
}

export async function sendTelegramMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = (req.body || {}) as {
      userIds?: string[];
      chatIds?: string[];
      text?: string;
      parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
    };
    const result = await adminService.sendTelegramMessage({
      userIds: body.userIds,
      chatIds: body.chatIds,
      text: String(body.text ?? ''),
      parseMode: body.parseMode,
    });
    res.status(200).json(result);
  } catch (e) {
    next(e);
  }
}

export async function suspendUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const suspend = req.body.suspend !== false;
    const data = await adminService.suspendUser(req.params.id, suspend, req.user);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getVerificationQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getVerificationQueue();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function verifyUniversity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = req.body.approve;
    const approve = raw === true || raw === 'true';
    const data = await adminService.verifyUniversity(req.params.id, approve);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getScholarships(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getScholarshipsMonitor();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, userId, type } = req.query;
    const data = await adminService.getLogs({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      userId: userId as string,
      action: type as string, // frontend sends "type", ActivityLog uses "action"
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getHealth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database not connected');
    }
    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    next(e);
  }
}

export async function getSubscriptions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, role, plan, status } = req.query;
    const data = await adminService.getSubscriptions({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      role: role as string,
      plan: plan as string,
      status: status as string,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getSubscriptionByUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getSubscriptionByUser(req.params.userId);
    if (!data) {
      res.status(404).json({ message: 'Subscription not found' });
      return;
    }
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { plan, status, trialEndsAt, currentPeriodEnd } = req.body;
    const data = await adminService.updateUserSubscription(req.params.userId, {
      plan,
      status,
      trialEndsAt: trialEndsAt != null ? new Date(trialEndsAt) : undefined,
      currentPeriodEnd: currentPeriodEnd != null ? new Date(currentPeriodEnd) : undefined,
    });
    if (!data) {
      res.status(404).json({ message: 'Subscription not found' });
      return;
    }
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getTickets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, status, role } = req.query;
    const data = await adminService.getTickets({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status: status as string,
      role: role as string,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getTicket(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getTicketById(req.params.id, req.user!.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateTicketStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status } = req.body;
    if (!status) {
      res.status(400).json({ message: 'Status is required' });
      return;
    }
    const data = await adminService.updateTicketStatus(req.params.id, status);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function addTicketReply(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { message } = req.body;
    if (!message?.trim()) {
      res.status(400).json({ message: 'Message is required' });
      return;
    }
    const data = await adminService.addTicketReply(req.params.id, req.user!.id, message);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getPendingDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getPendingDocuments();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function listAdminStudentDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = req.query.status as string | undefined;
    const status =
      raw === 'approved' || raw === 'rejected' || raw === 'all' || raw === 'pending' ? raw : 'pending';
    const data = await adminService.listAdminStudentDocuments(status);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function reviewDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { decision, rejectionReason } = req.body;
    if (decision !== 'approved' && decision !== 'rejected') {
      res.status(400).json({ message: 'decision must be approved or rejected' });
      return;
    }
    const data = await adminService.reviewDocument(req.params.id, req.user!.id, decision, rejectionReason);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

// ——— University catalog & verification requests ———

export async function getCatalogUniversities(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, search } = req.query;
    const data = await adminService.getCatalogUniversities({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search: search as string,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getGlobalFaculties(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await globalFacultyService.listGlobalFaculties();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function createGlobalFaculty(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await globalFacultyService.createGlobalFaculty(req.body);
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateGlobalFaculty(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await globalFacultyService.updateGlobalFaculty(req.params.id, req.body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function deleteGlobalFaculty(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await globalFacultyService.deleteGlobalFaculty(req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function createCatalogUniversity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.createCatalogUniversity(req.body);
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function downloadUniversitiesTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const buffer = adminService.getUniversitiesExcelTemplateBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="universities_template.xlsx"');
    res.send(buffer);
  } catch (e) {
    next(e);
  }
}

export async function downloadAllUniversitiesExcel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const buffer = await adminService.getUniversitiesExcelExportBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="universities_export.xlsx"');
    res.send(buffer);
  } catch (e) {
    next(e);
  }
}

export async function previewUniversitiesExcel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file?.buffer) {
      res.status(400).json({ message: 'No file uploaded. Use form field "file" with an .xlsx file.' });
      return;
    }
    const result = await adminService.previewUniversitiesExcelImport(req.file.buffer);
    res.status(200).json(result);
  } catch (e) {
    next(e);
  }
}

export async function uploadUniversitiesExcel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file?.buffer) {
      res.status(400).json({ message: 'No file uploaded. Use form field "file" with an .xlsx file.' });
      return;
    }
    const result = await adminService.importUniversitiesFromExcel(req.file.buffer);
    res.status(200).json(result);
  } catch (e) {
    next(e);
  }
}

export async function getCatalogUniversity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getCatalogUniversityById(req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateCatalogUniversity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.updateCatalogUniversity(req.params.id, req.body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function deleteCatalogUniversity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.deleteCatalogUniversity(req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getUniversityVerificationRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status } = req.query;
    const data = await adminService.getUniversityVerificationRequests({ status: status as string });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function approveUniversityRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await adminService.approveUniversityRequest(req.params.id, req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function rejectUniversityRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await adminService.rejectUniversityRequest(req.params.id, req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

// ——— Investors ———

export async function getInvestors(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.getInvestors();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function createInvestor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { name?: string; logoUrl?: string; websiteUrl?: string; description?: string; order?: number };
    const data = await adminService.createInvestor({
      name: body.name ?? '',
      logoUrl: body.logoUrl,
      websiteUrl: body.websiteUrl,
      description: body.description,
      order: body.order,
    });
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function deleteInvestor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.deleteInvestor(req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

// ——— System settings (admin only) ———

export async function getSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await settingsService.getSettings();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { requireAccountConfirmation?: boolean; requireEmailVerification?: boolean; maintenanceMode?: boolean };
    const data = await settingsService.updateSettings(body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

// ——— Landing Certificates ———

export async function listLandingCertificates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.listLandingCertificates();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function createLandingCertificate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { type: 'university' | 'student'; title: string; imageUrl: string; order?: number };
    const data = await adminService.createLandingCertificate(body);
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function updateLandingCertificate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { type?: 'university' | 'student'; title?: string; imageUrl?: string; order?: number };
    const data = await adminService.updateLandingCertificate(req.params.id, body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function deleteLandingCertificate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await adminService.deleteLandingCertificate(req.params.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

// ——— Admin acting as a university (document templates, issued docs, offers) ———

const uniUserIdParam = 'universityUserId';

export async function adminUniListDocumentTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const universityUserId = req.params[uniUserIdParam];
    await adminService.assertUniversityUserAccount(universityUserId);
    const data = await documentsService.listTemplates(universityUserId, {
      type: req.query.type as 'offer' | 'scholarship' | undefined,
      status: req.query.status as 'draft' | 'active' | 'archived' | undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function adminUniGetDocumentTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const universityUserId = req.params[uniUserIdParam];
    await adminService.assertUniversityUserAccount(universityUserId);
    const data = await documentsService.getTemplate(universityUserId, req.params.templateId);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function adminUniCreateDocumentTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const universityUserId = req.params[uniUserIdParam];
    await adminService.assertUniversityUserAccount(universityUserId);
    const data = await documentsService.createTemplate(universityUserId, req.body);
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function adminUniUpdateDocumentTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const universityUserId = req.params[uniUserIdParam];
    await adminService.assertUniversityUserAccount(universityUserId);
    const data = await documentsService.updateTemplate(universityUserId, req.params.templateId, req.body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function adminUniDeleteDocumentTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const universityUserId = req.params[uniUserIdParam];
    await adminService.assertUniversityUserAccount(universityUserId);
    await documentsService.deleteTemplate(universityUserId, req.params.templateId);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

export async function adminUniDuplicateDocumentTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const universityUserId = req.params[uniUserIdParam];
    await adminService.assertUniversityUserAccount(universityUserId);
    const data = await documentsService.duplicateTemplate(universityUserId, req.params.templateId);
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function adminUniRenderDocumentTemplatePreview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const universityUserId = req.params[uniUserIdParam];
    await adminService.assertUniversityUserAccount(universityUserId);
    const data = await documentsService.renderTemplatePreview(universityUserId, req.params.templateId, req.body);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function adminUniListIssuedStudentDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const universityUserId = req.params[uniUserIdParam];
    await adminService.assertUniversityUserAccount(universityUserId);
    const data = await documentsService.listStudentDocuments(universityUserId, {
      type: req.query.type as 'offer' | 'scholarship' | undefined,
      status: req.query.status as
        | 'sent'
        | 'viewed'
        | 'accepted'
        | 'declined'
        | 'postponed'
        | 'expired'
        | 'revoked'
        | undefined,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function adminUniSendStudentDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const universityUserId = req.params[uniUserIdParam];
    await adminService.assertUniversityUserAccount(universityUserId);
    const data = await documentsService.sendStudentDocument(universityUserId, req.body);
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function adminUniGetIssuedStudentDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const universityUserId = req.params[uniUserIdParam];
    await adminService.assertUniversityUserAccount(universityUserId);
    const data = await documentsService.getStudentDocument(universityUserId, req.params.documentId);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function adminUniRevokeIssuedStudentDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const universityUserId = req.params[uniUserIdParam];
    await adminService.assertUniversityUserAccount(universityUserId);
    const data = await documentsService.revokeStudentDocument(universityUserId, req.params.documentId);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function adminUniDeleteIssuedStudentDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const universityUserId = req.params[uniUserIdParam];
    await adminService.assertUniversityUserAccount(universityUserId);
    await documentsService.deleteStudentDocument(universityUserId, req.params.documentId);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

export async function adminUniGetScholarships(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const universityUserId = req.params[uniUserIdParam];
    await adminService.assertUniversityUserAccount(universityUserId);
    const data = await universityService.getScholarships(universityUserId);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function adminUniListOfferTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const universityUserId = req.params[uniUserIdParam];
    await adminService.assertUniversityUserAccount(universityUserId);
    const data = await universityService.listOfferTemplates(universityUserId);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function adminUniCreateOffer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const universityUserId = req.params[uniUserIdParam];
    await adminService.assertUniversityUserAccount(universityUserId);
    const body = req.body as {
      studentId: string;
      scholarshipId?: string;
      coveragePercent: number;
      deadline?: string;
      certificateTemplateId?: string;
      certificateData?: Record<string, string>;
    };
    const data = await universityService.createOffer(
      universityUserId,
      {
        ...body,
        deadline: body.deadline ? new Date(body.deadline) : undefined,
      },
      { bypassOfferLimitCheck: true }
    );
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}
