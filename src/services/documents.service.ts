import mongoose from 'mongoose';
import { getIO } from '../socket';
import {
  Chat,
  DocumentTemplate,
  DocumentTemplateAsset,
  Interest,
  Message,
  StudentDocumentEvent,
  StudentIssuedDocument,
  StudentProfile,
  UniversityProfile,
  User,
} from '../models';
import * as notificationService from './notification.service';
import { getOrCreateChat } from './chat.service';
import {
  createBlankScene,
  createSamplePayload,
  createTemplateSummary,
  getPageDimensions,
  parseScene,
  resolveSceneVariables,
  stringifyScene,
} from './documentRenderer.service';
import { AppError, ErrorCodes } from '../utils/errors';

type DocumentType = 'offer' | 'scholarship';
type TemplateStatus = 'draft' | 'active' | 'archived';
type PageFormat = 'A4_PORTRAIT' | 'A4_LANDSCAPE' | 'LETTER' | 'CUSTOM';
type StudentDocumentStatus = 'sent' | 'viewed' | 'accepted' | 'declined' | 'postponed' | 'expired' | 'revoked';
type EventActorType = 'university' | 'student' | 'system';
type EventType =
  | 'created'
  | 'sent'
  | 'viewed'
  | 'accepted'
  | 'declined'
  | 'postponed'
  | 'expired'
  | 'revoked'
  | 'chat_message_created'
  | 'notification_sent';

type TemplateAssetInput = {
  id?: string;
  type: 'image' | 'logo' | 'signature' | 'background' | 'pdf_background';
  fileUrl: string;
  fileName: string;
  mimeType: string;
  width?: number;
  height?: number;
};

type TemplateInput = {
  type: DocumentType;
  name: string;
  status?: TemplateStatus;
  pageFormat?: PageFormat;
  width?: number;
  height?: number;
  editorVersion?: string;
  canvasJson?: string;
  previewImageUrl?: string;
  isDefault?: boolean;
  assets?: TemplateAssetInput[];
};

type TemplateUpdateInput = Partial<TemplateInput>;

type RenderPreviewInput = {
  studentId?: string;
  acceptDeadline?: string;
  universityMessage?: string;
  documentData?: Record<string, unknown>;
};

type SendDocumentInput = {
  studentId: string;
  chatId?: string;
  templateId: string;
  type: DocumentType;
  acceptDeadline?: string;
  universityMessage?: string;
  title?: string;
  documentData?: Record<string, unknown>;
};

type PostponeInput = {
  days: 3 | 7 | 14;
};

type TemplateFilters = {
  type?: DocumentType;
  status?: TemplateStatus;
};

type StudentDocumentFilters = {
  type?: DocumentType;
  status?: StudentDocumentStatus;
};

export async function listTemplates(userId: string, filters: TemplateFilters = {}) {
  const university = await requireUniversityProfile(userId);
  const query: Record<string, unknown> = { universityId: university._id };
  if (filters.type) query.type = filters.type;
  if (filters.status) query.status = filters.status;

  const [templates, assets] = await Promise.all([
    DocumentTemplate.find(query).sort({ updatedAt: -1 }).lean(),
    DocumentTemplateAsset.find({ universityId: university._id }).sort({ createdAt: 1 }).lean(),
  ]);
  const assetsByTemplateId = groupAssetsByTemplate(assets);

  return templates.map((template) =>
    mapTemplate(template, assetsByTemplateId.get(String((template as { _id: unknown })._id)) ?? [])
  );
}

export async function getTemplate(userId: string, templateId: string) {
  const university = await requireUniversityProfile(userId);
  const [template, assets] = await Promise.all([
    DocumentTemplate.findOne({ _id: templateId, universityId: university._id }).lean(),
    DocumentTemplateAsset.find({ templateId }).sort({ createdAt: 1 }).lean(),
  ]);
  if (!template) throw new AppError(404, 'Document template not found', ErrorCodes.NOT_FOUND);
  return mapTemplate(template, assets);
}

export async function createTemplate(userId: string, input: TemplateInput) {
  const university = await requireUniversityProfile(userId);
  const pageFormat = input.pageFormat ?? 'A4_PORTRAIT';
  const pageSize = getPageDimensions(pageFormat, input.width, input.height);
  const scene = input.canvasJson
    ? parseScene(input.canvasJson, pageFormat, pageSize.width, pageSize.height)
    : createBlankScene(pageFormat, pageSize.width, pageSize.height);

  if (input.isDefault) {
    await clearDefaultTemplate(university._id, input.type);
  }

  const template = await DocumentTemplate.create({
    universityId: university._id,
    createdByUserId: userId,
    type: input.type,
    name: input.name.trim(),
    status: input.status ?? 'draft',
    pageFormat,
    width: pageSize.width,
    height: pageSize.height,
    editorVersion: input.editorVersion ?? scene.version ?? '1.0.0',
    canvasJson: stringifyScene(scene),
    previewImageUrl: input.previewImageUrl,
    isDefault: input.isDefault ?? false,
  });

  const assets = await replaceTemplateAssets(university._id, String((template as { _id: unknown })._id), input.assets ?? []);
  return mapTemplate(template.toObject(), assets);
}

