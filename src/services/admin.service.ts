import crypto from "crypto";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
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
} from "../models";
import { AppError, ErrorCodes } from "../utils/errors";
import { toObjectIdString } from "../utils/objectId";
import { safeRegExp } from "../utils/validators";
import { DEFAULT_ADMIN_EMAIL } from "../config/defaultAdmin";
import * as subscriptionService from "./subscription.service";
import * as ticketService from "./ticket.service";
import * as studentDocumentService from "./studentDocument.service";
import type { AdminDocumentListStatus } from "./studentDocument.service";
import * as emailService from "./email.service";
import * as telegramService from "./telegram.service";
import { config } from "../config";
import { v4 as uuidv4 } from "uuid";

const BCRYPT_ROUNDS = 12;
const INVITE_TOKEN_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000;
const MANAGER_VISIBLE_ROLES = [
  "school_counsellor",
  "counsellor_coordinator",
] as const;
const COORDINATOR_VISIBLE_ROLES = ["school_counsellor"] as const;

type ManagementRole =
  | "admin"
  | "manager"
  | "counsellor_coordinator"
  | "school_counsellor";
type ManagedRole =
  | "student"
  | "university"
  | "university_multi_manager"
  | "admin"
  | "school_counsellor"
  | "counsellor_coordinator"
  | "manager";
type ManagementActor = { id: string; role: string } | undefined;

const MANAGED_ROLES = [
  "student",
  "university",
  "university_multi_manager",
  "admin",
  "school_counsellor",
  "counsellor_coordinator",
  "manager",
] as const;

function getManagementRole(role: string | undefined): ManagementRole | null {
  if (
    role === "admin" ||
    role === "manager" ||
    role === "counsellor_coordinator" ||
    role === "school_counsellor"
  ) {
    return role;
  }
  return null;
}

function getVisibleRolesForManagementRole(
  role: ManagementRole,
): ReadonlyArray<string> | null {
  if (role === "admin") return null;
  if (role === "manager") return MANAGER_VISIBLE_ROLES;
  if (role === "counsellor_coordinator") return COORDINATOR_VISIBLE_ROLES;
  return ["school_counsellor"];
}

function canManageTargetRole(
  actorRole: ManagementRole,
  targetRole: string,
): boolean {
  if (actorRole === "admin") return true;
  if (actorRole === "manager")
    return (
      targetRole === "school_counsellor" ||
      targetRole === "counsellor_coordinator"
    );
  if (actorRole === "counsellor_coordinator")
    return targetRole === "school_counsellor";
  return false;
}

function isManagedRole(value: string): value is ManagedRole {
  return (MANAGED_ROLES as readonly string[]).includes(value);
}

function isPhonePlaceholderEmail(value: unknown): boolean {
  return /^phone_\d+@phone\.edmission\.local$/i.test(
    String(value ?? "").trim(),
  );
}

function getPublicUserEmail(user: { email?: string; phone?: string }): string {
  const email = String(user.email ?? "").trim();
  const phone = String(user.phone ?? "").trim();
  if (phone && (isPhonePlaceholderEmail(email) || email === phone))
    return phone;
  return email;
}

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(12);
  let value = "";
  for (let i = 0; i < 12; i++) value += chars[bytes[i]! % chars.length];
  return value;
}

function assertRoleManageAllowed(
  actor: ManagementActor,
  targetRole: string,
): void {
  if (!actor) {
    throw new AppError(401, "Authorization required", ErrorCodes.UNAUTHORIZED);
  }
  const actorRole = getManagementRole(actor.role);
  if (!actorRole || !canManageTargetRole(actorRole, targetRole)) {
    throw new AppError(403, "Insufficient permissions", ErrorCodes.FORBIDDEN);
  }
}

function restrictRoleByVisibility(
  requestedRole: string | undefined,
  visibleRoles: ReadonlyArray<string> | null,
): string | undefined {
  if (!requestedRole) return undefined;
  if (visibleRoles == null) return requestedRole;
  return visibleRoles.includes(requestedRole)
    ? requestedRole
    : "__no_visible_role__";
}

function mergeUserRoleFilters(
  visibleRoles: ReadonlyArray<string> | null,
  requestedRole: string | undefined,
): Record<string, unknown> {
  const roleFromQuery = restrictRoleByVisibility(requestedRole, visibleRoles);
  if (roleFromQuery === "__no_visible_role__")
    return { role: "__no_visible_role__" };
  if (visibleRoles == null) return roleFromQuery ? { role: roleFromQuery } : {};
  if (roleFromQuery) return { role: roleFromQuery };
  return { role: { $in: [...visibleRoles] } };
}

function parseDateOnlyInput(
  value: string | undefined,
  endOfDay: boolean = false,
): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const iso = endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function getDashboard() {
  const [users, universities, offers, pendingVerification, pendingDocuments, subStats] =
    await Promise.all([
      User.countDocuments(),
      UniversityProfile.countDocuments(),
      Offer.countDocuments({ status: "pending" }),
      UniversityProfile.countDocuments({ verified: false }),
      StudentDocument.countDocuments({ status: "pending" }),
      Subscription.aggregate([
        { $match: { status: "active" } },
        { $group: { _id: "$plan", count: { $sum: 1 } } },
      ]),
    ]);
  const byPlan: Record<string, number> = {};
  for (const s of subStats) {
    byPlan[s._id] = s.count;
  }
  const mrr =
    (byPlan["student_standard"] ?? 0) * 9.99 +
    (byPlan["student_max_premium"] ?? 0) * 19.99 +
    (byPlan["university_premium"] ?? 0) * 29.99;
  return {
    users,
    universities,
    pendingOffers: offers,
    pendingVerification,
    pendingDocuments,
    subscriptionsByPlan: byPlan,
    mrr: Math.round(mrr * 100) / 100,
  };
}

