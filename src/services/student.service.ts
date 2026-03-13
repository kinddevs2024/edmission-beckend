import mongoose from 'mongoose';
import {
  StudentProfile,
  UniversityProfile,
  UniversityCatalog,
  Program,
  Scholarship,
  Faculty,
  Interest,
  CatalogInterest,
  Offer,
  Recommendation,
  Chat,
} from '../models';
import * as notificationService from './notification.service';
import * as subscriptionService from './subscription.service';
import { filterSkills, filterInterests, filterHobbies } from '../constants/profileCriteria';
import { AppError, ErrorCodes } from '../utils/errors';
import { toObjectIdString, toObjectIdStrings } from '../utils/objectId';

/** Minimal profile: name, surname, where born (country/city), where studied (educationStatus + at least one schoolsAttended or legacy school fields). */
function isMinimalPortfolioComplete(doc: Record<string, unknown>): boolean {
  const hasName = (doc.firstName != null && String(doc.firstName).trim() !== '') || (doc.lastName != null && String(doc.lastName).trim() !== '');
  const hasLocation = (doc.country != null && String(doc.country).trim() !== '') || (doc.city != null && String(doc.city).trim() !== '');
  const status = doc.educationStatus as string | undefined;
  const schools = Array.isArray(doc.schoolsAttended) ? doc.schoolsAttended as Array<Record<string, unknown>> : [];
  const hasSchoolEntry = schools.some((s) => (s.institutionName != null && String(s.institutionName).trim() !== ''));
  const legacyEducation = (doc.schoolName != null && String(doc.schoolName).trim() !== '') || (doc.gradeLevel != null && String(doc.gradeLevel).trim() !== '') || (doc.graduationYear != null);
  const hasEducation = hasSchoolEntry || legacyEducation;
  return Boolean(hasName && hasLocation && hasEducation);
}

function computePortfolioCompletion(doc: Record<string, unknown>): number {
  const sections = [
    (doc.firstName != null && String(doc.firstName).trim() !== '') || (doc.lastName != null && String(doc.lastName).trim() !== ''),
    (doc.country != null && String(doc.country).trim() !== '') || (doc.city != null && String(doc.city).trim() !== ''),
    (doc.gradeLevel != null && String(doc.gradeLevel).trim() !== '') || (doc.gpa != null) || (doc.languageLevel != null && String(doc.languageLevel).trim() !== '') || (Array.isArray(doc.languages) && doc.languages.length > 0) || doc.schoolCompleted === true || (doc.schoolName != null && String(doc.schoolName).trim() !== '') || (doc.graduationYear != null),
    (doc.bio != null && String(doc.bio).trim() !== '') || (doc.avatarUrl != null && String(doc.avatarUrl).trim() !== ''),
    Array.isArray(doc.skills) && doc.skills.length > 0,
    (Array.isArray(doc.interests) && doc.interests.length > 0) || (Array.isArray(doc.hobbies) && doc.hobbies.length > 0),
    Array.isArray(doc.experiences) && doc.experiences.length > 0,
    Array.isArray(doc.portfolioWorks) && doc.portfolioWorks.length > 0,
  ];
  const filled = sections.filter(Boolean).length;
  return Math.round((filled / sections.length) * 100);
}

export async function getProfile(userId: string) {
  const profile = await StudentProfile.findOne({ userId })
    .lean();
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);
  const user = await mongoose.model('User').findById(userId).select('email emailVerified').lean() as Record<string, unknown> | null;
  const profileObj = profile as Record<string, unknown>;
  const portfolioCompletionPercent = computePortfolioCompletion(profileObj);
  const minimalPortfolioComplete = isMinimalPortfolioComplete(profileObj);
  return {
    ...profile,
    id: String(profileObj._id),
    portfolioCompletionPercent,
    minimalPortfolioComplete,
    verifiedAt: profileObj.verifiedAt,
    user: user ? { email: String(user.email), emailVerified: Boolean(user.emailVerified) } : undefined,
  };
}

