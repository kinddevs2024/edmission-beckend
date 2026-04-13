import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import {
  User,
  StudentProfile,
  CounsellorProfile,
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
  GlobalFaculty,
  Program,
  StudentDocument,
  Investor,
  LandingCertificate,
  SiteVisit,
} from '../models';
import { AppError, ErrorCodes } from '../utils/errors';
import { toObjectIdString } from '../utils/objectId';
import { safeRegExp } from '../utils/validators';
import { DEFAULT_ADMIN_EMAIL } from '../config/defaultAdmin';
import * as subscriptionService from './subscription.service';
import * as ticketService from './ticket.service';
import * as studentDocumentService from './studentDocument.service';
import type { AdminDocumentListStatus } from './studentDocument.service';
import * as emailService from './email.service';
import * as telegramService from './telegram.service';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';

const BCRYPT_ROUNDS = 12;
const INVITE_TOKEN_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000;
const MANAGER_VISIBLE_ROLES = ['school_counsellor', 'counsellor_coordinator'] as const;
const COORDINATOR_VISIBLE_ROLES = ['school_counsellor'] as const;

type ManagementRole = 'admin' | 'manager' | 'counsellor_coordinator' | 'school_counsellor';
type ManagedRole = 'student' | 'university' | 'admin' | 'school_counsellor' | 'counsellor_coordinator' | 'manager';
type ManagementActor = { id: string; role: string } | undefined;

function getManagementRole(role: string | undefined): ManagementRole | null {
  if (role === 'admin' || role === 'manager' || role === 'counsellor_coordinator' || role === 'school_counsellor') {
    return role;
  }
  return null;
}

function getVisibleRolesForManagementRole(role: ManagementRole): ReadonlyArray<string> | null {
  if (role === 'admin') return null;
  if (role === 'manager') return MANAGER_VISIBLE_ROLES;
  if (role === 'counsellor_coordinator') return COORDINATOR_VISIBLE_ROLES;
  return ['school_counsellor'];
}

function canManageTargetRole(actorRole: ManagementRole, targetRole: string): boolean {
  if (actorRole === 'admin') return true;
  if (actorRole === 'manager') return targetRole === 'school_counsellor' || targetRole === 'counsellor_coordinator';
  if (actorRole === 'counsellor_coordinator') return targetRole === 'school_counsellor';
  return false;
}

function assertRoleManageAllowed(actor: ManagementActor, targetRole: string): void {
  if (!actor) {
    throw new AppError(401, 'Authorization required', ErrorCodes.UNAUTHORIZED);
  }
  const actorRole = getManagementRole(actor.role);
  if (!actorRole || !canManageTargetRole(actorRole, targetRole)) {
    throw new AppError(403, 'Insufficient permissions', ErrorCodes.FORBIDDEN);
  }
}

function restrictRoleByVisibility(requestedRole: string | undefined, visibleRoles: ReadonlyArray<string> | null): string | undefined {
  if (!requestedRole) return undefined;
  if (visibleRoles == null) return requestedRole;
  return visibleRoles.includes(requestedRole) ? requestedRole : '__no_visible_role__';
}

function mergeUserRoleFilters(
  visibleRoles: ReadonlyArray<string> | null,
  requestedRole: string | undefined
): Record<string, unknown> {
  const roleFromQuery = restrictRoleByVisibility(requestedRole, visibleRoles);
  if (roleFromQuery === '__no_visible_role__') return { role: '__no_visible_role__' };
  if (visibleRoles == null) return roleFromQuery ? { role: roleFromQuery } : {};
  if (roleFromQuery) return { role: roleFromQuery };
  return { role: { $in: [...visibleRoles] } };
}

function parseDateOnlyInput(value: string | undefined, endOfDay: boolean = false): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const iso = endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

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

export async function getAnalyticsOverview(query: { from?: string; to?: string }) {
  const today = new Date();
  const todayKey = toDateOnlyString(today);
  const from = parseDateOnlyInput(query.from ?? todayKey, false);
  const to = parseDateOnlyInput(query.to ?? todayKey, true);

  if (!from || !to) {
    throw new AppError(400, 'Invalid date range', ErrorCodes.VALIDATION);
  }
  if (from.getTime() > to.getTime()) {
    throw new AppError(400, '"from" must be before or equal to "to"', ErrorCodes.VALIDATION);
  }

  const visitRange = { visitedOn: { $gte: from, $lte: to } };
  const registrationRange = { createdAt: { $gte: from, $lte: to } };

  const [visitorIds, universityUserIds, studentUserIds, registrations] = await Promise.all([
    SiteVisit.distinct('visitorId', visitRange),
    SiteVisit.distinct('userId', { ...visitRange, role: 'university', userId: { $ne: null } }),
    SiteVisit.distinct('userId', { ...visitRange, role: 'student', userId: { $ne: null } }),
    User.countDocuments(registrationRange),
  ]);

  return {
    from: toDateOnlyString(from),
    to: toDateOnlyString(to),
    totalVisitors: visitorIds.length,
    universityVisitors: universityUserIds.length,
    studentVisitors: studentUserIds.length,
    registrations,
  };
}