/** Top universities by student interest count (for admin analytics). */
export async function getUniversityInterestAnalytics(limit: number = 20) {
  const cap = Math.min(50, Math.max(1, limit));
  const [profileAgg, catalogAgg] = await Promise.all([
    Interest.aggregate([
      { $group: { _id: "$universityId", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: cap },
      {
        $lookup: {
          from: "universityprofiles",
          localField: "_id",
          foreignField: "_id",
          as: "uni",
        },
      },
      { $unwind: { path: "$uni", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          universityId: { $toString: "$_id" },
          count: 1,
          name: "$uni.universityName",
        },
      },
    ]).exec(),
    CatalogInterest.aggregate([
      { $group: { _id: "$catalogUniversityId", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: cap },
      {
        $lookup: {
          from: "universitycatalogs",
          localField: "_id",
          foreignField: "_id",
          as: "uni",
        },
      },
      { $unwind: { path: "$uni", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          universityId: { $toString: "$_id" },
          count: 1,
          name: "$uni.universityName",
        },
      },
    ]).exec(),
  ]);
  const profileItems = profileAgg.map(
    (r: { universityId: string; count: number; name?: string }) => ({
      universityId: r.universityId,
      universityName: r.name ?? "—",
      interestCount: r.count,
      source: "profile" as const,
    }),
  );
  const catalogItems = catalogAgg.map(
    (r: { universityId: string; count: number; name?: string }) => ({
      universityId: r.universityId,
      universityName: r.name ?? "—",
      interestCount: r.count,
      source: "catalog" as const,
    }),
  );
  const merged = [...profileItems, ...catalogItems]
    .sort((a, b) => b.interestCount - a.interestCount)
    .slice(0, cap);
  return merged;
}

export async function getAnalyticsOverview(query: {
  from?: string;
  to?: string;
}) {
  const today = new Date();
  const todayKey = toDateOnlyString(today);
  const from = parseDateOnlyInput(query.from ?? todayKey, false);
  const to = parseDateOnlyInput(query.to ?? todayKey, true);

  if (!from || !to) {
    throw new AppError(400, "Invalid date range", ErrorCodes.VALIDATION);
  }
  if (from.getTime() > to.getTime()) {
    throw new AppError(
      400,
      '"from" must be before or equal to "to"',
      ErrorCodes.VALIDATION,
    );
  }

  const visitRange = { visitedOn: { $gte: from, $lte: to } };
  const registrationRange = { createdAt: { $gte: from, $lte: to } };

  const [visitorIds, universityUserIds, studentUserIds, registrations] =
    await Promise.all([
      SiteVisit.distinct("visitorId", visitRange),
      SiteVisit.distinct("userId", {
        ...visitRange,
        role: "university",
        userId: { $ne: null },
      }),
      SiteVisit.distinct("userId", {
        ...visitRange,
        role: "student",
        userId: { $ne: null },
      }),
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

export async function assertUniversityUserAccount(userId: string) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new AppError(400, "Invalid user id", ErrorCodes.VALIDATION);
  }
  const user = await User.findById(userId).select("role").lean();
  if (!user) throw new AppError(404, "User not found", ErrorCodes.NOT_FOUND);
  if (String((user as { role?: string }).role) !== "university") {
    throw new AppError(
      400,
      "User is not a university account",
      ErrorCodes.VALIDATION,
    );
  }
}

async function createUniversityProfileFromCatalogForUser(
  catalog: Record<string, unknown>,
  userId: unknown,
) {
  const profile = await UniversityProfile.create({
    userId,
    universityName: String(catalog.universityName ?? ""),
    tagline: catalog.tagline,
    establishedYear: catalog.establishedYear,
    studentCount: catalog.studentCount,
    country: catalog.country,
    city: catalog.city,
    description: catalog.description,
    rating: catalog.rating,
    logoUrl: catalog.logoUrl,
    verified: true,
    onboardingCompleted: false,
    facultyCodes: Array.isArray(catalog.facultyCodes)
      ? catalog.facultyCodes
      : [],
    facultyItems: catalog.facultyItems ?? undefined,
    targetStudentCountries: Array.isArray(catalog.targetStudentCountries)
      ? catalog.targetStudentCountries
      : [],
    minLanguageLevel: catalog.minLanguageLevel,
    tuitionPrice: catalog.tuitionPrice,
  });

  for (const p of (Array.isArray(catalog.programs) ? catalog.programs : []) as Array<Record<string, unknown>>) {
    await Program.create({
      universityId: profile._id,
      name: p.name ?? "",
      degreeLevel: p.degreeLevel ?? "",
      field: p.field ?? "",
      durationYears: p.durationYears != null ? Number(p.durationYears) : undefined,
      tuitionFee: p.tuitionFee != null ? Number(p.tuitionFee) : undefined,
      language: p.language != null ? String(p.language) : undefined,
      entryRequirements: p.entryRequirements != null ? String(p.entryRequirements) : undefined,
    });
  }

  for (const s of (Array.isArray(catalog.scholarships) ? catalog.scholarships : []) as Array<Record<string, unknown>>) {
    const maxSlots = s.maxSlots != null ? Number(s.maxSlots) : 1;
    await Scholarship.create({
      universityId: profile._id,
      name: s.name ?? "",
      coveragePercent: s.coveragePercent != null ? Number(s.coveragePercent) : 0,
      maxSlots,
      remainingSlots: maxSlots,
      deadline: s.deadline ? new Date(s.deadline as string) : undefined,
      eligibility: s.eligibility != null ? String(s.eligibility) : undefined,
    });
  }

  for (const faculty of (Array.isArray(catalog.customFaculties) ? catalog.customFaculties : []) as Array<Record<string, unknown>>) {
    await Faculty.create({
      universityId: profile._id,
      name: faculty.name ?? "",
      description: faculty.description != null ? String(faculty.description) : "",
      items: Array.isArray(faculty.items)
        ? faculty.items.map((item) => String(item)).filter(Boolean)
        : [],
      order: faculty.order != null ? Number(faculty.order) : 0,
    });
  }

  for (const document of (Array.isArray(catalog.documents) ? catalog.documents : []) as Array<Record<string, unknown>>) {
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

  return profile;
}

async function ensureUniversityUserAccountFromCatalog(catalogId: string): Promise<string> {
  const catalog = await UniversityCatalog.findById(catalogId).lean();
  if (!catalog) {
    throw new AppError(
      400,
      "managedUniversityUserIds must reference university accounts or catalog universities",
      ErrorCodes.VALIDATION,
    );
  }

  const linkedProfileId = (catalog as { linkedUniversityProfileId?: unknown }).linkedUniversityProfileId;
  if (linkedProfileId && mongoose.Types.ObjectId.isValid(String(linkedProfileId))) {
    const linkedProfile = await UniversityProfile.findById(linkedProfileId)
      .select("userId")
      .lean();
    const linkedUserId = linkedProfile ? String((linkedProfile as { userId: unknown }).userId) : "";
    if (linkedUserId && mongoose.Types.ObjectId.isValid(linkedUserId)) return linkedUserId;
  }

  const existingProfile = await UniversityProfile.findOne({
    universityName: (catalog as { universityName?: string }).universityName,
    country: (catalog as { country?: string }).country,
    city: (catalog as { city?: string }).city,
  })
    .select("_id userId")
    .lean();
  if (existingProfile) {
    await UniversityCatalog.findByIdAndUpdate(catalogId, {
      linkedUniversityProfileId: (existingProfile as { _id: unknown })._id,
    });
    return String((existingProfile as { userId: unknown }).userId);
  }

  const technicalEmail = `catalog-${catalogId}@edmission.local`;
  let user = await User.findOne({ email: technicalEmail }).select("_id").lean();
  if (!user) {
    const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10);
    user = await User.create({
      email: technicalEmail,
      role: "university",
      name: String((catalog as { universityName?: string }).universityName ?? ""),
      passwordHash,
      emailVerified: true,
      localPasswordConfigured: false,
    });
  }

  const profile = await createUniversityProfileFromCatalogForUser(
    catalog as unknown as Record<string, unknown>,
    (user as { _id: unknown })._id,
  );
  await UniversityCatalog.findByIdAndUpdate(catalogId, {
    linkedUniversityProfileId: profile._id,
  });
  return String((user as { _id: unknown })._id);
}

export async function getUsers(
  query: {
    page?: number;
    limit?: number;
    role?: string;
    status?: string;
    search?: string;
  },
  actor?: { id: string; role: string },
) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const actorRole = getManagementRole(actor?.role);
  const visibleRoles = actorRole
    ? getVisibleRolesForManagementRole(actorRole)
    : null;
  const baseWhere: Record<string, unknown> = mergeUserRoleFilters(
    visibleRoles,
    query.role,
  );
  if (query.status === "active") baseWhere.suspended = false;
  if (query.status === "suspended") baseWhere.suspended = true;

  const searchRaw = query.search?.trim();
  let where: Record<string, unknown> = baseWhere;
  if (searchRaw) {
    const rx = safeRegExp(searchRaw, "i", 100);
    const profileRows = await StudentProfile.find({
      $or: [{ firstName: rx }, { lastName: rx }],
    })
      .select("userId")
      .limit(200)
      .lean();
    const userIdsFromProfiles = profileRows
      .map((p) => (p as { userId?: unknown }).userId)
      .filter(
        (id): id is mongoose.Types.ObjectId =>
          Boolean(id) && mongoose.Types.ObjectId.isValid(String(id)),
      )
      .map((id) => new mongoose.Types.ObjectId(String(id)));
    const orClause: Record<string, unknown>[] = [{ email: rx }, { name: rx }];
    if (userIdsFromProfiles.length) {
      orClause.push({ _id: { $in: userIdsFromProfiles } });
    }
    where = { $and: [baseWhere, { $or: orClause }] };
  }

  const [list, total] = await Promise.all([
    User.find(where)
      .skip(skip)
      .limit(limit)
      .select(
        "email name phone role emailVerified suspended createdAt mustChangePassword temporaryPlainPassword",
      )
      .lean(),
    User.countDocuments(where),
  ]);
  const data = list.map((u) => {
    const doc = u as {
      _id: unknown;
      email?: string;
      name?: string;
      phone?: string;
      role?: string;
      emailVerified?: boolean;
      suspended?: boolean;
      createdAt?: Date | string;
      mustChangePassword?: boolean;
      temporaryPlainPassword?: string;
    };
    const createdAt =
      doc.createdAt != null
        ? new Date(doc.createdAt as string | Date).toISOString()
        : undefined;
    return {
      id: String(doc._id),
      email: getPublicUserEmail(doc),
      name: doc.name ?? "",
      phone: doc.phone ?? "",
      role: doc.role ?? "",
      emailVerified: doc.emailVerified,
      suspended: doc.suspended,
      mustChangePassword: Boolean(doc.mustChangePassword),
      temporaryPassword: doc.mustChangePassword
        ? String(doc.temporaryPlainPassword ?? "") || undefined
        : undefined,
      createdAt,
    };
  });

  const needsDisplayName = (name: string) => !String(name || "").trim();
  const toOid = (ids: string[]) =>
    ids.map((id) => new mongoose.Types.ObjectId(id));

  const studentIds = data
    .filter((r) => r.role === "student" && needsDisplayName(r.name))
    .map((r) => r.id);
  const universityIds = data
    .filter((r) => r.role === "university" && needsDisplayName(r.name))
    .map((r) => r.id);
  const counsellorIds = data
    .filter((r) => r.role === "school_counsellor" && needsDisplayName(r.name))
    .map((r) => r.id);

  const [studentProfiles, uniProfiles, counsellorProfiles] = await Promise.all([
    studentIds.length
      ? StudentProfile.find({ userId: { $in: toOid(studentIds) } })
          .select("userId firstName lastName")
          .lean()
      : Promise.resolve([]),
    universityIds.length
      ? UniversityProfile.find({ userId: { $in: toOid(universityIds) } })
          .select("userId universityName")
          .lean()
      : Promise.resolve([]),
    counsellorIds.length
      ? CounsellorProfile.find({ userId: { $in: toOid(counsellorIds) } })
          .select("userId schoolName")
          .lean()
      : Promise.resolve([]),
  ]);

  const studentNameByUserId = new Map<string, string>();
  for (const p of studentProfiles) {
    const row = p as {
      userId?: unknown;
      firstName?: string;
      lastName?: string;
    };
    const uid = String(row.userId ?? "");
    const full = [row.firstName, row.lastName]
      .map((x) => (x != null ? String(x).trim() : ""))
      .filter(Boolean)
      .join(" ")
      .trim();
    if (full) studentNameByUserId.set(uid, full);
  }
  const uniNameByUserId = new Map<string, string>();
  for (const p of uniProfiles) {
    const row = p as { userId?: unknown; universityName?: string };
    const uid = String(row.userId ?? "");
    const n =
      row.universityName != null ? String(row.universityName).trim() : "";
    if (n) uniNameByUserId.set(uid, n);
  }
  const schoolNameByUserId = new Map<string, string>();
  for (const p of counsellorProfiles) {
    const row = p as { userId?: unknown; schoolName?: string };
    const uid = String(row.userId ?? "");
    const n = row.schoolName != null ? String(row.schoolName).trim() : "";
    if (n) schoolNameByUserId.set(uid, n);
  }

  for (const row of data) {
    if (!needsDisplayName(row.name)) continue;
    if (row.role === "student") {
      const alt = studentNameByUserId.get(row.id);
      if (alt) row.name = alt;
    } else if (row.role === "university") {
      const alt = uniNameByUserId.get(row.id);
      if (alt) row.name = alt;
    } else if (row.role === "school_counsellor") {
      const alt = schoolNameByUserId.get(row.id);
      if (alt) row.name = alt;
    } else if (
      row.role === "university_multi_manager" &&
      needsDisplayName(row.name)
    ) {
      row.name = row.email || row.name;
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
  actor?: { id: string; role: string },
) {
  const email = String(payload.email || "")
    .trim()
    .toLowerCase();
  const password =
    payload.password != null ? String(payload.password) : undefined;
  const role = payload.role;
  const name = payload.name != null ? String(payload.name) : "";

  if (!email)
    throw new AppError(400, "Email is required", ErrorCodes.VALIDATION);
  if (
    ![
      "student",
      "university",
      "university_multi_manager",
      "admin",
      "school_counsellor",
      "counsellor_coordinator",
      "manager",
    ].includes(role)
  ) {
    throw new AppError(400, "Invalid role", ErrorCodes.VALIDATION);
  }
  if (actor && actor.role !== "admin") {
    assertRoleManageAllowed(actor, role);
  }

  const existing = await User.findOne({ email });
  if (existing)
    throw new AppError(409, "Email already registered", ErrorCodes.CONFLICT);

  const isInvite = !password || password.trim() === "";
  const passwordHash = isInvite
    ? await bcrypt.hash(uuidv4() + Date.now(), BCRYPT_ROUNDS)
    : await bcrypt.hash(password!, BCRYPT_ROUNDS);

  const inviteToken = isInvite ? uuidv4() : undefined;
  const inviteTokenExpires = isInvite
    ? new Date(Date.now() + INVITE_TOKEN_EXPIRES_MS)
    : undefined;

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
    temporaryPlainPassword: isInvite ? "" : password,
  });

  if (role === "student") {
    await StudentProfile.create({ userId: user._id });
  } else if (role === "university") {
    await UniversityProfile.create({
      userId: user._id,
      universityName: name?.trim() ? name.trim() : "New University",
      verified: true,
      onboardingCompleted: false,
    });
  } else if (role === "school_counsellor") {
    await CounsellorProfile.create({
      userId: user._id,
      schoolName: name?.trim() ? name.trim() : "",
    });
  }

  if (role === "student" || role === "university") {
    await subscriptionService.createForNewUser(String(user._id), role);
  }

  if (
    isInvite &&
    inviteToken &&
    (config.email?.enabled || config.email?.sendgridApiKey)
  ) {
    await emailService.sendInviteSetPasswordEmail(user.email, inviteToken);
  }

  const plain = user.toObject();
  return { ...plain, id: String(user._id) };
}

export async function getUserById(
  userId: string,
  actor?: { id: string; role: string },
) {
  const u = await User.findById(userId)
    .select(
      "email name phone role emailVerified suspended createdAt mustChangePassword temporaryPlainPassword managedUniversityUserIds universityMultiManagerApproved",
    )
    .lean();
  if (!u) throw new AppError(404, "User not found", ErrorCodes.NOT_FOUND);
  if (actor && actor.role !== "admin") {
    const actorRole = getManagementRole(actor.role);
    const visibleRoles = actorRole
      ? getVisibleRolesForManagementRole(actorRole)
      : null;
    if (
      visibleRoles != null &&
      !visibleRoles.includes(String((u as { role?: string }).role ?? ""))
    ) {
      throw new AppError(403, "Insufficient permissions", ErrorCodes.FORBIDDEN);
    }
  }
  const doc = u as {
    _id: unknown;
    mustChangePassword?: boolean;
    temporaryPlainPassword?: string;
    role?: string;
    managedUniversityUserIds?: unknown[];
  };
  let managedUniversities:
    | Array<{ userId: string; universityName: string; logoUrl?: string; verified: boolean }>
    | undefined;
  if (doc.role === "university_multi_manager") {
    const ids = (doc.managedUniversityUserIds ?? [])
      .map((x) => String(x))
      .filter((id) => mongoose.Types.ObjectId.isValid(id));
    managedUniversities = ids.length
      ? (
          await UniversityProfile.find({ userId: { $in: ids } })
            .select("userId universityName logoUrl verified")
            .lean()
        ).map((p) => ({
          userId: String((p as { userId: unknown }).userId),
          universityName: String((p as { universityName?: string }).universityName ?? ""),
          logoUrl: (p as { logoUrl?: string }).logoUrl
            ? String((p as { logoUrl: string }).logoUrl).trim() || undefined
            : undefined,
          verified: Boolean((p as { verified?: boolean }).verified),
        }))
      : [];
  }
  return {
    ...u,
    id: String(doc._id),
    temporaryPassword: String(doc.temporaryPlainPassword ?? "") || undefined,
    ...(managedUniversities ? { managedUniversities } : {}),
  };
}

export async function updateUser(
  userId: string,
  patch: {
    name?: string;
    role?: ManagedRole;
    emailVerified?: boolean;
    suspended?: boolean;
    managedUniversityUserIds?: string[];
    universityMultiManagerApproved?: boolean;
  },
  actor?: { id: string; role: string },
) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, "User not found", ErrorCodes.NOT_FOUND);
  if (actor && actor.role !== "admin") {
    assertRoleManageAllowed(actor, user.role);
    if (patch.role !== undefined) assertRoleManageAllowed(actor, patch.role);
    if (patch.emailVerified !== undefined) {
      throw new AppError(403, "Insufficient permissions", ErrorCodes.FORBIDDEN);
    }
  }
  if (user.email === DEFAULT_ADMIN_EMAIL) {
    if (patch.suspended !== undefined)
      throw new AppError(
        403,
        "Cannot modify default admin",
        ErrorCodes.FORBIDDEN,
      );
    if (patch.role !== undefined)
      throw new AppError(
        403,
        "Cannot change default admin role",
        ErrorCodes.FORBIDDEN,
      );
  }

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = String(patch.name);
  if (patch.role !== undefined) update.role = patch.role;
  if (patch.emailVerified !== undefined)
    update.emailVerified = Boolean(patch.emailVerified);
  if (patch.suspended !== undefined) {
    if (user.email === DEFAULT_ADMIN_EMAIL)
      throw new AppError(
        403,
        "Cannot suspend default admin",
        ErrorCodes.FORBIDDEN,
      );
    if (user.role === "admin")
      throw new AppError(403, "Cannot suspend admin", ErrorCodes.FORBIDDEN);
    update.suspended = Boolean(patch.suspended);
  }

  if (
    patch.managedUniversityUserIds !== undefined ||
    patch.universityMultiManagerApproved !== undefined
  ) {
    if (!actor || actor.role !== "admin") {
      throw new AppError(
        403,
        "Only administrators can update multi-manager university assignments",
        ErrorCodes.FORBIDDEN,
      );
    }
    const targetRole = patch.role ?? (user as { role?: string }).role;
    const nextRole = patch.role ?? (user as { role: ManagedRole }).role;
    if (nextRole !== "university_multi_manager") {
      throw new AppError(
        400,
        "Assignment fields apply only to university multi-manager accounts",
        ErrorCodes.VALIDATION,
      );
    }
    if (patch.managedUniversityUserIds !== undefined) {
      const inputIds = [
        ...new Set(
          patch.managedUniversityUserIds
            .map((x) => String(x).trim())
            .filter(Boolean),
        ),
      ];
      for (const id of inputIds) {
        if (!mongoose.Types.ObjectId.isValid(id)) {
          throw new AppError(
            400,
            "Invalid university or catalog id in managedUniversityUserIds",
            ErrorCodes.VALIDATION,
          );
        }
      }
      const resolvedUserIds: string[] = [];
      for (const id of inputIds) {
        const uniUser = await User.findOne({ _id: id, role: "university" })
          .select("_id")
          .lean();
        if (uniUser) {
          resolvedUserIds.push(String((uniUser as { _id: unknown })._id));
          continue;
        }
        resolvedUserIds.push(await ensureUniversityUserAccountFromCatalog(id));
      }
      const ids = [...new Set(resolvedUserIds)];
      update.managedUniversityUserIds = ids.map(
        (id) => new mongoose.Types.ObjectId(id),
      );
    }
    if (patch.universityMultiManagerApproved !== undefined) {
      update.universityMultiManagerApproved = Boolean(
        patch.universityMultiManagerApproved,
      );
    }
  }

  const updated = await User.findByIdAndUpdate(userId, update, { new: true })
    .select(
      "email name phone role emailVerified suspended createdAt mustChangePassword temporaryPlainPassword managedUniversityUserIds universityMultiManagerApproved",
    )
    .lean();
  if (!updated) return null;
  const doc = updated as {
    _id: unknown;
    mustChangePassword?: boolean;
    temporaryPlainPassword?: string;
  };
  return {
    ...updated,
    id: String(doc._id),
    temporaryPassword: doc.mustChangePassword
      ? String(doc.temporaryPlainPassword ?? "") || undefined
      : undefined,
  };
}

export async function resetUserPassword(
  userId: string,
  newPassword: string,
  actor?: { id: string; role: string },
) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, "User not found", ErrorCodes.NOT_FOUND);
  if (actor && actor.role !== "admin") {
    assertRoleManageAllowed(actor, user.role);
  }
  if (user.email === DEFAULT_ADMIN_EMAIL)
    throw new AppError(
      403,
      "Cannot reset default admin password",
      ErrorCodes.FORBIDDEN,
    );
  const passwordHash = await bcrypt.hash(
    String(newPassword || ""),
    BCRYPT_ROUNDS,
  );
  await User.findByIdAndUpdate(
    userId,
    {
      passwordHash,
      localPasswordConfigured: true,
      mustChangePassword: false,
      temporaryPlainPassword: String(newPassword || ""),
      temporaryPasswordGeneratedAt: null,
      resetToken: null,
      resetTokenExpires: null,
      passwordChangedAt: new Date(),
    },
    { new: true },
  );
  await RefreshToken.deleteMany({ userId });
  return { success: true };
}

type UserExcelPayload = {
  email: string;
  generatedEmail?: boolean;
  role: ManagedRole;
  name: string;
  firstName: string;
  lastName: string;
  phone?: string;
  language?: "en" | "ru" | "uz";
  emailVerified?: boolean;
  suspended?: boolean;
  country?: string;
  city?: string;
  gradeLevel?: string;
  gpa?: number;
  schoolName?: string;
  graduationYear?: number;
  preferredCountries?: string[];
  interestedFaculties?: string[];
  counsellorUserId?: string;
  counsellorEmail?: string;
  managedUniversityUserIds?: string[];
  universityMultiManagerApproved?: boolean;
};

type ParsedUserExcelRow = {
  row: number;
  sourceId?: string;
  body: UserExcelPayload;
};

type ParsedUsersExcelResult = {
  rows: ParsedUserExcelRow[];
  errors: Array<{ row: number; name: string; message: string }>;
};

type UsersExcelPreviewItem = {
  row: number;
  sourceId?: string;
  existingId?: string;
  email: string;
  name: string;
  action: "create" | "update";
  incoming: UserExcelPayload;
  current?: UserExcelPayload;
  changes: Array<{ field: string; before: string; after: string }>;
};