export async function updateProfile(userId: string, data: Record<string, unknown>) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const update: Record<string, unknown> = { needsRecalculation: true };
  if (data.firstName !== undefined) update.firstName = String(data.firstName);
  if (data.lastName !== undefined) update.lastName = String(data.lastName);
  if (data.birthDate !== undefined) update.birthDate = data.birthDate ? new Date(data.birthDate as string) : null;
  if (data.country !== undefined) update.country = String(data.country);
  if (data.city !== undefined) update.city = String(data.city);
  if (data.gradeLevel !== undefined) update.gradeLevel = String(data.gradeLevel);
  if (data.gpa !== undefined) update.gpa = Number(data.gpa);
  if (data.languageLevel !== undefined) update.languageLevel = String(data.languageLevel);
  if (data.languages !== undefined) {
    update.languages = Array.isArray(data.languages)
      ? (data.languages as Array<{ language?: string; level?: string }>)
          .filter((x) => x && String(x.language || '').trim() && String(x.level || '').trim())
          .slice(0, 20)
          .map((x) => ({ language: String(x.language).trim(), level: String(x.level).trim() }))
      : [];
  }
  if (data.bio !== undefined) update.bio = String(data.bio);
  if (data.avatarUrl !== undefined) update.avatarUrl = String(data.avatarUrl);
  if (data.budgetAmount !== undefined) update.budgetAmount = data.budgetAmount != null && data.budgetAmount !== '' ? Number(data.budgetAmount) : null;
  if (data.budgetCurrency !== undefined) update.budgetCurrency = data.budgetCurrency != null && String(data.budgetCurrency).trim() !== '' ? String(data.budgetCurrency).trim() : 'USD';
  if (data.educationStatus !== undefined) {
    const v = data.educationStatus as string;
    update.educationStatus = ['in_school', 'finished_school', 'in_university', 'finished_university'].includes(v) ? v : null;
  }
  if (data.schoolCompleted !== undefined) update.schoolCompleted = Boolean(data.schoolCompleted);
  if (data.schoolName !== undefined) update.schoolName = String(data.schoolName);
  if (data.graduationYear !== undefined) update.graduationYear = data.graduationYear != null ? Number(data.graduationYear) : null;
  if (data.gradingScheme !== undefined) update.gradingScheme = data.gradingScheme != null ? String(data.gradingScheme) : null;
  if (data.gradeScale !== undefined) update.gradeScale = data.gradeScale != null ? Number(data.gradeScale) : null;
  if (data.highestEducationLevel !== undefined) update.highestEducationLevel = data.highestEducationLevel != null ? String(data.highestEducationLevel) : null;
  if (data.targetDegreeLevel !== undefined) update.targetDegreeLevel = ['bachelor', 'master', 'phd'].includes(String(data.targetDegreeLevel)) ? data.targetDegreeLevel : null;
  const MAX_SCHOOLS = 10;
  if (data.schoolsAttended !== undefined) update.schoolsAttended = Array.isArray(data.schoolsAttended)
    ? (data.schoolsAttended as Array<Record<string, unknown>>).slice(0, MAX_SCHOOLS).map((s) => ({
        country: s.country != null ? String(s.country) : undefined,
        institutionName: s.institutionName != null ? String(s.institutionName) : undefined,
        institutionType: (s.institutionType === 'school' || s.institutionType === 'university') ? s.institutionType : undefined,
        educationLevel: s.educationLevel != null ? String(s.educationLevel) : undefined,
        gradingScheme: s.gradingScheme != null ? String(s.gradingScheme) : undefined,
        gradeScale: s.gradeScale != null ? Number(s.gradeScale) : undefined,
        gradeAverage: s.gradeAverage != null ? Number(s.gradeAverage) : undefined,
        primaryLanguage: s.primaryLanguage != null ? String(s.primaryLanguage) : undefined,
        attendedFrom: s.attendedFrom ? new Date(s.attendedFrom as string) : undefined,
        attendedTo: s.attendedTo ? new Date(s.attendedTo as string) : undefined,
        degreeName: s.degreeName != null ? String(s.degreeName) : undefined,
      }))
    : [];
  const MAX_SKILLS = 50;
  const MAX_INTERESTS = 30;
  const MAX_HOBBIES = 30;
  const MAX_EXPERIENCES = 20;
  const MAX_WORKS = 20;
  if (data.skills !== undefined) {
    const arr = Array.isArray(data.skills) ? data.skills.map((s) => String(s)).slice(0, MAX_SKILLS) : [];
    update.skills = filterSkills(arr);
  }
  if (data.interests !== undefined) {
    const arr = Array.isArray(data.interests) ? data.interests.map((s) => String(s)).slice(0, MAX_INTERESTS) : [];
    update.interests = filterInterests(arr);
  }
  if (data.hobbies !== undefined) {
    const arr = Array.isArray(data.hobbies) ? data.hobbies.map((s) => String(s)).slice(0, MAX_HOBBIES) : [];
    update.hobbies = filterHobbies(arr);
  }
  if (data.experiences !== undefined) update.experiences = Array.isArray(data.experiences)
    ? (data.experiences as Array<Record<string, unknown>>).slice(0, MAX_EXPERIENCES).map((e) => ({
        type: e.type,
        title: e.title != null ? String(e.title) : undefined,
        organization: e.organization != null ? String(e.organization) : undefined,
        startDate: e.startDate ? new Date(e.startDate as string) : undefined,
        endDate: e.endDate ? new Date(e.endDate as string) : undefined,
        description: e.description != null ? String(e.description) : undefined,
      }))
    : [];
  if (data.portfolioWorks !== undefined) update.portfolioWorks = Array.isArray(data.portfolioWorks)
    ? (data.portfolioWorks as Array<Record<string, unknown>>).slice(0, MAX_WORKS).map((w) => ({
        title: w.title != null ? String(w.title) : undefined,
        description: w.description != null ? String(w.description) : undefined,
        fileUrl: w.fileUrl != null ? String(w.fileUrl) : undefined,
        linkUrl: w.linkUrl != null ? String(w.linkUrl) : undefined,
      }))
    : [];

  const merged = { ...(profile.toObject ? profile.toObject() : profile), ...update } as Record<string, unknown>;
  update.portfolioCompletionPercent = computePortfolioCompletion(merged);

  if (data.interestedFaculties !== undefined) {
    const arr = Array.isArray(data.interestedFaculties) ? data.interestedFaculties : [];
    update.interestedFaculties = arr.map((s) => String(s)).filter((s) => s.trim()).slice(0, 30);
  }
  if (data.preferredCountries !== undefined) {
    const arr = Array.isArray(data.preferredCountries) ? data.preferredCountries : [];
    update.preferredCountries = arr.map((s) => String(s)).filter((s) => s.trim()).slice(0, 30);
  }

  const updated = await StudentProfile.findByIdAndUpdate(profile._id, update, { new: true }).lean();
  return { ...updated, id: String((updated as { _id: unknown })._id) };
}