export async function getUsers(
  query: { page?: number; limit?: number; role?: string; status?: string },
  actor?: { id: string; role: string }
) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const actorRole = getManagementRole(actor?.role);
  const visibleRoles = actorRole ? getVisibleRolesForManagementRole(actorRole) : null;
  const where: Record<string, unknown> = mergeUserRoleFilters(visibleRoles, query.role);
  if (query.status === 'active') where.suspended = false;
  if (query.status === 'suspended') where.suspended = true;

  const [list, total] = await Promise.all([
    User.find(where).skip(skip).limit(limit).select('email name role emailVerified suspended createdAt').lean(),
    User.countDocuments(where),
  ]);
  const data = list.map((u) => {
    const doc = u as {
      _id: unknown
      email?: string
      name?: string
      role?: string
      emailVerified?: boolean
      suspended?: boolean
      createdAt?: Date | string
    };
    const createdAt =
      doc.createdAt != null ? new Date(doc.createdAt as string | Date).toISOString() : undefined;
    return {
      id: String(doc._id),
      email: doc.email ?? '',
      name: doc.name ?? '',
      role: doc.role ?? '',
      emailVerified: doc.emailVerified,
      suspended: doc.suspended,
      createdAt,
    };
  });

  const needsDisplayName = (name: string) => !String(name || '').trim();
  const toOid = (ids: string[]) => ids.map((id) => new mongoose.Types.ObjectId(id));

  const studentIds = data.filter((r) => r.role === 'student' && needsDisplayName(r.name)).map((r) => r.id);
  const universityIds = data.filter((r) => r.role === 'university' && needsDisplayName(r.name)).map((r) => r.id);
  const counsellorIds = data
    .filter((r) => r.role === 'school_counsellor' && needsDisplayName(r.name))
    .map((r) => r.id);

  const [studentProfiles, uniProfiles, counsellorProfiles] = await Promise.all([
    studentIds.length
      ? StudentProfile.find({ userId: { $in: toOid(studentIds) } })
          .select('userId firstName lastName')
          .lean()
      : Promise.resolve([]),
    universityIds.length
      ? UniversityProfile.find({ userId: { $in: toOid(universityIds) } })
          .select('userId universityName')
          .lean()
      : Promise.resolve([]),
    counsellorIds.length
      ? CounsellorProfile.find({ userId: { $in: toOid(counsellorIds) } })
          .select('userId schoolName')
          .lean()
      : Promise.resolve([]),
  ]);

  const studentNameByUserId = new Map<string, string>();
  for (const p of studentProfiles) {
    const row = p as { userId?: unknown; firstName?: string; lastName?: string };
    const uid = String(row.userId ?? '');
    const full = [row.firstName, row.lastName]
      .map((x) => (x != null ? String(x).trim() : ''))
      .filter(Boolean)
      .join(' ')
      .trim();
    if (full) studentNameByUserId.set(uid, full);
  }
  const uniNameByUserId = new Map<string, string>();
  for (const p of uniProfiles) {
    const row = p as { userId?: unknown; universityName?: string };
    const uid = String(row.userId ?? '');
    const n = row.universityName != null ? String(row.universityName).trim() : '';
    if (n) uniNameByUserId.set(uid, n);
  }
  const schoolNameByUserId = new Map<string, string>();
  for (const p of counsellorProfiles) {
    const row = p as { userId?: unknown; schoolName?: string };
    const uid = String(row.userId ?? '');
    const n = row.schoolName != null ? String(row.schoolName).trim() : '';
    if (n) schoolNameByUserId.set(uid, n);
  }

  for (const row of data) {
    if (!needsDisplayName(row.name)) continue;
    if (row.role === 'student') {
      const alt = studentNameByUserId.get(row.id);
      if (alt) row.name = alt;
    } else if (row.role === 'university') {
      const alt = uniNameByUserId.get(row.id);
      if (alt) row.name = alt;
    } else if (row.role === 'school_counsellor') {
      const alt = schoolNameByUserId.get(row.id);
      if (alt) row.name = alt;
    }
  }

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function createUser(
  payload: {
    role: ManagedRole;
    email: string;
    password?: string;
    name?: string;
  },
  actor?: { id: string; role: string }
) {
  const email = String(payload.email || '').trim().toLowerCase();
  const password = payload.password != null ? String(payload.password) : undefined;
  const role = payload.role;
  const name = payload.name != null ? String(payload.name) : '';

  if (!email) throw new AppError(400, 'Email is required', ErrorCodes.VALIDATION);
  if (!['student', 'university', 'admin', 'school_counsellor', 'counsellor_coordinator', 'manager'].includes(role)) {
    throw new AppError(400, 'Invalid role', ErrorCodes.VALIDATION);
  }
  if (actor && actor.role !== 'admin') {
    assertRoleManageAllowed(actor, role);
  }

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
    localPasswordConfigured: !isInvite,
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
  } else if (role === 'school_counsellor') {
    await CounsellorProfile.create({
      userId: user._id,
      schoolName: name?.trim() ? name.trim() : '',
    });
  }

  if (role === 'student' || role === 'university') {
    await subscriptionService.createForNewUser(String(user._id), role);
  }

  if (isInvite && inviteToken && (config.email?.enabled || config.email?.sendgridApiKey)) {
    await emailService.sendInviteSetPasswordEmail(user.email, inviteToken);
  }

  const plain = user.toObject();
  return { ...plain, id: String(user._id) };
}

export async function getUserById(userId: string, actor?: { id: string; role: string }) {
  const u = await User.findById(userId).select('email name role emailVerified suspended createdAt').lean();
  if (!u) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  if (actor && actor.role !== 'admin') {
    const actorRole = getManagementRole(actor.role);
    const visibleRoles = actorRole ? getVisibleRolesForManagementRole(actorRole) : null;
    if (visibleRoles != null && !visibleRoles.includes(String((u as { role?: string }).role ?? ''))) {
      throw new AppError(403, 'Insufficient permissions', ErrorCodes.FORBIDDEN);
    }
  }
  return { ...u, id: String((u as { _id: unknown })._id) };
}

export async function updateUser(
  userId: string,
  patch: {
    name?: string;
    role?: ManagedRole;
    emailVerified?: boolean;
    suspended?: boolean;
  },
  actor?: { id: string; role: string }
) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  if (actor && actor.role !== 'admin') {
    assertRoleManageAllowed(actor, user.role);
    if (patch.role !== undefined) assertRoleManageAllowed(actor, patch.role);
    if (patch.emailVerified !== undefined) {
      throw new AppError(403, 'Insufficient permissions', ErrorCodes.FORBIDDEN);
    }
  }
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

export async function resetUserPassword(
  userId: string,
  newPassword: string,
  actor?: { id: string; role: string }
) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  if (actor && actor.role !== 'admin') {
    assertRoleManageAllowed(actor, user.role);
  }
  if (user.email === DEFAULT_ADMIN_EMAIL) throw new AppError(403, 'Cannot reset default admin password', ErrorCodes.FORBIDDEN);
  const passwordHash = await bcrypt.hash(String(newPassword || ''), BCRYPT_ROUNDS);
  await User.findByIdAndUpdate(
    userId,
    {
      passwordHash,
      localPasswordConfigured: true,
      mustChangePassword: false,
      resetToken: null,
      resetTokenExpires: null,
      passwordChangedAt: new Date(),
    },
    { new: true }
  );
  await RefreshToken.deleteMany({ userId });
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

async function getManagedStudentProfileIds(actor?: { id: string; role: string }): Promise<mongoose.Types.ObjectId[] | null> {
  const actorRole = getManagementRole(actor?.role);
  if (!actorRole || actorRole === 'admin') return null;
  if (actorRole !== 'manager' && actorRole !== 'counsellor_coordinator') return [];

  const counsellors = await User.find({ role: 'school_counsellor' }).select('_id').lean();
  const counsellorIds = counsellors.map((row) => (row as { _id: mongoose.Types.ObjectId })._id);
  if (counsellorIds.length === 0) return [];

  const students = await StudentProfile.find({ counsellorUserId: { $in: counsellorIds } }).select('_id').lean();
  return students.map((row) => (row as { _id: mongoose.Types.ObjectId })._id);
}