export async function updateTemplate(userId: string, templateId: string, input: TemplateUpdateInput) {
  const university = await requireUniversityProfile(userId);
  const current = await DocumentTemplate.findOne({ _id: templateId, universityId: university._id });
  if (!current) throw new AppError(404, 'Document template not found', ErrorCodes.NOT_FOUND);

  const nextType = input.type ?? (current.type as DocumentType);
  if (input.isDefault) {
    await clearDefaultTemplate(university._id, nextType, templateId);
  }

  const nextPageFormat = input.pageFormat ?? (current.pageFormat as PageFormat);
  const pageSize = getPageDimensions(
    nextPageFormat,
    normalizeMaybeNumber(input.width ?? current.width),
    normalizeMaybeNumber(input.height ?? current.height)
  );
  const nextScene = input.canvasJson
    ? parseScene(input.canvasJson, nextPageFormat, pageSize.width, pageSize.height)
    : parseScene(current.canvasJson, nextPageFormat, pageSize.width, pageSize.height);

  const updated = await DocumentTemplate.findOneAndUpdate(
    { _id: templateId, universityId: university._id },
    {
      ...(input.type ? { type: input.type } : {}),
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.status ? { status: input.status } : {}),
      pageFormat: nextPageFormat,
      width: pageSize.width,
      height: pageSize.height,
      editorVersion: input.editorVersion ?? current.editorVersion,
      canvasJson: stringifyScene(nextScene),
      previewImageUrl: input.previewImageUrl ?? current.previewImageUrl,
      isDefault: input.isDefault ?? current.isDefault,
    },
    { new: true }
  ).lean();

  if (!updated) throw new AppError(404, 'Document template not found', ErrorCodes.NOT_FOUND);
  const assets = input.assets
    ? await replaceTemplateAssets(university._id, templateId, input.assets)
    : await DocumentTemplateAsset.find({ templateId }).sort({ createdAt: 1 }).lean();

  return mapTemplate(updated, assets);
}

export async function deleteTemplate(userId: string, templateId: string) {
  const university = await requireUniversityProfile(userId);
  const deleted = await DocumentTemplate.findOneAndDelete({ _id: templateId, universityId: university._id }).lean();
  if (!deleted) throw new AppError(404, 'Document template not found', ErrorCodes.NOT_FOUND);
  await DocumentTemplateAsset.deleteMany({ templateId });
  return { success: true };
}

export async function duplicateTemplate(userId: string, templateId: string) {
  const university = await requireUniversityProfile(userId);
  const [template, assets] = await Promise.all([
    DocumentTemplate.findOne({ _id: templateId, universityId: university._id }).lean(),
    DocumentTemplateAsset.find({ templateId }).lean(),
  ]);
  if (!template) throw new AppError(404, 'Document template not found', ErrorCodes.NOT_FOUND);

  const clone = await DocumentTemplate.create({
    universityId: university._id,
    createdByUserId: userId,
    type: template.type,
    name: `${template.name} Copy`,
    status: 'draft',
    pageFormat: template.pageFormat,
    width: template.width,
    height: template.height,
    editorVersion: template.editorVersion,
    canvasJson: template.canvasJson,
    previewImageUrl: template.previewImageUrl,
    isDefault: false,
  });
  const clonedAssets = await replaceTemplateAssets(
    university._id,
    String((clone as { _id: unknown })._id),
    assets.map((asset) => ({
      type: asset.type as TemplateAssetInput['type'],
      fileUrl: asset.fileUrl,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      width: normalizeMaybeNumber(asset.width),
      height: normalizeMaybeNumber(asset.height),
    }))
  );
  return mapTemplate(clone.toObject(), clonedAssets);
}

export async function renderTemplatePreview(userId: string, templateId: string, input: RenderPreviewInput = {}) {
  const university = await requireUniversityProfile(userId);
  const template = await DocumentTemplate.findOne({ _id: templateId, universityId: university._id }).lean();
  if (!template) throw new AppError(404, 'Document template not found', ErrorCodes.NOT_FOUND);

  const payload = input.studentId
    ? await buildRenderedPayload({
        documentId: 'preview-document',
        type: template.type as DocumentType,
        university,
        studentProfileId: input.studentId,
        acceptDeadline: input.acceptDeadline,
        universityMessage: input.universityMessage,
        documentData: input.documentData,
      })
    : createSamplePayload(template.type as DocumentType);
  const resolvedScene = resolveSceneVariables(
    parseScene(
      template.canvasJson,
      template.pageFormat as PageFormat,
      normalizeMaybeNumber(template.width),
      normalizeMaybeNumber(template.height)
    ),
    payload
  );

  return {
    templateId: String((template as { _id: unknown })._id),
    type: template.type,
    renderedPayload: payload,
    resolvedCanvasJson: stringifyScene(resolvedScene),
    summary: createTemplateSummary(resolvedScene),
  };
}

export async function listStudentDocuments(userId: string, filters: StudentDocumentFilters = {}) {
  const user = await User.findById(userId).select('role').lean();
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);

  const query: Record<string, unknown> = { deletedByUniversityAt: null };
  if (filters.type) query.type = filters.type;
  if (filters.status) query.status = filters.status;

  if (user.role === 'university') {
    const university = await requireUniversityProfile(userId);
    query.universityId = university._id;
    const documents = await StudentIssuedDocument.find(query)
      .sort({ createdAt: -1 })
      .populate('studentId', 'firstName lastName country')
      .lean();
    return documents.map((document) => mapIssuedDocument(document, 'university'));
  }

  if (user.role === 'student') {
    const student = await requireStudentProfile(userId);
    query.studentId = student._id;
    const documents = await StudentIssuedDocument.find(query)
      .sort({ createdAt: -1 })
      .populate('universityId', 'universityName logoUrl city country')
      .lean();
    return documents.map((document) => mapIssuedDocument(document, 'student'));
  }

  throw new AppError(403, 'Insufficient permissions', ErrorCodes.FORBIDDEN);
}