export async function getDashboard(userId: string) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const [recommendations, interests, offers] = await Promise.all([
    Recommendation.find({ studentId: profile._id })
      .sort({ matchScore: -1 })
      .limit(5)
      .populate('universityId', 'universityName country city')
      .lean(),
    Interest.find({ studentId: profile._id })
      .populate('universityId', 'universityName')
      .lean(),
    Offer.find({ studentId: profile._id })
      .populate('universityId', 'universityName')
      .populate('scholarshipId', 'name')
      .lean(),
  ]);

  const chatCount = await Chat.countDocuments({ studentId: profile._id });

  const mapRec = (r: Record<string, unknown>) => {
    const uni = r.universityId as { universityName?: string; country?: string; city?: string } | undefined;
    return { ...r, id: String(r._id), university: uni ? { universityName: uni.universityName, country: uni.country, city: uni.city } : undefined };
  };
  const mapInt = (i: Record<string, unknown>) => {
    const uni = i.universityId as { universityName?: string } | undefined;
    return { ...i, id: String(i._id), university: uni ? { universityName: uni.universityName } : undefined };
  };
  const mapOff = (o: Record<string, unknown>) => {
    const uni = o.universityId as { universityName?: string } | undefined;
    const sch = o.scholarshipId as { name?: string; coveragePercent?: number } | undefined;
    return { ...o, id: String(o._id), university: uni ? { universityName: uni.universityName } : undefined, scholarship: sch ? { name: sch.name, coveragePercent: sch.coveragePercent } : undefined };
  };

  return {
    profile: { portfolioCompletionPercent: profile.portfolioCompletionPercent },
    topRecommendations: recommendations.map((r) => mapRec(r as Record<string, unknown>)),
    applications: interests.map((i) => mapInt(i as Record<string, unknown>)),
    offers: offers.map((o) => mapOff(o as Record<string, unknown>)),
    chatCount,
  };
}

