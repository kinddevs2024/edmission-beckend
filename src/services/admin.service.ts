import { User, UniversityProfile, Offer, Scholarship, ActivityLog, UniversityDocument } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';

export async function getDashboard() {
  const [users, universities, offers, pendingVerification] = await Promise.all([
    User.countDocuments(),
    UniversityProfile.countDocuments(),
    Offer.countDocuments({ status: 'pending' }),
    UniversityProfile.countDocuments({ verified: false }),
  ]);
  return { users, universities, pendingOffers: offers, pendingVerification };
}

export async function getUsers(query: { page?: number; limit?: number; role?: string }) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const where = query.role ? { role: query.role } : {};
  const [list, total] = await Promise.all([
    User.find(where).skip(skip).limit(limit).select('email role emailVerified suspended createdAt').lean(),
    User.countDocuments(where),
  ]);
  return {
    data: list.map((u) => ({ ...u, id: String((u as { _id: unknown })._id) })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function suspendUser(userId: string, suspend: boolean) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  if (user.role === 'admin') throw new AppError(403, 'Cannot suspend admin', ErrorCodes.FORBIDDEN);
  const updated = await User.findByIdAndUpdate(userId, { suspended: suspend }, { new: true }).lean();
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}

export async function getVerificationQueue() {
  const list = await UniversityProfile.find({ verified: false })
    .populate('userId', 'email')
    .lean();
  const withDocs = await Promise.all(
    list.map(async (u: Record<string, unknown>) => {
      const documents = await UniversityDocument.find({ universityId: u._id }).lean();
      const userId = u.userId as { email?: string } | undefined;
      return {
        ...u,
        id: String(u._id),
        user: userId && typeof userId === 'object' && 'email' in userId ? { email: String(userId.email) } : undefined,
        documents: documents.map((d: Record<string, unknown>) => ({ ...d, id: String(d._id) })),
      };
    })
  );
  return withDocs;
}

export async function verifyUniversity(universityId: string, approve: boolean) {
  const uni = await UniversityProfile.findById(universityId);
  if (!uni) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
  const updated = await UniversityProfile.findByIdAndUpdate(universityId, { verified: approve }, { new: true }).lean();
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}

export async function getScholarshipsMonitor() {
  const list = await Scholarship.find().populate('universityId', 'universityName').lean();
  return list.map((s: Record<string, unknown>) => {
    const uni = s.universityId as { universityName?: string } | undefined;
    return {
      ...s,
      id: String(s._id),
      university: uni && typeof uni === 'object' && 'universityName' in uni ? { universityName: String(uni.universityName) } : undefined,
    };
  });
}

export async function getLogs(query: { page?: number; limit?: number; userId?: string; action?: string }) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const where: { userId?: string; action?: string } = {};
  if (query.userId) where.userId = query.userId;
  if (query.action) where.action = query.action;
  const [list, total] = await Promise.all([
    ActivityLog.find(where).skip(skip).limit(limit).sort({ createdAt: -1 }).lean(),
    ActivityLog.countDocuments(where),
  ]);
  return {
    data: list.map((l) => ({ ...l, id: String((l as { _id: unknown })._id) })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