export async function sendStudentDocument(userId: string, input: SendDocumentInput) {
  const university = await requireUniversityProfile(userId);
  const template = await DocumentTemplate.findOne({ _id: input.templateId, universityId: university._id }).lean();
  if (!template) throw new AppError(404, 'Document template not found', ErrorCodes.NOT_FOUND);
  if (template.type !== input.type) {
    throw new AppError(400, 'Template type does not match the requested document type', ErrorCodes.VALIDATION);
  }

  const student = await StudentProfile.findById(input.studentId).lean();
  if (!student) throw new AppError(404, 'Student not found', ErrorCodes.NOT_FOUND);

  const acceptDeadline = parseDocumentDeadline(input.acceptDeadline);
  if (acceptDeadline === null) {
    throw new AppError(400, 'Invalid accept deadline', ErrorCodes.VALIDATION);
  }
  if (acceptDeadline && acceptDeadline.getTime() <= Date.now()) {
    throw new AppError(400, 'Accept deadline must be in the future', ErrorCodes.VALIDATION);
  }

  const chatInfo = input.chatId
    ? await getExistingChatForDocument(input.chatId, String(university._id), input.studentId)
    : await getOrCreateChat(input.studentId, university._id);

  const documentId = new mongoose.Types.ObjectId();
  const renderedPayload = await buildRenderedPayload({
    documentId: String(documentId),
    type: input.type,
    university,
    studentProfileId: input.studentId,
    acceptDeadline: input.acceptDeadline,
    universityMessage: input.universityMessage,
    documentData: input.documentData,
  });
  const frozenScene = parseScene(
    template.canvasJson,
    template.pageFormat as PageFormat,
    normalizeMaybeNumber(template.width),
    normalizeMaybeNumber(template.height)
  );
  const resolvedScene = resolveSceneVariables(frozenScene, renderedPayload);
  const title =
    input.title?.trim() ||
    template.name ||
    `${input.type === 'offer' ? 'Offer' : 'Scholarship'} from ${university.universityName ?? 'University'}`;

  const created = await StudentIssuedDocument.create({
    _id: documentId,
    universityId: university._id,
    studentId: student._id,
    chatId: chatInfo.chatId,
    templateId: template._id,
    type: input.type,
    status: 'sent',
    pageFormat: frozenScene.page.format,
    width: frozenScene.page.width,
    height: frozenScene.page.height,
    title,
    universityMessage: input.universityMessage?.trim() || undefined,
    renderedPayload,
    frozenTemplateJson: stringifyScene(frozenScene),
    resolvedCanvasJson: stringifyScene(resolvedScene),
    sentAt: new Date(),
    expiresAt: acceptDeadline,
  });

  await appendEvent(String(documentId), 'university', userId, 'created', {
    templateId: String(template._id),
    templateName: template.name,
  });
  await appendEvent(String(documentId), 'university', userId, 'sent', {
    chatId: String(chatInfo.chatId),
    title,
  });

  await createSystemChatMessage({
    chatId: String(chatInfo.chatId),
    senderId: userId,
    text: `University sent you ${input.type === 'offer' ? 'an Offer' : 'a Scholarship'}`,
    metadata: {
      subtype: 'document_sent',
      documentId: String(documentId),
      documentType: input.type,
      title,
      link: `/student/received-documents/${String(documentId)}`,
    },
    documentId: String(documentId),
  });

  const studentUserId = chatInfo.studentUserId;
  if (studentUserId) {
    await notificationService.createNotification(studentUserId, {
      type: 'document',
      title: input.type === 'offer' ? 'You received an Offer' : 'You received a Scholarship',
      body: `${university.universityName ?? 'A university'} sent you a new ${input.type}.`,
      referenceType: 'student_document',
      referenceId: String(documentId),
      metadata: {
        documentId: String(documentId),
        documentType: input.type,
        link: `/student/received-documents/${String(documentId)}`,
      },
    });
    await appendEvent(String(documentId), 'university', userId, 'notification_sent', {
      recipientUserId: studentUserId,
      notificationType: 'document',
    });
  }

  const counsellorUserId = (student as { counsellorUserId?: unknown }).counsellorUserId
    ? String((student as { counsellorUserId: unknown }).counsellorUserId)
    : '';
  if (counsellorUserId) {
    const studentName = [student.firstName, student.lastName].filter(Boolean).join(' ') || 'Student';
    await notificationService.createNotification(counsellorUserId, {
      type: 'document',
      title: input.type === 'offer' ? 'Student received an Offer' : 'Student received a Scholarship',
      body: `${studentName} received a new ${input.type} from ${university.universityName ?? 'a university'}.`,
      referenceType: 'student_document',
      referenceId: String(documentId),
      metadata: {
        documentId: String(documentId),
        documentType: input.type,
        studentProfileId: String(student._id),
        link: '/school/offers',
      },
    });
    await appendEvent(String(documentId), 'university', userId, 'notification_sent', {
      recipientUserId: counsellorUserId,
      notificationType: 'document',
      recipientRole: 'school_counsellor',
    });
  }

  await Interest.findOneAndUpdate(
    {
      studentId: student._id,
      universityId: university._id,
      status: { $in: ['interested', 'chat_opened', 'under_review'] },
    },
    { $set: { status: 'offer_sent' } }
  );

  return mapIssuedDocument(created.toObject(), 'university');
}

export async function getStudentDocument(userId: string, documentId: string) {
  const user = await User.findById(userId).select('role').lean();
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  const document = await StudentIssuedDocument.findById(documentId)
    .populate('studentId', 'firstName lastName country')
    .populate('universityId', 'universityName logoUrl city country')
    .lean();
  if (!document) throw new AppError(404, 'Document not found', ErrorCodes.NOT_FOUND);
  if (document.deletedByUniversityAt) throw new AppError(404, 'Document not found', ErrorCodes.NOT_FOUND);

  if (user.role === 'student') {
    const student = await requireStudentProfile(userId);
    if (String(document.studentId?._id ?? document.studentId) !== String(student._id)) {
      throw new AppError(403, 'Not your document', ErrorCodes.FORBIDDEN);
    }
  } else if (user.role === 'university') {
    const university = await requireUniversityProfile(userId);
    if (String(document.universityId?._id ?? document.universityId) !== String(university._id)) {
      throw new AppError(403, 'Not your document', ErrorCodes.FORBIDDEN);
    }
  } else {
    throw new AppError(403, 'Insufficient permissions', ErrorCodes.FORBIDDEN);
  }

  const events = await StudentDocumentEvent.find({ documentId }).sort({ createdAt: 1 }).lean();
  return {
    ...mapIssuedDocument(document, user.role === 'student' ? 'student' : 'university'),
    events: events.map((event) => ({
      ...event,
      id: String((event as { _id: unknown })._id),
    })),
  };
}

