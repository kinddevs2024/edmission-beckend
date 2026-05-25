import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import {
  Faculty,
  Program,
  Scholarship,
  UniversityCatalog,
  UniversityDocument,
  UniversityProfile,
  User,
} from '../models';
import { AppError, ErrorCodes } from '../utils/errors';

const BCRYPT_ROUNDS = 12;

async function copyCatalogChildren(catalog: Record<string, unknown>, profileId: unknown) {
  for (const p of (Array.isArray(catalog.programs) ? catalog.programs : []) as Array<Record<string, unknown>>) {
    await Program.create({
      universityId: profileId,
      name: p.name,
      degreeLevel: p.degreeLevel,
      field: p.field,
      durationYears: p.durationYears,
      tuitionFee: p.tuitionFee,
      language: p.language,
      entryRequirements: p.entryRequirements,
    });
  }

  for (const s of (Array.isArray(catalog.scholarships) ? catalog.scholarships : []) as Array<Record<string, unknown>>) {
    await Scholarship.create({
      universityId: profileId,
      name: s.name,
      coveragePercent: s.coveragePercent,
      maxSlots: s.maxSlots,
      remainingSlots: s.maxSlots,
      deadline: s.deadline,
      eligibility: s.eligibility,
    });
  }

  for (const faculty of (Array.isArray(catalog.customFaculties) ? catalog.customFaculties : []) as Array<Record<string, unknown>>) {
    await Faculty.create({
      universityId: profileId,
      name: faculty.name,
      description: faculty.description,
      items: Array.isArray(faculty.items) ? faculty.items : [],
      order: faculty.order,
    });
  }

  for (const document of (Array.isArray(catalog.documents) ? catalog.documents : []) as Array<Record<string, unknown>>) {
    await UniversityDocument.create({
      universityId: profileId,
      documentType: document.documentType,
      fileUrl: document.fileUrl,
      status: document.status,
      reviewedBy: document.reviewedBy,
      reviewedAt: document.reviewedAt,
    });
  }
}

async function createProfileFromCatalog(catalog: Record<string, unknown>, userId: unknown) {
  const profile = await UniversityProfile.create({
    userId,
    universityName: String(catalog.universityName ?? ''),
    tagline: catalog.tagline,
    establishedYear: catalog.establishedYear,
    studentCount: catalog.studentCount,
    country: catalog.country,
    city: catalog.city,
    description: catalog.description,
    rating: catalog.rating,
    logoUrl: catalog.logoUrl,
    verified: true,
    onboardingCompleted: true,
    facultyCodes: Array.isArray(catalog.facultyCodes) ? catalog.facultyCodes : [],
    facultyItems: catalog.facultyItems ?? undefined,
    targetStudentCountries: Array.isArray(catalog.targetStudentCountries) ? catalog.targetStudentCountries : [],
    minLanguageLevel: catalog.minLanguageLevel,
    tuitionPrice: catalog.tuitionPrice,
    ieltsMinBand: catalog.ieltsMinBand,
    gpaMinMode: catalog.gpaMinMode,
    gpaMinValue: catalog.gpaMinValue,
  });

  await copyCatalogChildren(catalog, profile._id);
  return profile;
}

