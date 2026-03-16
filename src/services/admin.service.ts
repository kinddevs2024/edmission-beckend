import bcrypt from 'bcrypt';
import {
  User,
  StudentProfile,
  UniversityProfile,
  UniversityCatalog,
  UniversityVerificationRequest,
  Offer,
  Scholarship,
  ActivityLog,
  UniversityDocument,
  Subscription,
  Interest,
  CatalogInterest,
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
  Investor,
  LandingCertificate,
} from '../models';
import { AppError, ErrorCodes } from '../utils/errors';
import { toObjectIdString } from '../utils/objectId';
import { safeRegExp } from '../utils/validators';
import { DEFAULT_ADMIN_EMAIL } from '../config/defaultAdmin';
import * as subscriptionService from './subscription.service';
import * as ticketService from './ticket.service';
import * as studentDocumentService from './studentDocument.service';
import * as emailService from './email.service';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';

const BCRYPT_ROUNDS = 12;
const INVITE_TOKEN_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000;

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

/** Top universities by student interest count (for admin analytics). */
export async function getUniversityInterestAnalytics(limit: number = 20) {
  const cap = Math.min(50, Math.max(1, limit));
  const [profileAgg, catalogAgg] = await Promise.all([
    Interest.aggregate([
      { $group: { _id: '$universityId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: cap },
      {
        $lookup: {
          from: 'universityprofiles',
          localField: '_id',
          foreignField: '_id',
          as: 'uni',
        },
      },
      { $unwind: { path: '$uni', preserveNullAndEmptyArrays: true } },
      { $project: { universityId: { $toString: '$_id' }, count: 1, name: '$uni.universityName' } },
    ]).exec(),
    CatalogInterest.aggregate([
      { $group: { _id: '$catalogUniversityId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: cap },
      {
        $lookup: {
          from: 'universitycatalogs',
          localField: '_id',
          foreignField: '_id',
          as: 'uni',
        },
      },
      { $unwind: { path: '$uni', preserveNullAndEmptyArrays: true } },
      { $project: { universityId: { $toString: '$_id' }, count: 1, name: '$uni.universityName' } },
    ]).exec(),
  ]);
  const profileItems = profileAgg.map((r: { universityId: string; count: number; name?: string }) => ({
    universityId: r.universityId,
    universityName: r.name ?? '—',
    interestCount: r.count,
    source: 'profile' as const,
  }));
  const catalogItems = catalogAgg.map((r: { universityId: string; count: number; name?: string }) => ({
    universityId: r.universityId,
    universityName: r.name ?? '—',
    interestCount: r.count,
    source: 'catalog' as const,
  }));
  const merged = [...profileItems, ...catalogItems].sort((a, b) => b.interestCount - a.interestCount).slice(0, cap);
  return merged;
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

export async function createUser(payload: { role: 'student' | 'university' | 'admin'; email: string; password?: string; name?: string }) {
  const email = String(payload.email || '').trim().toLowerCase();
  const password = payload.password != null ? String(payload.password) : undefined;
  const role = payload.role;
  const name = payload.name != null ? String(payload.name) : '';

  if (!email) throw new AppError(400, 'Email is required', ErrorCodes.VALIDATION);
  if (!['student', 'university', 'admin'].includes(role)) throw new AppError(400, 'Invalid role', ErrorCodes.VALIDATION);

  const existing = await User.findOne({ email });
  if (existing) throw new AppError(409, 'Email already registered', ErrorCodes.CONFLICT);

  const isInvite = !password || password.trim() === '';
  const passwordHash = isInvite
    ? await bcrypt.hash(uuidv4() + Date.now(), BCRYPT_ROUNDS)
    : await bcrypt.hash(password!, BCRYPT_ROUNDS);

  const inviteToken = isInvite ? uuidv4() : undefined;
  const inviteTokenExpires = isInvite ? new Date(Date.now() + INVITE_TOKEN_EXPIRES_MS) : undefined;

  const user = await User.create({
    email,
    name,
    passwordHash,
    role,
    emailVerified: true,
    suspended: false,
    resetToken: inviteToken,
    resetTokenExpires: inviteTokenExpires,
  });

  if (role === 'student') {
    await StudentProfile.create({ userId: user._id });
  } else if (role === 'university') {
    await UniversityProfile.create({
      userId: user._id,
      universityName: name?.trim() ? name.trim() : 'New University',
      verified: true,
      onboardingCompleted: false,
    });
  }

  await subscriptionService.createForNewUser(String(user._id), role);

  if (isInvite && inviteToken && (config.email?.enabled || config.email?.sendgridApiKey)) {
    await emailService.sendInviteSetPasswordEmail(user.email, inviteToken);
  }

  const plain = user.toObject();
  return { ...plain, id: String(user._id) };
}

export async function getUserById(userId: string) {
  const u = await User.findById(userId).select('email name role emailVerified suspended createdAt').lean();
  if (!u) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  return { ...u, id: String((u as { _id: unknown })._id) };
}

export async function updateUser(userId: string, patch: { name?: string; role?: 'student' | 'university' | 'admin' | 'school_counsellor'; emailVerified?: boolean; suspended?: boolean }) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  if (user.email === DEFAULT_ADMIN_EMAIL) {
    if (patch.suspended !== undefined) throw new AppError(403, 'Cannot modify default admin', ErrorCodes.FORBIDDEN);
    if (patch.role !== undefined) throw new AppError(403, 'Cannot change default admin role', ErrorCodes.FORBIDDEN);
  }

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = String(patch.name);
  if (patch.role !== undefined) update.role = patch.role;
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

const STUDENT_PROFILE_WHITELIST = new Set([
  'firstName', 'lastName', 'birthDate', 'country', 'city', 'gradeLevel', 'gpa', 'languageLevel', 'languages',
  'bio', 'avatarUrl', 'budgetAmount', 'budgetCurrency', 'educationStatus', 'schoolCompleted', 'schoolName',
  'graduationYear', 'gradingScheme', 'gradeScale', 'highestEducationLevel', 'targetDegreeLevel', 'schoolsAttended',
  'skills', 'interests', 'hobbies', 'experiences', 'portfolioWorks', 'interestedFaculties', 'preferredCountries',
]);

export async function updateStudentProfileByUserId(userId: string, patch: Record<string, unknown>) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);
  const filtered = Object.fromEntries(Object.entries(patch).filter(([k]) => STUDENT_PROFILE_WHITELIST.has(k)));
  const updated = await StudentProfile.findByIdAndUpdate(profile._id, filtered, { new: true }).lean();
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}

export async function getUniversityProfileByUserId(userId: string) {
  const profile = await UniversityProfile.findOne({ userId }).lean();
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  return { ...profile, id: String((profile as { _id: unknown })._id) };
}

const UNIVERSITY_PROFILE_WHITELIST = new Set([
  'universityName', 'tagline', 'establishedYear', 'studentCount', 'country', 'city', 'description', 'logoUrl',
  'verified', 'onboardingCompleted', 'facultyCodes', 'facultyItems', 'targetStudentCountries',
  'minLanguageLevel', 'tuitionPrice',
]);

export async function updateUniversityProfileByUserId(userId: string, patch: Record<string, unknown>) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const filtered = Object.fromEntries(Object.entries(patch).filter(([k]) => UNIVERSITY_PROFILE_WHITELIST.has(k)));
  if (filtered.minLanguageLevel !== undefined) {
    (filtered as Record<string, unknown>).minLanguageLevel = filtered.minLanguageLevel != null ? String(filtered.minLanguageLevel).trim() || null : null;
  }
  if (filtered.tuitionPrice !== undefined) {
    (filtered as Record<string, unknown>).tuitionPrice = filtered.tuitionPrice != null ? Number(filtered.tuitionPrice) : null;
  }
  const updated = await UniversityProfile.findByIdAndUpdate(profile._id, filtered, { new: true }).lean();
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
  const whereProfile: Record<string, unknown> = {};
  const whereCatalog: Record<string, unknown> = {};
  if (query.status) {
    whereProfile.status = query.status;
    whereCatalog.status = query.status;
  }
  const fetchLimit = skip + limit;
  const [profileList, profileTotal, catalogList, catalogTotal] = await Promise.all([
    Interest.find(whereProfile).sort({ createdAt: -1 }).limit(fetchLimit).lean(),
    Interest.countDocuments(whereProfile),
    CatalogInterest.find(whereCatalog).sort({ createdAt: -1 }).limit(fetchLimit).lean(),
    CatalogInterest.countDocuments(whereCatalog),
  ]);
  const profileItems = profileList.map((i) => {
    const x = i as Record<string, unknown>;
    return { ...x, id: String(x._id), source: 'profile' as const, universityId: x.universityId };
  });
  const catalogItems = catalogList.map((i) => {
    const x = i as Record<string, unknown>;
    return { ...x, id: `catalog-${x._id}`, source: 'catalog' as const, universityId: x.catalogUniversityId };
  });
  const merged = [...profileItems, ...catalogItems].sort(
    (a, b) => new Date((b as { createdAt?: Date }).createdAt ?? 0).getTime() - new Date((a as { createdAt?: Date }).createdAt ?? 0).getTime()
  );
  const total = profileTotal + catalogTotal;
  const data = merged.slice(skip, skip + limit);
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function updateInterestStatus(interestId: string, status: string) {
  if (interestId.startsWith('catalog-')) {
    const catalogId = interestId.replace(/^catalog-/, '');
    const updated = await CatalogInterest.findByIdAndUpdate(catalogId, { status }, { new: true }).lean();
    if (!updated) throw new AppError(404, 'Interest not found', ErrorCodes.NOT_FOUND);
    const x = updated as Record<string, unknown>;
    return { ...x, id: `catalog-${x._id}`, source: 'catalog' as const };
  }
  const updated = await Interest.findByIdAndUpdate(interestId, { status }, { new: true }).lean();
  if (!updated) throw new AppError(404, 'Interest not found', ErrorCodes.NOT_FOUND);
  const x = updated as Record<string, unknown>;
  return { ...x, id: String(x._id), source: 'profile' as const };
}

export async function listChats(query: { page?: number; limit?: number; universityId?: string }) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const filter: Record<string, unknown> = {};
  if (query.universityId) filter.universityId = toObjectIdString(query.universityId);
  const [list, total, universities] = await Promise.all([
    Chat.find(filter).populate('universityId', 'universityName').populate('studentId', 'firstName lastName').sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Chat.countDocuments(filter),
    UniversityProfile.find({}).select('_id universityName').sort({ universityName: 1 }).lean(),
  ]);
  const data = list.map((c) => {
    const x = c as Record<string, unknown>;
    return { ...x, id: String(x._id), universityName: (x.universityId as { universityName?: string })?.universityName, studentName: x.studentId ? `${(x.studentId as { firstName?: string }).firstName ?? ''} ${(x.studentId as { lastName?: string }).lastName ?? ''}`.trim() : '—' };
  });
  return { data, total, page, limit, totalPages: Math.ceil(total / limit), universities: universities.map((u) => ({ id: String((u as { _id: unknown })._id), name: (u as { universityName?: string }).universityName ?? '' })) };
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

export async function sendChatMessageAsUniversity(chatId: string, adminUserId: string, text: string) {
  const chat = await Chat.findById(chatId)
    .populate('universityId', 'userId')
    .lean();
  if (!chat) throw new AppError(404, 'Chat not found', ErrorCodes.NOT_FOUND);
  const university = (chat as { universityId?: { userId?: unknown } }).universityId;
  if (!university || typeof university !== 'object' || !(university as { userId?: unknown }).userId) {
    throw new AppError(400, 'Chat has no university', ErrorCodes.VALIDATION);
  }
  const universityUserId = String((university as { userId: unknown }).userId);
  const chatService = await import('./chat.service');
  const result = await chatService.saveMessage(chatId, universityUserId, { text: text.trim(), type: 'text' });
  return result;
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
  const ids = list.map((u: Record<string, unknown>) => u._id);
  const allDocs = await UniversityDocument.find({ universityId: { $in: ids } }).lean();
  const docsByUni = new Map<string, Record<string, unknown>[]>();
  for (const d of allDocs as { universityId?: unknown; _id?: unknown }[]) {
    const key = String(d.universityId);
    if (!docsByUni.has(key)) docsByUni.set(key, []);
    docsByUni.get(key)!.push({ ...d, id: String(d._id) });
  }
  return list.map((u: Record<string, unknown>) => {
    const userId = u.userId as { email?: string } | undefined;
    const documents = docsByUni.get(String(u._id)) ?? [];
    return {
      ...u,
      id: String(u._id),
      user: userId && typeof userId === 'object' && 'email' in userId ? { email: String(userId.email) } : undefined,
      documents,
    };
  });
}

export async function verifyUniversity(universityId: unknown, approve: boolean) {
  const uid = toObjectIdString(universityId);
  if (!uid) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
  const uni = await UniversityProfile.findById(uid);
  if (!uni) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
  const update = approve
    ? { verified: true, verificationRejectedAt: null }
    : { verified: false, verificationRejectedAt: new Date() };
  const updated = await UniversityProfile.findByIdAndUpdate(uid, update, { new: true }).lean();
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

// ——— University catalog (for registration flow) ———

export async function getCatalogUniversities(query: { page?: number; limit?: number; search?: string }) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;
  const filter: Record<string, unknown> = {};
  if (query.search?.trim()) {
    const re = safeRegExp(query.search.trim());
    filter.$or = [
      { universityName: re },
      { city: re },
      { country: re },
    ];
  }
  const [list, total] = await Promise.all([
    UniversityCatalog.find(filter).sort({ universityName: 1 }).skip(skip).limit(limit).lean(),
    UniversityCatalog.countDocuments(filter),
  ]);
  return {
    data: list.map((u) => ({ ...u, id: String((u as { _id: unknown })._id), name: (u as { universityName?: string }).universityName ?? '' })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function createCatalogUniversity(body: Record<string, unknown>) {
  const doc = await UniversityCatalog.create({
    universityName: typeof body.universityName === 'string' ? body.universityName : '',
    tagline: typeof body.tagline === 'string' ? body.tagline : undefined,
    establishedYear: typeof body.establishedYear === 'number' ? body.establishedYear : undefined,
    studentCount: typeof body.studentCount === 'number' ? body.studentCount : undefined,
    country: typeof body.country === 'string' ? body.country : undefined,
    city: typeof body.city === 'string' ? body.city : undefined,
    description: typeof body.description === 'string' ? body.description : undefined,
    logoUrl: typeof body.logoUrl === 'string' ? body.logoUrl : undefined,
    facultyCodes: Array.isArray(body.facultyCodes) ? body.facultyCodes.map(String).filter(Boolean).slice(0, 50) : undefined,
    facultyItems: typeof body.facultyItems === 'object' && body.facultyItems !== null && !Array.isArray(body.facultyItems)
      ? (body.facultyItems as Record<string, string[]>) : undefined,
    targetStudentCountries: Array.isArray(body.targetStudentCountries) ? body.targetStudentCountries.map(String).filter(Boolean).slice(0, 50) : undefined,
    minLanguageLevel: typeof body.minLanguageLevel === 'string' ? (body.minLanguageLevel.trim() || undefined) : undefined,
    tuitionPrice: typeof body.tuitionPrice === 'number' ? body.tuitionPrice : (body.tuitionPrice != null && body.tuitionPrice !== '' ? Number(body.tuitionPrice) : undefined),
    programs: Array.isArray(body.programs) ? body.programs.slice(0, 50).map((p: Record<string, unknown>) => ({
      name: p.name != null ? String(p.name) : '',
      degreeLevel: p.degreeLevel != null ? String(p.degreeLevel) : '',
      field: p.field != null ? String(p.field) : '',
      durationYears: p.durationYears != null ? Number(p.durationYears) : undefined,
      tuitionFee: p.tuitionFee != null ? Number(p.tuitionFee) : undefined,
      language: p.language != null ? String(p.language) : undefined,
      entryRequirements: p.entryRequirements != null ? String(p.entryRequirements) : undefined,
    })) : undefined,
    scholarships: Array.isArray(body.scholarships) ? body.scholarships.slice(0, 30).map((s: Record<string, unknown>) => ({
      name: s.name != null ? String(s.name) : '',
      coveragePercent: s.coveragePercent != null ? Number(s.coveragePercent) : 0,
      maxSlots: s.maxSlots != null ? Number(s.maxSlots) : 0,
      deadline: s.deadline ? new Date(s.deadline as string) : undefined,
      eligibility: s.eligibility != null ? String(s.eligibility) : undefined,
    })) : undefined,
  });
  return { ...doc.toObject(), id: String(doc._id) };
}

export async function getCatalogUniversityById(id: string) {
  const doc = await UniversityCatalog.findById(id).lean();
  if (!doc) throw new AppError(404, 'Catalog university not found', ErrorCodes.NOT_FOUND);
  return { ...doc, id: String((doc as { _id: unknown })._id), name: (doc as { universityName?: string }).universityName ?? '' };
}

export async function updateCatalogUniversity(id: string, body: Record<string, unknown>) {
  const doc = await UniversityCatalog.findByIdAndUpdate(
    id,
    {
      ...(typeof body.universityName === 'string' && { universityName: body.universityName }),
      ...(typeof body.tagline === 'string' && { tagline: body.tagline }),
      ...(typeof body.establishedYear === 'number' && { establishedYear: body.establishedYear }),
      ...(typeof body.studentCount === 'number' && { studentCount: body.studentCount }),
      ...(typeof body.country === 'string' && { country: body.country }),
      ...(typeof body.city === 'string' && { city: body.city }),
      ...(typeof body.description === 'string' && { description: body.description }),
      ...(typeof body.logoUrl === 'string' && { logoUrl: body.logoUrl }),
      ...(Array.isArray(body.facultyCodes) && { facultyCodes: body.facultyCodes.map(String).filter(Boolean).slice(0, 50) }),
      ...(body.facultyItems !== undefined && {
        facultyItems: typeof body.facultyItems === 'object' && body.facultyItems !== null && !Array.isArray(body.facultyItems)
          ? body.facultyItems as Record<string, string[]>
          : undefined,
      }),
      ...(Array.isArray(body.targetStudentCountries) && { targetStudentCountries: body.targetStudentCountries.map(String).filter(Boolean).slice(0, 50) }),
      ...(typeof body.minLanguageLevel === 'string' && { minLanguageLevel: body.minLanguageLevel.trim() || undefined }),
      ...(body.tuitionPrice !== undefined && { tuitionPrice: body.tuitionPrice != null && body.tuitionPrice !== '' ? Number(body.tuitionPrice) : undefined }),
      ...(Array.isArray(body.programs) && {
        programs: body.programs.slice(0, 50).map((p: Record<string, unknown>) => ({
          name: p.name != null ? String(p.name) : '',
          degreeLevel: p.degreeLevel != null ? String(p.degreeLevel) : '',
          field: p.field != null ? String(p.field) : '',
          durationYears: p.durationYears != null ? Number(p.durationYears) : undefined,
          tuitionFee: p.tuitionFee != null ? Number(p.tuitionFee) : undefined,
          language: p.language != null ? String(p.language) : undefined,
          entryRequirements: p.entryRequirements != null ? String(p.entryRequirements) : undefined,
        })),
      }),
      ...(Array.isArray(body.scholarships) && {
        scholarships: body.scholarships.slice(0, 30).map((s: Record<string, unknown>) => ({
          name: s.name != null ? String(s.name) : '',
          coveragePercent: s.coveragePercent != null ? Number(s.coveragePercent) : 0,
          maxSlots: s.maxSlots != null ? Number(s.maxSlots) : 0,
          deadline: s.deadline ? new Date(s.deadline as string) : undefined,
          eligibility: s.eligibility != null ? String(s.eligibility) : undefined,
        })),
      }),
    },
    { new: true }
  ).lean();
  if (!doc) throw new AppError(404, 'Catalog university not found', ErrorCodes.NOT_FOUND);
  return { ...doc, id: String((doc as { _id: unknown })._id) };
}

export async function deleteCatalogUniversity(id: string) {
  const catalog = await UniversityCatalog.findById(id);
  if (!catalog) throw new AppError(404, 'Catalog university not found', ErrorCodes.NOT_FOUND);
  await CatalogInterest.deleteMany({ catalogUniversityId: id });
  await UniversityVerificationRequest.deleteMany({ universityCatalogId: id });
  await UniversityCatalog.findByIdAndDelete(id);
  return { deleted: true };
}

export async function getUniversityVerificationRequests(query: { status?: string }) {
  const filter: Record<string, string> = {};
  if (query.status === 'pending' || query.status === 'approved' || query.status === 'rejected') filter.status = query.status;
  const list = await UniversityVerificationRequest.find(filter)
    .populate('universityCatalogId', 'universityName country city')
    .populate('userId', 'email')
    .sort({ createdAt: -1 })
    .lean();
  return list.map((r: Record<string, unknown>) => {
    const catalog = r.universityCatalogId as { universityName?: string; country?: string; city?: string } | undefined;
    const user = r.userId as { email?: string } | undefined;
    return {
      ...r,
      id: String(r._id),
      university: catalog ? { name: catalog.universityName, country: catalog.country, city: catalog.city } : undefined,
      userEmail: user?.email,
    };
  });
}

export async function approveUniversityRequest(requestId: string, adminUserId: string) {
  const request = await UniversityVerificationRequest.findById(requestId).populate('universityCatalogId');
  if (!request) throw new AppError(404, 'Request not found', ErrorCodes.NOT_FOUND);
  if ((request as { status: string }).status === 'approved') {
    return { approved: true, profileId: '', alreadyProcessed: true };
  }
  if ((request as { status: string }).status === 'rejected') {
    return { approved: false, alreadyProcessed: true };
  }
  const catalog = request.universityCatalogId as unknown as { _id: unknown; universityName: string; tagline?: string; establishedYear?: number; studentCount?: number; country?: string; city?: string; description?: string; logoUrl?: string; facultyCodes?: string[]; facultyItems?: Record<string, string[]>; targetStudentCountries?: string[]; programs?: Array<Record<string, unknown>>; scholarships?: Array<Record<string, unknown>> };
  if (!catalog) throw new AppError(404, 'Catalog university not found', ErrorCodes.NOT_FOUND);
  const userId = (request as { userId: unknown }).userId;

  const profile = await UniversityProfile.create({
    userId,
    universityName: catalog.universityName ?? '',
    tagline: catalog.tagline,
    establishedYear: catalog.establishedYear,
    studentCount: catalog.studentCount,
    country: catalog.country,
    city: catalog.city,
    description: catalog.description,
    logoUrl: catalog.logoUrl,
    verified: true,
    onboardingCompleted: false,
    facultyCodes: catalog.facultyCodes ?? [],
    facultyItems: catalog.facultyItems ?? undefined,
    targetStudentCountries: catalog.targetStudentCountries ?? [],
  });

  const programs = catalog.programs ?? [];
  for (const p of programs) {
    await Program.create({
      universityId: profile._id,
      name: p.name ?? '',
      degreeLevel: p.degreeLevel ?? '',
      field: p.field ?? '',
      durationYears: p.durationYears != null ? Number(p.durationYears) : undefined,
      tuitionFee: p.tuitionFee != null ? Number(p.tuitionFee) : undefined,
      language: p.language != null ? String(p.language) : undefined,
      entryRequirements: p.entryRequirements != null ? String(p.entryRequirements) : undefined,
    });
  }

  const scholarships = catalog.scholarships ?? [];
  for (const s of scholarships) {
    const maxSlots = s.maxSlots != null ? Number(s.maxSlots) : 1;
    await Scholarship.create({
      universityId: profile._id,
      name: s.name ?? '',
      coveragePercent: s.coveragePercent != null ? Number(s.coveragePercent) : 0,
      maxSlots,
      remainingSlots: maxSlots,
      deadline: s.deadline ? new Date(s.deadline as string) : undefined,
      eligibility: s.eligibility != null ? String(s.eligibility) : undefined,
    });
  }

  await UniversityVerificationRequest.findByIdAndUpdate(requestId, {
    status: 'approved',
    reviewedAt: new Date(),
    reviewedBy: adminUserId,
  });

  await UniversityCatalog.findByIdAndUpdate(catalog._id, {
    linkedUniversityProfileId: profile._id,
  });

  const notificationService = await import('./notification.service');
  await notificationService.createNotification(String(userId), {
    type: 'university_approved',
    title: 'University account approved',
    body: `Your request for ${catalog.universityName} has been approved. You can now sign in and complete your profile.`,
    referenceType: 'university',
    referenceId: String(profile._id),
  });

  return { approved: true, profileId: String(profile._id) };
}

export async function rejectUniversityRequest(requestId: string, adminUserId: string) {
  const request = await UniversityVerificationRequest.findById(requestId);
  if (!request) throw new AppError(404, 'Request not found', ErrorCodes.NOT_FOUND);
  if ((request as { status: string }).status !== 'pending') {
    return { rejected: true, alreadyProcessed: true };
  }
  await UniversityVerificationRequest.findByIdAndUpdate(requestId, {
    status: 'rejected',
    reviewedAt: new Date(),
    reviewedBy: adminUserId,
  });
  return { rejected: true };
}

// ——— Investors ———

export async function getInvestors() {
  const list = await Investor.find().sort({ order: 1, name: 1 }).lean();
  return list.map((i) => ({ ...i, id: String((i as { _id: unknown })._id) }));
}

export async function createInvestor(body: { name: string; logoUrl?: string; websiteUrl?: string; description?: string; order?: number }) {
  const name = String(body.name ?? '').trim();
  if (!name) throw new AppError(400, 'Name is required', ErrorCodes.VALIDATION);
  const doc = await Investor.create({
    name,
    logoUrl: body.logoUrl?.trim() || undefined,
    websiteUrl: body.websiteUrl?.trim() || undefined,
    description: body.description?.trim() || undefined,
    order: body.order != null ? Number(body.order) : 0,
  });
  return { ...doc.toObject(), id: String(doc._id) };
}

export async function deleteInvestor(id: string) {
  const doc = await Investor.findByIdAndDelete(id);
  if (!doc) throw new AppError(404, 'Investor not found', ErrorCodes.NOT_FOUND);
  return { deleted: true };
}

// ——— Landing Certificates ———

export async function listLandingCertificates() {
  const list = await LandingCertificate.find().sort({ order: 1, createdAt: 1 }).lean();
  return list.map((c) => ({ ...c, id: String((c as { _id: unknown })._id) }));
}

export async function createLandingCertificate(body: { type: 'university' | 'student'; title: string; imageUrl: string; order?: number }) {
  const doc = await LandingCertificate.create({
    type: body.type,
    title: String(body.title ?? '').trim(),
    imageUrl: String(body.imageUrl ?? '').trim(),
    order: body.order != null ? Number(body.order) : 0,
  });
  return { ...doc.toObject(), id: String(doc._id) };
}

export async function updateLandingCertificate(id: string, body: { type?: 'university' | 'student'; title?: string; imageUrl?: string; order?: number }) {
  const update: Record<string, unknown> = {};
  if (body.type !== undefined) update.type = body.type;
  if (body.title !== undefined) update.title = String(body.title).trim();
  if (body.imageUrl !== undefined) update.imageUrl = String(body.imageUrl).trim();
  if (body.order !== undefined) update.order = Number(body.order);
  const doc = await LandingCertificate.findByIdAndUpdate(id, update, { new: true }).lean();
  if (!doc) throw new AppError(404, 'Landing certificate not found', ErrorCodes.NOT_FOUND);
  return { ...doc, id: String((doc as { _id: unknown })._id) };
}

export async function deleteLandingCertificate(id: string) {
  const doc = await LandingCertificate.findByIdAndDelete(id);
  if (!doc) throw new AppError(404, 'Landing certificate not found', ErrorCodes.NOT_FOUND);
  return { deleted: true };
}

// ——— Universities Excel import / template ———

function parseNumFromText(s: unknown): number | undefined {
  if (s == null || s === '') return undefined;
  const str = String(s).trim();
  if (!str || /^varies$/i.test(str) || /^n\/a$/i.test(str)) return undefined;
  const match = str.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function parseDateFromText(s: unknown): Date | undefined {
  if (s == null || s === '') return undefined;
  const str = String(s).trim();
  if (!str || /^varies$/i.test(str)) return undefined;
  const d = new Date(str);
  return isNaN(d.getTime()) ? undefined : d;
}

function splitList(s: unknown): string[] {
  if (s == null || s === '') return [];
  return String(s)
    .split(/[;,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 50);
}

/** Parse universities Excel buffer (Universities + Programs + Scholarships sheets). Returns array of bodies for createCatalogUniversity. */
export function parseUniversitiesExcel(buffer: Buffer): Record<string, unknown>[] {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetNames = wb.SheetNames || [];

  const universitiesSheet = sheetNames.find((n: string) => /universit/i.test(n)) || sheetNames[0];
  const programsSheet = sheetNames.find((n: string) => /program/i.test(n));
  const scholarshipsSheet = sheetNames.find((n: string) => /scholarship/i.test(n));

  const uniRows = XLSX.utils.sheet_to_json(wb.Sheets[universitiesSheet] || {}) as Record<string, unknown>[];
  if (!uniRows.length) return [];

  const programsByUni = new Map<string, Array<{ name: string; degreeLevel?: string; field?: string; durationYears?: number; tuitionFee?: number; language?: string; entryRequirements?: string }>>();
  if (programsSheet && wb.Sheets[programsSheet]) {
    const progRows = XLSX.utils.sheet_to_json(wb.Sheets[programsSheet]) as Record<string, unknown>[];
    for (const row of progRows) {
      const uniName = String(row['University name'] ?? row['universityName'] ?? '').trim();
      if (!uniName) continue;
      const list = programsByUni.get(uniName) || [];
      list.push({
        name: String(row['Program name'] ?? row['programName'] ?? '').trim() || 'Program',
        degreeLevel: String(row['Degree'] ?? row['degreeLevel'] ?? '').trim() || undefined,
        field: String(row['Field'] ?? row['field'] ?? '').trim() || undefined,
        durationYears: parseNumFromText(row['Years'] ?? row['durationYears']),
        tuitionFee: parseNumFromText(row['Tuition'] ?? row['tuitionFee'] ?? row['Tuition']),
        language: String(row['Language'] ?? row['language'] ?? '').trim() || undefined,
        entryRequirements: String(row['Entry requirements'] ?? row['entryRequirements'] ?? '').trim() || undefined,
      });
      programsByUni.set(uniName, list);
    }
  }

  const scholarshipsByUni = new Map<string, Array<{ name: string; coveragePercent: number; maxSlots: number; deadline?: Date; eligibility?: string }>>();
  if (scholarshipsSheet && wb.Sheets[scholarshipsSheet]) {
    const schRows = XLSX.utils.sheet_to_json(wb.Sheets[scholarshipsSheet]) as Record<string, unknown>[];
    for (const row of schRows) {
      const uniName = String(row['University name'] ?? row['universityName'] ?? '').trim();
      if (!uniName) continue;
      const list = scholarshipsByUni.get(uniName) || [];
      list.push({
        name: String(row['Scholarship name'] ?? row['scholarshipName'] ?? '').trim() || 'Scholarship',
        coveragePercent: parseNumFromText(row['Coverage %'] ?? row['coveragePercent']) ?? 0,
        maxSlots: parseNumFromText(row['Max slots'] ?? row['maxSlots']) ?? 0,
        deadline: parseDateFromText(row['Deadline'] ?? row['deadline']),
        eligibility: String(row['Eligibility'] ?? row['eligibility'] ?? '').trim() || undefined,
      });
      scholarshipsByUni.set(uniName, list);
    }
  }

  const result: Record<string, unknown>[] = [];
  for (const row of uniRows) {
    const universityName = String(row['University name'] ?? row['universityName'] ?? '').trim();
    if (!universityName) continue;

    const tuitionPrice = parseNumFromText(row['Minimum tuition (annual)'] ?? row['tuitionPrice']);
    const establishedYear = parseNumFromText(row['Year founded'] ?? row['establishedYear']);
    const studentCount = parseNumFromText(row['Number of students'] ?? row['studentCount']);
    const facultiesRaw = row['Faculties'] ?? row['faculties'];
    const targetRaw = row['Target student countries'] ?? row['targetStudentCountries'];
    const facultyCodes = splitList(facultiesRaw);
    const targetStudentCountries = splitList(targetRaw);

    const body: Record<string, unknown> = {
      universityName,
      country: String(row['Country'] ?? row['country'] ?? '').trim() || undefined,
      city: String(row['City'] ?? row['city'] ?? '').trim() || undefined,
      tagline: String(row['Slogan'] ?? row['tagline'] ?? '').trim() || undefined,
      logoUrl: String(row['Logo URL'] ?? row['logoUrl'] ?? '').trim() || undefined,
      description: String(row['Description'] ?? row['description'] ?? '').trim() || undefined,
      minLanguageLevel: String(row['Minimum requirements'] ?? row['minLanguageLevel'] ?? '').trim() || undefined,
      tuitionPrice: tuitionPrice != null ? tuitionPrice : undefined,
      establishedYear: establishedYear != null ? establishedYear : undefined,
      studentCount: studentCount != null ? studentCount : undefined,
      facultyCodes: facultyCodes.length ? facultyCodes : undefined,
      targetStudentCountries: targetStudentCountries.length ? targetStudentCountries : undefined,
      programs: (programsByUni.get(universityName) || []).slice(0, 50),
      scholarships: (scholarshipsByUni.get(universityName) || []).slice(0, 30).map((s) => ({
        name: s.name,
        coveragePercent: s.coveragePercent,
        maxSlots: s.maxSlots,
        deadline: s.deadline ? (s.deadline instanceof Date ? s.deadline.toISOString().slice(0, 10) : String(s.deadline)) : undefined,
        eligibility: s.eligibility,
      })),
    };
    result.push(body);
  }
  return result;
}

/** Import universities from Excel buffer: parse and create each. Returns created count and errors. */
export async function importUniversitiesFromExcel(buffer: Buffer): Promise<{ created: number; errors: Array<{ row: number; name: string; message: string }> }> {
  const rows = parseUniversitiesExcel(buffer);
  const errors: Array<{ row: number; name: string; message: string }> = [];
  let created = 0;
  for (let i = 0; i < rows.length; i++) {
    const body = rows[i];
    const name = String(body.universityName ?? '').trim();
    try {
      await createCatalogUniversity(body);
      created++;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ row: i + 2, name, message });
    }
  }
  return { created, errors };
}

/** Generate Excel template buffer (Universities, Programs, Scholarships sheets with headers + one example row). */
export function getUniversitiesExcelTemplateBuffer(): Buffer {
  const XLSX = require('xlsx');
  const uniHeaders = [
    'University name',
    'Country',
    'City',
    'Slogan',
    'Logo URL',
    'Description',
    'Minimum requirements',
    'Minimum tuition (annual)',
    'Year founded',
    'Number of students',
    'Faculties',
    'Target student countries',
    'Source URL',
    'Source site',
    'Extraction notes',
  ];
  const progHeaders = ['University name', 'Program name', 'Degree', 'Field', 'Years', 'Tuition', 'Language', 'Source URL', 'Notes'];
  const schHeaders = ['University name', 'Scholarship name', 'Coverage %', 'Max slots', 'Deadline', 'Eligibility', 'Source URL', 'Notes'];

  const uniData = [
    uniHeaders,
    [
      'Example University',
      'Country',
      'City',
      'Short slogan',
      'https://example.com/logo.png',
      'Description text',
      'IELTS 6.5 or equivalent',
      '5000',
      '1990',
      '10000',
      'Engineering; Science; Arts',
      'Uzbekistan; Kazakhstan; Turkey',
      '',
      '',
      '',
    ],
  ];
  const progData = [progHeaders, ['Example University', 'Bachelor in Computer Science', 'Bachelor', 'Computer Science', '4', '5000', 'English', '', '']];
  const schData = [schHeaders, ['Example University', 'Merit Scholarship', '50', '10', '2025-06-30', 'GPA 3.5+', '', '']];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(uniData), 'Universities');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(progData), 'Programs');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(schData), 'Scholarships');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