export async function listInterests(
  query: { page?: number; limit?: number; status?: string },
  actor?: { id: string; role: string }
) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const whereProfile: Record<string, unknown> = {};
  const whereCatalog: Record<string, unknown> = {};
  if (query.status) {
    whereProfile.status = query.status;
    whereCatalog.status = query.status;
  }
  const managedStudentIds = await getManagedStudentProfileIds(actor);
  if (managedStudentIds != null) {
    if (managedStudentIds.length === 0) {
      return { data: [], total: 0, page, limit, totalPages: 0 };
    }
    whereProfile.studentId = { $in: managedStudentIds };
    whereCatalog.studentId = { $in: managedStudentIds };
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

type SendTelegramPayload = {
  userIds?: string[];
  chatIds?: string[];
  text: string;
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
};

export async function sendTelegramMessage(payload: SendTelegramPayload) {
  const text = String(payload.text ?? '').trim();
  if (!text) throw new AppError(400, 'Text is required', ErrorCodes.VALIDATION);

  const userIds = Array.isArray(payload.userIds) ? [...new Set(payload.userIds.map((x) => String(x).trim()).filter(Boolean))] : [];
  const directChatIds = Array.isArray(payload.chatIds) ? [...new Set(payload.chatIds.map((x) => String(x).trim()).filter(Boolean))] : [];

  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select('_id socialLinks.telegram telegram.chatId').lean()
    : [];

  const userChatIds = users
    .map((u) => {
      const raw = (u as { telegram?: { chatId?: string }; socialLinks?: { telegram?: string } }).telegram?.chatId
        || (u as { socialLinks?: { telegram?: string } }).socialLinks?.telegram;
      return String(raw ?? '').trim();
    })
    .filter(Boolean);

  const chatIds = [...new Set([...directChatIds, ...userChatIds])];
  if (!chatIds.length) {
    return {
      sent: 0,
      failed: 0,
      skipped: userIds.length,
      details: [] as Array<{ chatId: string; ok: boolean; error?: string }>,
    };
  }

  const details: Array<{ chatId: string; ok: boolean; error?: string }> = [];
  let sent = 0;
  let failed = 0;

  for (const chatId of chatIds) {
    try {
      await telegramService.sendTelegramMessage(chatId, text, payload.parseMode);
      sent += 1;
      details.push({ chatId, ok: true });
    } catch (e: unknown) {
      failed += 1;
      details.push({ chatId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    sent,
    failed,
    skipped: Math.max(0, userIds.length - userChatIds.length),
    details,
  };
}

export async function suspendUser(
  userId: string,
  suspend: boolean,
  actor?: { id: string; role: string }
) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  if (actor && actor.role !== 'admin') {
    assertRoleManageAllowed(actor, user.role);
  }
  if (user.email === DEFAULT_ADMIN_EMAIL) throw new AppError(403, 'Cannot suspend default admin', ErrorCodes.FORBIDDEN);
  if (user.role === 'admin') throw new AppError(403, 'Cannot suspend admin', ErrorCodes.FORBIDDEN);
  const updated = await User.findByIdAndUpdate(userId, { suspended: suspend }, { new: true }).lean();
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}

/** Delete a user and all related data. Cannot delete default admin or other admins. */
export async function deleteUser(userId: string, actor?: { id: string; role: string }) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  if (actor && actor.role !== 'admin') {
    assertRoleManageAllowed(actor, user.role);
  }
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

export async function listAdminStudentDocuments(status: AdminDocumentListStatus) {
  return studentDocumentService.listDocumentsForAdmin(status);
}

export async function reviewDocument(docId: string, adminUserId: string, decision: 'approved' | 'rejected', rejectionReason?: string) {
  return studentDocumentService.reviewDocument(docId, adminUserId, decision, rejectionReason);
}

// ——— University catalog (for registration flow) ———

type CatalogProgramPayload = {
  name: string;
  degreeLevel?: string;
  field?: string;
  durationYears?: number;
  tuitionFee?: number;
  language?: string;
  entryRequirements?: string;
};

type CatalogScholarshipPayload = {
  name: string;
  coveragePercent: number;
  maxSlots: number;
  deadline?: string;
  eligibility?: string;
};

type CatalogCustomFacultyPayload = {
  name: string;
  description?: string;
  items?: string[];
  order?: number;
};

type CatalogDocumentPayload = {
  documentType: string;
  fileUrl: string;
  status?: string;
  reviewedBy?: string;
  reviewedAt?: string;
};

type CatalogUniversityPayload = {
  universityName: string;
  tagline?: string;
  establishedYear?: number;
  studentCount?: number;
  country?: string;
  city?: string;
  description?: string;
  logoUrl?: string;
  facultyCodes?: string[];
  facultyItems?: Record<string, string[]>;
  targetStudentCountries?: string[];
  minLanguageLevel?: string;
  tuitionPrice?: number;
  programs?: CatalogProgramPayload[];
  scholarships?: CatalogScholarshipPayload[];
  customFaculties?: CatalogCustomFacultyPayload[];
  documents?: CatalogDocumentPayload[];
};

function trimString(value: unknown, maxLength?: number): string | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  return maxLength != null ? trimmed.slice(0, maxLength) : trimmed;
}

function normalizeNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeStringArray(value: unknown, maxItems: number = 50): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => String(item).trim()).filter(Boolean).slice(0, maxItems);
  return items.length ? items : undefined;
}

