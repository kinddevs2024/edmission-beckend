import bcrypt from 'bcrypt';
import {
  User,
  StudentProfile,
  UniversityProfile,
  Offer,
  Scholarship,
  ActivityLog,
  UniversityDocument,
  Subscription,
  Interest,
  Chat,
  Message,
  Notification,
  RefreshToken,
  AIConversation,
  Ticket,
  Recommendation,
  Faculty,
  Program,
  StudentDocument,
} from '../models';
import { AppError, ErrorCodes } from '../utils/errors';
import { DEFAULT_ADMIN_EMAIL } from '../config/defaultAdmin';
import * as subscriptionService from './subscription.service';
import * as ticketService from './ticket.service';
import * as studentDocumentService from './studentDocument.service';

const BCRYPT_ROUNDS = 12;

export async function getDashboard() {
  const [users, universities, offers, pendingVerification, subStats] = await Promise.all([
    User.countDocuments(),
    UniversityProfile.countDocuments(),
    Offer.countDocuments({ status: 'pending' }),
    UniversityProfile.countDocuments({ verified: false }),
    Subscription.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$plan', count: { $sum: 1 } } },
    ]),
  ]);
  const byPlan: Record<string, number> = {};
  for (const s of subStats) {
    byPlan[s._id] = s.count;
  }
  const mrr = (byPlan['student_standard'] ?? 0) * 9.99 + (byPlan['student_max_premium'] ?? 0) * 19.99 + (byPlan['university_premium'] ?? 0) * 29.99;
  return { users, universities, pendingOffers: offers, pendingVerification, subscriptionsByPlan: byPlan, mrr: Math.round(mrr * 100) / 100 };
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

export async function createUser(payload: { role: 'student' | 'university' | 'admin'; email: string; password: string; name?: string }) {
  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  const role = payload.role;
  const name = payload.name != null ? String(payload.name) : '';

  if (!email) throw new AppError(400, 'Email is required', ErrorCodes.VALIDATION);
  if (!password) throw new AppError(400, 'Password is required', ErrorCodes.VALIDATION);
  if (!['student', 'university', 'admin'].includes(role)) throw new AppError(400, 'Invalid role', ErrorCodes.VALIDATION);

  const existing = await User.findOne({ email });
  if (existing) throw new AppError(409, 'Email already registered', ErrorCodes.CONFLICT);

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await User.create({
    email,
    name,
    passwordHash,
    role,
    emailVerified: true,
    suspended: false,
  });

  if (role === 'student') {
    await StudentProfile.create({ userId: user._id });
  } else if (role === 'university') {
    // Университет, созданный админом, сразу верифицирован (без pending).
    await UniversityProfile.create({
      userId: user._id,
      universityName: name?.trim() ? name.trim() : 'New University',
      verified: true,
      onboardingCompleted: false,
    });
  }

  await subscriptionService.createForNewUser(String(user._id), role);
  const plain = user.toObject();
  return { ...plain, id: String(user._id) };
}

export async function getUserById(userId: string) {
  const u = await User.findById(userId).select('email name role emailVerified suspended createdAt').lean();
  if (!u) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  return { ...u, id: String((u as { _id: unknown })._id) };
}

export async function updateUser(userId: string, patch: { name?: string; emailVerified?: boolean; suspended?: boolean }) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  if (user.email === DEFAULT_ADMIN_EMAIL) {
    // Не даём менять критичные поля дефолтного админа через админку.
    if (patch.suspended !== undefined) throw new AppError(403, 'Cannot modify default admin', ErrorCodes.FORBIDDEN);
  }

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = String(patch.name);
  if (patch.emailVerified !== undefined) update.emailVerified = Boolean(patch.emailVerified);
  if (patch.suspended !== undefined) {
    if (user.email === DEFAULT_ADMIN_EMAIL) throw new AppError(403, 'Cannot suspend default admin', ErrorCodes.FORBIDDEN);
    if (user.role === 'admin') throw new AppError(403, 'Cannot suspend admin', ErrorCodes.FORBIDDEN);
    update.suspended = Boolean(patch.suspended);
  }

  const updated = await User.findByIdAndUpdate(userId, update, { new: true }).select('email name role emailVerified suspended createdAt').lean();
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}