export async function viewStudentDocument(userId: string, documentId: string) {
  const student = await requireStudentProfile(userId);
  const current = await StudentIssuedDocument.findById(documentId).lean();
  if (!current || current.deletedByUniversityAt || String(current.studentId) !== String(student._id)) {
    throw new AppError(404, 'Document not found', ErrorCodes.NOT_FOUND);
  }
  if (current.viewedAt) {
    return getStudentDocument(userId, documentId);
  }

  const updated = await StudentIssuedDocument.findOneAndUpdate(
    { _id: documentId, studentId: student._id, status: { $in: ['sent', 'postponed'] } },
    { $set: { status: 'viewed', viewedAt: new Date() } },
    { new: true }
  )
    .populate('universityId', 'universityName logoUrl city country')
    .populate('studentId', 'firstName lastName country')
    .lean();

  if (!updated) {
    return getStudentDocument(userId, documentId);
  }

  const university = await UniversityProfile.findById(updated.universityId).select('userId').lean();
  const universityUserId = university?.userId ? String(university.userId) : null;
  await appendEvent(documentId, 'student', userId, 'viewed', {});

  const chat = await Chat.findById(updated.chatId).lean();
  if (chat) {
    await createSystemChatMessage({
      chatId: String(chat._id),
      senderId: userId,
      text: 'Student viewed the document',
      metadata: {
        subtype: 'document_viewed',
        documentId,
      },
      documentId,
    });
  }

  if (universityUserId) {
    await notificationService.createNotification(universityUserId, {
      type: 'document_viewed',
      title: 'Document viewed',
      body: `${student.firstName ?? 'Student'} ${student.lastName ?? ''}`.trim() + ' viewed the document.',
      referenceType: 'student_document',
      referenceId: documentId,
      metadata: {
        documentId,
        link: `/university/documents?documentId=${documentId}`,
      },
    });
    await appendEvent(documentId, 'student', userId, 'notification_sent', {
      recipientUserId: universityUserId,
      notificationType: 'document_viewed',
    });
  }

  return {
    ...mapIssuedDocument(updated, 'student'),
    events: await getEventList(documentId),
  };
}

export async function acceptStudentDocument(userId: string, documentId: string) {
  return transitionStudentDecision({
    userId,
    documentId,
    desiredStatus: 'accepted',
    chatText: 'Student accepted the offer',
    eventType: 'accepted',
    notificationType: 'document_accepted',
    notificationTitle: 'Document accepted',
    notificationBody: 'Student accepted the document.',
  });
}

export async function declineStudentDocument(userId: string, documentId: string) {
  return transitionStudentDecision({
    userId,
    documentId,
    desiredStatus: 'declined',
    chatText: 'Student declined the scholarship',
    eventType: 'declined',
    notificationType: 'document_declined',
    notificationTitle: 'Document declined',
    notificationBody: 'Student declined the document.',
  });
}

export async function postponeStudentDocument(userId: string, documentId: string, input: PostponeInput) {
  const student = await requireStudentProfile(userId);
  const current = await StudentIssuedDocument.findById(documentId).lean();
  if (!current || current.deletedByUniversityAt || String(current.studentId) !== String(student._id)) {
    throw new AppError(404, 'Document not found', ErrorCodes.NOT_FOUND);
  }
  if (current.status === 'postponed') {
    return getStudentDocument(userId, documentId);
  }
  if (['accepted', 'declined', 'expired', 'revoked'].includes(current.status)) {
    throw new AppError(409, 'Document already processed', ErrorCodes.CONFLICT);
  }

  const now = new Date();
  const requestedUntil = new Date(now.getTime() + input.days * 24 * 60 * 60 * 1000);
  if (current.expiresAt && current.expiresAt.getTime() <= now.getTime()) {
    throw new AppError(409, 'Document is already expired', ErrorCodes.CONFLICT);
  }
  const postponeUntil = current.expiresAt && current.expiresAt.getTime() < requestedUntil.getTime()
    ? current.expiresAt
    : requestedUntil;

  const updated = await StudentIssuedDocument.findOneAndUpdate(
    { _id: documentId, studentId: student._id, status: { $in: ['sent', 'viewed'] } },
    {
      $set: {
        status: 'postponed',
        postponeUntil,
        expiresAt: postponeUntil,
      },
    },
    { new: true }
  )
    .populate('universityId', 'universityName logoUrl city country userId')
    .populate('studentId', 'firstName lastName country')
    .lean();

  if (!updated) {
    return getStudentDocument(userId, documentId);
  }

  await appendEvent(documentId, 'student', userId, 'postponed', {
    postponeUntil: postponeUntil.toISOString(),
    days: input.days,
  });

  const university = await UniversityProfile.findById(updated.universityId).select('userId').lean();
  const universityUserId = university?.userId ? String(university.userId) : null;
  if (updated.chatId) {
    await createSystemChatMessage({
      chatId: String(updated.chatId),
      senderId: userId,
      text: `Student postponed the decision until ${postponeUntil.toISOString().slice(0, 10)}`,
      metadata: {
        subtype: 'document_postponed',
        documentId,
        postponeUntil: postponeUntil.toISOString(),
      },
      documentId,
    });
  }

  if (universityUserId) {
    await notificationService.createNotification(universityUserId, {
      type: 'document_postponed',
      title: 'Decision postponed',
      body: `Student postponed the decision until ${postponeUntil.toISOString().slice(0, 10)}.`,
      referenceType: 'student_document',
      referenceId: documentId,
      metadata: {
        documentId,
        postponeUntil: postponeUntil.toISOString(),
        link: `/university/documents?documentId=${documentId}`,
      },
    });
    await appendEvent(documentId, 'student', userId, 'notification_sent', {
      recipientUserId: universityUserId,
      notificationType: 'document_postponed',
    });
  }

  return {
    ...mapIssuedDocument(updated, 'student'),
    events: await getEventList(documentId),
  };
}