function normalizeFacultyItemsValue(value: unknown): Record<string, string[]> | undefined {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) return undefined;
  const result: Record<string, string[]> = {};
  for (const [key, rawItems] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.trim();
    const normalizedItems = normalizeStringArray(rawItems, 50);
    if (normalizedKey && normalizedItems?.length) {
      result[normalizedKey] = normalizedItems;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeProgramsValue(value: unknown): CatalogProgramPayload[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const programs: CatalogProgramPayload[] = [];
  for (const raw of value.slice(0, 50)) {
      const item = raw as Record<string, unknown>;
      const name = trimString(item.name) ?? '';
      if (!name) continue;
      programs.push({
        name,
        degreeLevel: trimString(item.degreeLevel),
        field: trimString(item.field),
        durationYears: normalizeNumber(item.durationYears),
        tuitionFee: normalizeNumber(item.tuitionFee),
        language: trimString(item.language),
        entryRequirements: trimString(item.entryRequirements),
      });
  }
  return programs.length ? programs : undefined;
}

function normalizeScholarshipsValue(value: unknown): CatalogScholarshipPayload[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const scholarships: CatalogScholarshipPayload[] = [];
  for (const raw of value.slice(0, 30)) {
      const item = raw as Record<string, unknown>;
      const name = trimString(item.name) ?? '';
      if (!name) continue;
      const coveragePercent = normalizeNumber(item.coveragePercent) ?? 0;
      const maxSlots = normalizeNumber(item.maxSlots) ?? 0;
      scholarships.push({
        name,
        coveragePercent,
        maxSlots,
        deadline: trimString(item.deadline),
        eligibility: trimString(item.eligibility),
      });
  }
  return scholarships.length ? scholarships : undefined;
}

function normalizeCustomFacultiesValue(value: unknown): CatalogCustomFacultyPayload[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const faculties: CatalogCustomFacultyPayload[] = [];
  value.slice(0, 100).forEach((raw, index) => {
      const item = raw as Record<string, unknown>;
      const name = trimString(item.name) ?? '';
      if (!name) return;
      faculties.push({
        name,
        description: trimString(item.description) ?? '',
        items: normalizeStringArray(item.items, 100) ?? [],
        order: normalizeNumber(item.order) ?? index,
      });
    });
  return faculties.length ? faculties : undefined;
}

function normalizeDocumentsValue(value: unknown): CatalogDocumentPayload[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const documents: CatalogDocumentPayload[] = [];
  for (const raw of value.slice(0, 100)) {
      const item = raw as Record<string, unknown>;
      const documentType = trimString(item.documentType) ?? '';
      const fileUrl = trimString(item.fileUrl) ?? '';
      if (!documentType || !fileUrl) continue;
      const reviewedAt = trimString(item.reviewedAt);
      documents.push({
        documentType,
        fileUrl,
        status: trimString(item.status),
        reviewedBy: trimString(item.reviewedBy),
        reviewedAt,
      });
  }
  return documents.length ? documents : undefined;
}

function buildCatalogUniversityPayload(body: Record<string, unknown>): CatalogUniversityPayload {
  const universityName = trimString(body.universityName) ?? '';
  if (!universityName) {
    throw new AppError(400, 'University name is required', ErrorCodes.VALIDATION);
  }

  return {
    universityName,
    tagline: trimString(body.tagline),
    establishedYear: normalizeNumber(body.establishedYear),
    studentCount: normalizeNumber(body.studentCount),
    country: trimString(body.country),
    city: trimString(body.city),
    description: trimString(body.description),
    logoUrl: trimString(body.logoUrl),
    facultyCodes: normalizeStringArray(body.facultyCodes, 50),
    facultyItems: normalizeFacultyItemsValue(body.facultyItems),
    targetStudentCountries: normalizeStringArray(body.targetStudentCountries, 50),
    minLanguageLevel: trimString(body.minLanguageLevel, 50),
    tuitionPrice: normalizeNumber(body.tuitionPrice),
    programs: normalizeProgramsValue(body.programs),
    scholarships: normalizeScholarshipsValue(body.scholarships),
    customFaculties: normalizeCustomFacultiesValue(body.customFaculties),
    documents: normalizeDocumentsValue(body.documents),
  };
}

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
  const payload = buildCatalogUniversityPayload(body);
  const doc = await UniversityCatalog.create({
    ...payload,
    scholarships: payload.scholarships?.map((s) => ({
      ...s,
      deadline: s.deadline ? new Date(s.deadline) : undefined,
    })),
    documents: payload.documents?.map((docItem) => ({
      ...docItem,
      reviewedAt: docItem.reviewedAt ? new Date(docItem.reviewedAt) : undefined,
    })),
  });
  return { ...doc.toObject(), id: String(doc._id) };
}

export async function getCatalogUniversityById(id: string) {
  const doc = await UniversityCatalog.findById(id).lean();
  if (!doc) throw new AppError(404, 'Catalog university not found', ErrorCodes.NOT_FOUND);
  const effective = await getEffectiveCatalogUniversityData(doc as unknown as Record<string, unknown>);
  return {
    ...doc,
    ...effective.body,
    id: effective.id,
    linkedUniversityProfileId: effective.linkedProfileId,
    name: effective.body.universityName ?? '',
  };
}

export async function updateCatalogUniversity(id: string, body: Record<string, unknown>) {
  const existing = await UniversityCatalog.findById(id).lean();
  if (!existing) throw new AppError(404, 'Catalog university not found', ErrorCodes.NOT_FOUND);
  const payload = buildCatalogUniversityPayload({
    ...existing,
    ...body,
    universityName: body.universityName ?? existing.universityName,
  });
  const doc = await UniversityCatalog.findByIdAndUpdate(
    id,
    {
      ...payload,
      scholarships: payload.scholarships?.map((s) => ({
        ...s,
        deadline: s.deadline ? new Date(s.deadline) : undefined,
      })),
      documents: payload.documents?.map((docItem) => ({
        ...docItem,
        reviewedAt: docItem.reviewedAt ? new Date(docItem.reviewedAt) : undefined,
      })),
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
  const catalog = request.universityCatalogId as unknown as {
    _id: unknown;
    universityName: string;
    tagline?: string;
    establishedYear?: number;
    studentCount?: number;
    country?: string;
    city?: string;
    description?: string;
    logoUrl?: string;
    facultyCodes?: string[];
    facultyItems?: Record<string, string[]>;
    targetStudentCountries?: string[];
    minLanguageLevel?: string;
    tuitionPrice?: number;
    programs?: Array<Record<string, unknown>>;
    scholarships?: Array<Record<string, unknown>>;
    customFaculties?: Array<Record<string, unknown>>;
    documents?: Array<Record<string, unknown>>;
  };
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
    minLanguageLevel: catalog.minLanguageLevel,
    tuitionPrice: catalog.tuitionPrice,
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

  const customFaculties = catalog.customFaculties ?? [];
  for (const faculty of customFaculties) {
    await Faculty.create({
      universityId: profile._id,
      name: faculty.name ?? '',
      description: faculty.description != null ? String(faculty.description) : '',
      items: Array.isArray(faculty.items) ? faculty.items.map((item) => String(item)).filter(Boolean) : [],
      order: faculty.order != null ? Number(faculty.order) : 0,
    });
  }

  const documents = catalog.documents ?? [];
  for (const document of documents) {
    if (!document.documentType || !document.fileUrl) continue;
    await UniversityDocument.create({
      universityId: profile._id,
      documentType: String(document.documentType),
      fileUrl: String(document.fileUrl),
      status: document.status != null ? String(document.status) : undefined,
      reviewedBy: document.reviewedBy != null ? String(document.reviewedBy) : undefined,
      reviewedAt: document.reviewedAt ? new Date(document.reviewedAt as string) : undefined,
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

function parseFacultyItems(raw: unknown): Record<string, string[]> | undefined {
  if (raw == null || raw === '') return undefined;
  // Format: category:item1|item2; category2:item3|item4
  const entries = String(raw)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!entries.length) return undefined;

  const result: Record<string, string[]> = {};
  for (const entry of entries) {
    const separator = entry.indexOf(':');
    if (separator <= 0) continue;
    const key = entry.slice(0, separator).trim();
    const values = entry
      .slice(separator + 1)
      .split('|')
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 50);
    if (key && values.length > 0) {
      result[key] = values;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function formatFacultyItems(value: Record<string, string[]> | undefined): string {
  if (!value) return '';
  return Object.entries(value)
    .map(([key, items]) => `${key}:${items.join('|')}`)
    .join('; ');
}

const STATIC_FACULTY_LABELS: Record<string, string> = {
  business_management_economics: 'Business, Management and Economics',
  engineering_technology: 'Engineering and Technology',
  computer_science_digital_technologies: 'Computer Science and Digital Technologies',
  natural_sciences: 'Natural Sciences',
  health_medical_sciences: 'Health and Medical Sciences',
  social_sciences_humanities: 'Social Sciences and Humanities',
  creative_arts_media_design: 'Creative Arts, Media and Design',
  education: 'Education',
  environment_agriculture_sustainability: 'Environment, Agriculture and Sustainability',
  hospitality_tourism_service: 'Hospitality, Tourism and Service',
  law_legal_studies: 'Law and Legal Studies',
};

function getStaticFacultyItems(code: string): string[] {
  const staticMap: Record<string, string[]> = {
    business_management_economics: ['Accounting', 'Banking and Finance', 'Business Administration', 'Business Analytics', 'Economics', 'Finance', 'Global Business', 'Human Resource Management', 'International Business', 'Logistics and Supply Chain Management', 'Management', 'Marketing', 'Project Management'],
    engineering_technology: ['Aerospace Engineering', 'Biomedical Engineering', 'Chemical Engineering', 'Civil Engineering', 'Computer Engineering', 'Electrical Engineering', 'Mechanical Engineering', 'Software Engineering'],
    computer_science_digital_technologies: ['Artificial Intelligence', 'Computer Science', 'Cybersecurity', 'Data Analytics', 'Data Science', 'Information Systems', 'Information Technology'],
    natural_sciences: ['Biochemistry', 'Biology', 'Chemistry', 'Genetics', 'Mathematics', 'Physics', 'Statistics'],
    health_medical_sciences: ['Health Sciences', 'Nursing', 'Pharmacy'],
    social_sciences_humanities: ['International Relations', 'Philosophy', 'Political Science', 'Psychology', 'Sociology'],
    creative_arts_media_design: ['Architecture', 'Digital Media', 'Game Design', 'Graphic Design', 'Journalism', 'Media Studies'],
    education: ['Education', 'Primary Education', 'Pre-school education', 'Education technology'],
    environment_agriculture_sustainability: ['Agriculture', 'Environmental Science', 'Urban Planning'],
    hospitality_tourism_service: ['Hospitality Management', 'Tourism Management', 'Food Science'],
    law_legal_studies: ['Law', 'Forensic Science'],
  };
  return staticMap[code] ?? [];
}

type CatalogFacultySelectionPayload = {
  type?: 'catalog' | 'custom';
  code: string;
  name: string;
  items?: string[];
  description?: string;
  order?: number;
};

function normalizeIsoDate(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

type ParsedUniversityExcelRow = {
  row: number;
  sourceId?: string;
  universityName: string;
  body: CatalogUniversityPayload;
};

type ParsedUniversitiesExcelResult = {
  rows: ParsedUniversityExcelRow[];
  errors: Array<{ row: number; name: string; message: string }>;
};

async function getFacultyCatalogMap(): Promise<Map<string, { name: string; items: string[] }>> {
  const map = new Map<string, { name: string; items: string[] }>();
  Object.entries(STATIC_FACULTY_LABELS).forEach(([code, name]) => {
    map.set(code, { name, items: getStaticFacultyItems(code) });
  });
  const globals = await GlobalFaculty.find().lean();
  globals.forEach((faculty) => {
    map.set(String(faculty.code ?? ''), {
      name: String(faculty.name ?? faculty.code ?? ''),
      items: Array.isArray(faculty.items) ? faculty.items.map((item) => String(item)) : [],
    });
  });
  return map;
}

type EffectiveCatalogUniversityData = {
  id: string;
  linkedProfileId?: string;
  body: CatalogUniversityPayload;
};

async function findCatalogUniversityForImport(row: ParsedUniversityExcelRow) {
  if (row.sourceId && mongoose.Types.ObjectId.isValid(row.sourceId)) {
    const byId = await UniversityCatalog.findById(row.sourceId).lean();
    if (byId) {
      return { catalog: byId as Record<string, unknown>, matchedBy: 'id' as const };
    }
  }

  const normalizedName = row.universityName.trim();
  if (!normalizedName) {
    return { catalog: undefined, matchedBy: undefined };
  }

  const exactNameRegex = new RegExp(`^${safeRegExp(normalizedName).source}$`, 'i');
  const byName = await UniversityCatalog.findOne({ universityName: exactNameRegex }).lean();
  if (byName) {
    return { catalog: byName as Record<string, unknown>, matchedBy: 'name' as const };
  }

  return { catalog: undefined, matchedBy: undefined };
}

type UniversitiesExcelPreviewItem = {
  row: number;
  sourceId?: string;
  existingId?: string;
  universityName: string;
  linkedProfileId?: string;
  action: 'create' | 'update';
  incoming: CatalogUniversityPayload;
  current?: CatalogUniversityPayload;
  changes: Array<{ field: string; before: string; after: string }>;
  sections: {
    programsChanged: boolean;
    scholarshipsChanged: boolean;
    customFacultiesChanged: boolean;
    documentsChanged: boolean;
  };
};

function getUniversityRowName(row: Record<string, unknown>): string {
  return String(row['University name'] ?? row['universityName'] ?? '').trim();
}

function getUniversityRowId(row: Record<string, unknown>): string | undefined {
  const id = trimString(row['University ID'] ?? row['universityId'] ?? row['ID'] ?? row['id']);
  return id || undefined;
}

function makeUniversityJoinKey(id: string | undefined, name: string | undefined): string | undefined {
  if (id) return `id:${id}`;
  if (name) return `name:${name.trim().toLowerCase()}`;
  return undefined;
}

function pushToRowMap<T>(map: Map<string, T[]>, key: string | undefined, value: T) {
  if (!key) return;
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function getMappedRows<T>(map: Map<string, T[]>, id: string | undefined, name: string): T[] {
  const byId = id ? map.get(`id:${id}`) ?? [] : [];
  const byName = map.get(`name:${name.trim().toLowerCase()}`) ?? [];
  if (!byId.length) return byName;
  if (!byName.length) return byId;
  return [...byId, ...byName];
}

function sortForCompare(payload: CatalogUniversityPayload): Record<string, unknown> {
  const facultyItems = payload.facultyItems
    ? Object.fromEntries(Object.entries(payload.facultyItems).sort(([a], [b]) => a.localeCompare(b)))
    : undefined;

  return {
    universityName: payload.universityName,
    tagline: payload.tagline ?? '',
    establishedYear: payload.establishedYear ?? null,
    studentCount: payload.studentCount ?? null,
    country: payload.country ?? '',
    city: payload.city ?? '',
    description: payload.description ?? '',
    logoUrl: payload.logoUrl ?? '',
    facultyCodes: [...(payload.facultyCodes ?? [])].sort(),
    facultyItems,
    targetStudentCountries: [...(payload.targetStudentCountries ?? [])].sort(),
    minLanguageLevel: payload.minLanguageLevel ?? '',
    tuitionPrice: payload.tuitionPrice ?? null,
    programs: [...(payload.programs ?? [])].sort((a, b) =>
      `${a.name}|${a.degreeLevel ?? ''}|${a.field ?? ''}`.localeCompare(`${b.name}|${b.degreeLevel ?? ''}|${b.field ?? ''}`)
    ),
    scholarships: [...(payload.scholarships ?? [])].sort((a, b) =>
      `${a.name}|${a.deadline ?? ''}`.localeCompare(`${b.name}|${b.deadline ?? ''}`)
    ),
    customFaculties: [...(payload.customFaculties ?? [])].sort((a, b) =>
      `${a.order ?? 0}|${a.name}`.localeCompare(`${b.order ?? 0}|${b.name}`)
    ),
    documents: [...(payload.documents ?? [])].sort((a, b) =>
      `${a.documentType}|${a.fileUrl}`.localeCompare(`${b.documentType}|${b.fileUrl}`)
    ),
  };
}

function stringifyCompareValue(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value) || typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function makePreviewChanges(current: CatalogUniversityPayload, incoming: CatalogUniversityPayload) {
  const labels: Record<string, string> = {
    universityName: 'University name',
    country: 'Country',
    city: 'City',
    tagline: 'Slogan',
    logoUrl: 'Logo URL',
    description: 'Description',
    minLanguageLevel: 'Minimum requirements',
    tuitionPrice: 'Minimum tuition (annual)',
    establishedYear: 'Year founded',
    studentCount: 'Number of students',
    facultyCodes: 'Faculties',
    facultyItems: 'Faculty items',
    targetStudentCountries: 'Target student countries',
  };

  const currentComparable = sortForCompare(current);
  const incomingComparable = sortForCompare(incoming);
  return Object.keys(labels)
    .map((field) => {
      const before = stringifyCompareValue(currentComparable[field]);
      const after = stringifyCompareValue(incomingComparable[field]);
      if (before === after) return null;
      return { field: labels[field], before, after };
    })
    .filter((item): item is { field: string; before: string; after: string } => item != null);
}

async function getEffectiveCatalogUniversityData(catalogRaw: Record<string, unknown>): Promise<EffectiveCatalogUniversityData> {
  const catalogId = String(catalogRaw._id ?? catalogRaw.id ?? '');
  const linkedProfileId = toObjectIdString((catalogRaw as { linkedUniversityProfileId?: unknown }).linkedUniversityProfileId);
  const baseBody = buildCatalogUniversityPayload({
    ...catalogRaw,
    universityName: catalogRaw.universityName,
    scholarships: Array.isArray(catalogRaw.scholarships)
      ? (catalogRaw.scholarships as Array<Record<string, unknown>>).map((item) => ({
          ...item,
          deadline: normalizeIsoDate(item.deadline),
        }))
      : [],
    documents: Array.isArray(catalogRaw.documents)
      ? (catalogRaw.documents as Array<Record<string, unknown>>).map((item) => ({
          ...item,
          reviewedAt: normalizeIsoDate(item.reviewedAt),
        }))
      : [],
  });

  if (!linkedProfileId) {
    return { id: catalogId, body: baseBody };
  }

  const [profile, programs, scholarships, faculties, documents] = await Promise.all([
    UniversityProfile.findById(linkedProfileId).lean(),
    Program.find({ universityId: linkedProfileId }).sort({ name: 1 }).lean(),
    Scholarship.find({ universityId: linkedProfileId }).sort({ name: 1 }).lean(),
    Faculty.find({ universityId: linkedProfileId }).sort({ order: 1, name: 1 }).lean(),
    UniversityDocument.find({ universityId: linkedProfileId }).sort({ documentType: 1, createdAt: 1 }).lean(),
  ]);

  if (!profile) {
    return { id: catalogId, linkedProfileId, body: baseBody };
  }

  const effectiveBody = buildCatalogUniversityPayload({
    ...baseBody,
    ...profile,
    universityName: profile.universityName ?? baseBody.universityName,
    programs: programs.map((item) => ({
      name: item.name,
      degreeLevel: item.degreeLevel,
      field: item.field,
      durationYears: item.durationYears,
      tuitionFee: item.tuitionFee,
      language: item.language,
      entryRequirements: item.entryRequirements,
    })),
    scholarships: scholarships.map((item) => ({
      name: item.name,
      coveragePercent: item.coveragePercent,
      maxSlots: item.maxSlots,
      deadline: normalizeIsoDate(item.deadline),
      eligibility: item.eligibility,
    })),
    customFaculties: faculties.map((item) => ({
      name: item.name,
      description: item.description,
      items: item.items,
      order: item.order,
    })),
    documents: documents.map((item) => ({
      documentType: item.documentType,
      fileUrl: item.fileUrl,
      status: item.status,
      reviewedBy: item.reviewedBy,
      reviewedAt: normalizeIsoDate(item.reviewedAt),
    })),
  });

  return { id: catalogId, linkedProfileId, body: effectiveBody };
}

async function syncLinkedUniversityProfile(profileId: string, payload: CatalogUniversityPayload): Promise<void> {
  await UniversityProfile.findByIdAndUpdate(profileId, {
    universityName: payload.universityName,
    tagline: payload.tagline,
    establishedYear: payload.establishedYear,
    studentCount: payload.studentCount,
    country: payload.country,
    city: payload.city,
    description: payload.description,
    logoUrl: payload.logoUrl,
    facultyCodes: payload.facultyCodes ?? [],
    facultyItems: payload.facultyItems,
    targetStudentCountries: payload.targetStudentCountries ?? [],
    minLanguageLevel: payload.minLanguageLevel,
    tuitionPrice: payload.tuitionPrice,
  });

  await Program.deleteMany({ universityId: profileId });
  if (payload.programs?.length) {
    await Program.insertMany(
      payload.programs.map((item) => ({
        universityId: profileId,
        name: item.name,
        degreeLevel: item.degreeLevel ?? '',
        field: item.field ?? '',
        durationYears: item.durationYears,
        tuitionFee: item.tuitionFee,
        language: item.language,
        entryRequirements: item.entryRequirements,
      }))
    );
  }

  await Scholarship.deleteMany({ universityId: profileId });
  if (payload.scholarships?.length) {
    await Scholarship.insertMany(
      payload.scholarships.map((item) => ({
        universityId: profileId,
        name: item.name,
        coveragePercent: item.coveragePercent,
        maxSlots: item.maxSlots,
        remainingSlots: item.maxSlots,
        deadline: item.deadline ? new Date(item.deadline) : undefined,
        eligibility: item.eligibility,
      }))
    );
  }

  await Faculty.deleteMany({ universityId: profileId });
  if (payload.customFaculties?.length) {
    await Faculty.insertMany(
      payload.customFaculties.map((item, index) => ({
        universityId: profileId,
        name: item.name,
        description: item.description ?? '',
        items: item.items ?? [],
        order: item.order ?? index,
      }))
    );
  }

  await UniversityDocument.deleteMany({ universityId: profileId });
  if (payload.documents?.length) {
    await UniversityDocument.insertMany(
      payload.documents.map((item) => ({
        universityId: profileId,
        documentType: item.documentType,
        fileUrl: item.fileUrl,
        status: item.status,
        reviewedBy: item.reviewedBy,
        reviewedAt: item.reviewedAt ? new Date(item.reviewedAt) : undefined,
      }))
    );
  }
}

export function parseUniversitiesExcel(buffer: Buffer): ParsedUniversitiesExcelResult {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetNames = wb.SheetNames || [];

  const universitiesSheet = sheetNames.find((n: string) => /universit/i.test(n)) || sheetNames[0];
  const programsSheet = sheetNames.find((n: string) => /program/i.test(n));
  const scholarshipsSheet = sheetNames.find((n: string) => /scholarship/i.test(n));
  const facultiesSheet = sheetNames.find((n: string) => /^facult/i.test(n));
  const customFacultiesSheet = sheetNames.find((n: string) => /custom.*facult|facult.*custom/i.test(n));
  const documentsSheet = sheetNames.find((n: string) => /document/i.test(n));

  const uniRows = XLSX.utils.sheet_to_json(wb.Sheets[universitiesSheet] || {}) as Record<string, unknown>[];
  if (!uniRows.length) return { rows: [], errors: [] };

  const errors: Array<{ row: number; name: string; message: string }> = [];

  const programsByUni = new Map<string, CatalogProgramPayload[]>();
  if (programsSheet && wb.Sheets[programsSheet]) {
    const progRows = XLSX.utils.sheet_to_json(wb.Sheets[programsSheet]) as Record<string, unknown>[];
    for (const row of progRows) {
      const uniName = getUniversityRowName(row);
      const joinKey = makeUniversityJoinKey(getUniversityRowId(row), uniName);
      if (!joinKey) continue;
      const list = programsByUni.get(joinKey) || [];
      list.push({
        name: String(row['Program name'] ?? row['programName'] ?? '').trim() || 'Program',
        degreeLevel: String(row['Degree'] ?? row['degreeLevel'] ?? '').trim() || undefined,
        field: String(row['Field'] ?? row['field'] ?? '').trim() || undefined,
        durationYears: parseNumFromText(row['Years'] ?? row['durationYears']),
        tuitionFee: parseNumFromText(row['Tuition'] ?? row['tuitionFee'] ?? row['Tuition']),
        language: String(row['Language'] ?? row['language'] ?? '').trim() || undefined,
        entryRequirements: String(
          row['Entry requirements'] ?? row['entryRequirements'] ?? row['Notes'] ?? row['notes'] ?? ''
        ).trim() || undefined,
      });
      programsByUni.set(joinKey, list);
    }
  }

  const scholarshipsByUni = new Map<string, CatalogScholarshipPayload[]>();
  if (scholarshipsSheet && wb.Sheets[scholarshipsSheet]) {
    const schRows = XLSX.utils.sheet_to_json(wb.Sheets[scholarshipsSheet]) as Record<string, unknown>[];
    for (const row of schRows) {
      const uniName = getUniversityRowName(row);
      const joinKey = makeUniversityJoinKey(getUniversityRowId(row), uniName);
      if (!joinKey) continue;
      const list = scholarshipsByUni.get(joinKey) || [];
      list.push({
        name: String(row['Scholarship name'] ?? row['scholarshipName'] ?? '').trim() || 'Scholarship',
        coveragePercent: parseNumFromText(row['Coverage %'] ?? row['coveragePercent']) ?? 0,
        maxSlots: parseNumFromText(row['Max slots'] ?? row['maxSlots']) ?? 0,
        deadline: normalizeIsoDate(parseDateFromText(row['Deadline'] ?? row['deadline'])),
        eligibility: String(row['Eligibility'] ?? row['eligibility'] ?? '').trim() || undefined,
      });
      scholarshipsByUni.set(joinKey, list);
    }
  }

  const facultiesByUni = new Map<string, CatalogFacultySelectionPayload[]>();
  if (facultiesSheet && wb.Sheets[facultiesSheet]) {
    const facultyRows = XLSX.utils.sheet_to_json(wb.Sheets[facultiesSheet]) as Record<string, unknown>[];
    for (const row of facultyRows) {
      const uniName = getUniversityRowName(row);
      const joinKey = makeUniversityJoinKey(getUniversityRowId(row), uniName);
      if (!joinKey) continue;
      const typeRaw = trimString(row['Faculty type'] ?? row['facultyType'] ?? row['Type'] ?? row['type'])?.toLowerCase();
      const type = typeRaw === 'custom' ? 'custom' : 'catalog';
      const code = trimString(row['Faculty code'] ?? row['facultyCode'] ?? row['Code'] ?? row['code']) ?? '';
      const name = trimString(row['Faculty name'] ?? row['facultyName'] ?? row['Name'] ?? row['name']) ?? code;
      if (type === 'catalog' && !code) continue;
      if (type === 'custom' && !name) continue;
      const list = facultiesByUni.get(joinKey) || [];
      list.push({
        type,
        code,
        name,
        items: splitList(row['Selected items'] ?? row['selectedItems'] ?? row['Items'] ?? row['items']),
        description: trimString(row['Description'] ?? row['description']) ?? '',
        order: parseNumFromText(row['Order'] ?? row['order']) ?? list.length,
      });
      facultiesByUni.set(joinKey, list);
    }
  }

  const customFacultiesByUni = new Map<string, CatalogCustomFacultyPayload[]>();
  if (customFacultiesSheet && wb.Sheets[customFacultiesSheet]) {
    const facultyRows = XLSX.utils.sheet_to_json(wb.Sheets[customFacultiesSheet]) as Record<string, unknown>[];
    for (const row of facultyRows) {
      const uniName = getUniversityRowName(row);
      const joinKey = makeUniversityJoinKey(getUniversityRowId(row), uniName);
      if (!joinKey) continue;
      const list = customFacultiesByUni.get(joinKey) || [];
      list.push({
        name: String(row['Faculty name'] ?? row['facultyName'] ?? '').trim() || 'Faculty',
        description: String(row['Description'] ?? row['description'] ?? '').trim() || '',
        items: splitList(row['Items'] ?? row['items']) ?? [],
        order: parseNumFromText(row['Order'] ?? row['order']) ?? list.length,
      });
      customFacultiesByUni.set(joinKey, list);
    }
  }

  const documentsByUni = new Map<string, CatalogDocumentPayload[]>();
  if (documentsSheet && wb.Sheets[documentsSheet]) {
    const documentRows = XLSX.utils.sheet_to_json(wb.Sheets[documentsSheet]) as Record<string, unknown>[];
    for (const row of documentRows) {
      const uniName = getUniversityRowName(row);
      const joinKey = makeUniversityJoinKey(getUniversityRowId(row), uniName);
      if (!joinKey) continue;
      const documentType = trimString(row['Document type'] ?? row['documentType']) ?? '';
      const fileUrl = trimString(row['File URL'] ?? row['fileUrl']) ?? '';
      if (!documentType || !fileUrl) continue;
      const list = documentsByUni.get(joinKey) || [];
      list.push({
        documentType,
        fileUrl,
        status: trimString(row['Status'] ?? row['status']),
        reviewedBy: trimString(row['Reviewed by'] ?? row['reviewedBy']),
        reviewedAt: normalizeIsoDate(row['Reviewed at'] ?? row['reviewedAt']),
      });
      documentsByUni.set(joinKey, list);
    }
  }

  const rows: ParsedUniversityExcelRow[] = [];
  for (let index = 0; index < uniRows.length; index++) {
    const row = uniRows[index];
    const rowNumber = index + 2;
    const universityName = getUniversityRowName(row);
    if (!universityName) {
      errors.push({ row: rowNumber, name: '', message: 'University name is required.' });
      continue;
    }

    const sourceId = trimString(row['ID'] ?? row['id']);
    const facultySelections = getMappedRows(facultiesByUni, sourceId, universityName);
    const normalFacultySelections = facultySelections.filter((faculty) => faculty.type !== 'custom');
    const customFacultySelections = facultySelections.filter((faculty) => faculty.type === 'custom');
    const facultyCodesFromSheet = normalFacultySelections.map((faculty) => faculty.code).filter(Boolean);
    const facultyItemsFromSheet = Object.fromEntries(
      normalFacultySelections
        .filter((faculty) => (faculty.items ?? []).length > 0)
        .map((faculty) => [faculty.code, (faculty.items ?? []).slice(0, 50)])
    );
    const body: CatalogUniversityPayload = {
      universityName,
      country: String(row['Country'] ?? row['country'] ?? '').trim() || undefined,
      city: String(row['City'] ?? row['city'] ?? '').trim() || undefined,
      tagline: String(row['Slogan'] ?? row['tagline'] ?? '').trim() || undefined,
      logoUrl: String(row['Logo URL'] ?? row['logoUrl'] ?? '').trim() || undefined,
      description: String(row['Description'] ?? row['description'] ?? '').trim() || undefined,
      minLanguageLevel: String(row['Minimum requirements'] ?? row['minLanguageLevel'] ?? '').trim() || undefined,
      tuitionPrice: parseNumFromText(row['Minimum tuition (annual)'] ?? row['tuitionPrice']),
      establishedYear: parseNumFromText(row['Year founded'] ?? row['establishedYear']),
      studentCount: parseNumFromText(row['Number of students'] ?? row['studentCount']),
      facultyCodes: facultyCodesFromSheet.length ? facultyCodesFromSheet : splitList(row['Faculties'] ?? row['faculties']),
      facultyItems:
        Object.keys(facultyItemsFromSheet).length > 0
          ? facultyItemsFromSheet
          : parseFacultyItems(row['Faculty items'] ?? row['facultyItems']),
      targetStudentCountries: splitList(row['Target student countries'] ?? row['targetStudentCountries']),
      programs: getMappedRows(programsByUni, sourceId, universityName).slice(0, 50),
      scholarships: getMappedRows(scholarshipsByUni, sourceId, universityName).slice(0, 30),
      customFaculties: (
        customFacultySelections.length
          ? customFacultySelections.map((faculty, index) => ({
              name: faculty.name,
              description: faculty.description ?? '',
              items: (faculty.items ?? []).slice(0, 100),
              order: faculty.order ?? index,
            }))
          : getMappedRows(customFacultiesByUni, sourceId, universityName)
      ).slice(0, 100),
      documents: getMappedRows(documentsByUni, sourceId, universityName).slice(0, 100),
    };

    rows.push({ row: rowNumber, sourceId: sourceId || undefined, universityName, body });
  }
  return { rows, errors };
}

export async function previewUniversitiesExcelImport(buffer: Buffer): Promise<{
  items: UniversitiesExcelPreviewItem[];
  errors: Array<{ row: number; name: string; message: string }>;
  summary: { total: number; creates: number; updates: number; errors: number };
}> {
  const parsed = parseUniversitiesExcel(buffer);
  const items: UniversitiesExcelPreviewItem[] = [];
  const errors = [...parsed.errors];

  for (const row of parsed.rows) {
    let current: EffectiveCatalogUniversityData | undefined;
    const { catalog: existing } = await findCatalogUniversityForImport(row);
    if (existing) {
      current = await getEffectiveCatalogUniversityData(existing);
    }

    const currentComparable = current ? sortForCompare(current.body) : undefined;
    const incomingComparable = sortForCompare(row.body);

    items.push({
      row: row.row,
      sourceId: row.sourceId,
      existingId: current?.id,
      universityName: row.universityName,
      linkedProfileId: current?.linkedProfileId,
      action: current ? 'update' : 'create',
      incoming: row.body,
      current: current?.body,
      changes: current ? makePreviewChanges(current.body, row.body) : [],
      sections: {
        programsChanged: stringifyCompareValue(currentComparable?.programs) !== stringifyCompareValue(incomingComparable.programs),
        scholarshipsChanged: stringifyCompareValue(currentComparable?.scholarships) !== stringifyCompareValue(incomingComparable.scholarships),
        customFacultiesChanged:
          stringifyCompareValue(currentComparable?.customFaculties) !== stringifyCompareValue(incomingComparable.customFaculties),
        documentsChanged: stringifyCompareValue(currentComparable?.documents) !== stringifyCompareValue(incomingComparable.documents),
      },
    });
  }

  return {
    items,
    errors,
    summary: {
      total: items.length,
      creates: items.filter((item) => item.action === 'create').length,
      updates: items.filter((item) => item.action === 'update').length,
      errors: errors.length,
    },
  };
}

export async function importUniversitiesFromExcel(buffer: Buffer): Promise<{
  created: number;
  updated: number;
  errors: Array<{ row: number; name: string; message: string }>;
}> {
  const parsed = parseUniversitiesExcel(buffer);
  const errors: Array<{ row: number; name: string; message: string }> = [...parsed.errors];
  let created = 0;
  let updated = 0;

  for (const row of parsed.rows) {
    try {
      const { catalog: existing } = await findCatalogUniversityForImport(row);
      if (existing) {
        const existingId = String((existing as { _id: unknown })._id);
        const updatedCatalog = await updateCatalogUniversity(existingId, row.body as unknown as Record<string, unknown>);
        const linkedProfileId = toObjectIdString((updatedCatalog as { linkedUniversityProfileId?: unknown }).linkedUniversityProfileId);
        if (linkedProfileId) {
          await syncLinkedUniversityProfile(linkedProfileId, row.body);
        }
        updated++;
      } else {
        const createdCatalog = await createCatalogUniversity(row.body as unknown as Record<string, unknown>);
        const linkedProfileId = toObjectIdString((createdCatalog as { linkedUniversityProfileId?: unknown }).linkedUniversityProfileId);
        if (linkedProfileId) {
          await syncLinkedUniversityProfile(linkedProfileId, row.body);
        }
        created++;
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ row: row.row, name: row.universityName, message });
    }
  }
  return { created, updated, errors };
}

export function getUniversitiesExcelTemplateBuffer(): Buffer {
  const XLSX = require('xlsx');
  const uniHeaders = [
    'ID',
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
    'Faculty items',
    'Target student countries',
  ];
  const facultyHeaders = ['University ID', 'University name', 'Faculty type', 'Faculty code', 'Faculty name', 'Description', 'Selected items', 'Order'];
  const progHeaders = ['University ID', 'University name', 'Program name', 'Degree', 'Field', 'Years', 'Tuition', 'Language', 'Entry requirements', 'Notes'];
  const schHeaders = ['University ID', 'University name', 'Scholarship name', 'Coverage %', 'Max slots', 'Deadline', 'Eligibility', 'Notes'];
  const documentHeaders = ['University ID', 'University name', 'Document type', 'File URL', 'Status', 'Reviewed by', 'Reviewed at'];

  const uniData = [
    uniHeaders,
    [
      '',
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
      'Engineering:Computer Science|Mechanical Engineering; Science:Biology|Physics',
      'Uzbekistan; Kazakhstan; Turkey',
    ],
  ];
  const facultyData = [
    facultyHeaders,
    ['', 'Example University', 'catalog', 'engineering_technology', 'Engineering and Technology', '', 'Computer Engineering; Mechanical Engineering', ''],
    ['', 'Example University', 'custom', '', 'Faculty of Engineering', 'Optional custom description', 'Computer Science; Mechanical Engineering', '0'],
  ];
  const progData = [progHeaders, ['', 'Example University', 'Bachelor in Computer Science', 'Bachelor', 'Computer Science', '4', '5000', 'English', 'IELTS 6.0, GPA 3.0+', '']];
  const schData = [schHeaders, ['', 'Example University', 'Merit Scholarship', '50', '10', '2025-06-30', 'GPA 3.5+', '']];
  const documentData = [documentHeaders, ['', 'Example University', 'license', 'https://example.com/license.pdf', 'approved', 'admin@example.com', '2025-06-30']];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(uniData), 'Universities');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(facultyData), 'Faculties');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(progData), 'Programs');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(schData), 'Scholarships');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(documentData), 'University Documents');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export async function getUniversitiesExcelExportBuffer(): Promise<Buffer> {
  const XLSX = require('xlsx');
  const catalogs = await UniversityCatalog.find().sort({ universityName: 1 }).lean();
  const facultyCatalogMap = await getFacultyCatalogMap();
  const effectiveItems = await Promise.all(
    catalogs.map((catalog) => getEffectiveCatalogUniversityData(catalog as unknown as Record<string, unknown>))
  );

  const universitiesSheet = [
    [
      'ID',
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
      'Faculty items',
      'Target student countries',
    ],
    ...effectiveItems.map((item) => [
      item.id,
      item.body.universityName,
      item.body.country ?? '',
      item.body.city ?? '',
      item.body.tagline ?? '',
      item.body.logoUrl ?? '',
      item.body.description ?? '',
      item.body.minLanguageLevel ?? '',
      item.body.tuitionPrice ?? '',
      item.body.establishedYear ?? '',
      item.body.studentCount ?? '',
      (item.body.facultyCodes ?? []).join('; '),
      formatFacultyItems(item.body.facultyItems),
      (item.body.targetStudentCountries ?? []).join('; '),
    ]),
  ];

  const programsSheet = [
    ['University ID', 'University name', 'Program name', 'Degree', 'Field', 'Years', 'Tuition', 'Language', 'Entry requirements', 'Notes'],
    ...effectiveItems.flatMap((item) =>
      (item.body.programs ?? []).map((program) => [
        item.id,
        item.body.universityName,
        program.name,
        program.degreeLevel ?? '',
        program.field ?? '',
        program.durationYears ?? '',
        program.tuitionFee ?? '',
        program.language ?? '',
        program.entryRequirements ?? '',
        '',
      ])
    ),
  ];

  const scholarshipsSheet = [
    ['University ID', 'University name', 'Scholarship name', 'Coverage %', 'Max slots', 'Deadline', 'Eligibility', 'Notes'],
    ...effectiveItems.flatMap((item) =>
      (item.body.scholarships ?? []).map((scholarship) => [
        item.id,
        item.body.universityName,
        scholarship.name,
        scholarship.coveragePercent,
        scholarship.maxSlots,
        scholarship.deadline ?? '',
        scholarship.eligibility ?? '',
        '',
      ])
    ),
  ];

  const facultiesSheet = [
    ['University ID', 'University name', 'Faculty type', 'Faculty code', 'Faculty name', 'Description', 'Selected items', 'Order'],
    ...effectiveItems.flatMap((item) => [
      ...(item.body.facultyCodes ?? []).map((code) => {
        const faculty = facultyCatalogMap.get(code);
        const selectedItems = item.body.facultyItems?.[code] ?? faculty?.items ?? [];
        return [
          item.id,
          item.body.universityName,
          'catalog',
          code,
          faculty?.name ?? STATIC_FACULTY_LABELS[code] ?? code,
          '',
          selectedItems.join('; '),
          '',
        ];
      }),
      ...(item.body.customFaculties ?? []).map((faculty) => [
        item.id,
        item.body.universityName,
        'custom',
        '',
        faculty.name,
        faculty.description ?? '',
        (faculty.items ?? []).join('; '),
        faculty.order ?? 0,
      ]),
    ]),
  ];

  const documentsSheet = [
    ['University ID', 'University name', 'Document type', 'File URL', 'Status', 'Reviewed by', 'Reviewed at'],
    ...effectiveItems.flatMap((item) =>
      (item.body.documents ?? []).map((document) => [
        item.id,
        item.body.universityName,
        document.documentType,
        document.fileUrl,
        document.status ?? '',
        document.reviewedBy ?? '',
        document.reviewedAt ?? '',
      ])
    ),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(universitiesSheet), 'Universities');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(facultiesSheet), 'Faculties');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(programsSheet), 'Programs');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(scholarshipsSheet), 'Scholarships');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(documentsSheet), 'University Documents');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
