import { StudentDocument, StudentProfile } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';

export async function addDocument(userId: string, data: { type: string; fileUrl: string; name?: string; certificateType?: string; score?: string }) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);
  const allowed = ['transcript', 'diploma', 'language_certificate', 'course_certificate', 'passport', 'id_card', 'other'];
  if (!allowed.includes(data.type)) throw new AppError(400, 'Invalid document type', ErrorCodes.VALIDATION);
  const doc = await StudentDocument.create({
    studentId: profile._id,
    type: data.type,
    fileUrl: data.fileUrl,
    name: data.name ? String(data.name).trim() : undefined,
    certificateType: data.certificateType ? String(data.certificateType).trim() : undefined,
    score: data.score != null ? String(data.score) : undefined,
    status: 'pending',
  });
  const d = doc.toObject() as Record<string, unknown>;
  return { ...d, id: String(d._id) };
}

export async function getMyDocuments(userId: string) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);
  const list = await StudentDocument.find({ studentId: profile._id }).sort({ createdAt: -1 }).lean();
  return list.map((d) => ({ ...d, id: String((d as { _id: unknown })._id) }));
}

export async function listPendingForAdmin() {
  const list = await StudentDocument.find({ status: 'pending' })
    .populate('studentId', 'userId firstName lastName')
    .sort({ createdAt: 1 })
    .lean();
  return list.map((d) => {
    const u = d as Record<string, unknown>;
    const st = u.studentId as { _id?: unknown; userId?: unknown; firstName?: string; lastName?: string } | null;
    return {
      ...u,
      id: String(u._id),
      studentName: st ? [st.firstName, st.lastName].filter(Boolean).join(' ') || 'Student' : '—',
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
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}
