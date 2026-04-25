import crypto from 'crypto';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import {
  User,
  StudentProfile,
  CounsellorProfile,
  SchoolJoinRequest,
  SchoolInvitation,
  Interest,
  CatalogInterest,
  StudentIssuedDocument,
} from '../models';
import * as subscriptionService from './subscription.service';
import * as notificationService from './notification.service';
import { AppError, ErrorCodes } from '../utils/errors';

const BCRYPT_ROUNDS = 12;

/** Generate a random temporary password (e.g. 12 chars, alphanumeric). */
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += chars[bytes[i]! % chars.length];
  return s;
}

function splitList(value: unknown): string[] {
  if (value == null || value === '') return [];
  return String(value)
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function parseNumFromText(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = Number(String(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0] ?? NaN);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function trimString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function slugEmailPart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
}

function makeGeneratedEmailBase(firstName: string, lastName: string): string {
  const lastInitial = slugEmailPart(lastName).slice(0, 1).toUpperCase();
  const cleanFirstName = slugEmailPart(firstName);
  const displayFirstName = cleanFirstName
    ? cleanFirstName.charAt(0).toUpperCase() + cleanFirstName.slice(1)
    : 'User';
  return `${lastInitial || 'U'}-${displayFirstName}`;
}

async function makeUniqueGeneratedStudentEmail(firstName: string, lastName: string, usedEmails: Set<string>): Promise<string> {
  const base = makeGeneratedEmailBase(firstName, lastName);
  let counter = 1;
  while (counter < 10000) {
    const suffix = counter === 1 ? '' : String(counter);
    const email = `${base}${suffix}@edu.uz`;
    const emailKey = email.toLowerCase();
    const existing = await User.exists({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') });
    if (!usedEmails.has(emailKey) && !existing) {
      usedEmails.add(emailKey);
      return email;
    }
    counter += 1;
  }
  const fallback = `${base}.${Date.now()}@edu.uz`;
  usedEmails.add(fallback.toLowerCase());
  return fallback;
}

function ensureCounsellor(counsellorUserId: string): void {
  // Caller must have verified role is school_counsellor
}

/** Get or create counsellor profile. */
export async function getCounsellorProfile(counsellorUserId: string) {
  const user = await User.findById(counsellorUserId);
  if (!user || user.role !== 'school_counsellor') {
    throw new AppError(403, 'Not a school counsellor', ErrorCodes.FORBIDDEN);
  }
  let profile = await CounsellorProfile.findOne({ userId: counsellorUserId }).lean();
  if (!profile) {
    const created = await CounsellorProfile.create({
      userId: counsellorUserId,
      schoolName: '',
      schoolDescription: '',
      country: '',
      city: '',
      isPublic: true,
    });
    profile = created.toObject();
  }
  const p = profile as Record<string, unknown>;
  return {
    id: String(p._id),
    userId: String(p.userId),
    schoolName: p.schoolName ?? '',
    schoolDescription: p.schoolDescription ?? '',
    country: p.country ?? '',
    city: p.city ?? '',
    isPublic: Boolean(p.isPublic),
  };
}

export async function updateCounsellorProfile(
  counsellorUserId: string,
  patch: { schoolName?: string; schoolDescription?: string; country?: string; city?: string; isPublic?: boolean }
) {
  ensureCounsellor(counsellorUserId);
  const user = await User.findById(counsellorUserId);
  if (!user || user.role !== 'school_counsellor') {
    throw new AppError(403, 'Not a school counsellor', ErrorCodes.FORBIDDEN);
  }
  const update: Record<string, unknown> = {};
  if (patch.schoolName !== undefined) update.schoolName = String(patch.schoolName);
  if (patch.schoolDescription !== undefined) update.schoolDescription = String(patch.schoolDescription);
  if (patch.country !== undefined) update.country = String(patch.country);
  if (patch.city !== undefined) update.city = String(patch.city);
  if (patch.isPublic !== undefined) update.isPublic = Boolean(patch.isPublic);

  const doc = await CounsellorProfile.findOneAndUpdate(
    { userId: counsellorUserId },
    update,
    { new: true, upsert: true }
  ).lean();
  const p = doc as Record<string, unknown>;
  return {
    id: String(p._id),
    userId: String(p.userId),
    schoolName: p.schoolName ?? '',
    schoolDescription: p.schoolDescription ?? '',
    country: p.country ?? '',
    city: p.city ?? '',
    isPublic: Boolean(p.isPublic),
  };
}

/** List schools (counsellors with public profile) for students to choose and send join request. */
export async function listSchools(params?: { search?: string; page?: number; limit?: number; studentUserId?: string }) {
  const page = Math.max(1, params?.page ?? 1);
  const limit = Math.min(50, Math.max(1, params?.limit ?? 20));
  const skip = (page - 1) * limit;
  const where: Record<string, unknown> = { isPublic: true };
  if (params?.search?.trim()) {
    const s = params.search.trim();
    where.$or = [
      { schoolName: new RegExp(escapeRegex(s), 'i') },
      { schoolDescription: new RegExp(escapeRegex(s), 'i') },
      { city: new RegExp(escapeRegex(s), 'i') },
      { country: new RegExp(escapeRegex(s), 'i') },
    ];
  }
  const [list, total] = await Promise.all([
    CounsellorProfile.find(where).sort({ schoolName: 1 }).skip(skip).limit(limit).lean(),
    CounsellorProfile.countDocuments(where),
  ]);
  const counsellorIds = list.map((c: { userId?: unknown }) => c.userId);
  const users = await User.find({ _id: { $in: counsellorIds } })
    .select('name email')
    .lean();
  const userMap = new Map(users.map((u: { _id: unknown; name?: string; email?: string }) => [String(u._id), u]));

  let requestStatusMap: Map<string, string> = new Map();
  if (params?.studentUserId) {
    const requests = await SchoolJoinRequest.find({
      studentId: params.studentUserId,
      counsellorUserId: { $in: counsellorIds },
      status: { $in: ['pending', 'accepted'] },
    })
      .select('counsellorUserId status')
      .lean();
    requests.forEach((r: { counsellorUserId?: unknown; status?: string }) => {
      requestStatusMap.set(String(r.counsellorUserId), r.status ?? 'pending');
    });
  }

  return {
    data: list.map((c: Record<string, unknown>) => {
      const u = userMap.get(String(c.userId));
      const requestStatus = requestStatusMap.get(String(c.userId));
      return {
        id: String(c._id),
        counsellorUserId: String(c.userId),
        schoolName: c.schoolName ?? '',
        schoolDescription: c.schoolDescription ?? '',
        country: c.country ?? '',
        city: c.city ?? '',
        counsellorName: (u as { name?: string })?.name ?? '',
        requestStatus: requestStatus || null,
      };
    }),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Create a new student by counsellor; returns temp password once. */
export async function createStudentByCounsellor(
  counsellorUserId: string,
  body: { email: string; name?: string; firstName?: string; lastName?: string; [key: string]: unknown }
) {
  const user = await User.findById(counsellorUserId);
  if (!user || user.role !== 'school_counsellor') {
    throw new AppError(403, 'Not a school counsellor', ErrorCodes.FORBIDDEN);
  }
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!email) throw new AppError(400, 'Email is required', ErrorCodes.VALIDATION);

  const existing = await User.findOne({ email });
  if (existing) throw new AppError(409, 'Email already registered', ErrorCodes.CONFLICT);

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

  const newUser = await User.create({
    email,
    name: (body.name ?? '').trim() || undefined,
    passwordHash,
    role: 'student',
    mustChangePassword: true,
    localPasswordConfigured: true,
    temporaryPlainPassword: tempPassword,
    temporaryPasswordGeneratedAt: new Date(),
  });

  await StudentProfile.create({
    userId: newUser._id,
    counsellorUserId: new mongoose.Types.ObjectId(counsellorUserId),
    firstName: (body.firstName ?? '').trim() || undefined,
    lastName: (body.lastName ?? '').trim() || undefined,
  });

  await subscriptionService.createForNewUser(String(newUser._id), 'student');

  return {
    user: {
      id: String(newUser._id),
      email: newUser.email,
      name: newUser.name ?? '',
      role: 'student' as const,
    },
    /** Temporary password: show only once to counsellor; student must change on first login. */
    temporaryPassword: tempPassword,
  };
}

/** List students linked to this counsellor. */
export async function listMyStudents(counsellorUserId: string, params?: { page?: number; limit?: number; search?: string }) {
  const user = await User.findById(counsellorUserId);
  if (!user || user.role !== 'school_counsellor') {
    // If the user record is missing or role is different, just return an empty list
    // instead of throwing, so that UI for new/empty counsellor accounts does not break.
    return { data: [], total: 0, page: 1, limit: params?.limit ?? 20, totalPages: 0 };
  }
  const page = Math.max(1, params?.page ?? 1);
  const limit = Math.min(100, Math.max(1, params?.limit ?? 20));
  const skip = (page - 1) * limit;
  const where: Record<string, unknown> = { counsellorUserId: new mongoose.Types.ObjectId(counsellorUserId) };
  if (params?.search?.trim()) {
    const s = params.search.trim();
    const studentIds = await User.find({ role: 'student', $or: [{ email: new RegExp(escapeRegex(s), 'i') }, { name: new RegExp(escapeRegex(s), 'i') }] })
      .select('_id')
      .lean();
    where.userId = { $in: studentIds.map((u: { _id: unknown }) => u._id) };
  }
  const [profiles, total] = await Promise.all([
    StudentProfile.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    StudentProfile.countDocuments(where),
  ]);
  const userIds = profiles.map((p: { userId?: unknown }) => p.userId).filter(Boolean);
  const users = await User.find({ _id: { $in: userIds } }).select('email name mustChangePassword temporaryPlainPassword').lean();
  const userMap = new Map(users.map((u: { _id: unknown; email?: string; name?: string; mustChangePassword?: boolean; temporaryPlainPassword?: string }) => [String(u._id), u]));
  const data = profiles.map((p: Record<string, unknown>) => {
    const u = userMap.get(String(p.userId)) as { email?: string; name?: string; mustChangePassword?: boolean; temporaryPlainPassword?: string } | undefined;
    return {
      id: String(p._id),
      userId: String(p.userId),
      email: u?.email ?? '',
      name: u?.name ?? '',
      firstName: p.firstName ?? '',
      lastName: p.lastName ?? '',
      country: p.country ?? '',
      city: p.city ?? '',
      mustChangePassword: Boolean(u?.mustChangePassword),
      temporaryPassword: u?.mustChangePassword ? String(u?.temporaryPlainPassword ?? '') || undefined : undefined,
    };
  });
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

type CounsellorExcelStudentPayload = {
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  phone?: string;
  country?: string;
  city?: string;
  gradeLevel?: string;
  gpa?: number;
  schoolName?: string;
  graduationYear?: number;
  preferredCountries?: string[];
  interestedFaculties?: string[];
};

type ParsedCounsellorStudentExcelRow = {
  row: number;
  sourceId?: string;
  body: CounsellorExcelStudentPayload;
};

async function assertCounsellorAccount(counsellorUserId: string): Promise<void> {
  const user = await User.findById(counsellorUserId).select('role').lean();
  if (!user || user.role !== 'school_counsellor') {
    throw new AppError(403, 'Not a school counsellor', ErrorCodes.FORBIDDEN);
  }
}

function buildCounsellorStudentPayload(userRaw: Record<string, unknown>, profileRaw: Record<string, unknown>): CounsellorExcelStudentPayload {
  const firstName = String(profileRaw.firstName ?? '').trim();
  const lastName = String(profileRaw.lastName ?? '').trim();
  const name = String(userRaw.name ?? '').trim() || [firstName, lastName].filter(Boolean).join(' ');
  return {
    email: String(userRaw.email ?? '').trim().toLowerCase(),
    firstName,
    lastName,
    name,
    phone: trimString(userRaw.phone),
    country: trimString(profileRaw.country),
    city: trimString(profileRaw.city),
    gradeLevel: trimString(profileRaw.gradeLevel),
    gpa: parseNumFromText(profileRaw.gpa),
    schoolName: trimString(profileRaw.schoolName),
    graduationYear: parseNumFromText(profileRaw.graduationYear),
    preferredCountries: Array.isArray(profileRaw.preferredCountries) ? profileRaw.preferredCountries.map(String).filter(Boolean) : [],
    interestedFaculties: Array.isArray(profileRaw.interestedFaculties) ? profileRaw.interestedFaculties.map(String).filter(Boolean) : [],
  };
}

async function getCounsellorStudentRows(counsellorUserId: string): Promise<Array<{
  id: string;
  userId: string;
  payload: CounsellorExcelStudentPayload;
  temporaryPassword?: string;
}>> {
  await assertCounsellorAccount(counsellorUserId);
  const profiles = await StudentProfile.find({ counsellorUserId: new mongoose.Types.ObjectId(counsellorUserId) })
    .sort({ createdAt: -1 })
    .lean();
  const userIds = profiles.map((profile) => profile.userId).filter(Boolean);
  const users = await User.find({ _id: { $in: userIds }, role: 'student' })
    .select('email name phone mustChangePassword temporaryPlainPassword')
    .lean();
  const userMap = new Map(users.map((user: Record<string, unknown>) => [String(user._id), user]));
  return profiles.flatMap((profile: Record<string, unknown>) => {
    const user = userMap.get(String(profile.userId));
    if (!user) return [];
    return [{
      id: String(profile._id),
      userId: String(profile.userId),
      payload: buildCounsellorStudentPayload(user, profile),
      temporaryPassword: (user as { mustChangePassword?: boolean; temporaryPlainPassword?: string }).mustChangePassword
        ? String((user as { temporaryPlainPassword?: string }).temporaryPlainPassword ?? '') || undefined
        : undefined,
    }];
  });
}

export function getCounsellorStudentsExcelTemplateBuffer(): Buffer {
  const XLSX = require('xlsx');
  const headers = [
    'ID',
    'Email',
    'First name',
    'Last name',
    'Name',
    'Phone',
    'Country',
    'City',
    'Grade level',
    'GPA',
    'School name',
    'Graduation year',
    'Preferred countries',
    'Interested faculties',
  ];
  const data = [
    headers,
    ['', 'student@example.com', 'Example', 'Student', 'Example Student', '+998901234567', 'UZ', 'Tashkent', '11', '4.5', 'Example School', '2026', 'UZ; KZ; TR', 'engineering_technology; computer_science_digital_technologies'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'Students');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export async function getCounsellorStudentsExcelExportBuffer(counsellorUserId: string): Promise<Buffer> {
  const XLSX = require('xlsx');
  const rows = await getCounsellorStudentRows(counsellorUserId);
  const headers = [
    'ID',
    'User ID',
    'Email',
    'First name',
    'Last name',
    'Name',
    'Phone',
    'One-time password',
    'Country',
    'City',
    'Grade level',
    'GPA',
    'School name',
    'Graduation year',
    'Preferred countries',
    'Interested faculties',
  ];
  const data = [
    headers,
    ...rows.map((row) => [
      row.id,
      row.userId,
      row.payload.email,
      row.payload.firstName,
      row.payload.lastName,
      row.payload.name,
      row.payload.phone ?? '',
      row.temporaryPassword ?? '',
      row.payload.country ?? '',
      row.payload.city ?? '',
      row.payload.gradeLevel ?? '',
      row.payload.gpa ?? '',
      row.payload.schoolName ?? '',
      row.payload.graduationYear ?? '',
      (row.payload.preferredCountries ?? []).join('; '),
      (row.payload.interestedFaculties ?? []).join('; '),
    ]),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'Students');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function parseCounsellorStudentsExcel(buffer: Buffer): { rows: ParsedCounsellorStudentExcelRow[]; errors: Array<{ row: number; name: string; message: string }> } {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = (wb.SheetNames || []).find((name: string) => /student/i.test(name)) || wb.SheetNames?.[0];
  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName] || {}) as Record<string, unknown>[];
  const rows: ParsedCounsellorStudentExcelRow[] = [];
  const errors: Array<{ row: number; name: string; message: string }> = [];
  for (let index = 0; index < rawRows.length; index++) {
    const raw = rawRows[index];
    const rowNumber = index + 2;
    const firstName = trimString(raw['First name'] ?? raw.firstName) ?? '';
    const lastName = trimString(raw['Last name'] ?? raw.lastName ?? raw.Surname ?? raw.surname) ?? '';
    const name = trimString(raw.Name ?? raw.name) ?? [firstName, lastName].filter(Boolean).join(' ');
    const email = String(raw.Email ?? raw.email ?? '').trim().toLowerCase();
    if (!firstName || !lastName) {
      errors.push({ row: rowNumber, name, message: 'First name and last name are required.' });
      continue;
    }
    rows.push({
      row: rowNumber,
      sourceId: trimString(raw.ID ?? raw.id ?? raw['User ID'] ?? raw.userId),
      body: {
        email,
        firstName,
        lastName,
        name,
        phone: trimString(raw.Phone ?? raw.phone),
        country: trimString(raw.Country ?? raw.country),
        city: trimString(raw.City ?? raw.city),
        gradeLevel: trimString(raw['Grade level'] ?? raw.gradeLevel),
        gpa: parseNumFromText(raw.GPA ?? raw.gpa),
        schoolName: trimString(raw['School name'] ?? raw.schoolName),
        graduationYear: parseNumFromText(raw['Graduation year'] ?? raw.graduationYear),
        preferredCountries: splitList(raw['Preferred countries'] ?? raw.preferredCountries),
        interestedFaculties: splitList(raw['Interested faculties'] ?? raw.interestedFaculties),
      },
    });
  }
  return { rows, errors };
}

async function findCounsellorStudentForImport(counsellorUserId: string, row: ParsedCounsellorStudentExcelRow) {
  if (row.sourceId && mongoose.Types.ObjectId.isValid(row.sourceId)) {
    const profileById = await StudentProfile.findOne({
      $or: [{ _id: row.sourceId }, { userId: row.sourceId }],
      counsellorUserId: new mongoose.Types.ObjectId(counsellorUserId),
    }).lean();
    if (profileById) return profileById as Record<string, unknown>;
  }
  const userByEmail = await User.findOne({ email: row.body.email, role: 'student' }).select('_id').lean();
  if (!userByEmail) return undefined;
  return StudentProfile.findOne({
    userId: userByEmail._id,
    counsellorUserId: new mongoose.Types.ObjectId(counsellorUserId),
  }).lean() as Promise<Record<string, unknown> | null>;
}

export async function importCounsellorStudentsFromExcel(counsellorUserId: string, buffer: Buffer): Promise<{
  created: number;
  updated: number;
  errors: Array<{ row: number; name: string; message: string }>;
}> {
  await assertCounsellorAccount(counsellorUserId);
  const parsed = parseCounsellorStudentsExcel(buffer);
  const errors = [...parsed.errors];
  const usedEmails = new Set<string>();
  let created = 0;
  let updated = 0;
  for (const row of parsed.rows) {
    try {
      if (row.body.email) {
        usedEmails.add(row.body.email.toLowerCase());
      } else {
        row.body.email = await makeUniqueGeneratedStudentEmail(row.body.firstName, row.body.lastName, usedEmails);
      }
      const existingProfile = await findCounsellorStudentForImport(counsellorUserId, row);
      if (existingProfile) {
        const existingUserId = String(existingProfile.userId);
        await User.findByIdAndUpdate(existingUserId, {
          email: row.body.email,
          name: row.body.name,
          phone: row.body.phone ?? '',
        });
        await StudentProfile.findByIdAndUpdate(existingProfile._id, {
          firstName: row.body.firstName,
          lastName: row.body.lastName,
          country: row.body.country,
          city: row.body.city,
          gradeLevel: row.body.gradeLevel,
          gpa: row.body.gpa,
          schoolName: row.body.schoolName,
          graduationYear: row.body.graduationYear,
          preferredCountries: row.body.preferredCountries ?? [],
          interestedFaculties: row.body.interestedFaculties ?? [],
        });
        updated += 1;
      } else {
        const duplicate = await User.findOne({ email: row.body.email }).select('_id').lean();
        if (duplicate) {
          throw new AppError(409, 'Email already registered outside your students', ErrorCodes.CONFLICT);
        }
        const tempPassword = generateTempPassword();
        const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
        const user = await User.create({
          email: row.body.email,
          name: row.body.name,
          phone: row.body.phone ?? '',
          passwordHash,
          role: 'student',
          emailVerified: true,
          localPasswordConfigured: true,
          mustChangePassword: true,
          temporaryPlainPassword: tempPassword,
          temporaryPasswordGeneratedAt: new Date(),
        });
        await StudentProfile.create({
          userId: user._id,
          counsellorUserId: new mongoose.Types.ObjectId(counsellorUserId),
          firstName: row.body.firstName,
          lastName: row.body.lastName,
          country: row.body.country,
          city: row.body.city,
          gradeLevel: row.body.gradeLevel,
          gpa: row.body.gpa,
          schoolName: row.body.schoolName,
          graduationYear: row.body.graduationYear,
          preferredCountries: row.body.preferredCountries ?? [],
          interestedFaculties: row.body.interestedFaculties ?? [],
        });
        await subscriptionService.createForNewUser(String(user._id), 'student');
        created += 1;
      }
    } catch (error: unknown) {
      errors.push({ row: row.row, name: row.body.name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { created, updated, errors };
}

/** Ensure student belongs to this counsellor. */
async function assertStudentBelongsToCounsellor(studentUserId: string, counsellorUserId: string) {
  const profile = await StudentProfile.findOne({ userId: studentUserId });
  if (!profile) throw new AppError(404, 'Student not found', ErrorCodes.NOT_FOUND);
  if (String(profile.counsellorUserId) !== String(counsellorUserId)) {
    throw new AppError(403, 'Student is not linked to you', ErrorCodes.FORBIDDEN);
  }
  return profile;
}

/** Update student profile (counsellor can edit all student data). */
export async function updateMyStudent(
  counsellorUserId: string,
  studentUserId: string,
  patch: Record<string, unknown>
) {
  await assertStudentBelongsToCounsellor(studentUserId, counsellorUserId);
  const { updateProfile } = await import('./student.service');
  return updateProfile(studentUserId, patch);
}

/** Get full student profile (for counsellor to view/edit). */
export async function getStudentProfile(counsellorUserId: string, studentUserId: string) {
  await assertStudentBelongsToCounsellor(studentUserId, counsellorUserId);
  const { getProfile } = await import('./student.service');
  return getProfile(studentUserId);
}

/** List universities for a specific student linked to this counsellor. */
export async function getStudentUniversities(
  counsellorUserId: string,
  studentUserId: string,
  query: { page?: number; limit?: number; country?: string; city?: string; useProfileFilters?: boolean }
) {
  await assertStudentBelongsToCounsellor(studentUserId, counsellorUserId);
  const { getUniversities } = await import('./student.service');
  return getUniversities(studentUserId, query);
}

/** Return the existing one-time password, or create one only for legacy rows that do not have it stored. */
export async function generateTempPasswordForStudent(counsellorUserId: string, studentUserId: string): Promise<{ temporaryPassword: string }> {
  await assertStudentBelongsToCounsellor(studentUserId, counsellorUserId);
  const user = await User.findById(studentUserId);
  if (!user) throw new AppError(404, 'Student not found', ErrorCodes.NOT_FOUND);
  if (!user.mustChangePassword) {
    throw new AppError(400, 'Student has already set their password. Use reset password if needed.', ErrorCodes.VALIDATION);
  }
  if (user.temporaryPlainPassword) {
    return { temporaryPassword: user.temporaryPlainPassword };
  }
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
  await User.findByIdAndUpdate(studentUserId, {
    passwordHash,
    localPasswordConfigured: true,
    mustChangePassword: true,
    temporaryPlainPassword: tempPassword,
    temporaryPasswordGeneratedAt: new Date(),
  });
  return { temporaryPassword: tempPassword };
}

/** Delete student (counsellor can delete only their linked students). */
export async function deleteMyStudent(counsellorUserId: string, studentUserId: string) {
  await assertStudentBelongsToCounsellor(studentUserId, counsellorUserId);
  const profile = await StudentProfile.findOne({ userId: studentUserId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);
  await Interest.deleteMany({ studentId: profile._id });
  await SchoolJoinRequest.deleteMany({ studentId: studentUserId });
  await StudentProfile.findByIdAndDelete(profile._id);
  await User.findByIdAndDelete(studentUserId);
  return { success: true };
}

/** Student sends request to join a school (counsellor). */
export async function requestToJoinSchool(studentUserId: string, counsellorUserId: string) {
  const user = await User.findById(studentUserId);
  if (!user || user.role !== 'student') throw new AppError(403, 'Only students can request to join a school', ErrorCodes.FORBIDDEN);
  const counsellor = await User.findById(counsellorUserId);
  if (!counsellor) {
    throw new AppError(404, 'School not found', ErrorCodes.NOT_FOUND);
  }
  if (counsellor.role !== 'school_counsellor') {
    throw new AppError(400, 'This account is not a school counsellor', ErrorCodes.VALIDATION);
  }
  const existing = await SchoolJoinRequest.findOne({ studentId: studentUserId, counsellorUserId });
  if (existing) {
    if (existing.status === 'pending') throw new AppError(409, 'Request already sent', ErrorCodes.CONFLICT);
    if (existing.status === 'accepted') throw new AppError(409, 'Already in this school', ErrorCodes.CONFLICT);
    // Rejected: allow new request
    await SchoolJoinRequest.updateOne({ _id: existing._id }, { status: 'pending' });
  } else {
    await SchoolJoinRequest.create({ studentId: studentUserId, counsellorUserId, status: 'pending' });
  }
  const profile = await CounsellorProfile.findOne({ userId: counsellorUserId }).lean();
  const schoolName = (profile as { schoolName?: string })?.schoolName ?? 'School';
  await notificationService.createNotification(counsellorUserId, {
    type: 'school_join_request',
    title: 'Join request',
    body: `A student requested to join ${schoolName}`,
    referenceType: 'school_join_request',
    referenceId: studentUserId,
    metadata: { studentId: studentUserId },
  });
  return { success: true, message: 'Request sent' };
}

/** List join requests for this counsellor. */
export async function listJoinRequests(counsellorUserId: string, params?: { status?: string; page?: number; limit?: number }) {
  const user = await User.findById(counsellorUserId);
  if (!user || user.role !== 'school_counsellor') {
    // Gracefully handle cases where there is no counsellor profile / user yet
    return { data: [], total: 0, page: 1, limit: params?.limit ?? 20, totalPages: 0 };
  }
  const page = Math.max(1, params?.page ?? 1);
  const limit = Math.min(50, Math.max(1, params?.limit ?? 20));
  const skip = (page - 1) * limit;
  const where: Record<string, unknown> = { counsellorUserId };
  if (params?.status === 'pending' || params?.status === 'accepted' || params?.status === 'rejected') {
    where.status = params.status;
  }
  const [list, total] = await Promise.all([
    SchoolJoinRequest.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    SchoolJoinRequest.countDocuments(where),
  ]);
  const studentIds = list.map((r: { studentId?: unknown }) => r.studentId).filter(Boolean);
  const users = await User.find({ _id: { $in: studentIds } }).select('email name').lean();
  const profiles = await StudentProfile.find({ userId: { $in: studentIds } }).select('userId firstName lastName').lean();
  const userMap = new Map(users.map((u: { _id: unknown; email?: string; name?: string }) => [String(u._id), u]));
  const profileMap = new Map(profiles.map((p: Record<string, unknown>) => [String(p.userId), p]));
  const data = list.map((r: Record<string, unknown>) => {
    const u = userMap.get(String(r.studentId));
    const p = profileMap.get(String(r.studentId)) as { firstName?: string | null; lastName?: string | null } | undefined;
    const nameFromProfile = p ? [p.firstName, p.lastName].filter(Boolean).join(' ') : '';
    const studentName = ((u as { name?: string })?.name ?? nameFromProfile) || '—';
    return {
      id: String(r._id),
      studentId: String(r.studentId),
      status: r.status,
      createdAt: r.createdAt,
      studentEmail: (u as { email?: string })?.email ?? '',
      studentName,
    };
  });
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

/** Accept join request: link student to counsellor. */
export async function acceptJoinRequest(counsellorUserId: string, requestId: string) {
  const user = await User.findById(counsellorUserId);
  if (!user || user.role !== 'school_counsellor') {
    throw new AppError(403, 'Not a school counsellor', ErrorCodes.FORBIDDEN);
  }
  const req = await SchoolJoinRequest.findOne({ _id: requestId, counsellorUserId });
  if (!req) throw new AppError(404, 'Request not found', ErrorCodes.NOT_FOUND);
  if (req.status !== 'pending') throw new AppError(400, 'Request already processed', ErrorCodes.VALIDATION);
  await SchoolJoinRequest.findByIdAndUpdate(requestId, { status: 'accepted' });
  await StudentProfile.findOneAndUpdate(
    { userId: req.studentId },
    { counsellorUserId: new mongoose.Types.ObjectId(counsellorUserId) }
  );
  await notificationService.createNotification(String(req.studentId), {
    type: 'school_join_accepted',
    title: 'Accepted to school',
    body: 'Your request to join the school was accepted',
    referenceType: 'school_join_request',
    referenceId: requestId,
  });
  return { success: true };
}

/** Reject join request. */
export async function rejectJoinRequest(counsellorUserId: string, requestId: string) {
  const req = await SchoolJoinRequest.findOne({ _id: requestId, counsellorUserId });
  if (!req) throw new AppError(404, 'Request not found', ErrorCodes.NOT_FOUND);
  if (req.status !== 'pending') throw new AppError(400, 'Request already processed', ErrorCodes.VALIDATION);
  await SchoolJoinRequest.findByIdAndUpdate(requestId, { status: 'rejected' });
  return { success: true };
}

/** Add interest (application) on behalf of a student. Counsellor must own the student. */
export async function addInterestOnBehalfOfStudent(
  counsellorUserId: string,
  studentUserId: string,
  universityProfileId: string
) {
  await assertStudentBelongsToCounsellor(studentUserId, counsellorUserId);
  const { addInterest } = await import('./student.service');
  return addInterest(studentUserId, universityProfileId);
}

async function getCounsellorStudentProfileContext(counsellorUserId: string) {
  await assertCounsellorAccount(counsellorUserId);
  const profiles = await StudentProfile.find({ counsellorUserId: new mongoose.Types.ObjectId(counsellorUserId) })
    .select('_id userId firstName lastName country')
    .lean();
  const userIds = profiles.map((profile: Record<string, unknown>) => profile.userId).filter(Boolean);
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select('email name').lean()
    : [];
  const userMap = new Map(users.map((user: Record<string, unknown>) => [String(user._id), user]));
  const profileMap = new Map<string, { userId: string; studentName: string; studentEmail: string; country?: string }>();
  for (const profile of profiles as Record<string, unknown>[]) {
    const user = userMap.get(String(profile.userId)) as { email?: string; name?: string } | undefined;
    const profileName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    profileMap.set(String(profile._id), {
      userId: String(profile.userId ?? ''),
      studentName: user?.name || profileName || 'Student',
      studentEmail: user?.email ?? '',
      country: profile.country != null ? String(profile.country) : undefined,
    });
  }
  return {
    profileIds: profiles.map((profile: Record<string, unknown>) => profile._id),
    profileMap,
  };
}

export async function listMyApplications(
  counsellorUserId: string,
  query: { page?: number; limit?: number; status?: string; studentUserId?: string } = {}
) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;
  const { profileIds, profileMap } = await getCounsellorStudentProfileContext(counsellorUserId);
  if (profileIds.length === 0) return { data: [], total: 0, page, limit, totalPages: 0 };

  let scopedProfileIds = profileIds;
  if (query.studentUserId && mongoose.Types.ObjectId.isValid(query.studentUserId)) {
    const profile = await StudentProfile.findOne({
      userId: query.studentUserId,
      counsellorUserId: new mongoose.Types.ObjectId(counsellorUserId),
    }).select('_id').lean();
    scopedProfileIds = profile ? [profile._id] : [];
  }
  if (scopedProfileIds.length === 0) return { data: [], total: 0, page, limit, totalPages: 0 };

  const whereProfile: Record<string, unknown> = { studentId: { $in: scopedProfileIds } };
  const whereCatalog: Record<string, unknown> = { studentId: { $in: scopedProfileIds } };
  if (query.status) {
    whereProfile.status = query.status;
    whereCatalog.status = query.status;
  }

  const [profileList, catalogList] = await Promise.all([
    Interest.find(whereProfile)
      .populate('universityId', 'universityName')
      .sort({ createdAt: -1 })
      .lean(),
    CatalogInterest.find(whereCatalog)
      .populate('catalogUniversityId', 'universityName')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const profileItems = profileList.map((interest: Record<string, unknown>) => {
    const studentProfileId = String(interest.studentId ?? '');
    const student = profileMap.get(studentProfileId);
    const university = interest.universityId as { _id?: unknown; universityName?: string } | undefined;
    return {
      id: String(interest._id),
      source: 'profile' as const,
      studentProfileId,
      studentUserId: student?.userId ?? '',
      studentName: student?.studentName ?? 'Student',
      studentEmail: student?.studentEmail ?? '',
      universityId: university?._id != null ? String(university._id) : String(interest.universityId ?? ''),
      universityName: university?.universityName,
      status: String(interest.status ?? 'interested'),
      createdAt: interest.createdAt,
      updatedAt: interest.updatedAt,
    };
  });

  const catalogItems = catalogList.map((interest: Record<string, unknown>) => {
    const studentProfileId = String(interest.studentId ?? '');
    const student = profileMap.get(studentProfileId);
    const university = interest.catalogUniversityId as { _id?: unknown; universityName?: string } | undefined;
    const rawUniversityId = university?._id != null ? String(university._id) : String(interest.catalogUniversityId ?? '');
    return {
      id: `catalog-${interest._id}`,
      source: 'catalog' as const,
      studentProfileId,
      studentUserId: student?.userId ?? '',
      studentName: student?.studentName ?? 'Student',
      studentEmail: student?.studentEmail ?? '',
      universityId: rawUniversityId ? `catalog-${rawUniversityId}` : '',
      universityName: university?.universityName,
      status: String(interest.status ?? 'interested'),
      createdAt: interest.createdAt,
      updatedAt: interest.updatedAt,
    };
  });

  const merged = [...profileItems, ...catalogItems].sort(
    (a, b) => new Date(b.createdAt as Date | string | undefined ?? 0).getTime() - new Date(a.createdAt as Date | string | undefined ?? 0).getTime()
  );
  return {
    data: merged.slice(skip, skip + limit),
    total: merged.length,
    page,
    limit,
    totalPages: Math.ceil(merged.length / limit),
  };
}

export async function listMyOffers(
  counsellorUserId: string,
  query: { page?: number; limit?: number; status?: string; type?: string; studentUserId?: string } = {}
) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;
  const { profileIds, profileMap } = await getCounsellorStudentProfileContext(counsellorUserId);
  if (profileIds.length === 0) return { data: [], total: 0, page, limit, totalPages: 0 };

  let scopedProfileIds = profileIds;
  if (query.studentUserId && mongoose.Types.ObjectId.isValid(query.studentUserId)) {
    const profile = await StudentProfile.findOne({
      userId: query.studentUserId,
      counsellorUserId: new mongoose.Types.ObjectId(counsellorUserId),
    }).select('_id').lean();
    scopedProfileIds = profile ? [profile._id] : [];
  }
  if (scopedProfileIds.length === 0) return { data: [], total: 0, page, limit, totalPages: 0 };

  const where: Record<string, unknown> = {
    studentId: { $in: scopedProfileIds },
    deletedByUniversityAt: null,
  };
  if (query.status) where.status = query.status;
  if (query.type === 'offer' || query.type === 'scholarship') where.type = query.type;

  const [documents, total] = await Promise.all([
    StudentIssuedDocument.find(where)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('universityId', 'universityName logoUrl city country')
      .lean(),
    StudentIssuedDocument.countDocuments(where),
  ]);

  const data = documents.map((document: Record<string, unknown>) => {
    const studentProfileId = String(document.studentId ?? '');
    const student = profileMap.get(studentProfileId);
    const university = document.universityId as { _id?: unknown; universityName?: string; logoUrl?: string; city?: string; country?: string } | undefined;
    return {
      id: String(document._id),
      type: document.type,
      status: document.status,
      title: document.title,
      universityMessage: document.universityMessage,
      sentAt: document.sentAt,
      viewedAt: document.viewedAt,
      decisionAt: document.decisionAt,
      postponeUntil: document.postponeUntil,
      expiresAt: document.expiresAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      studentProfileId,
      studentUserId: student?.userId ?? '',
      studentName: student?.studentName ?? 'Student',
      studentEmail: student?.studentEmail ?? '',
      universityId: university?._id != null ? String(university._id) : String(document.universityId ?? ''),
      university: university
        ? {
            name: university.universityName ?? 'University',
            logoUrl: university.logoUrl,
            city: university.city,
            country: university.country,
          }
        : undefined,
    };
  });

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

/** Search existing students (by email/name) who are not in this counsellor's school. For invite flow. */
export async function searchStudentsForInvite(
  counsellorUserId: string,
  params: { search: string; limit?: number }
) {
  const user = await User.findById(counsellorUserId);
  if (!user || user.role !== 'school_counsellor') {
    // For safety, if user is not a counsellor just return no results
    return { data: [] };
  }
  const search = (params.search ?? '').trim();
  if (!search || search.length < 2) {
    return { data: [] };
  }
  const limit = Math.min(20, Math.max(1, params.limit ?? 10));
  const studentUsers = await User.find({
    role: 'student',
    $or: [
      { email: new RegExp(escapeRegex(search), 'i') },
      { name: new RegExp(escapeRegex(search), 'i') },
    ],
  })
    .select('_id email name')
    .limit(limit * 2)
    .lean();
  const myProfileStudentIds = await StudentProfile.find({
    counsellorUserId: new mongoose.Types.ObjectId(counsellorUserId),
  })
    .select('userId')
    .lean();
  const myStudentIds = new Set(myProfileStudentIds.map((p: { userId?: unknown }) => String(p.userId)));
  const pendingInvitationStudentIds = await SchoolInvitation.find({
    counsellorUserId: new mongoose.Types.ObjectId(counsellorUserId),
    status: 'pending',
  })
    .select('studentUserId')
    .lean();
  const pendingIds = new Set(pendingInvitationStudentIds.map((p: { studentUserId?: unknown }) => String(p.studentUserId)));
  const data = studentUsers
    .filter((u: { _id: unknown }) => !myStudentIds.has(String(u._id)) && !pendingIds.has(String(u._id)))
    .slice(0, limit)
    .map((u: Record<string, unknown>) => ({
      id: String(u._id),
      email: String(u.email ?? ''),
      name: String(u.name ?? ''),
    }));
  return { data };
}

/** Invite existing student to this school: send invitation (pending). Student must accept or decline. Until then, school cannot access student data. */
export async function inviteStudentToSchool(counsellorUserId: string, studentUserId: string) {
  const user = await User.findById(counsellorUserId);
  if (!user || user.role !== 'school_counsellor') {
    throw new AppError(403, 'Not a school counsellor', ErrorCodes.FORBIDDEN);
  }
  const studentUser = await User.findById(studentUserId);
  if (!studentUser) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  if (studentUser.role !== 'student') {
    throw new AppError(400, 'Only students can be invited to a school', ErrorCodes.VALIDATION);
  }
  const existingLink = await StudentProfile.findOne({ userId: studentUserId, counsellorUserId: counsellorUserId });
  if (existingLink) {
    return { success: true, message: 'Already in your school' };
  }
  let invitation = await SchoolInvitation.findOne({ counsellorUserId, studentUserId });
  if (invitation) {
    if (invitation.status === 'pending') {
      throw new AppError(409, 'Invitation already sent. Waiting for student response.', ErrorCodes.CONFLICT);
    }
    if (invitation.status === 'accepted') {
      return { success: true, message: 'Already in your school' };
    }
    if (invitation.status === 'declined') {
      await SchoolInvitation.findByIdAndUpdate(invitation._id, { status: 'pending', respondedAt: undefined });
    }
  } else {
    const created = await SchoolInvitation.create({
      counsellorUserId: new mongoose.Types.ObjectId(counsellorUserId),
      studentUserId: new mongoose.Types.ObjectId(studentUserId),
      status: 'pending',
    });
    invitation = created;
  }
  const invitationId = String(invitation._id);
  const profile = await CounsellorProfile.findOne({ userId: counsellorUserId }).lean();
  const schoolName = (profile as { schoolName?: string })?.schoolName ?? 'A school';
  await notificationService.createNotification(studentUserId, {
    type: 'school_invitation',
    title: 'School invitation',
    body: `${schoolName} invited you to join. You can accept or decline.`,
    referenceType: 'school_invitation',
    referenceId: invitationId,
    metadata: { counsellorUserId, schoolName },
  });
  return { success: true, message: 'Invitation sent. The student can accept or decline.' };
}

/** List invitations sent by this counsellor (pending = awaiting student response; accepted/declined = already responded). */
export async function listMyInvitations(counsellorUserId: string, params?: { status?: 'pending' | 'accepted' | 'declined'; page?: number; limit?: number }) {
  const user = await User.findById(counsellorUserId);
  if (!user || user.role !== 'school_counsellor') {
    throw new AppError(403, 'Not a school counsellor', ErrorCodes.FORBIDDEN);
  }
  const page = Math.max(1, params?.page ?? 1);
  const limit = Math.min(50, Math.max(1, params?.limit ?? 20));
  const skip = (page - 1) * limit;
  const where: Record<string, unknown> = { counsellorUserId: new mongoose.Types.ObjectId(counsellorUserId) };
  if (params?.status) where.status = params.status;
  const [list, total] = await Promise.all([
    SchoolInvitation.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    SchoolInvitation.countDocuments(where),
  ]);
  const studentIds = list.map((r: Record<string, unknown>) => r.studentUserId).filter(Boolean);
  const users = await User.find({ _id: { $in: studentIds } }).select('email name').lean();
  const userMap = new Map(users.map((u: Record<string, unknown>) => [String(u._id), u]));
  const data = list.map((r: Record<string, unknown>) => {
    const u = userMap.get(String(r.studentUserId)) as { email?: string; name?: string } | undefined;
    return {
      id: String(r._id),
      studentUserId: String(r.studentUserId),
      status: r.status,
      createdAt: r.createdAt,
      respondedAt: r.respondedAt,
      studentEmail: u?.email ?? '',
      studentName: u?.name ?? '',
    };
  });
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

/** Cancel a pending school invitation (counsellor can withdraw the invite). */
export async function cancelSchoolInvitation(counsellorUserId: string, invitationId: string) {
  const user = await User.findById(counsellorUserId);
  if (!user || user.role !== 'school_counsellor') {
    throw new AppError(403, 'Not a school counsellor', ErrorCodes.FORBIDDEN);
  }
  const invitation = await SchoolInvitation.findOne({ _id: invitationId, counsellorUserId });
  if (!invitation) {
    throw new AppError(404, 'Invitation not found', ErrorCodes.NOT_FOUND);
  }
  if (invitation.status !== 'pending') {
    throw new AppError(400, 'Only pending invitations can be cancelled', ErrorCodes.VALIDATION);
  }
  await SchoolInvitation.findByIdAndDelete(invitationId);
  return { success: true, message: 'Invitation cancelled.' };
}

/** Student accepts school invitation. Links student to school and notifies counsellor. */
export async function acceptSchoolInvitation(studentUserId: string, invitationId: string) {
  const invitation = await SchoolInvitation.findOne({ _id: invitationId, studentUserId });
  if (!invitation) throw new AppError(404, 'Invitation not found', ErrorCodes.NOT_FOUND);
  if (invitation.status !== 'pending') {
    throw new AppError(400, 'Invitation already responded to', ErrorCodes.VALIDATION);
  }
  const counsellorUserId = String(invitation.counsellorUserId);
  await SchoolInvitation.findByIdAndUpdate(invitationId, { status: 'accepted', respondedAt: new Date() });
  let profile = await StudentProfile.findOne({ userId: studentUserId });
  if (profile) {
    await StudentProfile.findByIdAndUpdate(profile._id, { counsellorUserId: new mongoose.Types.ObjectId(counsellorUserId) });
  } else {
    await StudentProfile.create({
      userId: studentUserId,
      counsellorUserId: new mongoose.Types.ObjectId(counsellorUserId),
    });
  }
  const counsellorProfile = await CounsellorProfile.findOne({ userId: counsellorUserId }).lean();
  const schoolName = (counsellorProfile as { schoolName?: string })?.schoolName ?? 'School';
  const studentUser = await User.findById(studentUserId).select('name email').lean();
  const studentName = (studentUser as { name?: string; email?: string })?.name ?? (studentUser as { email?: string })?.email ?? 'A student';
  await notificationService.createNotification(counsellorUserId, {
    type: 'school_invitation_accepted',
    title: 'Invitation accepted',
    body: `${studentName} accepted your invitation to join ${schoolName}.`,
    referenceType: 'school_invitation',
    referenceId: invitationId,
    metadata: { studentUserId },
  });
  return { success: true, message: 'You have joined the school.' };
}

/** Student declines school invitation. Notifies counsellor. */
export async function declineSchoolInvitation(studentUserId: string, invitationId: string) {
  const invitation = await SchoolInvitation.findOne({ _id: invitationId, studentUserId });
  if (!invitation) throw new AppError(404, 'Invitation not found', ErrorCodes.NOT_FOUND);
  if (invitation.status !== 'pending') {
    throw new AppError(400, 'Invitation already responded to', ErrorCodes.VALIDATION);
  }
  const counsellorUserId = String(invitation.counsellorUserId);
  await SchoolInvitation.findByIdAndUpdate(invitationId, { status: 'declined', respondedAt: new Date() });
  const counsellorProfile = await CounsellorProfile.findOne({ userId: counsellorUserId }).lean();
  const schoolName = (counsellorProfile as { schoolName?: string })?.schoolName ?? 'School';
  const studentUser = await User.findById(studentUserId).select('name email').lean();
  const studentName = (studentUser as { name?: string; email?: string })?.name ?? (studentUser as { email?: string })?.email ?? 'A student';
  await notificationService.createNotification(counsellorUserId, {
    type: 'school_invitation_declined',
    title: 'Invitation declined',
    body: `${studentName} declined your invitation to join ${schoolName}.`,
    referenceType: 'school_invitation',
    referenceId: invitationId,
    metadata: { studentUserId },
  });
  return { success: true, message: 'Invitation declined.' };
}

/** List pending school invitations for a student (invitations sent to this student). */
export async function listSchoolInvitationsForStudent(studentUserId: string) {
  const list = await SchoolInvitation.find({ studentUserId, status: 'pending' })
    .sort({ createdAt: -1 })
    .lean();
  const counsellorIds = list.map((r: Record<string, unknown>) => r.counsellorUserId).filter(Boolean);
  const profiles = await CounsellorProfile.find({ userId: { $in: counsellorIds } }).lean();
  const profileMap = new Map(profiles.map((p: Record<string, unknown>) => [String(p.userId), p]));
  return list.map((r: Record<string, unknown>) => {
    const profile = profileMap.get(String(r.counsellorUserId)) as { schoolName?: string; city?: string; country?: string } | undefined;
    return {
      id: String(r._id),
      counsellorUserId: String(r.counsellorUserId),
      schoolName: profile?.schoolName ?? '',
      city: profile?.city ?? '',
      country: profile?.country ?? '',
      createdAt: r.createdAt,
    };
  });
}

/** List documents of a student (counsellor must own the student). */
export async function getStudentDocuments(counsellorUserId: string, studentUserId: string) {
  await assertStudentBelongsToCounsellor(studentUserId, counsellorUserId);
  const studentDocumentService = await import('./studentDocument.service');
  return studentDocumentService.getMyDocuments(studentUserId);
}

/** Add document for a student (counsellor adds with status approved). */
export async function addDocumentForStudent(
  counsellorUserId: string,
  studentUserId: string,
  data: {
    type: string;
    source?: 'upload' | 'editor';
    fileUrl?: string;
    name?: string;
    certificateType?: string;
    score?: string;
    previewImageUrl?: string;
    canvasJson?: string;
    pageFormat?: 'A4_PORTRAIT' | 'A4_LANDSCAPE' | 'LETTER' | 'CUSTOM';
    width?: number;
    height?: number;
    editorVersion?: string;
  }
) {
  await assertStudentBelongsToCounsellor(studentUserId, counsellorUserId);
  const studentDocumentService = await import('./studentDocument.service');
  return studentDocumentService.addDocument(studentUserId, data);
}

/** Update a document of a student (counsellor must own the student). */
export async function updateDocumentForStudent(
  counsellorUserId: string,
  studentUserId: string,
  documentId: string,
  data: {
    type?: string;
    source?: 'upload' | 'editor';
    fileUrl?: string;
    name?: string;
    certificateType?: string;
    score?: string;
    previewImageUrl?: string;
    canvasJson?: string;
    pageFormat?: 'A4_PORTRAIT' | 'A4_LANDSCAPE' | 'LETTER' | 'CUSTOM';
    width?: number;
    height?: number;
    editorVersion?: string;
  }
) {
  await assertStudentBelongsToCounsellor(studentUserId, counsellorUserId);
  const studentDocumentService = await import('./studentDocument.service');
  return studentDocumentService.updateDocument(studentUserId, documentId, data as {
    type: string;
    source?: 'upload' | 'editor';
    fileUrl?: string;
    name?: string;
    certificateType?: string;
    score?: string;
    previewImageUrl?: string;
    canvasJson?: string;
    pageFormat?: 'A4_PORTRAIT' | 'A4_LANDSCAPE' | 'LETTER' | 'CUSTOM';
    width?: number;
    height?: number;
    editorVersion?: string;
  });
}

/** Delete a document of a student (counsellor must own the student). */
export async function deleteDocumentForStudent(counsellorUserId: string, studentUserId: string, documentId: string) {
  await assertStudentBelongsToCounsellor(studentUserId, counsellorUserId);
  const studentDocumentService = await import('./studentDocument.service');
  return studentDocumentService.deleteDocument(studentUserId, documentId);
}