export async function getUniversities(
  userId: string,
  query: { page?: number; limit?: number; country?: string; city?: string; useProfileFilters?: boolean }
) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const useProfileFilters = query.useProfileFilters !== false;

  const baseWhere: { country?: string | { $in: string[] }; city?: string; facultyCodes?: unknown } = {};
  if (query.country) baseWhere.country = query.country;
  if (query.city && String(query.city).trim()) baseWhere.city = String(query.city).trim();
  if (useProfileFilters) {
    const preferredCountries = Array.isArray((profile as { preferredCountries?: string[] }).preferredCountries)
      ? ((profile as { preferredCountries?: string[] }).preferredCountries ?? []).filter(Boolean)
      : [];
    if (preferredCountries.length > 0) baseWhere.country = { $in: preferredCountries };
    const interestedFaculties = Array.isArray((profile as { interestedFaculties?: string[] }).interestedFaculties)
      ? ((profile as { interestedFaculties?: string[] }).interestedFaculties ?? []).filter(Boolean)
      : [];
    if (interestedFaculties.length > 0) baseWhere.facultyCodes = { $in: interestedFaculties };
  }

  const [catalogs, profiles] = await Promise.all([
    UniversityCatalog.find({ ...baseWhere, linkedUniversityProfileId: { $exists: false } }).sort({ universityName: 1 }).lean(),
    UniversityProfile.find({ ...baseWhere, verified: true }).sort({ universityName: 1 }).lean(),
  ]);

  const catalogItems = catalogs.map((c) => {
    const id = `catalog-${String((c as { _id: unknown })._id)}`;
    const raw = c as unknown as Record<string, unknown>;
    const progs = Array.isArray(raw.programs) ? raw.programs : [];
    const schs = Array.isArray(raw.scholarships) ? raw.scholarships : [];
    const logoUrl = (c as { logoUrl?: string }).logoUrl;
    return {
      _id: (c as { _id: unknown })._id,
      id,
      _source: 'catalog' as const,
      name: (c as { universityName?: string }).universityName ?? '',
      universityName: (c as { universityName?: string }).universityName ?? '',
      country: (c as { country?: string }).country,
      city: (c as { city?: string }).city,
      description: (c as { description?: string }).description,
      logo: logoUrl,
      logoUrl,
      hasScholarship: schs.length > 0,
      programs: progs.slice(0, 3).map((p, i) => ({ ...p, id: `p-${i}` })),
      matchScore: null,
      breakdown: null,
    };
  });

  const profileIds = profiles.map((u) => (u as { _id: unknown })._id);
  const recs = await Recommendation.find({ studentId: profile._id, universityId: { $in: profileIds } }).lean();
  const recMap: Record<string, { matchScore: number; breakdown?: unknown }> = {};
  for (const r of recs) {
    const uid = String((r as { universityId: unknown }).universityId);
    recMap[uid] = { matchScore: (r as { matchScore: number }).matchScore, breakdown: (r as { breakdown?: unknown }).breakdown };
  }

  const scholarshipCounts = await Scholarship.aggregate([
    { $match: { universityId: { $in: profileIds } } },
    { $group: { _id: '$universityId', count: { $sum: 1 } } },
  ]);
  const schCountMap: Record<string, number> = {};
  for (const s of scholarshipCounts) schCountMap[String(s._id)] = s.count;

  const programsByUni = await Program.aggregate([
    { $match: { universityId: { $in: profileIds } } },
    { $sort: { createdAt: 1 } },
    { $group: { _id: '$universityId', programs: { $push: '$$ROOT' } } },
  ]);
  const programsMap: Record<string, unknown[]> = {};
  for (const p of programsByUni) programsMap[String(p._id)] = (p.programs as unknown[]).slice(0, 3);

  const profileItems = profiles.map((u) => {
    const id = String((u as { _id: unknown })._id);
    const logoUrl = (u as { logoUrl?: string }).logoUrl;
    return {
      ...u,
      id,
      _source: 'profile' as const,
      name: (u as { universityName?: string }).universityName ?? '',
      universityName: (u as { universityName?: string }).universityName ?? '',
      logo: logoUrl,
      hasScholarship: (schCountMap[id] ?? 0) > 0,
      programs: programsMap[id] ?? [],
      matchScore: recMap[id]?.matchScore ?? null,
      breakdown: recMap[id]?.breakdown ?? null,
    };
  });

  const merged = [...catalogItems, ...profileItems].sort((a, b) =>
    (a.name ?? '').localeCompare(b.name ?? '')
  );
  const total = merged.length;
  const dataWithCount = merged.slice(skip, skip + limit);

  return {
    data: dataWithCount,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getUniversityById(userId: string, universityId: unknown) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const idStr = String(universityId ?? '').trim();
  if (idStr.startsWith('catalog-')) {
    const catalogId = toObjectIdString(idStr.replace(/^catalog-/, ''));
    if (!catalogId) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
    const catalog = await UniversityCatalog.findById(catalogId).lean();
    if (!catalog) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
    if ((catalog as { linkedUniversityProfileId?: unknown }).linkedUniversityProfileId) {
      throw new AppError(404, 'University no longer available', ErrorCodes.NOT_FOUND);
    }
    const catalogInterest = await CatalogInterest.findOne({
      studentId: profile._id,
      catalogUniversityId: catalogId,
    }).lean();
    const raw = catalog as unknown as Record<string, unknown>;
    const progs = Array.isArray(raw.programs) ? raw.programs : [];
    const schs = Array.isArray(raw.scholarships) ? raw.scholarships : [];
    const establishedYear = (catalog as { establishedYear?: number }).establishedYear;
    const tagline = (catalog as { tagline?: string }).tagline;
    const catalogLogoUrl = (catalog as { logoUrl?: string }).logoUrl;
    return {
      ...catalog,
      id: `catalog-${String((catalog as { _id: unknown })._id)}`,
      name: (catalog as { universityName?: string }).universityName ?? '',
      foundedYear: establishedYear,
      slogan: tagline,
      logo: catalogLogoUrl,
      logoUrl: catalogLogoUrl,
      programs: progs.map((p, i) => ({ ...p, id: String(i) })),
      scholarships: schs.map((s, i) => ({ ...s, id: String(i) })),
      faculties: [],
      matchScore: null,
      breakdown: null,
      interest: catalogInterest ? { ...catalogInterest, id: String((catalogInterest as { _id: unknown })._id) } : null,
    };
  }

  const uid = toObjectIdString(universityId);
  if (!uid) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
  const university = await UniversityProfile.findById(uid).lean();
  if (!university) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);

  const rec = await Recommendation.findOne({ studentId: profile._id, universityId: uid }).lean();
  const interest = await Interest.findOne({ studentId: profile._id, universityId: uid }).lean();
  const programs = await Program.find({ universityId: uid }).lean();
  const scholarships = await Scholarship.find({ universityId: uid }).lean();
  const faculties = await Faculty.find({ universityId: uid }).sort({ order: 1, name: 1 }).lean();

  return {
    ...university,
    id: String((university as { _id: unknown })._id),
    name: (university as { universityName?: string }).universityName ?? '',
    programs,
    scholarships,
    faculties: faculties.map((f) => ({ ...f, id: String((f as { _id: unknown })._id) })),
    matchScore: rec ? (rec as { matchScore: number }).matchScore : null,
    breakdown: rec ? (rec as { breakdown?: unknown }).breakdown : null,
    interest: interest ? { ...interest, id: String((interest as { _id: unknown })._id) } : null,
  };
}