function normalizeEmail(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function parseBooleanFromText(value: unknown): boolean | undefined {
  if (value == null || value === "") return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (
    ["true", "yes", "y", "1", "active", "verified", "approved"].includes(
      normalized,
    )
  )
    return true;
  if (
    [
      "false",
      "no",
      "n",
      "0",
      "suspended",
      "unverified",
      "not verified",
    ].includes(normalized)
  )
    return false;
  return undefined;
}

function splitFullName(value: string): { firstName: string; lastName: string } {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function slugEmailPart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeGeneratedEmailBase(firstName: string, lastName: string): string {
  const lastInitial = slugEmailPart(lastName).slice(0, 1).toUpperCase();
  const cleanFirstName = slugEmailPart(firstName);
  const displayFirstName = cleanFirstName
    ? cleanFirstName.charAt(0).toUpperCase() + cleanFirstName.slice(1)
    : "User";
  return `${lastInitial || "U"}-${displayFirstName}`;
}

async function makeUniqueGeneratedEmail(
  firstName: string,
  lastName: string,
  usedEmails: Set<string>,
): Promise<string> {
  const base = makeGeneratedEmailBase(firstName, lastName);
  let counter = 1;
  while (counter < 10000) {
    const suffix = counter === 1 ? "" : String(counter);
    const email = `${base}${suffix}@edmission.uz`;
    const emailKey = email.toLowerCase();
    const existing = await User.exists({
      email: new RegExp(`^${escapeRegExp(email)}$`, "i"),
    });
    if (!usedEmails.has(emailKey) && !existing) {
      usedEmails.add(emailKey);
      return email;
    }
    counter += 1;
  }
  const fallback = `${base}.${Date.now()}@edmission.uz`;
  usedEmails.add(fallback.toLowerCase());
  return fallback;
}

function userExcelComparable(
  payload: UserExcelPayload,
): Record<string, unknown> {
  return {
    email: payload.email,
    role: payload.role,
    name: payload.name,
    firstName: payload.firstName,
    lastName: payload.lastName,
    phone: payload.phone ?? "",
    language: payload.language ?? "",
    emailVerified: payload.emailVerified ?? false,
    suspended: payload.suspended ?? false,
    country: payload.country ?? "",
    city: payload.city ?? "",
    gradeLevel: payload.gradeLevel ?? "",
    gpa: payload.gpa ?? null,
    schoolName: payload.schoolName ?? "",
    graduationYear: payload.graduationYear ?? null,
    preferredCountries: [...(payload.preferredCountries ?? [])].sort(),
    interestedFaculties: [...(payload.interestedFaculties ?? [])].sort(),
    counsellorUserId: payload.counsellorUserId ?? "",
    counsellorEmail: payload.counsellorEmail ?? "",
    managedUniversityUserIds: [
      ...(payload.managedUniversityUserIds ?? []),
    ].sort(),
    universityMultiManagerApproved:
      payload.universityMultiManagerApproved ?? false,
  };
}

function makeUserPreviewChanges(
  current: UserExcelPayload,
  incoming: UserExcelPayload,
) {
  const labels: Record<string, string> = {
    email: "Email",
    role: "Role",
    name: "Name",
    firstName: "First name",
    lastName: "Last name",
    phone: "Phone",
    language: "Language",
    emailVerified: "Email verified",
    suspended: "Suspended",
    country: "Country",
    city: "City",
    gradeLevel: "Grade level",
    gpa: "GPA",
    schoolName: "School name",
    graduationYear: "Graduation year",
    preferredCountries: "Preferred countries",
    interestedFaculties: "Interested faculties",
    counsellorUserId: "Counsellor User ID",
    counsellorEmail: "Counsellor email",
    managedUniversityUserIds: "Managed university User IDs",
    universityMultiManagerApproved: "Multi-manager approved",
  };
  const currentComparable = userExcelComparable(current);
  const incomingComparable = userExcelComparable(incoming);
  return Object.keys(labels)
    .map((field) => {
      const before = stringifyCompareValue(currentComparable[field]);
      const after = stringifyCompareValue(incomingComparable[field]);
      if (before === after) return null;
      return { field: labels[field], before, after };
    })
    .filter(
      (item): item is { field: string; before: string; after: string } =>
        item != null,
    );
}

async function getStudentPayloadByUserIds(
  userIds: string[],
): Promise<Map<string, Partial<UserExcelPayload>>> {
  const result = new Map<string, Partial<UserExcelPayload>>();
  if (!userIds.length) return result;
  const profiles = await StudentProfile.find({
    userId: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) },
  }).lean();
  const counsellorIds = [
    ...new Set(
      profiles
        .map((profile) =>
          String((profile as Record<string, unknown>).counsellorUserId ?? ""),
        )
        .filter((id) => mongoose.Types.ObjectId.isValid(id)),
    ),
  ];
  const counsellors = counsellorIds.length
    ? await User.find({
        _id: {
          $in: counsellorIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
        role: "school_counsellor",
      })
        .select("email")
        .lean()
    : [];
  const counsellorEmailById = new Map(
    counsellors.map((user: Record<string, unknown>) => [
      String(user._id),
      String(user.email ?? ""),
    ]),
  );
  for (const profile of profiles) {
    const row = profile as Record<string, unknown>;
    const userId = String(row.userId ?? "");
    const counsellorUserId =
      row.counsellorUserId != null ? String(row.counsellorUserId) : undefined;
    result.set(userId, {
      firstName: String(row.firstName ?? ""),
      lastName: String(row.lastName ?? ""),
      country: trimString(row.country),
      city: trimString(row.city),
      gradeLevel: trimString(row.gradeLevel),
      gpa: normalizeNumber(row.gpa),
      schoolName: trimString(row.schoolName),
      graduationYear: normalizeNumber(row.graduationYear),
      preferredCountries: Array.isArray(row.preferredCountries)
        ? row.preferredCountries.map(String).filter(Boolean)
        : [],
      interestedFaculties: Array.isArray(row.interestedFaculties)
        ? row.interestedFaculties.map(String).filter(Boolean)
        : [],
      counsellorUserId,
      counsellorEmail: counsellorUserId
        ? counsellorEmailById.get(counsellorUserId)
        : undefined,
    });
  }
  return result;
}

function buildUserExcelPayload(
  userRaw: Record<string, unknown>,
  studentPatch?: Partial<UserExcelPayload>,
): UserExcelPayload {
  const userName = String(userRaw.name ?? "").trim();
  const splitName = splitFullName(userName);
  const firstName = studentPatch?.firstName ?? splitName.firstName;
  const lastName = studentPatch?.lastName ?? splitName.lastName;
  const roleRaw = String(userRaw.role ?? "student");
  return {
    email: getPublicUserEmail(userRaw as { email?: string; phone?: string }),
    role: isManagedRole(roleRaw) ? roleRaw : "student",
    name: userName || [firstName, lastName].filter(Boolean).join(" "),
    firstName,
    lastName,
    phone: trimString(userRaw.phone),
    language: ["en", "ru", "uz"].includes(String(userRaw.language ?? ""))
      ? (String(userRaw.language) as "en" | "ru" | "uz")
      : undefined,
    emailVerified: Boolean(userRaw.emailVerified),
    suspended: Boolean(userRaw.suspended),
    country: studentPatch?.country,
    city: studentPatch?.city,
    gradeLevel: studentPatch?.gradeLevel,
    gpa: studentPatch?.gpa,
    schoolName: studentPatch?.schoolName,
    graduationYear: studentPatch?.graduationYear,
    preferredCountries: studentPatch?.preferredCountries ?? [],
    interestedFaculties: studentPatch?.interestedFaculties ?? [],
    counsellorUserId: studentPatch?.counsellorUserId,
    counsellorEmail: studentPatch?.counsellorEmail,
    managedUniversityUserIds: Array.isArray(userRaw.managedUniversityUserIds)
      ? userRaw.managedUniversityUserIds.map((id) => String(id)).filter(Boolean)
      : [],
    universityMultiManagerApproved: Boolean(
      userRaw.universityMultiManagerApproved,
    ),
  };
}

async function findUserForImport(row: ParsedUserExcelRow) {
  if (row.sourceId && mongoose.Types.ObjectId.isValid(row.sourceId)) {
    const byId = await User.findById(row.sourceId).lean();
    if (byId) return byId as Record<string, unknown>;
  }
  if (row.body.email) {
    const byEmail = await User.findOne({ email: row.body.email }).lean();
    if (byEmail) return byEmail as Record<string, unknown>;
  }
  return undefined;
}

async function resolveCounsellorUserIdByEmail(email: string): Promise<string> {
  const normalized = normalizeEmail(email);
  if (!normalized) return "";
  const counsellor = await User.findOne({
    role: "school_counsellor",
    email: new RegExp(`^${escapeRegExp(normalized)}$`, "i"),
  })
    .select("_id")
    .lean();
  if (!counsellor) {
    throw new AppError(
      404,
      `Counsellor not found for email: ${email}`,
      ErrorCodes.NOT_FOUND,
    );
  }
  return String(counsellor._id);
}

async function ensureStudentProfile(
  userId: string,
  payload: UserExcelPayload,
): Promise<void> {
  if (payload.role !== "student") return;
  const update: Record<string, unknown> = {
    firstName: payload.firstName,
    lastName: payload.lastName,
    country: payload.country,
    city: payload.city,
    gradeLevel: payload.gradeLevel,
    gpa: payload.gpa,
    schoolName: payload.schoolName,
    graduationYear: payload.graduationYear,
    preferredCountries: payload.preferredCountries ?? [],
    interestedFaculties: payload.interestedFaculties ?? [],
  };
  if (
    payload.counsellorUserId &&
    mongoose.Types.ObjectId.isValid(payload.counsellorUserId)
  ) {
    update.counsellorUserId = new mongoose.Types.ObjectId(
      payload.counsellorUserId,
    );
  }
  await StudentProfile.findOneAndUpdate({ userId }, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
}

async function applyUserExcelPayload(
  existing: Record<string, unknown> | undefined,
  payload: UserExcelPayload,
  actor?: { id: string; role: string },
): Promise<"create" | "update"> {
  if (actor && actor.role !== "admin") {
    assertRoleManageAllowed(actor, payload.role);
  }
  if (existing) {
    const existingId = String(existing._id ?? existing.id ?? "");
    if (existing.email === DEFAULT_ADMIN_EMAIL) {
      throw new AppError(
        403,
        "Cannot modify default admin",
        ErrorCodes.FORBIDDEN,
      );
    }
    if (
      payload.email &&
      payload.email !== String(existing.email ?? "").toLowerCase()
    ) {
      const duplicate = await User.findOne({
        email: payload.email,
        _id: { $ne: existingId },
      })
        .select("_id")
        .lean();
      if (duplicate)
        throw new AppError(
          409,
          "Email already registered",
          ErrorCodes.CONFLICT,
        );
    }
    const update: Record<string, unknown> = {
      email: payload.email,
      role: payload.role,
      name: payload.name,
      phone: payload.phone ?? "",
      emailVerified: payload.emailVerified ?? true,
      suspended: payload.suspended ?? false,
      universityMultiManagerApproved:
        payload.universityMultiManagerApproved ?? false,
    };
    if (payload.language) update.language = payload.language;
    if (payload.managedUniversityUserIds) {
      update.managedUniversityUserIds = payload.managedUniversityUserIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
    }
    await User.findByIdAndUpdate(existingId, update, { new: true });
    await ensureStudentProfile(existingId, payload);
    return "update";
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
  const created = await User.create({
    email: payload.email,
    name: payload.name,
    phone: payload.phone ?? "",
    language: payload.language,
    passwordHash,
    role: payload.role,
    emailVerified: payload.emailVerified ?? true,
    suspended: payload.suspended ?? false,
    localPasswordConfigured: true,
    mustChangePassword: true,
    temporaryPlainPassword: tempPassword,
    temporaryPasswordGeneratedAt: new Date(),
    universityMultiManagerApproved:
      payload.universityMultiManagerApproved ?? false,
    managedUniversityUserIds: (payload.managedUniversityUserIds ?? [])
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id)),
  });
  const createdId = String(created._id);
  if (payload.role === "student") {
    await StudentProfile.create({ userId: created._id });
  } else if (payload.role === "university") {
    await UniversityProfile.create({
      userId: created._id,
      universityName: payload.name?.trim()
        ? payload.name.trim()
        : "New University",
      verified: true,
      onboardingCompleted: false,
    });
  } else if (payload.role === "school_counsellor") {
    await CounsellorProfile.create({
      userId: created._id,
      schoolName: payload.name?.trim() ? payload.name.trim() : "",
    });
  }
  if (payload.role === "student" || payload.role === "university") {
    await subscriptionService.createForNewUser(createdId, payload.role);
  }
  await User.findByIdAndUpdate(createdId, {
    phone: payload.phone ?? "",
    language: payload.language,
    emailVerified: payload.emailVerified ?? true,
    suspended: payload.suspended ?? false,
    universityMultiManagerApproved:
      payload.universityMultiManagerApproved ?? false,
    managedUniversityUserIds: (payload.managedUniversityUserIds ?? [])
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id)),
  });
  await ensureStudentProfile(createdId, payload);
  return "create";
}