export async function resetUserPassword(userId: string, newPassword: string) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  if (user.email === DEFAULT_ADMIN_EMAIL) throw new AppError(403, 'Cannot reset default admin password', ErrorCodes.FORBIDDEN);
  const passwordHash = await bcrypt.hash(String(newPassword || ''), BCRYPT_ROUNDS);
  await User.findByIdAndUpdate(userId, { passwordHash }, { new: true });
  return { success: true };
}

export async function getStudentProfileByUserId(userId: string) {
  const profile = await StudentProfile.findOne({ userId }).lean();
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);
  return { ...profile, id: String((profile as { _id: unknown })._id) };
}

export async function updateStudentProfileByUserId(userId: string, patch: Record<string, unknown>) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);
  const updated = await StudentProfile.findByIdAndUpdate(profile._id, patch, { new: true }).lean();
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}

export async function getUniversityProfileByUserId(userId: string) {
  const profile = await UniversityProfile.findOne({ userId }).lean();
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  return { ...profile, id: String((profile as { _id: unknown })._id) };
}

export async function updateUniversityProfileByUserId(userId: string, patch: Record<string, unknown>) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const updated = await UniversityProfile.findByIdAndUpdate(profile._id, patch, { new: true }).lean();
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}

export async function listOffers(query: { page?: number; limit?: number; status?: string }) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const where: Record<string, unknown> = {};
  if (query.status) where.status = query.status;
  const [list, total] = await Promise.all([
    Offer.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Offer.countDocuments(where),
  ]);
  return { data: list.map((o) => ({ ...o, id: String((o as { _id: unknown })._id) })), total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function updateOfferStatus(offerId: string, status: 'pending' | 'accepted' | 'declined') {
  const updated = await Offer.findByIdAndUpdate(offerId, { status }, { new: true }).lean();
  if (!updated) throw new AppError(404, 'Offer not found', ErrorCodes.NOT_FOUND);
  return { ...updated, id: String((updated as { _id: unknown })._id) };
}

export async function listInterests(query: { page?: number; limit?: number; status?: string }) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const where: Record<string, unknown> = {};
  if (query.status) where.status = query.status;
  const [list, total] = await Promise.all([
    Interest.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Interest.countDocuments(where),
  ]);
  return { data: list.map((i) => ({ ...i, id: String((i as { _id: unknown })._id) })), total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function updateInterestStatus(interestId: string, status: string) {
  const updated = await Interest.findByIdAndUpdate(interestId, { status }, { new: true }).lean();
  if (!updated) throw new AppError(404, 'Interest not found', ErrorCodes.NOT_FOUND);
  return { ...updated, id: String((updated as { _id: unknown })._id) };
}

export async function listChats(query: { page?: number; limit?: number }) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const [list, total] = await Promise.all([
    Chat.find({}).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Chat.countDocuments({}),
  ]);
  return { data: list.map((c) => ({ ...c, id: String((c as { _id: unknown })._id) })), total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function getChatMessages(chatId: string, query?: { limit?: number }) {
  const limit = Math.min(200, Math.max(1, query?.limit ?? 50));
  const chat = await Chat.findById(chatId).lean();
  if (!chat) throw new AppError(404, 'Chat not found', ErrorCodes.NOT_FOUND);
  const messages = await Message.find({ chatId }).sort({ createdAt: -1 }).limit(limit).lean();
  return {
    chat: { ...chat, id: String((chat as { _id: unknown })._id) },
    messages: messages.map((m) => ({ ...m, id: String((m as { _id: unknown })._id) })),
  };
}

export async function suspendUser(userId: string, suspend: boolean) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  if (user.email === DEFAULT_ADMIN_EMAIL) throw new AppError(403, 'Cannot suspend default admin', ErrorCodes.FORBIDDEN);
  if (user.role === 'admin') throw new AppError(403, 'Cannot suspend admin', ErrorCodes.FORBIDDEN);
  const updated = await User.findByIdAndUpdate(userId, { suspended: suspend }, { new: true }).lean();
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}

/** Delete a user and all related data. Cannot delete default admin or other admins. */
export async function deleteUser(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  if (user.email === DEFAULT_ADMIN_EMAIL) throw new AppError(403, 'Cannot delete default admin', ErrorCodes.FORBIDDEN);
  if (user.role === 'admin') throw new AppError(403, 'Cannot delete admin users', ErrorCodes.FORBIDDEN);

  const id = user._id;
  const role = user.role as string;

  await RefreshToken.deleteMany({ userId: id });
  await Notification.deleteMany({ userId: id });
  await ActivityLog.deleteMany({ userId: id });
  await AIConversation.deleteMany({ userId: id });
  await Ticket.deleteMany({ userId: id });
  await Message.deleteMany({ senderId: id });
  await Subscription.deleteMany({ userId: id });

  if (role === 'student') {
    const profile = await StudentProfile.findOne({ userId: id });
    if (profile) {
      const profileId = profile._id;
      await Interest.deleteMany({ studentId: profileId });
      await Offer.deleteMany({ studentId: profileId });
      await Recommendation.deleteMany({ studentId: profileId });
      await StudentDocument.deleteMany({ studentId: profileId });
      const chatIds = (await Chat.find({ studentId: profileId }).select('_id').lean()).map((c) => c._id);
      if (chatIds.length > 0) await Message.deleteMany({ chatId: { $in: chatIds } });
      await Chat.deleteMany({ studentId: profileId });
      await StudentProfile.deleteOne({ _id: profileId });
    }
  } else if (role === 'university') {
    const profile = await UniversityProfile.findOne({ userId: id });
    if (profile) {
      const profileId = profile._id;
      await Interest.deleteMany({ universityId: profileId });
      await Offer.deleteMany({ universityId: profileId });
      await Scholarship.deleteMany({ universityId: profileId });
      await Faculty.deleteMany({ universityId: profileId });
      await Program.deleteMany({ universityId: profileId });
      await UniversityDocument.deleteMany({ universityId: profileId });
      await Recommendation.deleteMany({ universityId: profileId });
      const chatIds = (await Chat.find({ universityId: profileId }).select('_id').lean()).map((c) => c._id);
      if (chatIds.length > 0) await Message.deleteMany({ chatId: { $in: chatIds } });
      await Chat.deleteMany({ universityId: profileId });
      await UniversityProfile.deleteOne({ _id: profileId });
    }
  }

  await User.deleteOne({ _id: id });
  return { deleted: true };
}

export async function getVerificationQueue() {
  const list = await UniversityProfile.find({
    verified: false,
    verificationRejectedAt: { $in: [null, undefined] },
  })
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
  const update = approve
    ? { verified: true, verificationRejectedAt: null }
    : { verified: false, verificationRejectedAt: new Date() };
  const updated = await UniversityProfile.findByIdAndUpdate(universityId, update, { new: true }).lean();
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

export async function getSubscriptions(query: {
  page?: number;
  limit?: number;
  role?: string;
  plan?: string;
  status?: string;
}) {
  return subscriptionService.listSubscriptions(query);
}

export async function getSubscriptionByUser(userId: string) {
  return subscriptionService.getSubscriptionByUserId(userId);
}

export async function updateUserSubscription(
  userId: string,
  data: { plan?: string; status?: string; trialEndsAt?: Date | null; currentPeriodEnd?: Date | null }
) {
  return subscriptionService.updateSubscription(userId, data);
}

export async function getTickets(query: { page?: number; limit?: number; status?: string; role?: string }) {
  return ticketService.listTickets(query);
}

export async function getTicketById(ticketId: string, adminUserId: string) {
  return ticketService.getTicketById(ticketId, adminUserId, true);
}

export async function updateTicketStatus(ticketId: string, status: string) {
  return ticketService.updateTicketStatus(ticketId, status);
}

export async function addTicketReply(ticketId: string, adminUserId: string, message: string) {
  return ticketService.addReply(ticketId, adminUserId, 'admin', message, true);
}

export async function getPendingDocuments() {
  return studentDocumentService.listPendingForAdmin();
}

export async function reviewDocument(docId: string, adminUserId: string, decision: 'approved' | 'rejected', rejectionReason?: string) {
  return studentDocumentService.reviewDocument(docId, adminUserId, decision, rejectionReason);
}