export async function addInterest(userId: string, universityId: unknown) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const subscription = await subscriptionService.canSendApplication(userId);
  if (!subscription.allowed) {
    if (subscription.trialExpired) {
      throw new AppError(402, 'Trial expired. Upgrade to a paid plan to continue sending applications.', ErrorCodes.PAYMENT_REQUIRED);
    }
    throw new AppError(402, `Application limit reached (${subscription.current}/${subscription.limit ?? '?'}). Upgrade your plan to send more.`, ErrorCodes.PAYMENT_REQUIRED);
  }

  const idStr = String(universityId ?? '').trim();
  if (idStr.startsWith('catalog-')) {
    const catalogId = toObjectIdString(idStr.replace(/^catalog-/, ''));
    if (!catalogId) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
    const catalog = await UniversityCatalog.findById(catalogId);
    if (!catalog) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
    if ((catalog as { linkedUniversityProfileId?: unknown }).linkedUniversityProfileId) {
      throw new AppError(404, 'University no longer available', ErrorCodes.NOT_FOUND);
    }
    const interest = await CatalogInterest.findOneAndUpdate(
      { studentId: profile._id, catalogUniversityId: catalogId },
      { status: 'interested' },
      { upsert: true, new: true }
    ).lean();
    const adminUsers = await mongoose.model('User').find({ role: 'admin' }).select('_id').lean();
    const studentName = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Student';
    const catalogName = (catalog as { universityName?: string }).universityName ?? 'Catalog university';
    for (const admin of adminUsers as { _id: unknown }[]) {
      const adminId = String(admin._id);
      await notificationService.createNotification(adminId, {
        type: 'interest',
        title: 'New interest (catalog)',
        body: `${studentName} is interested in ${catalogName} (template)`,
        referenceType: 'catalog_interest',
        referenceId: String((interest as { _id: unknown })._id),
        metadata: { studentId: String(profile._id), studentName, catalogUniversityId: catalogId, catalogName },
      });
    }
    return { ...interest, id: String((interest as { _id: unknown })._id) };
  }

  const uid = toObjectIdString(universityId);
  if (!uid) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
  const uni = await UniversityProfile.findById(uid);
  if (!uni) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);

  const interest = await Interest.findOneAndUpdate(
    { studentId: profile._id, universityId: uid },
    { status: 'interested' },
    { upsert: true, new: true }
  ).lean();
  const universityUserId = (uni as { userId?: unknown }).userId ? String((uni as { userId: unknown }).userId) : null;
  const studentName = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Student';
  if (universityUserId) {
    await notificationService.createNotification(universityUserId, {
      type: 'interest',
      title: 'New interest',
      body: `${studentName} is interested in your university`,
      referenceType: 'interest',
      referenceId: String((interest as { _id: unknown })._id),
      metadata: { studentId: String(profile._id), studentName },
    });
  }
  return { ...interest, id: String((interest as { _id: unknown })._id) };
}