export async function parseUsersExcel(
  buffer: Buffer,
): Promise<ParsedUsersExcelResult> {
  const XLSX = require("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName =
    (wb.SheetNames || []).find((name: string) => /user/i.test(name)) ||
    wb.SheetNames?.[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName] || {}) as Record<
    string,
    unknown
  >[];
  const resultRows: ParsedUserExcelRow[] = [];
  const errors: Array<{ row: number; name: string; message: string }> = [];
  const usedEmails = new Set<string>();

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const rowNumber = index + 2;
    const fullName = trimString(row["Name"] ?? row["name"]) ?? "";
    const splitName = splitFullName(fullName);
    const firstName =
      trimString(row["First name"] ?? row["firstName"]) ?? splitName.firstName;
    const lastName =
      trimString(
        row["Last name"] ?? row["lastName"] ?? row["Surname"] ?? row["surname"],
      ) ?? splitName.lastName;
    const displayName =
      fullName || [firstName, lastName].filter(Boolean).join(" ");
    if (!firstName || !lastName) {
      errors.push({
        row: rowNumber,
        name: displayName,
        message: "First name and last name are required.",
      });
      continue;
    }

    const roleRaw = String(row["Role"] ?? row["role"] ?? "student").trim();
    const role = isManagedRole(roleRaw) ? roleRaw : "student";
    let email = normalizeEmail(row["Email"] ?? row["email"]);
    let generatedEmail = false;
    if (!email) {
      email = await makeUniqueGeneratedEmail(firstName, lastName, usedEmails);
      generatedEmail = true;
    } else {
      usedEmails.add(email);
    }

    const languageRaw = String(row["Language"] ?? row["language"] ?? "")
      .trim()
      .toLowerCase();
    const language = ["en", "ru", "uz"].includes(languageRaw)
      ? (languageRaw as "en" | "ru" | "uz")
      : undefined;
    const counsellorEmail = normalizeEmail(
      row["Counsellor email"] ??
        row["Counselor email"] ??
        row["counsellorEmail"] ??
        row["counselorEmail"],
    );
    let counsellorUserId = trimString(
      row["Counsellor User ID"] ?? row["counsellorUserId"],
    );
    if (counsellorEmail) {
      try {
        counsellorUserId =
          await resolveCounsellorUserIdByEmail(counsellorEmail);
      } catch (error: unknown) {
        errors.push({
          row: rowNumber,
          name: displayName,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }
    const body: UserExcelPayload = {
      email,
      generatedEmail,
      role,
      name: displayName,
      firstName,
      lastName,
      phone: trimString(row["Phone"] ?? row["phone"]),
      language,
      emailVerified:
        parseBooleanFromText(row["Email verified"] ?? row["emailVerified"]) ??
        true,
      suspended:
        parseBooleanFromText(row["Suspended"] ?? row["suspended"]) ?? false,
      country: trimString(row["Country"] ?? row["country"]),
      city: trimString(row["City"] ?? row["city"]),
      gradeLevel: trimString(row["Grade level"] ?? row["gradeLevel"]),
      gpa: normalizeNumber(row["GPA"] ?? row["gpa"]),
      schoolName: trimString(row["School name"] ?? row["schoolName"]),
      graduationYear: normalizeNumber(
        row["Graduation year"] ?? row["graduationYear"],
      ),
      preferredCountries: splitList(
        row["Preferred countries"] ?? row["preferredCountries"],
      ),
      interestedFaculties: splitList(
        row["Interested faculties"] ?? row["interestedFaculties"],
      ),
      counsellorUserId,
      counsellorEmail,
      managedUniversityUserIds: splitList(
        row["Managed university User IDs"] ?? row["managedUniversityUserIds"],
      ),
      universityMultiManagerApproved:
        parseBooleanFromText(
          row["Multi-manager approved"] ??
            row["universityMultiManagerApproved"],
        ) ?? false,
    };
    resultRows.push({
      row: rowNumber,
      sourceId: trimString(row["ID"] ?? row["id"]),
      body,
    });
  }

  return { rows: resultRows, errors };
}

export async function previewUsersExcelImport(
  buffer: Buffer,
  actor?: { id: string; role: string },
): Promise<{
  items: UsersExcelPreviewItem[];
  errors: Array<{ row: number; name: string; message: string }>;
  summary: { total: number; creates: number; updates: number; errors: number };
}> {
  const parsed = await parseUsersExcel(buffer);
  const items: UsersExcelPreviewItem[] = [];
  const errors = [...parsed.errors];

  for (const row of parsed.rows) {
    try {
      if (actor && actor.role !== "admin") {
        assertRoleManageAllowed(actor, row.body.role);
      }
      const existing = await findUserForImport(row);
      let current: UserExcelPayload | undefined;
      if (existing) {
        const id = String(existing._id ?? existing.id ?? "");
        const studentMap = await getStudentPayloadByUserIds([id]);
        current = buildUserExcelPayload(existing, studentMap.get(id));
      }
      items.push({
        row: row.row,
        sourceId: row.sourceId,
        existingId: existing
          ? String(existing._id ?? existing.id ?? "")
          : undefined,
        email: row.body.email,
        name: row.body.name,
        action: existing ? "update" : "create",
        incoming: row.body,
        current,
        changes: current ? makeUserPreviewChanges(current, row.body) : [],
      });
    } catch (e: unknown) {
      errors.push({
        row: row.row,
        name: row.body.name,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    items,
    errors,
    summary: {
      total: items.length,
      creates: items.filter((item) => item.action === "create").length,
      updates: items.filter((item) => item.action === "update").length,
      errors: errors.length,
    },
  };
}

export async function importUsersFromExcel(
  buffer: Buffer,
  actor?: { id: string; role: string },
): Promise<{
  created: number;
  updated: number;
  errors: Array<{ row: number; name: string; message: string }>;
}> {
  const parsed = await parseUsersExcel(buffer);
  const errors: Array<{ row: number; name: string; message: string }> = [
    ...parsed.errors,
  ];
  let created = 0;
  let updated = 0;

  for (const row of parsed.rows) {
    try {
      const existing = await findUserForImport(row);
      const action = await applyUserExcelPayload(existing, row.body, actor);
      if (action === "create") created += 1;
      else updated += 1;
    } catch (e: unknown) {
      errors.push({
        row: row.row,
        name: row.body.name,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { created, updated, errors };
}

export function getUsersExcelTemplateBuffer(): Buffer {
  const XLSX = require("xlsx");
  const headers = [
    "ID",
    "Email",
    "Role",
    "Name",
    "First name",
    "Last name",
    "Phone",
    "Language",
    "Email verified",
    "Suspended",
    "Country",
    "City",
    "Grade level",
    "GPA",
    "School name",
    "Graduation year",
    "Preferred countries",
    "Interested faculties",
    "Counsellor email",
    "Counsellor User ID",
    "Managed university User IDs",
    "Multi-manager approved",
  ];
  const data = [
    headers,
    [
      "",
      "",
      "student",
      "Example Student",
      "Example",
      "Student",
      "+998901234567",
      "en",
      "yes",
      "no",
      "UZ",
      "Tashkent",
      "11",
      "4.5",
      "Example School",
      "2026",
      "UZ; KZ; TR",
      "engineering_technology; computer_science_digital_technologies",
      "",
      "",
      "",
      "no",
    ],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "Users");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

export async function getUsersExcelExportBuffer(actor?: {
  id: string;
  role: string;
}): Promise<Buffer> {
  const XLSX = require("xlsx");
  const actorRole = getManagementRole(actor?.role);
  const visibleRoles = actorRole
    ? getVisibleRolesForManagementRole(actorRole)
    : null;
  const filter = mergeUserRoleFilters(visibleRoles, undefined);
  const users = await User.find(filter)
    .select(
      "email role language name phone emailVerified suspended createdAt managedUniversityUserIds universityMultiManagerApproved",
    )
    .sort({ createdAt: -1 })
    .lean();
  const userIds = users.map((user) => String((user as { _id: unknown })._id));
  const studentMap = await getStudentPayloadByUserIds(userIds);
  const headers = [
    "ID",
    "Email",
    "Role",
    "Name",
    "First name",
    "Last name",
    "Phone",
    "Language",
    "Email verified",
    "Suspended",
    "Country",
    "City",
    "Grade level",
    "GPA",
    "School name",
    "Graduation year",
    "Preferred countries",
    "Interested faculties",
    "Counsellor email",
    "Counsellor User ID",
    "Managed university User IDs",
    "Multi-manager approved",
    "Created at",
  ];
  const data = [
    headers,
    ...users.map((user) => {
      const id = String((user as { _id: unknown })._id);
      const payload = buildUserExcelPayload(
        user as Record<string, unknown>,
        studentMap.get(id),
      );
      return [
        id,
        payload.email,
        payload.role,
        payload.name,
        payload.firstName,
        payload.lastName,
        payload.phone ?? "",
        payload.language ?? "",
        payload.emailVerified ? "yes" : "no",
        payload.suspended ? "yes" : "no",
        payload.country ?? "",
        payload.city ?? "",
        payload.gradeLevel ?? "",
        payload.gpa ?? "",
        payload.schoolName ?? "",
        payload.graduationYear ?? "",
        (payload.preferredCountries ?? []).join("; "),
        (payload.interestedFaculties ?? []).join("; "),
        payload.counsellorEmail ?? "",
        payload.counsellorUserId ?? "",
        (payload.managedUniversityUserIds ?? []).join("; "),
        payload.universityMultiManagerApproved ? "yes" : "no",
        user.createdAt ? new Date(user.createdAt as Date).toISOString() : "",
      ];
    }),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "Users");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

export async function getStudentProfileByUserId(userId: string) {
  const user = await User.findById(userId).select("role").lean();
  if (!user || user.role !== "student") {
    throw new AppError(404, "Student not found", ErrorCodes.NOT_FOUND);
  }
  const { getProfile } = await import("./student.service");
  return getProfile(userId);
}

export async function updateStudentProfileByUserId(
  userId: string,
  patch: Record<string, unknown>,
) {
  const user = await User.findById(userId).select("role").lean();
  if (!user || user.role !== "student") {
    throw new AppError(404, "Student not found", ErrorCodes.NOT_FOUND);
  }
  const { updateProfile } = await import("./student.service");
  return updateProfile(userId, patch);
}

export async function getUniversityProfileByUserId(userId: string) {
  const profile = await UniversityProfile.findOne({ userId }).lean();
  if (!profile)
    throw new AppError(
      404,
      "University profile not found",
      ErrorCodes.NOT_FOUND,
    );
  return { ...profile, id: String((profile as { _id: unknown })._id) };
}

const UNIVERSITY_PROFILE_WHITELIST = new Set([
  "universityName",
  "tagline",
  "establishedYear",
  "studentCount",
  "country",
  "city",
  "description",
  "logoUrl",
  "verified",
  "onboardingCompleted",
  "facultyCodes",
  "facultyItems",
  "targetStudentCountries",
  "minLanguageLevel",
  "tuitionPrice",
  "rating",
  "coverImageUrl",
  "ieltsMinBand",
  "gpaMinMode",
  "gpaMinValue",
]);

export async function updateUniversityProfileByUserId(
  userId: string,
  patch: Record<string, unknown>,
) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile)
    throw new AppError(
      404,
      "University profile not found",
      ErrorCodes.NOT_FOUND,
    );
  const filtered = Object.fromEntries(
    Object.entries(patch).filter(([k]) => UNIVERSITY_PROFILE_WHITELIST.has(k)),
  );
  if (filtered.minLanguageLevel !== undefined) {
    (filtered as Record<string, unknown>).minLanguageLevel =
      filtered.minLanguageLevel != null
        ? String(filtered.minLanguageLevel).trim() || null
        : null;
  }
  if (filtered.tuitionPrice !== undefined) {
    (filtered as Record<string, unknown>).tuitionPrice =
      filtered.tuitionPrice != null ? Number(filtered.tuitionPrice) : null;
  }
  const updated = await UniversityProfile.findByIdAndUpdate(
    profile._id,
    filtered,
    { new: true },
  ).lean();
  return updated
    ? { ...updated, id: String((updated as { _id: unknown })._id) }
    : null;
}

export async function getCounsellorProfileByUserId(userId: string) {
  const user = await User.findById(userId).select("role").lean();
  if (!user || user.role !== "school_counsellor") {
    throw new AppError(404, "Counsellor not found", ErrorCodes.NOT_FOUND);
  }
  let profile = await CounsellorProfile.findOne({ userId }).lean();
  if (!profile) {
    const created = await CounsellorProfile.create({
      userId,
      schoolName: "",
      schoolDescription: "",
      country: "",
      city: "",
      isPublic: true,
    });
    profile = created.toObject();
  }
  return {
    ...profile,
    id: String((profile as { _id: unknown })._id),
    userId: String((profile as { userId: unknown }).userId),
  };
}

export async function updateCounsellorProfileByUserId(
  userId: string,
  patch: {
    schoolName?: string;
    schoolDescription?: string;
    country?: string;
    city?: string;
    isPublic?: boolean;
  },
) {
  const user = await User.findById(userId).select("role").lean();
  if (!user || user.role !== "school_counsellor") {
    throw new AppError(404, "Counsellor not found", ErrorCodes.NOT_FOUND);
  }
  const update: Record<string, unknown> = {};
  if (patch.schoolName !== undefined)
    update.schoolName = String(patch.schoolName);
  if (patch.schoolDescription !== undefined)
    update.schoolDescription = String(patch.schoolDescription);
  if (patch.country !== undefined) update.country = String(patch.country);
  if (patch.city !== undefined) update.city = String(patch.city);
  if (patch.isPublic !== undefined) update.isPublic = Boolean(patch.isPublic);
  const updated = await CounsellorProfile.findOneAndUpdate({ userId }, update, {
    new: true,
    upsert: true,
  }).lean();
  return updated
    ? {
        ...updated,
        id: String((updated as { _id: unknown })._id),
        userId: String((updated as { userId: unknown }).userId),
      }
    : null;
}

export async function getCounsellorStudentsExcelExportBufferByUserId(
  userId: string,
): Promise<Buffer> {
  const user = await User.findById(userId).select("role").lean();
  if (!user || user.role !== "school_counsellor") {
    throw new AppError(404, "Counsellor not found", ErrorCodes.NOT_FOUND);
  }
  const counsellorService = await import("./counsellor.service");
  return counsellorService.getCounsellorStudentsExcelExportBuffer(userId);
}

export async function importCounsellorStudentsFromExcelByUserId(
  userId: string,
  buffer: Buffer,
) {
  const user = await User.findById(userId).select("role").lean();
  if (!user || user.role !== "school_counsellor") {
    throw new AppError(404, "Counsellor not found", ErrorCodes.NOT_FOUND);
  }
  const counsellorService = await import("./counsellor.service");
  return counsellorService.importCounsellorStudentsFromExcel(userId, buffer);
}

async function assertUserRole(
  userId: string,
  expectedRole: "student" | "university",
) {
  const user = await User.findById(userId).select("role").lean();
  if (!user || user.role !== expectedRole) {
    throw new AppError(404, "User not found", ErrorCodes.NOT_FOUND);
  }
}

export async function getStudentDocumentsByUserId(studentUserId: string) {
  await assertUserRole(studentUserId, "student");
  const studentDocumentService = await import("./studentDocument.service");
  return studentDocumentService.getMyDocuments(studentUserId);
}

type AdminAddStudentDocumentPayload = {
  type: string;
  source?: "upload" | "editor";
  fileUrl?: string;
  name?: string;
  certificateType?: string;
  score?: string;
  previewImageUrl?: string;
  canvasJson?: string;
  pageFormat?: "A4_PORTRAIT" | "A4_LANDSCAPE" | "LETTER" | "CUSTOM";
  width?: number;
  height?: number;
  editorVersion?: string;
};

export async function addStudentDocumentByUserId(
  studentUserId: string,
  data: AdminAddStudentDocumentPayload,
) {
  await assertUserRole(studentUserId, "student");
  const studentDocumentService = await import("./studentDocument.service");
  return studentDocumentService.addDocument(studentUserId, data);
}

export async function deleteStudentDocumentByUserId(
  studentUserId: string,
  documentId: string,
) {
  await assertUserRole(studentUserId, "student");
  const studentDocumentService = await import("./studentDocument.service");
  return studentDocumentService.deleteDocument(studentUserId, documentId);
}

export async function listOffers(query: {
  page?: number;
  limit?: number;
  status?: string;
}) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const where: Record<string, unknown> = {};
  if (query.status) where.status = query.status;
  const [list, total] = await Promise.all([
    Offer.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Offer.countDocuments(where),
  ]);
  return {
    data: list.map((o) => ({ ...o, id: String((o as { _id: unknown })._id) })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function updateOfferStatus(
  offerId: string,
  status: "pending" | "accepted" | "declined",
) {
  const updated = await Offer.findByIdAndUpdate(
    offerId,
    { status },
    { new: true },
  ).lean();
  if (!updated)
    throw new AppError(404, "Offer not found", ErrorCodes.NOT_FOUND);
  return { ...updated, id: String((updated as { _id: unknown })._id) };
}

async function getManagedStudentProfileIds(actor?: {
  id: string;
  role: string;
}): Promise<mongoose.Types.ObjectId[] | null> {
  const actorRole = getManagementRole(actor?.role);
  if (!actorRole || actorRole === "admin") return null;
  if (actorRole !== "manager" && actorRole !== "counsellor_coordinator")
    return [];

  const counsellors = await User.find({ role: "school_counsellor" })
    .select("_id")
    .lean();
  const counsellorIds = counsellors.map(
    (row) => (row as { _id: mongoose.Types.ObjectId })._id,
  );
  if (counsellorIds.length === 0) return [];

  const students = await StudentProfile.find({
    counsellorUserId: { $in: counsellorIds },
  })
    .select("_id")
    .lean();
  return students.map((row) => (row as { _id: mongoose.Types.ObjectId })._id);
}

export async function listInterests(
  query: { page?: number; limit?: number; status?: string },
  actor?: { id: string; role: string },
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
  const [profileList, profileTotal, catalogList, catalogTotal] =
    await Promise.all([
      Interest.find(whereProfile)
        .populate("studentId", "firstName lastName")
        .populate("universityId", "universityName")
        .sort({ createdAt: -1 })
        .limit(fetchLimit)
        .lean(),
      Interest.countDocuments(whereProfile),
      CatalogInterest.find(whereCatalog)
        .populate("studentId", "firstName lastName")
        .populate("catalogUniversityId", "universityName")
        .sort({ createdAt: -1 })
        .limit(fetchLimit)
        .lean(),
      CatalogInterest.countDocuments(whereCatalog),
    ]);
  const pairMap = new Map<
    string,
    { studentId: string; universityId: string }
  >();
  for (const row of profileList) {
    const x = row as Record<string, unknown>;
    const studentId = toObjectIdString(x.studentId);
    const universityId = toObjectIdString(x.universityId);
    if (!studentId || !universityId) continue;
    pairMap.set(`${studentId}|${universityId}`, { studentId, universityId });
  }
  const pairFilters = Array.from(pairMap.values()).map((p) => ({
    studentId: p.studentId,
    universityId: p.universityId,
  }));
  const chats =
    pairFilters.length > 0
      ? await Chat.find({ $or: pairFilters })
          .select("_id studentId universityId createdAt")
          .lean()
      : [];
  const chatByPair = new Map<
    string,
    { chatId: string; chatCreatedAt?: Date }
  >();
  for (const row of chats) {
    const x = row as Record<string, unknown>;
    const studentId = toObjectIdString(x.studentId);
    const universityId = toObjectIdString(x.universityId);
    if (!studentId || !universityId) continue;
    chatByPair.set(`${studentId}|${universityId}`, {
      chatId: String(x._id),
      chatCreatedAt: x.createdAt as Date | undefined,
    });
  }
  const profileItems = profileList.map((i) => {
    const x = i as Record<string, unknown>;
    const studentId = toObjectIdString(x.studentId) ?? "";
    const universityId = toObjectIdString(x.universityId) ?? "";
    const studentNameFirst =
      (x.studentId as { firstName?: string } | null | undefined)?.firstName ??
      "";
    const studentNameLast =
      (x.studentId as { lastName?: string } | null | undefined)?.lastName ?? "";
    const studentName =
      `${studentNameFirst} ${studentNameLast}`.trim() || undefined;
    const universityName = (
      x.universityId as { universityName?: string } | null | undefined
    )?.universityName;
    const chat = chatByPair.get(`${studentId}|${universityId}`);
    return {
      ...x,
      id: String(x._id),
      source: "profile" as const,
      studentId,
      universityId,
      studentName,
      universityName,
      chatId: chat?.chatId,
      chatCreatedAt: chat?.chatCreatedAt,
    };
  });
  const catalogItems = catalogList.map((i) => {
    const x = i as Record<string, unknown>;
    const studentId = toObjectIdString(x.studentId) ?? "";
    const universityId = toObjectIdString(x.catalogUniversityId) ?? "";
    const studentNameFirst =
      (x.studentId as { firstName?: string } | null | undefined)?.firstName ??
      "";
    const studentNameLast =
      (x.studentId as { lastName?: string } | null | undefined)?.lastName ?? "";
    const studentName =
      `${studentNameFirst} ${studentNameLast}`.trim() || undefined;
    const universityName = (
      x.catalogUniversityId as { universityName?: string } | null | undefined
    )?.universityName;
    return {
      ...x,
      id: `catalog-${x._id}`,
      source: "catalog" as const,
      studentId,
      universityId,
      studentName,
      universityName,
      chatId: undefined,
      chatCreatedAt: undefined,
    };
  });
  const merged = [...profileItems, ...catalogItems].sort(
    (a, b) =>
      new Date((b as { createdAt?: Date }).createdAt ?? 0).getTime() -
      new Date((a as { createdAt?: Date }).createdAt ?? 0).getTime(),
  );
  const total = profileTotal + catalogTotal;
  const data = merged.slice(skip, skip + limit);
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function updateInterestStatus(interestId: string, status: string) {
  if (interestId.startsWith("catalog-")) {
    const catalogId = interestId.replace(/^catalog-/, "");
    if (!mongoose.Types.ObjectId.isValid(catalogId)) {
      throw new AppError(400, "Invalid id", ErrorCodes.VALIDATION);
    }
    const updated = await CatalogInterest.findByIdAndUpdate(
      catalogId,
      { status },
      { new: true, runValidators: true },
    ).lean();
    if (!updated)
      throw new AppError(404, "Interest not found", ErrorCodes.NOT_FOUND);
    const x = updated as Record<string, unknown>;
    return { ...x, id: `catalog-${x._id}`, source: "catalog" as const };
  }
  if (!mongoose.Types.ObjectId.isValid(interestId)) {
    throw new AppError(400, "Invalid id", ErrorCodes.VALIDATION);
  }
  const updated = await Interest.findByIdAndUpdate(
    interestId,
    { status },
    { new: true, runValidators: true },
  ).lean();
  if (!updated)
    throw new AppError(404, "Interest not found", ErrorCodes.NOT_FOUND);
  const x = updated as Record<string, unknown>;
  return { ...x, id: String(x._id), source: "profile" as const };
}

export async function openInterestChat(interestId: string) {
  if (interestId.startsWith("catalog-")) {
    throw new AppError(
      400,
      "Catalog interests do not support chat",
      ErrorCodes.VALIDATION,
    );
  }
  if (!mongoose.Types.ObjectId.isValid(interestId)) {
    throw new AppError(400, "Invalid id", ErrorCodes.VALIDATION);
  }
  const interest = await Interest.findById(interestId).lean();
  if (!interest)
    throw new AppError(404, "Interest not found", ErrorCodes.NOT_FOUND);
  const studentId = toObjectIdString(
    (interest as { studentId?: unknown }).studentId,
  );
  const universityId = toObjectIdString(
    (interest as { universityId?: unknown }).universityId,
  );
  if (!studentId || !universityId) {
    throw new AppError(
      400,
      "Interest has invalid participants",
      ErrorCodes.VALIDATION,
    );
  }
  const chatService = await import("./chat.service");
  const result = await chatService.getOrCreateChat(studentId, universityId);
  return {
    chatId: String(result.chatId),
    created: Boolean(result.created),
  };
}

export async function listChats(query: {
  page?: number;
  limit?: number;
  universityId?: string;
}) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const filter: Record<string, unknown> = {};
  if (query.universityId) {
    const universityId = toObjectIdString(query.universityId);
    if (universityId) filter.universityId = universityId;
  }
  const [list, total, universities] = await Promise.all([
    Chat.find(filter)
      .populate({
        path: "universityId",
        select: "universityName userId",
        populate: { path: "userId", select: "email name" },
      })
      .populate({
        path: "studentId",
        select: "firstName lastName userId",
        populate: { path: "userId", select: "email name" },
      })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Chat.countDocuments(filter),
    UniversityProfile.find({})
      .select("_id universityName")
      .sort({ universityName: 1 })
      .lean(),
  ]);
  const data = list.map((c) => {
    const x = c as Record<string, unknown>;
    const studentId = toObjectIdString(x.studentId) ?? "";
    const universityId = toObjectIdString(x.universityId) ?? "";
    const firstName =
      (x.studentId as { firstName?: string } | null | undefined)?.firstName ??
      "";
    const lastName =
      (x.studentId as { lastName?: string } | null | undefined)?.lastName ?? "";
    const studentName = `${firstName} ${lastName}`.trim() || undefined;
    const studentUser = (x.studentId as { userId?: { email?: string; name?: string } } | null | undefined)?.userId;
    const university = x.universityId as { universityName?: string; userId?: { email?: string; name?: string } } | null | undefined;
    const universityName = university?.universityName;
    const universityUser = university?.userId;
    return {
      ...x,
      id: String(x._id),
      studentId,
      universityId,
      studentName,
      studentEmail: studentUser?.email ?? "",
      universityName,
      universityEmail: universityUser?.email ?? "",
    };
  });
  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    universities: universities.map((u) => ({
      id: String((u as { _id: unknown })._id),
      name: (u as { universityName?: string }).universityName ?? "",
    })),
  };
}

function normalizeChatMessageText(raw: unknown): string {
  if (raw == null) return "";
  if (
    typeof raw === "string" ||
    typeof raw === "number" ||
    typeof raw === "boolean"
  ) {
    return String(raw);
  }
  if (Buffer.isBuffer(raw)) {
    return raw.toString("utf8");
  }
  if (raw instanceof Uint8Array) {
    return Buffer.from(raw).toString("utf8");
  }
  if (typeof raw === "object") {
    const x = raw as Record<string, unknown>;
    const direct = x.message ?? x.text;
    if (
      typeof direct === "string" ||
      typeof direct === "number" ||
      typeof direct === "boolean"
    ) {
      return String(direct);
    }
    if (x.type === "Buffer" && Array.isArray(x.data)) {
      try {
        return Buffer.from(
          (x.data as unknown[]).map((n) => Number(n)),
        ).toString("utf8");
      } catch {
        return "";
      }
    }
    if (Array.isArray(x.buffer)) {
      try {
        return Buffer.from(
          (x.buffer as unknown[]).map((n) => Number(n)),
        ).toString("utf8");
      } catch {
        return "";
      }
    }
    if (x.buffer instanceof Uint8Array) {
      try {
        return Buffer.from(x.buffer).toString("utf8");
      } catch {
        return "";
      }
    }
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}
export async function getChatMessages(
  chatId: string,
  query?: { limit?: number },
) {
  const limit = Math.min(200, Math.max(1, query?.limit ?? 50));
  const chat = await Chat.findById(chatId).lean();
  if (!chat) throw new AppError(404, "Chat not found", ErrorCodes.NOT_FOUND);
  const [messages, uniProf, studentProf] = await Promise.all([
    Message.find({ chatId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("senderId", "email name role")
      .lean(),
    UniversityProfile.findById(
      (chat as { universityId?: unknown }).universityId,
    )
      .select("userId")
      .lean(),
    StudentProfile.findById((chat as { studentId?: unknown }).studentId)
      .select("firstName lastName userId")
      .populate("userId", "email name")
      .lean(),
  ]);
  const c = chat as {
    _id: unknown;
    studentId?: unknown;
    universityId?: unknown;
  };
  return {
    chat: {
      ...chat,
      id: String(c._id),
      studentProfileId: c.studentId != null ? String(c.studentId) : undefined,
      universityUserId:
        uniProf?.userId != null
          ? String((uniProf as { userId: unknown }).userId)
          : undefined,
      studentName: studentProf
        ? [studentProf.firstName, studentProf.lastName].filter(Boolean).join(" ")
        : undefined,
      studentEmail:
        studentProf && typeof studentProf.userId === "object"
          ? String((studentProf.userId as { email?: string }).email ?? "")
          : undefined,
    },
    messages: messages.map((m) => {
      const x = m as Record<string, unknown>;
      const normalizedText = normalizeChatMessageText(x.message ?? x.text);
      const sender = x.senderId as { _id?: unknown; id?: unknown; email?: string; name?: string; role?: string } | null | undefined;
      const senderRole = String((x.metadata as { senderRole?: unknown } | undefined)?.senderRole ?? sender?.role ?? "");
      return {
        ...x,
        id: String((m as { _id: unknown })._id),
        message: normalizedText,
        text: normalizedText,
        senderId: sender ? String(sender._id ?? sender.id ?? "") : toObjectIdString(x.senderId) ?? "",
        senderEmail: sender?.email ?? "",
        senderName: sender?.name ?? sender?.email ?? "",
        senderRole,
        sentByAdmin: senderRole === "admin" || Boolean((x.metadata as { sentByAdmin?: unknown } | undefined)?.sentByAdmin),
      };
    }),
  };
}

export async function sendChatMessageAsAdmin(
  chatId: string,
  adminUserId: string,
  text: string,
) {
  const chat = await Chat.findById(chatId).lean();
  if (!chat) throw new AppError(404, "Chat not found", ErrorCodes.NOT_FOUND);
  const admin = await User.findById(adminUserId).select("email name role").lean();
  if (!admin || (admin as { role?: string }).role !== "admin") {
    throw new AppError(403, "Only administrators can send admin chat messages", ErrorCodes.FORBIDDEN);
  }
  const messageText = text.trim();
  if (!messageText) throw new AppError(400, "Message text is required", ErrorCodes.VALIDATION);
  const msg = await Message.create({
    chatId,
    senderId: adminUserId,
    type: "text",
    message: messageText,
    metadata: {
      sentByAdmin: true,
      senderRole: "admin",
      senderLabel: "Admin",
      senderEmail: (admin as { email?: string }).email ?? "",
    },
  });
  await Chat.findByIdAndUpdate(chatId, { updatedAt: new Date() });
  const msgPop = await Message.findById(msg._id).populate("senderId", "email name role").lean();
  const sender = (msgPop as { senderId?: { _id?: unknown; id?: unknown; email?: string; name?: string; role?: string } } | null)?.senderId;
  return {
    message: {
      ...msgPop,
      id: String(msg._id),
      text: messageText,
      message: messageText,
      senderId: sender ? String(sender._id ?? sender.id ?? "") : String(adminUserId),
      senderEmail: sender?.email ?? "",
      senderName: sender?.name ?? sender?.email ?? "Admin",
      senderRole: "admin",
      sentByAdmin: true,
    },
  };
}

export async function deleteChat(chatId: string) {
  const chat = await Chat.findById(chatId).select("_id").lean();
  if (!chat) throw new AppError(404, "Chat not found", ErrorCodes.NOT_FOUND);
  await Message.deleteMany({ chatId });
  await Chat.deleteOne({ _id: chatId });
  return { success: true, chatId };
}

type SendTelegramPayload = {
  userIds?: string[];
  chatIds?: string[];
  text: string;
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
};

export async function sendTelegramMessage(payload: SendTelegramPayload) {
  const text = String(payload.text ?? "").trim();
  if (!text) throw new AppError(400, "Text is required", ErrorCodes.VALIDATION);

  const userIds = Array.isArray(payload.userIds)
    ? [...new Set(payload.userIds.map((x) => String(x).trim()).filter(Boolean))]
    : [];
  const directChatIds = Array.isArray(payload.chatIds)
    ? [...new Set(payload.chatIds.map((x) => String(x).trim()).filter(Boolean))]
    : [];

  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } })
        .select("_id socialLinks.telegram telegram.chatId")
        .lean()
    : [];

  const userChatIds = users
    .map((u) => {
      const raw =
        (
          u as {
            telegram?: { chatId?: string };
            socialLinks?: { telegram?: string };
          }
        ).telegram?.chatId ||
        (u as { socialLinks?: { telegram?: string } }).socialLinks?.telegram;
      return String(raw ?? "").trim();
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
      await telegramService.sendTelegramMessage(
        chatId,
        text,
        payload.parseMode,
      );
      sent += 1;
      details.push({ chatId, ok: true });
    } catch (e: unknown) {
      failed += 1;
      details.push({
        chatId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
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
  actor?: { id: string; role: string },
) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, "User not found", ErrorCodes.NOT_FOUND);
  if (actor && actor.role !== "admin") {
    assertRoleManageAllowed(actor, user.role);
  }
  if (user.email === DEFAULT_ADMIN_EMAIL)
    throw new AppError(
      403,
      "Cannot suspend default admin",
      ErrorCodes.FORBIDDEN,
    );
  if (user.role === "admin")
    throw new AppError(403, "Cannot suspend admin", ErrorCodes.FORBIDDEN);
  const updated = await User.findByIdAndUpdate(
    userId,
    { suspended: suspend },
    { new: true },
  ).lean();
  return updated
    ? { ...updated, id: String((updated as { _id: unknown })._id) }
    : null;
}

/** Delete a user and all related data. Cannot delete default admin or other admins. */
export async function deleteUser(
  userId: string,
  actor?: { id: string; role: string },
) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, "User not found", ErrorCodes.NOT_FOUND);
  if (actor && actor.role !== "admin") {
    assertRoleManageAllowed(actor, user.role);
  }
  if (user.email === DEFAULT_ADMIN_EMAIL)
    throw new AppError(
      403,
      "Cannot delete default admin",
      ErrorCodes.FORBIDDEN,
    );
  if (user.role === "admin")
    throw new AppError(403, "Cannot delete admin users", ErrorCodes.FORBIDDEN);

  const id = user._id;
  const role = user.role as string;

  await RefreshToken.deleteMany({ userId: id });
  await Notification.deleteMany({ userId: id });
  await ActivityLog.deleteMany({ userId: id });
  await AIConversation.deleteMany({ userId: id });
  await Ticket.deleteMany({ userId: id });
  await Message.deleteMany({ senderId: id });
  await Subscription.deleteMany({ userId: id });

  if (role === "student") {
    const profile = await StudentProfile.findOne({ userId: id });
    if (profile) {
      const profileId = profile._id;
      await Interest.deleteMany({ studentId: profileId });
      await Offer.deleteMany({ studentId: profileId });
      await Recommendation.deleteMany({ studentId: profileId });
      await StudentDocument.deleteMany({ studentId: profileId });
      const chatIds = (
        await Chat.find({ studentId: profileId }).select("_id").lean()
      ).map((c) => c._id);
      if (chatIds.length > 0)
        await Message.deleteMany({ chatId: { $in: chatIds } });
      await Chat.deleteMany({ studentId: profileId });
      await StudentProfile.deleteOne({ _id: profileId });
    }
  } else if (role === "university") {
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
      const chatIds = (
        await Chat.find({ universityId: profileId }).select("_id").lean()
      ).map((c) => c._id);
      if (chatIds.length > 0)
        await Message.deleteMany({ chatId: { $in: chatIds } });
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
    .populate("userId", "email")
    .lean();
  const ids = list.map((u: Record<string, unknown>) => u._id);
  const allDocs = await UniversityDocument.find({
    universityId: { $in: ids },
  }).lean();
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
      user:
        userId && typeof userId === "object" && "email" in userId
          ? { email: String(userId.email) }
          : undefined,
      documents,
    };
  });
}

export async function verifyUniversity(
  universityId: unknown,
  approve: boolean,
) {
  const uid = toObjectIdString(universityId);
  if (!uid)
    throw new AppError(404, "University not found", ErrorCodes.NOT_FOUND);
  const uni = await UniversityProfile.findById(uid);
  if (!uni)
    throw new AppError(404, "University not found", ErrorCodes.NOT_FOUND);
  const update = approve
    ? { verified: true, verificationRejectedAt: null }
    : { verified: false, verificationRejectedAt: new Date() };
  const updated = await UniversityProfile.findByIdAndUpdate(uid, update, {
    new: true,
  }).lean();
  return updated
    ? { ...updated, id: String((updated as { _id: unknown })._id) }
    : null;
}

export async function getScholarshipsMonitor() {
  const list = await Scholarship.find()
    .populate("universityId", "universityName")
    .lean();
  return list.map((s: Record<string, unknown>) => {
    const uni = s.universityId as { universityName?: string } | undefined;
    return {
      ...s,
      id: String(s._id),
      university:
        uni && typeof uni === "object" && "universityName" in uni
          ? { universityName: String(uni.universityName) }
          : undefined,
    };
  });
}

export async function getLogs(query: {
  page?: number;
  limit?: number;
  userId?: string;
  action?: string;
}) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const where: { userId?: string; action?: string } = {};
  if (query.userId) where.userId = query.userId;
  if (query.action) where.action = query.action;
  const [list, total] = await Promise.all([
    ActivityLog.find(where)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean(),
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
  data: {
    plan?: string;
    status?: string;
    trialEndsAt?: Date | null;
    currentPeriodEnd?: Date | null;
  },
) {
  return subscriptionService.updateSubscription(userId, data);
}

export async function getTickets(query: {
  page?: number;
  limit?: number;
  status?: string;
  role?: string;
}) {
  return ticketService.listTickets(query);
}

export async function getTicketById(ticketId: string, adminUserId: string) {
  return ticketService.getTicketById(ticketId, adminUserId, true);
}

export async function updateTicketStatus(ticketId: string, status: string) {
  return ticketService.updateTicketStatus(ticketId, status);
}

export async function addTicketReply(
  ticketId: string,
  adminUserId: string,
  message: string,
) {
  return ticketService.addReply(ticketId, adminUserId, "admin", message, true);
}

export async function getPendingDocuments() {
  return studentDocumentService.listPendingForAdmin();
}

export async function listAdminStudentDocuments(
  status: AdminDocumentListStatus,
) {
  return studentDocumentService.listDocumentsForAdmin(status);
}

export async function reviewDocument(
  docId: string,
  adminUserId: string,
  decision: "approved" | "rejected",
  rejectionReason?: string,
) {
  return studentDocumentService.reviewDocument(
    docId,
    adminUserId,
    decision,
    rejectionReason,
  );
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
  rating?: number;
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
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeStringArray(
  value: unknown,
  maxItems: number = 50,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, maxItems);
  return items.length ? items : undefined;
}

function normalizeFacultyItemsValue(
  value: unknown,
): Record<string, string[]> | undefined {
  if (typeof value !== "object" || value == null || Array.isArray(value))
    return undefined;
  const result: Record<string, string[]> = {};
  for (const [key, rawItems] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const normalizedKey = key.trim();
    const normalizedItems = normalizeStringArray(rawItems, 50);
    if (normalizedKey && normalizedItems?.length) {
      result[normalizedKey] = normalizedItems;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeProgramsValue(
  value: unknown,
): CatalogProgramPayload[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const programs: CatalogProgramPayload[] = [];
  for (const raw of value.slice(0, 50)) {
    const item = raw as Record<string, unknown>;
    const name = trimString(item.name) ?? "";
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

function normalizeScholarshipsValue(
  value: unknown,
): CatalogScholarshipPayload[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const scholarships: CatalogScholarshipPayload[] = [];
  for (const raw of value.slice(0, 30)) {
    const item = raw as Record<string, unknown>;
    const name = trimString(item.name) ?? "";
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

function normalizeCustomFacultiesValue(
  value: unknown,
): CatalogCustomFacultyPayload[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const faculties: CatalogCustomFacultyPayload[] = [];
  value.slice(0, 100).forEach((raw, index) => {
    const item = raw as Record<string, unknown>;
    const name = trimString(item.name) ?? "";
    if (!name) return;
    faculties.push({
      name,
      description: trimString(item.description) ?? "",
      items: normalizeStringArray(item.items, 100) ?? [],
      order: normalizeNumber(item.order) ?? index,
    });
  });
  return faculties.length ? faculties : undefined;
}

function normalizeDocumentsValue(
  value: unknown,
): CatalogDocumentPayload[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const documents: CatalogDocumentPayload[] = [];
  for (const raw of value.slice(0, 100)) {
    const item = raw as Record<string, unknown>;
    const documentType = trimString(item.documentType) ?? "";
    const fileUrl = trimString(item.fileUrl) ?? "";
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

function buildCatalogUniversityPayload(
  body: Record<string, unknown>,
): CatalogUniversityPayload {
  const universityName = trimString(body.universityName) ?? "";
  if (!universityName) {
    throw new AppError(
      400,
      "University name is required",
      ErrorCodes.VALIDATION,
    );
  }

  return {
    universityName,
    tagline: trimString(body.tagline),
    establishedYear: normalizeNumber(body.establishedYear),
    studentCount: normalizeNumber(body.studentCount),
    country: trimString(body.country),
    city: trimString(body.city),
    description: trimString(body.description),
    rating: normalizeNumber(body.rating),
    logoUrl: trimString(body.logoUrl),
    facultyCodes: normalizeStringArray(body.facultyCodes, 50),
    facultyItems: normalizeFacultyItemsValue(body.facultyItems),
    targetStudentCountries: normalizeStringArray(
      body.targetStudentCountries,
      50,
    ),
    minLanguageLevel: trimString(body.minLanguageLevel, 50),
    tuitionPrice: normalizeNumber(body.tuitionPrice),
    programs: normalizeProgramsValue(body.programs),
    scholarships: normalizeScholarshipsValue(body.scholarships),
    customFaculties: normalizeCustomFacultiesValue(body.customFaculties),
    documents: normalizeDocumentsValue(body.documents),
  };
}

export async function getCatalogUniversities(query: {
  page?: number;
  limit?: number;
  search?: string;
}) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;
  const filter: Record<string, unknown> = {};
  if (query.search?.trim()) {
    const re = safeRegExp(query.search.trim());
    filter.$or = [{ universityName: re }, { city: re }, { country: re }];
  }
  const [list, total] = await Promise.all([
    UniversityCatalog.find(filter)
      .sort({ universityName: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    UniversityCatalog.countDocuments(filter),
  ]);
  const linkedProfileIds = list
    .map((u) => String((u as { linkedUniversityProfileId?: unknown }).linkedUniversityProfileId ?? ""))
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
  const linkedProfiles = linkedProfileIds.length
    ? await UniversityProfile.find({ _id: { $in: linkedProfileIds } })
        .select("_id userId")
        .lean()
    : [];
  const linkedUserByProfileId = new Map(
    linkedProfiles.map((p) => [
      String((p as { _id: unknown })._id),
      String((p as { userId: unknown }).userId),
    ]),
  );
  return {
    data: list.map((u) => ({
      ...u,
      id: String((u as { _id: unknown })._id),
      name: (u as { universityName?: string }).universityName ?? "",
      linkedUniversityUserId: linkedUserByProfileId.get(
        String((u as { linkedUniversityProfileId?: unknown }).linkedUniversityProfileId ?? ""),
      ),
    })),
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
  if (!doc)
    throw new AppError(
      404,
      "Catalog university not found",
      ErrorCodes.NOT_FOUND,
    );
  const effective = await getEffectiveCatalogUniversityData(
    doc as unknown as Record<string, unknown>,
  );
  return {
    ...doc,
    ...effective.body,
    id: effective.id,
    linkedUniversityProfileId: effective.linkedProfileId,
    name: effective.body.universityName ?? "",
  };
}

export async function updateCatalogUniversity(
  id: string,
  body: Record<string, unknown>,
) {
  const existing = await UniversityCatalog.findById(id).lean();
  if (!existing)
    throw new AppError(
      404,
      "Catalog university not found",
      ErrorCodes.NOT_FOUND,
    );
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
        reviewedAt: docItem.reviewedAt
          ? new Date(docItem.reviewedAt)
          : undefined,
      })),
    },
    { new: true },
  ).lean();
  if (!doc)
    throw new AppError(
      404,
      "Catalog university not found",
      ErrorCodes.NOT_FOUND,
    );
  return { ...doc, id: String((doc as { _id: unknown })._id) };
}

export async function deleteCatalogUniversity(id: string) {
  const catalog = await UniversityCatalog.findById(id);
  if (!catalog)
    throw new AppError(
      404,
      "Catalog university not found",
      ErrorCodes.NOT_FOUND,
    );
  await CatalogInterest.deleteMany({ catalogUniversityId: id });
  await UniversityVerificationRequest.deleteMany({ universityCatalogId: id });
  await UniversityCatalog.findByIdAndDelete(id);
  return { deleted: true };
}

export async function getUniversityVerificationRequests(query: {
  status?: string;
}) {
  const filter: Record<string, string> = {};
  if (
    query.status === "pending" ||
    query.status === "approved" ||
    query.status === "rejected"
  )
    filter.status = query.status;
  const list = await UniversityVerificationRequest.find(filter)
    .populate("universityCatalogId", "universityName country city")
    .populate("userId", "email")
    .sort({ createdAt: -1 })
    .lean();
  return list.map((r: Record<string, unknown>) => {
    const catalog = r.universityCatalogId as
      | { universityName?: string; country?: string; city?: string }
      | undefined;
    const user = r.userId as { email?: string } | undefined;
    return {
      ...r,
      id: String(r._id),
      university: catalog
        ? {
            name: catalog.universityName,
            country: catalog.country,
            city: catalog.city,
          }
        : undefined,
      userEmail: user?.email,
    };
  });
}

export async function approveUniversityRequest(
  requestId: string,
  adminUserId: string,
) {
  const request = await UniversityVerificationRequest.findById(
    requestId,
  ).populate("universityCatalogId");
  if (!request)
    throw new AppError(404, "Request not found", ErrorCodes.NOT_FOUND);
  if ((request as { status: string }).status === "approved") {
    return { approved: true, profileId: "", alreadyProcessed: true };
  }
  if ((request as { status: string }).status === "rejected") {
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
    rating?: number;
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
  if (!catalog)
    throw new AppError(
      404,
      "Catalog university not found",
      ErrorCodes.NOT_FOUND,
    );
  const userId = (request as { userId: unknown }).userId;

  const profile = await UniversityProfile.create({
    userId,
    universityName: catalog.universityName ?? "",
    tagline: catalog.tagline,
    establishedYear: catalog.establishedYear,
    studentCount: catalog.studentCount,
    country: catalog.country,
    city: catalog.city,
    description: catalog.description,
    rating: catalog.rating,
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
      name: p.name ?? "",
      degreeLevel: p.degreeLevel ?? "",
      field: p.field ?? "",
      durationYears:
        p.durationYears != null ? Number(p.durationYears) : undefined,
      tuitionFee: p.tuitionFee != null ? Number(p.tuitionFee) : undefined,
      language: p.language != null ? String(p.language) : undefined,
      entryRequirements:
        p.entryRequirements != null ? String(p.entryRequirements) : undefined,
    });
  }

  const scholarships = catalog.scholarships ?? [];
  for (const s of scholarships) {
    const maxSlots = s.maxSlots != null ? Number(s.maxSlots) : 1;
    await Scholarship.create({
      universityId: profile._id,
      name: s.name ?? "",
      coveragePercent:
        s.coveragePercent != null ? Number(s.coveragePercent) : 0,
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
      name: faculty.name ?? "",
      description:
        faculty.description != null ? String(faculty.description) : "",
      items: Array.isArray(faculty.items)
        ? faculty.items.map((item) => String(item)).filter(Boolean)
        : [],
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
      reviewedBy:
        document.reviewedBy != null ? String(document.reviewedBy) : undefined,
      reviewedAt: document.reviewedAt
        ? new Date(document.reviewedAt as string)
        : undefined,
    });
  }

  await UniversityVerificationRequest.findByIdAndUpdate(requestId, {
    status: "approved",
    reviewedAt: new Date(),
    reviewedBy: adminUserId,
  });

  await UniversityCatalog.findByIdAndUpdate(catalog._id, {
    linkedUniversityProfileId: profile._id,
  });

  const notificationService = await import("./notification.service");
  await notificationService.createNotification(String(userId), {
    type: "university_approved",
    title: "University account approved",
    body: `Your request for ${catalog.universityName} has been approved. You can now sign in and complete your profile.`,
    referenceType: "university",
    referenceId: String(profile._id),
  });

  return { approved: true, profileId: String(profile._id) };
}

export async function rejectUniversityRequest(
  requestId: string,
  adminUserId: string,
) {
  const request = await UniversityVerificationRequest.findById(requestId);
  if (!request)
    throw new AppError(404, "Request not found", ErrorCodes.NOT_FOUND);
  if ((request as { status: string }).status !== "pending") {
    return { rejected: true, alreadyProcessed: true };
  }
  await UniversityVerificationRequest.findByIdAndUpdate(requestId, {
    status: "rejected",
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

export async function createInvestor(body: {
  name: string;
  logoUrl?: string;
  websiteUrl?: string;
  description?: string;
  order?: number;
}) {
  const name = String(body.name ?? "").trim();
  if (!name) throw new AppError(400, "Name is required", ErrorCodes.VALIDATION);
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
  if (!doc) throw new AppError(404, "Investor not found", ErrorCodes.NOT_FOUND);
  return { deleted: true };
}

// ——— Landing Certificates ———

export async function listLandingCertificates() {
  const list = await LandingCertificate.find()
    .sort({ order: 1, createdAt: 1 })
    .lean();
  return list.map((c) => ({ ...c, id: String((c as { _id: unknown })._id) }));
}

export async function createLandingCertificate(body: {
  type: "university" | "student";
  title: string;
  imageUrl: string;
  order?: number;
}) {
  const doc = await LandingCertificate.create({
    type: body.type,
    title: String(body.title ?? "").trim(),
    imageUrl: String(body.imageUrl ?? "").trim(),
    order: body.order != null ? Number(body.order) : 0,
  });
  return { ...doc.toObject(), id: String(doc._id) };
}

export async function updateLandingCertificate(
  id: string,
  body: {
    type?: "university" | "student";
    title?: string;
    imageUrl?: string;
    order?: number;
  },
) {
  const update: Record<string, unknown> = {};
  if (body.type !== undefined) update.type = body.type;
  if (body.title !== undefined) update.title = String(body.title).trim();
  if (body.imageUrl !== undefined)
    update.imageUrl = String(body.imageUrl).trim();
  if (body.order !== undefined) update.order = Number(body.order);
  const doc = await LandingCertificate.findByIdAndUpdate(id, update, {
    new: true,
  }).lean();
  if (!doc)
    throw new AppError(
      404,
      "Landing certificate not found",
      ErrorCodes.NOT_FOUND,
    );
  return { ...doc, id: String((doc as { _id: unknown })._id) };
}

export async function deleteLandingCertificate(id: string) {
  const doc = await LandingCertificate.findByIdAndDelete(id);
  if (!doc)
    throw new AppError(
      404,
      "Landing certificate not found",
      ErrorCodes.NOT_FOUND,
    );
  return { deleted: true };
}

// ——— Universities Excel import / template ———

function parseNumFromText(s: unknown): number | undefined {
  if (s == null || s === "") return undefined;
  const str = String(s).trim();
  if (!str || /^varies$/i.test(str) || /^n\/a$/i.test(str)) return undefined;
  const match = str.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function parseDateFromText(s: unknown): Date | undefined {
  if (s == null || s === "") return undefined;
  const str = String(s).trim();
  if (!str || /^varies$/i.test(str)) return undefined;
  const d = new Date(str);
  return isNaN(d.getTime()) ? undefined : d;
}

function splitList(s: unknown): string[] {
  if (s == null || s === "") return [];
  return String(s)
    .split(/[;,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function parseFacultyItems(raw: unknown): Record<string, string[]> | undefined {
  if (raw == null || raw === "") return undefined;
  // Format: category:item1|item2; category2:item3|item4
  const entries = String(raw)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!entries.length) return undefined;

  const result: Record<string, string[]> = {};
  for (const entry of entries) {
    const separator = entry.indexOf(":");
    if (separator <= 0) continue;
    const key = entry.slice(0, separator).trim();
    const values = entry
      .slice(separator + 1)
      .split("|")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 50);
    if (key && values.length > 0) {
      result[key] = values;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function formatFacultyItems(
  value: Record<string, string[]> | undefined,
): string {
  if (!value) return "";
  return Object.entries(value)
    .map(([key, items]) => `${key}:${items.join("|")}`)
    .join("; ");
}

const STATIC_FACULTY_LABELS: Record<string, string> = {
  business_management_economics: "Business, Management and Economics",
  engineering_technology: "Engineering and Technology",
  computer_science_digital_technologies:
    "Computer Science and Digital Technologies",
  natural_sciences: "Natural Sciences",
  health_medical_sciences: "Health and Medical Sciences",
  social_sciences_humanities: "Social Sciences and Humanities",
  creative_arts_media_design: "Creative Arts, Media and Design",
  education: "Education",
  environment_agriculture_sustainability:
    "Environment, Agriculture and Sustainability",
  hospitality_tourism_service: "Hospitality, Tourism and Service",
  law_legal_studies: "Law and Legal Studies",
};

function getStaticFacultyItems(code: string): string[] {
  const staticMap: Record<string, string[]> = {
    business_management_economics: [
      "Accounting",
      "Banking and Finance",
      "Business Administration",
      "Business Analytics",
      "Economics",
      "Finance",
      "Global Business",
      "Human Resource Management",
      "International Business",
      "Logistics and Supply Chain Management",
      "Management",
      "Marketing",
      "Project Management",
    ],
    engineering_technology: [
      "Aerospace Engineering",
      "Biomedical Engineering",
      "Chemical Engineering",
      "Civil Engineering",
      "Computer Engineering",
      "Electrical Engineering",
      "Mechanical Engineering",
      "Software Engineering",
    ],
    computer_science_digital_technologies: [
      "Artificial Intelligence",
      "Computer Science",
      "Cybersecurity",
      "Data Analytics",
      "Data Science",
      "Information Systems",
      "Information Technology",
    ],
    natural_sciences: [
      "Biochemistry",
      "Biology",
      "Chemistry",
      "Genetics",
      "Mathematics",
      "Physics",
      "Statistics",
    ],
    health_medical_sciences: ["Health Sciences", "Nursing", "Pharmacy"],
    social_sciences_humanities: [
      "International Relations",
      "Philosophy",
      "Political Science",
      "Psychology",
      "Sociology",
    ],
    creative_arts_media_design: [
      "Architecture",
      "Digital Media",
      "Game Design",
      "Graphic Design",
      "Journalism",
      "Media Studies",
    ],
    education: [
      "Education",
      "Primary Education",
      "Pre-school education",
      "Education technology",
    ],
    environment_agriculture_sustainability: [
      "Agriculture",
      "Environmental Science",
      "Urban Planning",
    ],
    hospitality_tourism_service: [
      "Hospitality Management",
      "Tourism Management",
      "Food Science",
    ],
    law_legal_studies: ["Law", "Forensic Science"],
  };
  return staticMap[code] ?? [];
}

type CatalogFacultySelectionPayload = {
  type?: "catalog" | "custom";
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

async function getFacultyCatalogMap(): Promise<
  Map<string, { name: string; items: string[] }>
> {
  const map = new Map<string, { name: string; items: string[] }>();
  Object.entries(STATIC_FACULTY_LABELS).forEach(([code, name]) => {
    map.set(code, { name, items: getStaticFacultyItems(code) });
  });
  const globals = await GlobalFaculty.find().lean();
  globals.forEach((faculty) => {
    map.set(String(faculty.code ?? ""), {
      name: String(faculty.name ?? faculty.code ?? ""),
      items: Array.isArray(faculty.items)
        ? faculty.items.map((item) => String(item))
        : [],
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
      return {
        catalog: byId as Record<string, unknown>,
        matchedBy: "id" as const,
      };
    }
  }

  const normalizedName = row.universityName.trim();
  if (!normalizedName) {
    return { catalog: undefined, matchedBy: undefined };
  }

  const exactNameRegex = new RegExp(
    `^${safeRegExp(normalizedName).source}$`,
    "i",
  );
  const byName = await UniversityCatalog.findOne({
    universityName: exactNameRegex,
  }).lean();
  if (byName) {
    return {
      catalog: byName as Record<string, unknown>,
      matchedBy: "name" as const,
    };
  }

  return { catalog: undefined, matchedBy: undefined };
}

type UniversitiesExcelPreviewItem = {
  row: number;
  sourceId?: string;
  existingId?: string;
  universityName: string;
  linkedProfileId?: string;
  action: "create" | "update";
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
  return String(row["University name"] ?? row["universityName"] ?? "").trim();
}

function getUniversityRowId(row: Record<string, unknown>): string | undefined {
  const id = trimString(
    row["University ID"] ?? row["universityId"] ?? row["ID"] ?? row["id"],
  );
  return id || undefined;
}

function makeUniversityJoinKey(
  id: string | undefined,
  name: string | undefined,
): string | undefined {
  if (id) return `id:${id}`;
  if (name) return `name:${name.trim().toLowerCase()}`;
  return undefined;
}

function pushToRowMap<T>(
  map: Map<string, T[]>,
  key: string | undefined,
  value: T,
) {
  if (!key) return;
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function getMappedRows<T>(
  map: Map<string, T[]>,
  id: string | undefined,
  name: string,
): T[] {
  const byId = id ? (map.get(`id:${id}`) ?? []) : [];
  const byName = map.get(`name:${name.trim().toLowerCase()}`) ?? [];
  if (!byId.length) return byName;
  if (!byName.length) return byId;
  return [...byId, ...byName];
}

function sortForCompare(
  payload: CatalogUniversityPayload,
): Record<string, unknown> {
  const facultyItems = payload.facultyItems
    ? Object.fromEntries(
        Object.entries(payload.facultyItems).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      )
    : undefined;

  return {
    universityName: payload.universityName,
    tagline: payload.tagline ?? "",
    establishedYear: payload.establishedYear ?? null,
    studentCount: payload.studentCount ?? null,
    country: payload.country ?? "",
    city: payload.city ?? "",
    description: payload.description ?? "",
    rating: payload.rating ?? null,
    logoUrl: payload.logoUrl ?? "",
    facultyCodes: [...(payload.facultyCodes ?? [])].sort(),
    facultyItems,
    targetStudentCountries: [...(payload.targetStudentCountries ?? [])].sort(),
    minLanguageLevel: payload.minLanguageLevel ?? "",
    tuitionPrice: payload.tuitionPrice ?? null,
    programs: [...(payload.programs ?? [])].sort((a, b) =>
      `${a.name}|${a.degreeLevel ?? ""}|${a.field ?? ""}`.localeCompare(
        `${b.name}|${b.degreeLevel ?? ""}|${b.field ?? ""}`,
      ),
    ),
    scholarships: [...(payload.scholarships ?? [])].sort((a, b) =>
      `${a.name}|${a.deadline ?? ""}`.localeCompare(
        `${b.name}|${b.deadline ?? ""}`,
      ),
    ),
    customFaculties: [...(payload.customFaculties ?? [])].sort((a, b) =>
      `${a.order ?? 0}|${a.name}`.localeCompare(`${b.order ?? 0}|${b.name}`),
    ),
    documents: [...(payload.documents ?? [])].sort((a, b) =>
      `${a.documentType}|${a.fileUrl}`.localeCompare(
        `${b.documentType}|${b.fileUrl}`,
      ),
    ),
  };
}

function stringifyCompareValue(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function makePreviewChanges(
  current: CatalogUniversityPayload,
  incoming: CatalogUniversityPayload,
) {
  const labels: Record<string, string> = {
    universityName: "University name",
    country: "Country",
    city: "City",
    tagline: "Slogan",
    logoUrl: "Logo URL",
    description: "Description",
    rating: "Rating",
    minLanguageLevel: "Minimum requirements",
    tuitionPrice: "Minimum tuition (annual)",
    establishedYear: "Year founded",
    studentCount: "Number of students",
    facultyCodes: "Faculties",
    facultyItems: "Faculty items",
    targetStudentCountries: "Target student countries",
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
    .filter(
      (item): item is { field: string; before: string; after: string } =>
        item != null,
    );
}

async function getEffectiveCatalogUniversityData(
  catalogRaw: Record<string, unknown>,
): Promise<EffectiveCatalogUniversityData> {
  const catalogId = String(catalogRaw._id ?? catalogRaw.id ?? "");
  const linkedProfileId = toObjectIdString(
    (catalogRaw as { linkedUniversityProfileId?: unknown })
      .linkedUniversityProfileId,
  );
  const baseBody = buildCatalogUniversityPayload({
    ...catalogRaw,
    universityName: catalogRaw.universityName,
    scholarships: Array.isArray(catalogRaw.scholarships)
      ? (catalogRaw.scholarships as Array<Record<string, unknown>>).map(
          (item) => ({
            ...item,
            deadline: normalizeIsoDate(item.deadline),
          }),
        )
      : [],
    documents: Array.isArray(catalogRaw.documents)
      ? (catalogRaw.documents as Array<Record<string, unknown>>).map(
          (item) => ({
            ...item,
            reviewedAt: normalizeIsoDate(item.reviewedAt),
          }),
        )
      : [],
  });

  if (!linkedProfileId) {
    return { id: catalogId, body: baseBody };
  }

  const [profile, programs, scholarships, faculties, documents] =
    await Promise.all([
      UniversityProfile.findById(linkedProfileId).lean(),
      Program.find({ universityId: linkedProfileId }).sort({ name: 1 }).lean(),
      Scholarship.find({ universityId: linkedProfileId })
        .sort({ name: 1 })
        .lean(),
      Faculty.find({ universityId: linkedProfileId })
        .sort({ order: 1, name: 1 })
        .lean(),
      UniversityDocument.find({ universityId: linkedProfileId })
        .sort({ documentType: 1, createdAt: 1 })
        .lean(),
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

async function syncLinkedUniversityProfile(
  profileId: string,
  payload: CatalogUniversityPayload,
): Promise<void> {
  await UniversityProfile.findByIdAndUpdate(profileId, {
    universityName: payload.universityName,
    tagline: payload.tagline,
    establishedYear: payload.establishedYear,
    studentCount: payload.studentCount,
    country: payload.country,
    city: payload.city,
    description: payload.description,
    rating: payload.rating,
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
        degreeLevel: item.degreeLevel ?? "",
        field: item.field ?? "",
        durationYears: item.durationYears,
        tuitionFee: item.tuitionFee,
        language: item.language,
        entryRequirements: item.entryRequirements,
      })),
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
      })),
    );
  }

  await Faculty.deleteMany({ universityId: profileId });
  if (payload.customFaculties?.length) {
    await Faculty.insertMany(
      payload.customFaculties.map((item, index) => ({
        universityId: profileId,
        name: item.name,
        description: item.description ?? "",
        items: item.items ?? [],
        order: item.order ?? index,
      })),
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
      })),
    );
  }
}

export function parseUniversitiesExcel(
  buffer: Buffer,
): ParsedUniversitiesExcelResult {
  const XLSX = require("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetNames = wb.SheetNames || [];

  const universitiesSheet =
    sheetNames.find((n: string) => /universit/i.test(n)) || sheetNames[0];
  const programsSheet = sheetNames.find((n: string) => /program/i.test(n));
  const scholarshipsSheet = sheetNames.find((n: string) =>
    /scholarship/i.test(n),
  );
  const facultiesSheet = sheetNames.find((n: string) => /^facult/i.test(n));
  const customFacultiesSheet = sheetNames.find((n: string) =>
    /custom.*facult|facult.*custom/i.test(n),
  );
  const documentsSheet = sheetNames.find((n: string) => /document/i.test(n));

  const uniRows = XLSX.utils.sheet_to_json(
    wb.Sheets[universitiesSheet] || {},
  ) as Record<string, unknown>[];
  if (!uniRows.length) return { rows: [], errors: [] };

  const errors: Array<{ row: number; name: string; message: string }> = [];

  const programsByUni = new Map<string, CatalogProgramPayload[]>();
  if (programsSheet && wb.Sheets[programsSheet]) {
    const progRows = XLSX.utils.sheet_to_json(
      wb.Sheets[programsSheet],
    ) as Record<string, unknown>[];
    for (const row of progRows) {
      const uniName = getUniversityRowName(row);
      const joinKey = makeUniversityJoinKey(getUniversityRowId(row), uniName);
      if (!joinKey) continue;
      const list = programsByUni.get(joinKey) || [];
      list.push({
        name:
          String(row["Program name"] ?? row["programName"] ?? "").trim() ||
          "Program",
        degreeLevel:
          String(row["Degree"] ?? row["degreeLevel"] ?? "").trim() || undefined,
        field: String(row["Field"] ?? row["field"] ?? "").trim() || undefined,
        durationYears: parseNumFromText(row["Years"] ?? row["durationYears"]),
        tuitionFee: parseNumFromText(
          row["Tuition"] ?? row["tuitionFee"] ?? row["Tuition"],
        ),
        language:
          String(row["Language"] ?? row["language"] ?? "").trim() || undefined,
        entryRequirements:
          String(
            row["Entry requirements"] ??
              row["entryRequirements"] ??
              row["Notes"] ??
              row["notes"] ??
              "",
          ).trim() || undefined,
      });
      programsByUni.set(joinKey, list);
    }
  }

  const scholarshipsByUni = new Map<string, CatalogScholarshipPayload[]>();
  if (scholarshipsSheet && wb.Sheets[scholarshipsSheet]) {
    const schRows = XLSX.utils.sheet_to_json(
      wb.Sheets[scholarshipsSheet],
    ) as Record<string, unknown>[];
    for (const row of schRows) {
      const uniName = getUniversityRowName(row);
      const joinKey = makeUniversityJoinKey(getUniversityRowId(row), uniName);
      if (!joinKey) continue;
      const list = scholarshipsByUni.get(joinKey) || [];
      list.push({
        name:
          String(
            row["Scholarship name"] ?? row["scholarshipName"] ?? "",
          ).trim() || "Scholarship",
        coveragePercent:
          parseNumFromText(row["Coverage %"] ?? row["coveragePercent"]) ?? 0,
        maxSlots: parseNumFromText(row["Max slots"] ?? row["maxSlots"]) ?? 0,
        deadline: normalizeIsoDate(
          parseDateFromText(row["Deadline"] ?? row["deadline"]),
        ),
        eligibility:
          String(row["Eligibility"] ?? row["eligibility"] ?? "").trim() ||
          undefined,
      });
      scholarshipsByUni.set(joinKey, list);
    }
  }

  const facultiesByUni = new Map<string, CatalogFacultySelectionPayload[]>();
  if (facultiesSheet && wb.Sheets[facultiesSheet]) {
    const facultyRows = XLSX.utils.sheet_to_json(
      wb.Sheets[facultiesSheet],
    ) as Record<string, unknown>[];
    for (const row of facultyRows) {
      const uniName = getUniversityRowName(row);
      const joinKey = makeUniversityJoinKey(getUniversityRowId(row), uniName);
      if (!joinKey) continue;
      const typeRaw = trimString(
        row["Faculty type"] ?? row["facultyType"] ?? row["Type"] ?? row["type"],
      )?.toLowerCase();
      const type = typeRaw === "custom" ? "custom" : "catalog";
      const code =
        trimString(
          row["Faculty code"] ??
            row["facultyCode"] ??
            row["Code"] ??
            row["code"],
        ) ?? "";
      const name =
        trimString(
          row["Faculty name"] ??
            row["facultyName"] ??
            row["Name"] ??
            row["name"],
        ) ?? code;
      if (type === "catalog" && !code) continue;
      if (type === "custom" && !name) continue;
      const list = facultiesByUni.get(joinKey) || [];
      list.push({
        type,
        code,
        name,
        items: splitList(
          row["Selected items"] ??
            row["selectedItems"] ??
            row["Items"] ??
            row["items"],
        ),
        description: trimString(row["Description"] ?? row["description"]) ?? "",
        order: parseNumFromText(row["Order"] ?? row["order"]) ?? list.length,
      });
      facultiesByUni.set(joinKey, list);
    }
  }

  const customFacultiesByUni = new Map<string, CatalogCustomFacultyPayload[]>();
  if (customFacultiesSheet && wb.Sheets[customFacultiesSheet]) {
    const facultyRows = XLSX.utils.sheet_to_json(
      wb.Sheets[customFacultiesSheet],
    ) as Record<string, unknown>[];
    for (const row of facultyRows) {
      const uniName = getUniversityRowName(row);
      const joinKey = makeUniversityJoinKey(getUniversityRowId(row), uniName);
      if (!joinKey) continue;
      const list = customFacultiesByUni.get(joinKey) || [];
      list.push({
        name:
          String(row["Faculty name"] ?? row["facultyName"] ?? "").trim() ||
          "Faculty",
        description:
          String(row["Description"] ?? row["description"] ?? "").trim() || "",
        items: splitList(row["Items"] ?? row["items"]) ?? [],
        order: parseNumFromText(row["Order"] ?? row["order"]) ?? list.length,
      });
      customFacultiesByUni.set(joinKey, list);
    }
  }

  const documentsByUni = new Map<string, CatalogDocumentPayload[]>();
  if (documentsSheet && wb.Sheets[documentsSheet]) {
    const documentRows = XLSX.utils.sheet_to_json(
      wb.Sheets[documentsSheet],
    ) as Record<string, unknown>[];
    for (const row of documentRows) {
      const uniName = getUniversityRowName(row);
      const joinKey = makeUniversityJoinKey(getUniversityRowId(row), uniName);
      if (!joinKey) continue;
      const documentType =
        trimString(row["Document type"] ?? row["documentType"]) ?? "";
      const fileUrl = trimString(row["File URL"] ?? row["fileUrl"]) ?? "";
      if (!documentType || !fileUrl) continue;
      const list = documentsByUni.get(joinKey) || [];
      list.push({
        documentType,
        fileUrl,
        status: trimString(row["Status"] ?? row["status"]),
        reviewedBy: trimString(row["Reviewed by"] ?? row["reviewedBy"]),
        reviewedAt: normalizeIsoDate(row["Reviewed at"] ?? row["reviewedAt"]),
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
      errors.push({
        row: rowNumber,
        name: "",
        message: "University name is required.",
      });
      continue;
    }

    const sourceId = trimString(row["ID"] ?? row["id"]);
    const facultySelections = getMappedRows(
      facultiesByUni,
      sourceId,
      universityName,
    );
    const normalFacultySelections = facultySelections.filter(
      (faculty) => faculty.type !== "custom",
    );
    const customFacultySelections = facultySelections.filter(
      (faculty) => faculty.type === "custom",
    );
    const facultyCodesFromSheet = normalFacultySelections
      .map((faculty) => faculty.code)
      .filter(Boolean);
    const facultyItemsFromSheet = Object.fromEntries(
      normalFacultySelections
        .filter((faculty) => (faculty.items ?? []).length > 0)
        .map((faculty) => [faculty.code, (faculty.items ?? []).slice(0, 50)]),
    );
    const body: CatalogUniversityPayload = {
      universityName,
      country:
        String(row["Country"] ?? row["country"] ?? "").trim() || undefined,
      city: String(row["City"] ?? row["city"] ?? "").trim() || undefined,
      tagline:
        String(row["Slogan"] ?? row["tagline"] ?? "").trim() || undefined,
      logoUrl:
        String(row["Logo URL"] ?? row["logoUrl"] ?? "").trim() || undefined,
      description:
        String(row["Description"] ?? row["description"] ?? "").trim() ||
        undefined,
      rating: parseNumFromText(row["Rating"] ?? row["rating"]),
      minLanguageLevel:
        String(
          row["Minimum requirements"] ?? row["minLanguageLevel"] ?? "",
        ).trim() || undefined,
      tuitionPrice: parseNumFromText(
        row["Minimum tuition (annual)"] ?? row["tuitionPrice"],
      ),
      establishedYear: parseNumFromText(
        row["Year founded"] ?? row["establishedYear"],
      ),
      studentCount: parseNumFromText(
        row["Number of students"] ?? row["studentCount"],
      ),
      facultyCodes: facultyCodesFromSheet.length
        ? facultyCodesFromSheet
        : splitList(row["Faculties"] ?? row["faculties"]),
      facultyItems:
        Object.keys(facultyItemsFromSheet).length > 0
          ? facultyItemsFromSheet
          : parseFacultyItems(row["Faculty items"] ?? row["facultyItems"]),
      targetStudentCountries: splitList(
        row["Target student countries"] ?? row["targetStudentCountries"],
      ),
      programs: getMappedRows(programsByUni, sourceId, universityName).slice(
        0,
        50,
      ),
      scholarships: getMappedRows(
        scholarshipsByUni,
        sourceId,
        universityName,
      ).slice(0, 30),
      customFaculties: (customFacultySelections.length
        ? customFacultySelections.map((faculty, index) => ({
            name: faculty.name,
            description: faculty.description ?? "",
            items: (faculty.items ?? []).slice(0, 100),
            order: faculty.order ?? index,
          }))
        : getMappedRows(customFacultiesByUni, sourceId, universityName)
      ).slice(0, 100),
      documents: getMappedRows(documentsByUni, sourceId, universityName).slice(
        0,
        100,
      ),
    };

    rows.push({
      row: rowNumber,
      sourceId: sourceId || undefined,
      universityName,
      body,
    });
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

    const currentComparable = current
      ? sortForCompare(current.body)
      : undefined;
    const incomingComparable = sortForCompare(row.body);

    items.push({
      row: row.row,
      sourceId: row.sourceId,
      existingId: current?.id,
      universityName: row.universityName,
      linkedProfileId: current?.linkedProfileId,
      action: current ? "update" : "create",
      incoming: row.body,
      current: current?.body,
      changes: current ? makePreviewChanges(current.body, row.body) : [],
      sections: {
        programsChanged:
          stringifyCompareValue(currentComparable?.programs) !==
          stringifyCompareValue(incomingComparable.programs),
        scholarshipsChanged:
          stringifyCompareValue(currentComparable?.scholarships) !==
          stringifyCompareValue(incomingComparable.scholarships),
        customFacultiesChanged:
          stringifyCompareValue(currentComparable?.customFaculties) !==
          stringifyCompareValue(incomingComparable.customFaculties),
        documentsChanged:
          stringifyCompareValue(currentComparable?.documents) !==
          stringifyCompareValue(incomingComparable.documents),
      },
    });
  }

  return {
    items,
    errors,
    summary: {
      total: items.length,
      creates: items.filter((item) => item.action === "create").length,
      updates: items.filter((item) => item.action === "update").length,
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
  const errors: Array<{ row: number; name: string; message: string }> = [
    ...parsed.errors,
  ];
  let created = 0;
  let updated = 0;

  for (const row of parsed.rows) {
    try {
      const { catalog: existing } = await findCatalogUniversityForImport(row);
      if (existing) {
        const existingId = String((existing as { _id: unknown })._id);
        const updatedCatalog = await updateCatalogUniversity(
          existingId,
          row.body as unknown as Record<string, unknown>,
        );
        const linkedProfileId = toObjectIdString(
          (updatedCatalog as { linkedUniversityProfileId?: unknown })
            .linkedUniversityProfileId,
        );
        if (linkedProfileId) {
          await syncLinkedUniversityProfile(linkedProfileId, row.body);
        }
        updated++;
      } else {
        const createdCatalog = await createCatalogUniversity(
          row.body as unknown as Record<string, unknown>,
        );
        const linkedProfileId = toObjectIdString(
          (createdCatalog as { linkedUniversityProfileId?: unknown })
            .linkedUniversityProfileId,
        );
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
  const XLSX = require("xlsx");
  const uniHeaders = [
    "ID",
    "University name",
    "Country",
    "City",
    "Slogan",
    "Logo URL",
    "Description",
    "Rating",
    "Minimum requirements",
    "Minimum tuition (annual)",
    "Year founded",
    "Number of students",
    "Faculties",
    "Faculty items",
    "Target student countries",
  ];
  const facultyHeaders = [
    "University ID",
    "University name",
    "Faculty type",
    "Faculty code",
    "Faculty name",
    "Description",
    "Selected items",
    "Order",
  ];
  const progHeaders = [
    "University ID",
    "University name",
    "Program name",
    "Degree",
    "Field",
    "Years",
    "Tuition",
    "Language",
    "Entry requirements",
    "Notes",
  ];
  const schHeaders = [
    "University ID",
    "University name",
    "Scholarship name",
    "Coverage %",
    "Max slots",
    "Deadline",
    "Eligibility",
    "Notes",
  ];
  const documentHeaders = [
    "University ID",
    "University name",
    "Document type",
    "File URL",
    "Status",
    "Reviewed by",
    "Reviewed at",
  ];

  const uniData = [
    uniHeaders,
    [
      "",
      "Example University",
      "Country",
      "City",
      "Short slogan",
      "https://example.com/logo.png",
      "Description text",
      "85",
      "IELTS 6.5 or equivalent",
      "5000",
      "1990",
      "10000",
      "Engineering; Science; Arts",
      "Engineering:Computer Science|Mechanical Engineering; Science:Biology|Physics",
      "Uzbekistan; Kazakhstan; Turkey",
    ],
  ];
  const facultyData = [
    facultyHeaders,
    [
      "",
      "Example University",
      "catalog",
      "engineering_technology",
      "Engineering and Technology",
      "",
      "Computer Engineering; Mechanical Engineering",
      "",
    ],
    [
      "",
      "Example University",
      "custom",
      "",
      "Faculty of Engineering",
      "Optional custom description",
      "Computer Science; Mechanical Engineering",
      "0",
    ],
  ];
  const progData = [
    progHeaders,
    [
      "",
      "Example University",
      "Bachelor in Computer Science",
      "Bachelor",
      "Computer Science",
      "4",
      "5000",
      "English",
      "IELTS 6.0, GPA 3.0+",
      "",
    ],
  ];
  const schData = [
    schHeaders,
    [
      "",
      "Example University",
      "Merit Scholarship",
      "50",
      "10",
      "2025-06-30",
      "GPA 3.5+",
      "",
    ],
  ];
  const documentData = [
    documentHeaders,
    [
      "",
      "Example University",
      "license",
      "https://example.com/license.pdf",
      "approved",
      "admin@example.com",
      "2025-06-30",
    ],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(uniData),
    "Universities",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(facultyData),
    "Faculties",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(progData),
    "Programs",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(schData),
    "Scholarships",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(documentData),
    "University Documents",
  );
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

export async function getUniversitiesExcelExportBuffer(): Promise<Buffer> {
  const XLSX = require("xlsx");
  const catalogs = await UniversityCatalog.find()
    .sort({ universityName: 1 })
    .lean();
  const facultyCatalogMap = await getFacultyCatalogMap();
  const effectiveItems = await Promise.all(
    catalogs.map((catalog) =>
      getEffectiveCatalogUniversityData(
        catalog as unknown as Record<string, unknown>,
      ),
    ),
  );

  const universitiesSheet = [
    [
      "ID",
      "University name",
      "Country",
      "City",
      "Slogan",
      "Logo URL",
      "Description",
      "Rating",
      "Minimum requirements",
      "Minimum tuition (annual)",
      "Year founded",
      "Number of students",
      "Faculties",
      "Faculty items",
      "Target student countries",
    ],
    ...effectiveItems.map((item) => [
      item.id,
      item.body.universityName,
      item.body.country ?? "",
      item.body.city ?? "",
      item.body.tagline ?? "",
      item.body.logoUrl ?? "",
      item.body.description ?? "",
      item.body.rating ?? "",
      item.body.minLanguageLevel ?? "",
      item.body.tuitionPrice ?? "",
      item.body.establishedYear ?? "",
      item.body.studentCount ?? "",
      (item.body.facultyCodes ?? []).join("; "),
      formatFacultyItems(item.body.facultyItems),
      (item.body.targetStudentCountries ?? []).join("; "),
    ]),
  ];

  const programsSheet = [
    [
      "University ID",
      "University name",
      "Program name",
      "Degree",
      "Field",
      "Years",
      "Tuition",
      "Language",
      "Entry requirements",
      "Notes",
    ],
    ...effectiveItems.flatMap((item) =>
      (item.body.programs ?? []).map((program) => [
        item.id,
        item.body.universityName,
        program.name,
        program.degreeLevel ?? "",
        program.field ?? "",
        program.durationYears ?? "",
        program.tuitionFee ?? "",
        program.language ?? "",
        program.entryRequirements ?? "",
        "",
      ]),
    ),
  ];

  const scholarshipsSheet = [
    [
      "University ID",
      "University name",
      "Scholarship name",
      "Coverage %",
      "Max slots",
      "Deadline",
      "Eligibility",
      "Notes",
    ],
    ...effectiveItems.flatMap((item) =>
      (item.body.scholarships ?? []).map((scholarship) => [
        item.id,
        item.body.universityName,
        scholarship.name,
        scholarship.coveragePercent,
        scholarship.maxSlots,
        scholarship.deadline ?? "",
        scholarship.eligibility ?? "",
        "",
      ]),
    ),
  ];

  const facultiesSheet = [
    [
      "University ID",
      "University name",
      "Faculty type",
      "Faculty code",
      "Faculty name",
      "Description",
      "Selected items",
      "Order",
    ],
    ...effectiveItems.flatMap((item) => [
      ...(item.body.facultyCodes ?? []).map((code) => {
        const faculty = facultyCatalogMap.get(code);
        const selectedItems =
          item.body.facultyItems?.[code] ?? faculty?.items ?? [];
        return [
          item.id,
          item.body.universityName,
          "catalog",
          code,
          faculty?.name ?? STATIC_FACULTY_LABELS[code] ?? code,
          "",
          selectedItems.join("; "),
          "",
        ];
      }),
      ...(item.body.customFaculties ?? []).map((faculty) => [
        item.id,
        item.body.universityName,
        "custom",
        "",
        faculty.name,
        faculty.description ?? "",
        (faculty.items ?? []).join("; "),
        faculty.order ?? 0,
      ]),
    ]),
  ];

  const documentsSheet = [
    [
      "University ID",
      "University name",
      "Document type",
      "File URL",
      "Status",
      "Reviewed by",
      "Reviewed at",
    ],
    ...effectiveItems.flatMap((item) =>
      (item.body.documents ?? []).map((document) => [
        item.id,
        item.body.universityName,
        document.documentType,
        document.fileUrl,
        document.status ?? "",
        document.reviewedBy ?? "",
        document.reviewedAt ?? "",
      ]),
    ),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(universitiesSheet),
    "Universities",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(facultiesSheet),
    "Faculties",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(programsSheet),
    "Programs",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(scholarshipsSheet),
    "Scholarships",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(documentsSheet),
    "University Documents",
  );
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
