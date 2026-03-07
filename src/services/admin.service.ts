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
} from '../models';
import { AppError, ErrorCodes } from '../utils/errors';
import { safeRegExp } from '../utils/validators';
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
]);

export async function updateUniversityProfileByUserId(userId: string, patch: Record<string, unknown>) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const filtered = Object.fromEntries(Object.entries(patch).filter(([k]) => UNIVERSITY_PROFILE_WHITELIST.has(k)));
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
  if ((request as { status: string }).status !== 'pending') {
    throw new AppError(400, 'Request already processed', ErrorCodes.CONFLICT);
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
    throw new AppError(400, 'Request already processed', ErrorCodes.CONFLICT);
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