export async function ensureCatalogUniversityAccount(catalogId: string): Promise<string | null> {
  if (!mongoose.Types.ObjectId.isValid(catalogId)) return null;
  const catalog = await UniversityCatalog.findById(catalogId).lean();
  if (!catalog) return null;

  const linkedProfileId = String((catalog as { linkedUniversityProfileId?: unknown }).linkedUniversityProfileId ?? '');
  if (mongoose.Types.ObjectId.isValid(linkedProfileId)) {
    const linkedProfile = await UniversityProfile.findById(linkedProfileId).select('userId').lean();
    if (linkedProfile?.userId) return String((linkedProfile as { userId: unknown }).userId);
  }

  const existingProfile = await UniversityProfile.findOne({
    universityName: (catalog as { universityName?: string }).universityName,
    country: (catalog as { country?: string }).country,
    city: (catalog as { city?: string }).city,
  })
    .select('_id userId')
    .lean();
  if (existingProfile?.userId) {
    await UniversityCatalog.findByIdAndUpdate(catalogId, {
      linkedUniversityProfileId: (existingProfile as { _id: unknown })._id,
    }).catch(() => undefined);
    return String((existingProfile as { userId: unknown }).userId);
  }

  const technicalEmail = `catalog-${catalogId}@edmission.local`;
  const passwordHash = await bcrypt.hash(`catalog-${catalogId}-${Date.now()}`, BCRYPT_ROUNDS);
  const technicalUser = await User.findOneAndUpdate(
    { email: technicalEmail },
    {
      $setOnInsert: {
        email: technicalEmail,
        passwordHash,
        role: 'university',
        name: String((catalog as { universityName?: string }).universityName ?? ''),
        emailVerified: true,
      },
    },
    { new: true, upsert: true }
  ).lean();

  let profile = await UniversityProfile.findOne({ userId: (technicalUser as { _id: unknown })._id }).select('_id userId').lean();
  if (!profile) {
    profile = (await createProfileFromCatalog(catalog as unknown as Record<string, unknown>, (technicalUser as { _id: unknown })._id)).toObject();
  }

  await UniversityCatalog.findByIdAndUpdate(catalogId, {
    linkedUniversityProfileId: (profile as { _id: unknown })._id,
  }).catch(() => undefined);

  return String((technicalUser as { _id: unknown })._id);
}

export async function resolveActAsUniversityUserId(rawId: string): Promise<string | null> {
  if (!mongoose.Types.ObjectId.isValid(rawId)) return null;

  const universityUser = await User.findOne({ _id: rawId, role: 'university' }).select('_id').lean();
  if (universityUser) return String((universityUser as { _id: unknown })._id);

  const profile = await UniversityProfile.findById(rawId).select('userId').lean();
  if (profile?.userId) return String((profile as { userId: unknown }).userId);

  return ensureCatalogUniversityAccount(rawId);
}

export type UniversityActAsOption = {
  userId: string;
  universityName: string;
  logoUrl?: string;
  verified: boolean;
  source: 'profile' | 'catalog';
};

export async function listAllUniversityActAsOptions(): Promise<UniversityActAsOption[]> {
  const [profiles, catalogs] = await Promise.all([
    UniversityProfile.find({})
      .select('userId universityName logoUrl verified')
      .sort({ universityName: 1 })
      .lean(),
    UniversityCatalog.find({})
      .select('universityName logoUrl country city linkedUniversityProfileId')
      .sort({ universityName: 1 })
      .lean(),
  ]);

  const byProfileId = new Map<string, Record<string, unknown>>();
  for (const profile of profiles as Array<Record<string, unknown>>) {
    byProfileId.set(String(profile._id), profile);
  }

  const options = new Map<string, UniversityActAsOption>();
  for (const profile of profiles as Array<Record<string, unknown>>) {
    const userId = String(profile.userId ?? '');
    if (!userId) continue;
    options.set(userId, {
      userId,
      universityName: String(profile.universityName ?? ''),
      logoUrl: profile.logoUrl ? String(profile.logoUrl) : undefined,
      verified: Boolean(profile.verified),
      source: 'profile',
    });
  }

  for (const catalog of catalogs as Array<Record<string, unknown>>) {
    const linkedProfileId = String(catalog.linkedUniversityProfileId ?? '');
    const linkedProfile = linkedProfileId ? byProfileId.get(linkedProfileId) : undefined;
    const userId = linkedProfile?.userId ? String(linkedProfile.userId) : String(catalog._id ?? '');
    if (!userId || options.has(userId)) continue;
    options.set(userId, {
      userId,
      universityName: String(catalog.universityName ?? ''),
      logoUrl: catalog.logoUrl ? String(catalog.logoUrl) : undefined,
      verified: linkedProfile ? Boolean(linkedProfile.verified) : true,
      source: 'catalog',
    });
  }

  return [...options.values()].sort((a, b) => a.universityName.localeCompare(b.universityName));
}

export function assertResolvedUniversityUserId(userId: string | null): string {
  if (!userId) {
    throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
  }
  return userId;
}