export async function getInterestLimit(userId: string) {
  return subscriptionService.canSendApplication(userId);
}

/** Lightweight: returns only university IDs the student has shown interest in (profile ids + catalog-xxx). */
export async function getInterestedUniversityIds(userId: string): Promise<string[]> {
  const profile = await StudentProfile.findOne({ userId }).select('_id').lean();
  if (!profile) return [];
  const [interests, catalogInterests] = await Promise.all([
    Interest.find({ studentId: profile._id }).select('universityId').lean(),
    CatalogInterest.find({ studentId: profile._id }).populate('catalogUniversityId', '_id').lean(),
  ]);
  const profileIds = interests.map((i: { universityId?: unknown }) => String(i.universityId)).filter(Boolean);
  const catalogIds = catalogInterests
    .map((i: { catalogUniversityId?: { _id?: unknown } }) => (i.catalogUniversityId as { _id?: unknown })?._id)
    .filter(Boolean)
    .map((id: unknown) => `catalog-${id}`);
  return [...profileIds, ...catalogIds];
}

export async function getApplications(userId: string) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const [interests, catalogInterests] = await Promise.all([
    Interest.find({ studentId: profile._id }).populate('universityId', 'universityName country city').lean(),
    CatalogInterest.find({ studentId: profile._id }).populate('catalogUniversityId', 'universityName country city').lean(),
  ]);

  const profileApps = interests.map((i: Record<string, unknown>) => {
    const uni = i.universityId as { _id?: unknown; universityName?: string; country?: string; city?: string } | undefined;
    const universityIdStr = uni?._id != null ? String(uni._id) : i.universityId != null ? String(i.universityId) : '';
    return {
      ...i,
      id: String(i._id),
      universityId: universityIdStr,
      university: uni ? { universityName: uni.universityName, country: uni.country, city: uni.city } : undefined,
      _source: 'profile' as const,
    };
  });

  const catalogApps = catalogInterests.map((i: Record<string, unknown>) => {
    const cat = i.catalogUniversityId as { _id?: unknown; universityName?: string; country?: string; city?: string } | undefined;
    const universityIdStr = cat?._id != null ? `catalog-${String(cat._id)}` : '';
    return {
      ...i,
      id: String(i._id),
      universityId: universityIdStr,
      university: cat ? { universityName: cat.universityName, country: cat.country, city: cat.city } : undefined,
      _source: 'catalog' as const,
    };
  });

  return [...profileApps, ...catalogApps].sort(
    (a, b) => new Date((b as { createdAt?: Date }).createdAt ?? 0).getTime() - new Date((a as { createdAt?: Date }).createdAt ?? 0).getTime()
  );
}