export async function revokeStudentDocument(userId: string, documentId: string) {
  const university = await requireUniversityProfile(userId);
  const current = await StudentIssuedDocument.findById(documentId).lean();
  if (!current || current.deletedByUniversityAt || String(current.universityId) !== String(university._id)) {
    throw new AppError(404, 'Document not found', ErrorCodes.NOT_FOUND);
  }
  if (current.status === 'revoked') {
    return getStudentDocument(userId, documentId);
  }
  if (['accepted', 'declined', 'expired'].includes(current.status)) {
    throw new AppError(409, 'Document can no longer be revoked', ErrorCodes.CONFLICT);
  }

  const updated = await StudentIssuedDocument.findOneAndUpdate(
    { _id: documentId, universityId: university._id, status: { $in: ['sent', 'viewed', 'postponed'] } },
    { $set: { status: 'revoked', revokedAt: new Date(), decisionAt: new Date() } },
    { new: true }
  )
    .populate('universityId', 'universityName logoUrl city country')
    .populate('studentId', 'firstName lastName country')
    .lean();

  if (!updated) {
    return getStudentDocument(userId, documentId);
  }

  await appendEvent(documentId, 'university', userId, 'revoked', {});
  if (updated.chatId) {
    await createSystemChatMessage({
      chatId: String(updated.chatId),
      senderId: userId,
      text: `${updated.type === 'offer' ? 'Offer' : 'Scholarship'} revoked`,
      metadata: {
        subtype: 'document_revoked',
        documentId,
      },
      documentId,
    });
  }

  const studentUserId = await getStudentUserIdByProfile(updated.studentId);
  if (studentUserId) {
    await notificationService.createNotification(studentUserId, {
      type: 'document_revoked',
      title: 'Document revoked',
      body: `A university revoked your ${updated.type}.`,
      referenceType: 'student_document',
      referenceId: documentId,
      metadata: {
        documentId,
        link: `/student/received-documents/${documentId}`,
      },
    });
    await appendEvent(documentId, 'university', userId, 'notification_sent', {
      recipientUserId: studentUserId,
      notificationType: 'document_revoked',
    });
  }

  return {
    ...mapIssuedDocument(updated, 'university'),
    events: await getEventList(documentId),
  };
}

export async function deleteStudentDocument(userId: string, documentId: string) {
  const university = await requireUniversityProfile(userId);
  const current = await StudentIssuedDocument.findById(documentId).lean();
  if (!current || String(current.universityId) !== String(university._id)) {
    throw new AppError(404, 'Document not found', ErrorCodes.NOT_FOUND);
  }
  if (current.deletedByUniversityAt) {
    return { success: true };
  }

  const now = new Date();
  const shouldRevoke = ['sent', 'viewed', 'postponed'].includes(current.status);
  const updated = await StudentIssuedDocument.findOneAndUpdate(
    { _id: documentId, universityId: university._id, deletedByUniversityAt: null },
    {
      $set: {
        deletedByUniversityAt: now,
        ...(shouldRevoke
          ? {
              status: 'revoked',
              revokedAt: current.revokedAt ?? now,
              decisionAt: current.decisionAt ?? now,
            }
          : {}),
      },
    },
    { new: true }
  ).lean();

  if (!updated) return { success: true };

  if (shouldRevoke && current.status !== 'revoked') {
    await appendEvent(documentId, 'university', userId, 'revoked', {
      deletedByUniversity: true,
    });

    if (updated.chatId) {
      await createSystemChatMessage({
        chatId: String(updated.chatId),
        senderId: userId,
        text: `${updated.type === 'offer' ? 'Offer' : 'Scholarship'} revoked`,
        metadata: {
          subtype: 'document_revoked',
          documentId,
        },
        documentId,
      });
    }

    const studentUserId = await getStudentUserIdByProfile(updated.studentId);
    if (studentUserId) {
      await notificationService.createNotification(studentUserId, {
        type: 'document_revoked',
        title: 'Document revoked',
        body: `A university revoked your ${updated.type}.`,
        referenceType: 'student_document',
        referenceId: documentId,
        metadata: {
          documentId,
          link: `/student/received-documents/${documentId}`,
        },
      });
      await appendEvent(documentId, 'university', userId, 'notification_sent', {
        recipientUserId: studentUserId,
        notificationType: 'document_revoked',
      });
    }
  }

  return { success: true };
}

