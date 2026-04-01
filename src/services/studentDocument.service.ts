import { StudentDocument, StudentProfile } from '../models';
import { getPageDimensions, parseScene, stringifyScene } from './documentRenderer.service';
import { ensureStudentProfile } from './studentProfile.service';
import { AppError, ErrorCodes } from '../utils/errors';

type PageFormat = 'A4_PORTRAIT' | 'A4_LANDSCAPE' | 'LETTER' | 'CUSTOM';

type StudentDocumentInput = {
  type: string;
  source?: 'upload' | 'editor';
  fileUrl?: string;
  name?: string;
  certificateType?: string;
  score?: string;
  previewImageUrl?: string;
  canvasJson?: string;
  pageFormat?: PageFormat;
  width?: number;
  height?: number;
  editorVersion?: string;
};

const ALLOWED_TYPES = ['transcript', 'diploma', 'language_certificate', 'course_certificate', 'passport', 'id_card', 'other'] as const;
const ALLOWED_PAGE_FORMATS: PageFormat[] = ['A4_PORTRAIT', 'A4_LANDSCAPE', 'LETTER', 'CUSTOM'];

export async function addDocument(userId: string, data: StudentDocumentInput) {
  const profile = await ensureStudentProfile(userId);

  assertDocumentType(data.type);
  const doc = await StudentDocument.create({
    studentId: profile._id,
    type: data.type,
    ...normalizeDocumentInput(data),
    status: 'pending',
  });

  return mapStudentDocument(doc.toObject());
}

export async function updateDocument(userId: string, docId: string, data: StudentDocumentInput) {
  const profile = await ensureStudentProfile(userId);

  const current = await StudentDocument.findOne({ _id: docId, studentId: profile._id }).lean();
  if (!current) throw new AppError(404, 'Document not found', ErrorCodes.NOT_FOUND);

  assertDocumentType(data.type ?? current.type);

  const updated = await StudentDocument.findOneAndUpdate(
    { _id: docId, studentId: profile._id },
    {
      ...(data.type ? { type: data.type } : {}),
      ...normalizeDocumentInput(data, current),
      status: 'pending',
      reviewedAt: undefined,
      reviewedBy: undefined,
      rejectionReason: undefined,
    },
    { new: true }
  ).lean();

  if (!updated) throw new AppError(404, 'Document not found', ErrorCodes.NOT_FOUND);
  return mapStudentDocument(updated);
}

export async function deleteDocument(userId: string, docId: string) {
  const profile = await ensureStudentProfile(userId);

  const deleted = await StudentDocument.findOneAndDelete({ _id: docId, studentId: profile._id }).lean();
  if (!deleted) throw new AppError(404, 'Document not found', ErrorCodes.NOT_FOUND);
  return { success: true };
}

export async function getMyDocuments(userId: string) {
  const profile = await ensureStudentProfile(userId);

  const list = await StudentDocument.find({ studentId: profile._id }).sort({ createdAt: -1 }).lean();
  return list.map((document) => mapStudentDocument(document as Record<string, unknown>));
}

export async function listPendingForAdmin() {
  const list = await StudentDocument.find({ status: 'pending' })
    .populate('studentId', 'userId firstName lastName')
    .sort({ createdAt: 1 })
    .lean();

  return list.map((document) => {
    const mapped = mapStudentDocument(document as Record<string, unknown>);
    const student = (document as Record<string, unknown>).studentId as
      | { _id?: unknown; userId?: unknown; firstName?: string; lastName?: string }
      | null;

    return {
      ...mapped,
      studentName: student ? [student.firstName, student.lastName].filter(Boolean).join(' ') || 'Student' : 'вЂ”',
    };
  });
}

export async function reviewDocument(
  docId: string,
  adminUserId: string,
  decision: 'approved' | 'rejected',
  rejectionReason?: string
) {
  const doc = await StudentDocument.findById(docId);
  if (!doc) throw new AppError(404, 'Document not found', ErrorCodes.NOT_FOUND);
  if (doc.status !== 'pending') throw new AppError(400, 'Document already reviewed', ErrorCodes.CONFLICT);

  await StudentDocument.findByIdAndUpdate(docId, {
    status: decision,
    reviewedAt: new Date(),
    reviewedBy: adminUserId,
    rejectionReason: decision === 'rejected' ? rejectionReason : undefined,
  });

  if (decision === 'approved') {
    await StudentProfile.findByIdAndUpdate(doc.studentId, { verifiedAt: new Date() });
  }

  const updated = await StudentDocument.findById(docId).lean();
  return updated ? mapStudentDocument(updated as Record<string, unknown>) : null;
}

function normalizeDocumentInput(data: StudentDocumentInput, current?: Record<string, unknown>) {
  const source = data.source ?? (current?.source as 'upload' | 'editor' | undefined) ?? (data.canvasJson ? 'editor' : 'upload');
  if (source !== 'upload' && source !== 'editor') {
    throw new AppError(400, 'Invalid document source', ErrorCodes.VALIDATION);
  }

  const name = normalizeOptionalString(data.name);
  const certificateType = normalizeOptionalString(data.certificateType);
  const score = normalizeOptionalString(data.score);
  const previewImageUrl = normalizeOptionalString(data.previewImageUrl);

  if (source === 'upload') {
    const fileUrl = normalizeOptionalString(data.fileUrl) ?? normalizeOptionalString(current?.fileUrl);
    if (!fileUrl) {
      throw new AppError(400, 'fileUrl is required for uploaded documents', ErrorCodes.VALIDATION);
    }

    return {
      source,
      fileUrl,
      name,
      certificateType,
      score,
      previewImageUrl,
      canvasJson: undefined,
      pageFormat: undefined,
      width: undefined,
      height: undefined,
      editorVersion: undefined,
    };
  }

  const pageFormat = (data.pageFormat ?? (current?.pageFormat as PageFormat | undefined) ?? 'A4_PORTRAIT') as PageFormat;
  if (!ALLOWED_PAGE_FORMATS.includes(pageFormat)) {
    throw new AppError(400, 'Invalid page format', ErrorCodes.VALIDATION);
  }

  const pageSize = getPageDimensions(
    pageFormat,
    normalizeMaybeNumber(data.width ?? current?.width),
    normalizeMaybeNumber(data.height ?? current?.height)
  );
  const rawCanvas = normalizeOptionalString(data.canvasJson) ?? normalizeOptionalString(current?.canvasJson);
  if (!rawCanvas) {
    throw new AppError(400, 'canvasJson is required for editor documents', ErrorCodes.VALIDATION);
  }

  const scene = parseScene(rawCanvas, pageFormat, pageSize.width, pageSize.height);

  return {
    source,
    fileUrl: undefined,
    name,
    certificateType,
    score,
    previewImageUrl,
    canvasJson: stringifyScene(scene),
    pageFormat,
    width: scene.page.width,
    height: scene.page.height,
    editorVersion: normalizeOptionalString(data.editorVersion) ?? scene.version ?? '1.0.0',
  };
}

function mapStudentDocument(document: Record<string, unknown>) {
  return {
    ...document,
    id: String(document._id),
    fileUrl: normalizeOptionalString(document.fileUrl),
    previewImageUrl: normalizeOptionalString(document.previewImageUrl),
    canvasJson: normalizeOptionalString(document.canvasJson),
    source: (document.source as string | undefined) ?? 'upload',
  };
}

function assertDocumentType(type: string) {
  if (!ALLOWED_TYPES.includes(type as (typeof ALLOWED_TYPES)[number])) {
    throw new AppError(400, 'Invalid document type', ErrorCodes.VALIDATION);
  }
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeMaybeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