export async function getOffers(userId: string) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const list = await Offer.find({ studentId: profile._id })
    .populate('universityId', 'universityName')
    .populate('scholarshipId', 'name coveragePercent')
    .lean();
  return list.map((o: Record<string, unknown>) => {
    const uni = o.universityId as { universityName?: string } | undefined;
    const sch = o.scholarshipId as { name?: string; coveragePercent?: number } | undefined;
    return {
      ...o,
      id: String(o._id),
      university: uni ? { universityName: uni.universityName } : undefined,
      scholarship: sch ? { name: sch.name, coveragePercent: sch.coveragePercent } : undefined,
    };
  });
}

export async function acceptOffer(userId: string, offerId: string) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const offer = await Offer.findById(offerId).populate('scholarshipId');
  if (!offer || String(offer.studentId) !== String(profile._id)) throw new AppError(404, 'Offer not found', ErrorCodes.NOT_FOUND);
  if (offer.status !== 'pending') throw new AppError(400, 'Offer already processed', ErrorCodes.CONFLICT);
  const offerUniId = toObjectIdString(offer.universityId);
  if (!offerUniId) throw new AppError(404, 'Offer invalid', ErrorCodes.NOT_FOUND);

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await Offer.findByIdAndUpdate(offerId, { status: 'accepted' }, { session });
    await Interest.updateMany(
      { studentId: profile._id, universityId: offerUniId },
      { status: 'accepted' },
      { session }
    );
    // Slot was already reserved when the offer was created; no need to decrement again
    await session.commitTransaction();
  } finally {
    session.endSession();
  }

  const universityProfile = await UniversityProfile.findById(offerUniId).lean();
  const universityUserId = universityProfile && (universityProfile as { userId?: unknown }).userId
    ? String((universityProfile as { userId: unknown }).userId)
    : null;
  const studentName = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Student';
  if (universityUserId) {
    await notificationService.createNotification(universityUserId, {
      type: 'offer_accepted',
      title: 'Offer accepted',
      body: `${studentName} accepted your offer`,
      referenceType: 'offer',
      referenceId: offerId,
      metadata: { offerId, studentName },
    });
  }

  const updated = await Offer.findById(offerId).lean();
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}