export async function expireStudentDocumentsNow() {
  const now = new Date();
  const candidates = await StudentIssuedDocument.find({
    deletedByUniversityAt: null,
    status: { $in: ['sent', 'viewed', 'postponed'] },
    expiresAt: { $ne: null, $lte: now },
  }).lean();

  if (candidates.length === 0) return { processed: 0 };

  let processed = 0;
  for (const candidate of candidates) {
    const updated = await StudentIssuedDocument.findOneAndUpdate(
      {
        _id: candidate._id,
        status: { $in: ['sent', 'viewed', 'postponed'] },
        expiresAt: { $ne: null, $lte: now },
      },
      { $set: { status: 'expired', decisionAt: now } },
      { new: true }
    ).lean();

    if (!updated) continue;
    processed += 1;
    const documentId = String(updated._id);
    await appendEvent(documentId, 'system', undefined, 'expired', {
      expiredAt: now.toISOString(),
    });

    if (updated.chatId) {
      const fallbackSenderId =
        (await getUniversityUserIdByProfile(updated.universityId)) ??
        (await getStudentUserIdByProfile(updated.studentId)) ??
        '';
      await createSystemChatMessage({
        chatId: String(updated.chatId),
        senderId: fallbackSenderId,
        text: `${updated.type === 'offer' ? 'Offer' : 'Document'} expired`,
        metadata: {
          subtype: 'document_expired',
          documentId,
        },
        documentId,
      });
    }

    const [studentUserId, universityUserId] = await Promise.all([
      getStudentUserIdByProfile(updated.studentId),
      getUniversityUserIdByProfile(updated.universityId),
    ]);
    if (studentUserId) {
      await notificationService.createNotification(studentUserId, {
        type: 'document_expired',
        title: 'Document expired',
        body: `Your ${updated.type} expired without a decision.`,
        referenceType: 'student_document',
        referenceId: documentId,
        metadata: {
          documentId,
          link: `/student/received-documents/${documentId}`,
        },
      });
      await appendEvent(documentId, 'system', undefined, 'notification_sent', {
        recipientUserId: studentUserId,
        notificationType: 'document_expired',
      });
    }
    if (universityUserId) {
      await notificationService.createNotification(universityUserId, {
        type: 'document_expired',
        title: 'Document expired',
        body: `A ${updated.type} expired without student decision.`,
        referenceType: 'student_document',
        referenceId: documentId,
        metadata: {
          documentId,
          link: `/university/documents?documentId=${documentId}`,
        },
      });
      await appendEvent(documentId, 'system', undefined, 'notification_sent', {
        recipientUserId: universityUserId,
        notificationType: 'document_expired',
      });
    }
  }

  return { processed };
}

async function transitionStudentDecision(params: {
  userId: string;
  documentId: string;
  desiredStatus: 'accepted' | 'declined';
  chatText: string;
  eventType: 'accepted' | 'declined';
  notificationType: 'document_accepted' | 'document_declined';
  notificationTitle: string;
  notificationBody: string;
}) {
  const student = await requireStudentProfile(params.userId);
  const current = await StudentIssuedDocument.findById(params.documentId).lean();
  if (!current || current.deletedByUniversityAt || String(current.studentId) !== String(student._id)) {
    throw new AppError(404, 'Document not found', ErrorCodes.NOT_FOUND);
  }
  if (current.status === params.desiredStatus) {
    return getStudentDocument(params.userId, params.documentId);
  }
  if (['accepted', 'declined', 'expired', 'revoked'].includes(current.status)) {
    throw new AppError(409, 'Document already processed', ErrorCodes.CONFLICT);
  }

  const updated = await StudentIssuedDocument.findOneAndUpdate(
    { _id: params.documentId, studentId: student._id, status: { $in: ['sent', 'viewed', 'postponed'] } },
    { $set: { status: params.desiredStatus, decisionAt: new Date(), postponeUntil: undefined } },
    { new: true }
  )
    .populate('universityId', 'universityName logoUrl city country userId')
    .populate('studentId', 'firstName lastName country')
    .lean();

  if (!updated) {
    return getStudentDocument(params.userId, params.documentId);
  }

  await appendEvent(params.documentId, 'student', params.userId, params.eventType, {});
  if (updated.chatId) {
    await createSystemChatMessage({
      chatId: String(updated.chatId),
      senderId: params.userId,
      text: params.chatText,
      metadata: {
        subtype: params.eventType === 'accepted' ? 'document_accepted' : 'document_declined',
        documentId: params.documentId,
      },
      documentId: params.documentId,
    });
  }

  const universityUserId = await getUniversityUserIdByProfile(updated.universityId);
  if (universityUserId) {
    await notificationService.createNotification(universityUserId, {
      type: params.notificationType,
      title: params.notificationTitle,
      body: params.notificationBody,
      referenceType: 'student_document',
      referenceId: params.documentId,
      metadata: {
        documentId: params.documentId,
        link: `/university/documents?documentId=${params.documentId}`,
      },
    });
    await appendEvent(params.documentId, 'student', params.userId, 'notification_sent', {
      recipientUserId: universityUserId,
      notificationType: params.notificationType,
    });
  }

  return {
    ...mapIssuedDocument(updated, 'student'),
    events: await getEventList(params.documentId),
  };
}

