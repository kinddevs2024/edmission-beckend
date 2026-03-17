import { Request, Response, NextFunction } from 'express';
import * as documentsService from '../services/documents.service';

export async function listTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await documentsService.listTemplates(req.user.id, {
      type: req.query.type as 'offer' | 'scholarship' | undefined,
      status: req.query.status as 'draft' | 'active' | 'archived' | undefined,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
}

export async function getTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await documentsService.getTemplate(req.user.id, req.params.id);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

export async function createTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await documentsService.createTemplate(req.user.id, req.body);
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
}

export async function updateTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await documentsService.updateTemplate(req.user.id, req.params.id, req.body);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

export async function deleteTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    await documentsService.deleteTemplate(req.user.id, req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function duplicateTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await documentsService.duplicateTemplate(req.user.id, req.params.id);
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
}

export async function renderTemplatePreview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await documentsService.renderTemplatePreview(req.user.id, req.params.id, req.body);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

export async function listStudentDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await documentsService.listStudentDocuments(req.user.id, {
      type: req.query.type as 'offer' | 'scholarship' | undefined,
      status: req.query.status as 'sent' | 'viewed' | 'accepted' | 'declined' | 'postponed' | 'expired' | 'revoked' | undefined,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
}

export async function sendStudentDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await documentsService.sendStudentDocument(req.user.id, req.body);
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
}

export async function getStudentDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await documentsService.getStudentDocument(req.user.id, req.params.id);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

export async function viewStudentDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await documentsService.viewStudentDocument(req.user.id, req.params.id);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

export async function acceptStudentDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await documentsService.acceptStudentDocument(req.user.id, req.params.id);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

export async function declineStudentDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await documentsService.declineStudentDocument(req.user.id, req.params.id);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

export async function postponeStudentDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await documentsService.postponeStudentDocument(req.user.id, req.params.id, req.body);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

export async function revokeStudentDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const data = await documentsService.revokeStudentDocument(req.user.id, req.params.id);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

export async function deleteStudentDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    await documentsService.deleteStudentDocument(req.user.id, req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