export async function declineOffer(userId: string, offerId: string) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const offer = await Offer.findOne({ _id: offerId, studentId: profile._id });
  if (!offer) throw new AppError(404, 'Offer not found', ErrorCodes.NOT_FOUND);
  if (offer.status !== 'pending') throw new AppError(400, 'Offer already processed', ErrorCodes.CONFLICT);

  await Offer.findByIdAndUpdate(offerId, { status: 'declined' });
  // Return the scholarship slot when offer is declined
  if (offer.scholarshipId) {
    await Scholarship.findByIdAndUpdate(offer.scholarshipId, { $inc: { remainingSlots: 1 } });
  }

  const offerUniId = toObjectIdString(offer.universityId);
  const universityProfile = offerUniId ? await UniversityProfile.findById(offerUniId).lean() : null;
  const universityUserId = universityProfile && (universityProfile as { userId?: unknown }).userId
    ? String((universityProfile as { userId: unknown }).userId)
    : null;
  const studentName = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Student';
  if (universityUserId) {
    await notificationService.createNotification(universityUserId, {
      type: 'offer_declined',
      title: 'Offer declined',
      body: `${studentName} declined your offer`,
      referenceType: 'offer',
      referenceId: offerId,
      metadata: { offerId, studentName },
    });
  }

  const updated = await Offer.findById(offerId).lean();
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}

export async function getRecommendations(userId: string) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const list = await Recommendation.find({ studentId: profile._id })
    .sort({ matchScore: -1 })
    .populate('universityId')
    .lean();
  return list.map((r) => ({
    ...r,
    id: String((r as { _id: unknown })._id),
    university: (r as { universityId?: unknown }).universityId,
  }));
}

export async function getCompare(userId: string, ids: unknown[]) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);
  const rawIds = (Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean);
  if (!rawIds.length || rawIds.length > 5) {
    throw new AppError(400, 'Provide 1-5 university ids', ErrorCodes.VALIDATION);
  }

  const catalogIds = rawIds.filter((id) => id.startsWith('catalog-')).map((id) => toObjectIdString(id.replace(/^catalog-/, ''))).filter(Boolean);
  const profileIds = rawIds.filter((id) => !id.startsWith('catalog-'));
  const normalizedProfileIds = toObjectIdStrings(profileIds);

  const [catalogs, universities] = await Promise.all([
    catalogIds.length > 0
      ? UniversityCatalog.find({ _id: { $in: catalogIds }, linkedUniversityProfileId: { $exists: false } }).lean()
      : [],
    normalizedProfileIds.length > 0
      ? UniversityProfile.find({ _id: { $in: normalizedProfileIds } }).lean()
      : [],
  ]);

  const recs = await Recommendation.find({
    studentId: profile._id,
    universityId: { $in: normalizedProfileIds },
  }).lean();
  const recMap: Record<string, { matchScore: number; breakdown?: unknown }> = {};
  for (const r of recs) {
    const uid = String((r as { universityId: unknown }).universityId);
    recMap[uid] = { matchScore: (r as { matchScore: number }).matchScore, breakdown: (r as { breakdown?: unknown }).breakdown };
  }

  const catalogItems = catalogs.map((c) => {
    const id = `catalog-${String((c as { _id: unknown })._id)}`;
    const schs = (c as { scholarships?: unknown[] }).scholarships ?? [];
    return {
      ...c,
      id,
      name: (c as { universityName?: string }).universityName ?? '',
      hasScholarship: schs.length > 0,
      matchScore: null,
      breakdown: null,
    };
  });

  const schCounts = normalizedProfileIds.length > 0
    ? await Scholarship.aggregate([
        { $match: { universityId: { $in: normalizedProfileIds } } },
        { $group: { _id: '$universityId', count: { $sum: 1 } } },
      ])
    : [];
  const schCountMap: Record<string, number> = {};
  for (const s of schCounts) schCountMap[String(s._id)] = s.count;

  const profileItems = universities.map((u) => {
    const id = String((u as { _id: unknown })._id);
    return {
      ...u,
      id,
      name: (u as { universityName?: string }).universityName ?? '',
      hasScholarship: (schCountMap[id] ?? 0) > 0,
      matchScore: recMap[id]?.matchScore ?? null,
      breakdown: recMap[id]?.breakdown ?? null,
    };
  });

  const idToItem = new Map<string, Record<string, unknown>>();
  for (const item of catalogItems) idToItem.set((item as { id: string }).id, item);
  for (const item of profileItems) idToItem.set((item as { id: string }).id, item);

  return rawIds.map((id) => idToItem.get(id)).filter(Boolean);
}