async function buildRenderedPayload(params: {
  documentId: string;
  type: DocumentType;
  university: { _id: unknown; universityName?: string | null; city?: string | null; country?: string | null; logoUrl?: string | null };
  studentProfileId: string;
  acceptDeadline?: string;
  universityMessage?: string;
  documentData?: Record<string, unknown>;
}) {
  const studentProfile = await StudentProfile.findById(params.studentProfileId).lean();
  if (!studentProfile) throw new AppError(404, 'Student not found', ErrorCodes.NOT_FOUND);
  const studentUser = studentProfile.userId
    ? await User.findById(studentProfile.userId).select('email').lean()
    : null;

  const fullName = [studentProfile.firstName, studentProfile.lastName].filter(Boolean).join(' ').trim();
  const documentData = params.documentData ?? {};
  const offer = readRecord(documentData.offer);
  const scholarship = readRecord(documentData.scholarship);
  const issuedAt = new Date();
  const issuedOn = issuedAt.toISOString().slice(0, 10);
  const issuedOnLabel = formatDocumentDate(issuedAt);
  const deadlineDate = parseDocumentDeadline(params.acceptDeadline);
  const acceptBy = normalizeDateValue(params.acceptDeadline, deadlineDate);
  const acceptByLabel = deadlineDate ? formatDocumentDate(deadlineDate) : '';
  const startDate = String(offer.startDate ?? '');
  const startDateLabel = formatDocumentDate(startDate);
  const tuitionDisplay = formatMoneyDisplay(String(offer.tuitionFee ?? ''), String(offer.currency ?? ''));
  const scholarshipSummary = buildScholarshipSummary(scholarship);
  const universityMessage = params.universityMessage?.trim() ?? '';
  const summary = [
    `Issued on ${issuedOnLabel}.`,
    offer.programName ? `Program: ${String(offer.programName).trim()}.` : '',
    offer.degreeLevel ? `Degree level: ${String(offer.degreeLevel).trim()}.` : '',
    startDateLabel ? `Start date: ${startDateLabel}.` : '',
    tuitionDisplay ? `Tuition fee: ${tuitionDisplay}.` : '',
    scholarshipSummary ? `Scholarship: ${scholarshipSummary}.` : '',
    acceptByLabel ? `Accept by: ${acceptByLabel}.` : 'No acceptance deadline specified.',
  ]
    .filter(Boolean)
    .join(' ');
  const smallPrint = [
    'This summary is included to make the main terms, deadlines, fees, conditions, and scholarship details explicit.',
    acceptByLabel ? `Please review the full document and respond by ${acceptByLabel}.` : 'Please review the full document carefully before making a decision.',
    String(offer.conditions ?? '').trim() ? 'Any stated offer conditions remain part of this document.' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    today: issuedOn,
    student: {
      firstName: studentProfile.firstName ?? '',
      lastName: studentProfile.lastName ?? '',
      fullName: fullName || 'Student',
      email: studentUser?.email ?? '',
      phone: '',
      country: studentProfile.country ?? '',
    },
    university: {
      name: params.university.universityName ?? '',
      address: [params.university.city, params.university.country].filter(Boolean).join(', '),
      logo: params.university.logoUrl ?? '',
    },
    offer: {
      programName: String(offer.programName ?? ''),
      degreeLevel: String(offer.degreeLevel ?? ''),
      intake: String(offer.intake ?? ''),
      startDate,
      startDateLabel,
      tuitionFee: String(offer.tuitionFee ?? ''),
      currency: String(offer.currency ?? ''),
      tuitionDisplay,
      conditions: String(offer.conditions ?? ''),
    },
    scholarship: {
      amount: String(scholarship.amount ?? ''),
      percent: String(scholarship.percent ?? ''),
      type: String(scholarship.type ?? ''),
      summary: scholarshipSummary,
    },
    deadline: {
      acceptBy,
      acceptByLabel,
    },
    document: {
      id: params.documentId,
      type: params.type,
      issuedOn,
      issuedOnLabel,
      message: universityMessage,
      summary,
      smallPrint,
    },
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseDocumentDeadline(value?: string): Date | undefined | null {
  if (!value || !value.trim()) return undefined;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [yearRaw, monthRaw, dayRaw] = trimmed.split('-');
    const parsed = new Date(Number(yearRaw), Number(monthRaw) - 1, Number(dayRaw), 23, 59, 59, 999);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeDateValue(rawValue: string | undefined, parsed: Date | undefined | null) {
  if (!rawValue || !rawValue.trim()) return '';
  const trimmed = rawValue.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function formatDocumentDate(value: string | Date) {
  const parsed = value instanceof Date ? value : parseDocumentDeadline(value);
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

function formatMoneyDisplay(amountValue: string, currencyValue: string) {
  const amount = amountValue.trim();
  const currency = currencyValue.trim();
  if (!amount) return currency;

  const normalized = amount.replace(/,/g, '');
  if (/^-?\d+(\.\d+)?$/.test(normalized)) {
    const formattedAmount = new Intl.NumberFormat('en-US', {
      maximumFractionDigits: normalized.includes('.') ? 2 : 0,
    }).format(Number(normalized));
    return [formattedAmount, currency].filter(Boolean).join(' ');
  }

  return [amount, currency].filter(Boolean).join(' ');
}

function buildScholarshipSummary(scholarship: Record<string, unknown>) {
  const amount = String(scholarship.amount ?? '').trim();
  const percent = String(scholarship.percent ?? '').trim();
  const type = String(scholarship.type ?? '').trim();

  return [amount, percent ? `${percent}%` : '', type]
    .filter(Boolean)
    .join(' ')
    .trim();
}

async function replaceTemplateAssets(universityId: unknown, templateId: string, assets: TemplateAssetInput[]) {
  await DocumentTemplateAsset.deleteMany({ templateId });
  if (assets.length === 0) return [];
  const created = await DocumentTemplateAsset.insertMany(
    assets.map((asset) => ({
      templateId,
      universityId,
      type: asset.type,
      fileUrl: asset.fileUrl,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
    }))
  );
  return created.map((asset) => asset.toObject());
}

async function clearDefaultTemplate(universityId: unknown, type: DocumentType, excludeTemplateId?: string) {
  const filter: Record<string, unknown> = { universityId, type, isDefault: true };
  if (excludeTemplateId) filter._id = { $ne: excludeTemplateId };
  await DocumentTemplate.updateMany(filter, { $set: { isDefault: false } });
}

async function appendEvent(
  documentId: string,
  actorType: EventActorType,
  actorId: string | undefined,
  eventType: EventType,
  meta: Record<string, unknown>
) {
  await StudentDocumentEvent.create({
    documentId,
    actorType,
    actorId: actorId || undefined,
    eventType,
    meta,
  });
}

async function createSystemChatMessage(params: {
  chatId: string;
  senderId: string;
  text: string;
  metadata: Record<string, unknown>;
  documentId: string;
}) {
  if (!params.senderId) return null;
  const message = await Message.create({
    chatId: params.chatId,
    senderId: params.senderId,
    type: 'system',
    message: params.text,
    metadata: params.metadata,
  });
  await appendEvent(params.documentId, 'system', undefined, 'chat_message_created', {
    chatId: params.chatId,
    messageId: String((message as { _id: unknown })._id),
    subtype: params.metadata.subtype,
  });
  const io = getIO();
  if (io) {
    io.to(`chat:${params.chatId}`).emit('new_message', {
      chatId: params.chatId,
      message: {
        id: String((message as { _id: unknown })._id),
        text: params.text,
        type: 'system',
        createdAt: (message as { createdAt?: Date }).createdAt,
        metadata: params.metadata,
        sender: { id: params.senderId },
      },
    });
  }
  return message;
}

async function getExistingChatForDocument(chatId: string, universityId: string, studentId: string) {
  const chat = await Chat.findById(chatId).lean();
  if (!chat) throw new AppError(404, 'Chat not found', ErrorCodes.NOT_FOUND);
  if (String(chat.universityId) !== universityId || String(chat.studentId) !== studentId) {
    throw new AppError(403, 'Chat does not match selected student', ErrorCodes.FORBIDDEN);
  }
  const [studentUserId, universityUserId] = await Promise.all([
    getStudentUserIdByProfile(chat.studentId),
    getUniversityUserIdByProfile(chat.universityId),
  ]);
  return {
    chat,
    chatId: chat._id,
    studentUserId: studentUserId ?? null,
    universityUserId: universityUserId ?? null,
  };
}

async function requireUniversityProfile(userId: string) {
  const profile = await UniversityProfile.findOne({ userId }).lean();
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  return profile;
}

async function requireStudentProfile(userId: string) {
  const profile = await StudentProfile.findOne({ userId }).lean();
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);
  return profile;
}

function groupAssetsByTemplate(assets: Array<Record<string, unknown>>) {
  const map = new Map<string, Array<Record<string, unknown>>>();
  for (const asset of assets) {
    const templateId = String(asset.templateId);
    const list = map.get(templateId) ?? [];
    list.push(asset);
    map.set(templateId, list);
  }
  return map;
}

function mapTemplate(template: Record<string, unknown>, assets: Array<Record<string, unknown>>) {
  const templateId = String(template._id);
  const scene = parseScene(
    String(template.canvasJson ?? ''),
    (template.pageFormat as PageFormat | undefined) ?? 'A4_PORTRAIT',
    typeof template.width === 'number' ? template.width : undefined,
    typeof template.height === 'number' ? template.height : undefined
  );
  return {
    ...template,
    id: templateId,
    canvasJson: stringifyScene(scene),
    summary: createTemplateSummary(scene),
    assets: assets.map((asset) => ({
      ...asset,
      id: String(asset._id),
      templateId,
    })),
  };
}

function mapIssuedDocument(document: Record<string, unknown>, audience: 'student' | 'university') {
  const snapshotScene = parseScene(
    typeof document.resolvedCanvasJson === 'string' && document.resolvedCanvasJson.trim()
      ? document.resolvedCanvasJson
      : String(document.frozenTemplateJson ?? ''),
    (document.pageFormat as PageFormat | undefined) ?? 'A4_PORTRAIT',
    normalizeMaybeNumber(document.width),
    normalizeMaybeNumber(document.height)
  );
  const base = {
    ...document,
    id: String(document._id),
    pageFormat: (document.pageFormat as PageFormat | undefined) ?? snapshotScene.page.format,
    width: normalizeMaybeNumber(document.width) ?? snapshotScene.page.width,
    height: normalizeMaybeNumber(document.height) ?? snapshotScene.page.height,
    studentId:
      document.studentId && typeof document.studentId === 'object' && '_id' in (document.studentId as Record<string, unknown>)
        ? String((document.studentId as { _id: unknown })._id)
        : String(document.studentId ?? ''),
    universityId:
      document.universityId && typeof document.universityId === 'object' && '_id' in (document.universityId as Record<string, unknown>)
        ? String((document.universityId as { _id: unknown })._id)
        : String(document.universityId ?? ''),
    templateId:
      document.templateId && typeof document.templateId === 'object' && '_id' in (document.templateId as Record<string, unknown>)
        ? String((document.templateId as { _id: unknown })._id)
        : String(document.templateId ?? ''),
  };

  if (audience === 'student') {
    const university = document.universityId as { universityName?: string; logoUrl?: string; city?: string; country?: string } | undefined;
    return {
      ...base,
      university: university
        ? {
            name: university.universityName ?? 'University',
            logoUrl: university.logoUrl,
            city: university.city,
            country: university.country,
          }
        : undefined,
    };
  }

  const student = document.studentId as { firstName?: string; lastName?: string; country?: string } | undefined;
  return {
    ...base,
    student: student
      ? {
          fullName: [student.firstName, student.lastName].filter(Boolean).join(' ') || 'Student',
          country: student.country,
        }
      : undefined,
  };
}

async function getEventList(documentId: string) {
  const events = await StudentDocumentEvent.find({ documentId }).sort({ createdAt: 1 }).lean();
  return events.map((event) => ({
    ...event,
    id: String((event as { _id: unknown })._id),
  }));
}

async function getStudentUserIdByProfile(studentProfileId: unknown) {
  const student = await StudentProfile.findById(studentProfileId).select('userId').lean();
  return student?.userId ? String(student.userId) : null;
}

async function getUniversityUserIdByProfile(universityProfileId: unknown) {
  const university = await UniversityProfile.findById(universityProfileId).select('userId').lean();
  return university?.userId ? String(university.userId) : null;
}

function normalizeMaybeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
