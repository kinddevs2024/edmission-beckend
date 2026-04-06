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
  UniversityFlyer,
  StudentDocument,
} from '../models';
import { getEffectiveIeltsMinBand } from '../utils/admissionRequirements';
import * as notificationService from './notification.service';
import * as subscriptionService from './subscription.service';
import { ensureStudentProfile } from './studentProfile.service';
import { calculateMatchScore } from './matching.service';
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
  const ensuredProfile = await ensureStudentProfile(userId);
  const profile = await StudentProfile.findById(ensuredProfile._id).lean();
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
  const profile = await ensureStudentProfile(userId);

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
  if (data.profileVisibility !== undefined) {
    const v = String(data.profileVisibility);
    update.profileVisibility = v === 'public' ? 'public' : 'private';
  }

  const updated = await StudentProfile.findByIdAndUpdate(profile._id, update, { new: true }).lean();
  return { ...updated, id: String((updated as { _id: unknown })._id) };
}

export async function getDashboard(userId: string) {
  const profile = await ensureStudentProfile(userId);

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

type StudentUniversitiesQuery = {
  page?: number;
  limit?: number;
  country?: string;
  search?: string;
  sort?: string;
  hasScholarship?: boolean;
  facultyCodes?: string[];
  degreeLevels?: string[];
  programLanguages?: string[];
  targetStudentCountries?: string[];
  minTuition?: number;
  maxTuition?: number;
  minEstablishedYear?: number;
  maxEstablishedYear?: number;
  minStudentCount?: number;
  maxStudentCount?: number;
  requirementsQuery?: string;
  programQuery?: string;
  useProfileFilters?: boolean;
};

type SearchableUniversityItem = {
  id: string;
  _source: 'catalog' | 'profile';
  name: string;
  universityName: string;
  country?: string;
  city?: string;
  description?: string;
  logo?: string;
  logoUrl?: string;
  hasScholarship: boolean;
  matchScore: number | null;
  breakdown?: unknown;
  minLanguageLevel?: string;
  tuitionPrice?: number;
  ieltsMinBand?: number;
  gpaMinMode?: 'scale' | 'percent';
  gpaMinValue?: number;
  facultyCodes: string[];
  targetStudentCountries: string[];
  programs: Array<Record<string, unknown>>;
  scholarships: Array<Record<string, unknown>>;
  faculties: Array<Record<string, unknown>>;
  tagline?: string;
  establishedYear?: number;
  studentCount?: number;
  rating?: number;
  createdAt?: Date;
};

export async function getUniversities(
  userId: string,
  query: StudentUniversitiesQuery
) {
  const profile = await ensureStudentProfile(userId);
  const profileObject = profile.toObject ? profile.toObject() : profile;
  if (!isMinimalPortfolioComplete(profileObject as Record<string, unknown>)) {
    return {
      data: [],
      total: 0,
      page: Math.max(1, query.page || 1),
      limit: Math.min(50, Math.max(1, query.limit || 20)),
      totalPages: 0,
    };
  }

  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const useProfileFilters = query.useProfileFilters !== false;

  const studentCountry = typeof (profile as { country?: string }).country === 'string'
    ? (profile as { country?: string }).country?.trim() ?? ''
    : '';
  const preferredCountries = Array.isArray((profile as { preferredCountries?: string[] }).preferredCountries)
    ? ((profile as { preferredCountries?: string[] }).preferredCountries ?? []).filter(Boolean)
    : [];
  const interestedFaculties = Array.isArray((profile as { interestedFaculties?: string[] }).interestedFaculties)
    ? ((profile as { interestedFaculties?: string[] }).interestedFaculties ?? []).filter(Boolean)
    : [];
  const explicitFacultyCodes = normalizeStringArray(query.facultyCodes);
  const explicitCountry = typeof query.country === 'string' && query.country.trim() ? query.country.trim() : '';

  const baseWhere: { country?: string } = {};
  if (explicitCountry) {
    baseWhere.country = explicitCountry;
  }

  const [catalogs, profiles, interestedProfileIds, interestedCatalogIds] = await Promise.all([
    UniversityCatalog.find({ ...baseWhere, linkedUniversityProfileId: { $exists: false } }).sort({ universityName: 1 }).lean(),
    UniversityProfile.find({ ...baseWhere, verified: true }).sort({ universityName: 1 }).lean(),
    Interest.find({ studentId: profile._id }).select('universityId').lean(),
    CatalogInterest.find({ studentId: profile._id }).select('catalogUniversityId').lean(),
  ]);
  const interestedProfileIdSet = new Set(interestedProfileIds.map((row) => String((row as { universityId?: unknown }).universityId ?? '')).filter(Boolean));
  const interestedCatalogIdSet = new Set(interestedCatalogIds.map((row) => String((row as { catalogUniversityId?: unknown }).catalogUniversityId ?? '')).filter(Boolean));

  const catalogItems: SearchableUniversityItem[] = catalogs.map((c) => {
    const id = `catalog-${String((c as { _id: unknown })._id)}`;
    const raw = c as unknown as Record<string, unknown>;
    const progs = Array.isArray(raw.programs) ? raw.programs as Array<Record<string, unknown>> : [];
    const schs = Array.isArray(raw.scholarships) ? raw.scholarships as Array<Record<string, unknown>> : [];
    const logoUrl = (c as { logoUrl?: string }).logoUrl;
    return {
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
      programs: progs.map((program, index) => mapStudentProgram(program, index)),
      scholarships: schs.map((scholarship, index) => mapStudentScholarship(scholarship, index)),
      faculties: [],
      facultyCodes: Array.isArray((c as { facultyCodes?: string[] }).facultyCodes) ? ((c as { facultyCodes?: string[] }).facultyCodes ?? []).filter(Boolean) : [],
      targetStudentCountries: Array.isArray((c as { targetStudentCountries?: string[] }).targetStudentCountries)
        ? ((c as { targetStudentCountries?: string[] }).targetStudentCountries ?? []).filter(Boolean)
        : [],
      matchScore: null,
      breakdown: null,
      minLanguageLevel: (c as { minLanguageLevel?: string }).minLanguageLevel,
      tuitionPrice: (c as { tuitionPrice?: number }).tuitionPrice,
      ieltsMinBand: (c as { ieltsMinBand?: number }).ieltsMinBand,
      gpaMinMode: (() => {
        const m = (c as { gpaMinMode?: string }).gpaMinMode;
        return m === 'scale' || m === 'percent' ? m : undefined;
      })(),
      gpaMinValue: (c as { gpaMinValue?: number }).gpaMinValue,
      tagline: (c as { tagline?: string }).tagline,
      establishedYear: (c as { establishedYear?: number }).establishedYear,
      studentCount: (c as { studentCount?: number }).studentCount,
      rating: (c as { rating?: number }).rating,
      createdAt: (c as { createdAt?: Date }).createdAt,
    };
  });

  const profileIds = profiles.map((u) => (u as { _id: unknown })._id);
  const [recs, scholarships, programs, faculties, linkedCatalogs] = await Promise.all([
    Recommendation.find({ studentId: profile._id, universityId: { $in: profileIds } }).lean(),
    profileIds.length > 0 ? Scholarship.find({ universityId: { $in: profileIds } }).sort({ createdAt: 1 }).lean() : [],
    profileIds.length > 0 ? Program.find({ universityId: { $in: profileIds } }).sort({ createdAt: 1 }).lean() : [],
    profileIds.length > 0 ? Faculty.find({ universityId: { $in: profileIds } }).sort({ order: 1, name: 1 }).lean() : [],
    profileIds.length > 0 ? UniversityCatalog.find({ linkedUniversityProfileId: { $in: profileIds } }).lean() : [],
  ]);
  const recMap: Record<string, { matchScore: number; breakdown?: unknown }> = {};
  for (const r of recs) {
    const uid = String((r as { universityId: unknown }).universityId);
    recMap[uid] = { matchScore: (r as { matchScore: number }).matchScore, breakdown: (r as { breakdown?: unknown }).breakdown };
  }

  const scholarshipMap: Record<string, Array<Record<string, unknown>>> = {};
  for (const scholarship of scholarships) {
    const universityId = String((scholarship as { universityId: unknown }).universityId);
    if (!scholarshipMap[universityId]) scholarshipMap[universityId] = [];
    scholarshipMap[universityId].push(scholarship as unknown as Record<string, unknown>);
  }

  const programsMap: Record<string, Array<Record<string, unknown>>> = {};
  for (const program of programs) {
    const universityId = String((program as { universityId: unknown }).universityId);
    if (!programsMap[universityId]) programsMap[universityId] = [];
    programsMap[universityId].push(program as unknown as Record<string, unknown>);
  }

  const facultiesMap: Record<string, Array<Record<string, unknown>>> = {};
  for (const faculty of faculties) {
    const universityId = String((faculty as { universityId: unknown }).universityId);
    if (!facultiesMap[universityId]) facultiesMap[universityId] = [];
    facultiesMap[universityId].push(faculty as unknown as Record<string, unknown>);
  }

  const linkedCatalogMap: Record<string, Record<string, unknown>> = {};
  for (const catalog of linkedCatalogs) {
    const linkedProfileId = (catalog as { linkedUniversityProfileId?: unknown }).linkedUniversityProfileId;
    if (!linkedProfileId) continue;
    linkedCatalogMap[String(linkedProfileId)] = catalog as unknown as Record<string, unknown>;
  }

  const profileItems: SearchableUniversityItem[] = profiles.map((u) => {
    const id = String((u as { _id: unknown })._id);
    const linkedCatalog = linkedCatalogMap[id];
    const universityPrograms = mergeProgramsWithCatalog(
      programsMap[id] ?? [],
      mapCatalogPrograms(linkedCatalog)
    ).map((program, index) => mapStudentProgram(program, index));
    const universityScholarships = mergeScholarshipsWithCatalog(
      scholarshipMap[id] ?? [],
      mapCatalogScholarships(linkedCatalog)
    ).map((scholarship, index) => mapStudentScholarship(scholarship, index));
    const universityFaculties = (facultiesMap[id] ?? []).length > 0 ? (facultiesMap[id] ?? []) : mapCatalogFaculties(linkedCatalog);
    const logoUrl = pickString((u as { logoUrl?: string }).logoUrl, linkedCatalog?.logoUrl);
    return {
      id,
      _source: 'profile' as const,
      name: pickString((u as { universityName?: string }).universityName, linkedCatalog?.universityName) ?? '',
      universityName: pickString((u as { universityName?: string }).universityName, linkedCatalog?.universityName) ?? '',
      country: pickString((u as { country?: string }).country, linkedCatalog?.country),
      city: pickString((u as { city?: string }).city, linkedCatalog?.city),
      description: pickString((u as { description?: string }).description, linkedCatalog?.description),
      logo: logoUrl,
      logoUrl,
      hasScholarship: universityScholarships.length > 0,
      programs: universityPrograms,
      scholarships: universityScholarships,
      faculties: universityFaculties,
      facultyCodes: pickStringArray((u as { facultyCodes?: string[] }).facultyCodes, linkedCatalog?.facultyCodes),
      targetStudentCountries: pickStringArray((u as { targetStudentCountries?: string[] }).targetStudentCountries, linkedCatalog?.targetStudentCountries),
      minLanguageLevel: pickString((u as { minLanguageLevel?: string }).minLanguageLevel, linkedCatalog?.minLanguageLevel),
      tuitionPrice: pickNumber((u as { tuitionPrice?: number }).tuitionPrice, linkedCatalog?.tuitionPrice),
      ieltsMinBand: pickNumber((u as { ieltsMinBand?: number }).ieltsMinBand, linkedCatalog?.ieltsMinBand),
      gpaMinMode: (() => {
        const raw =
          (u as { gpaMinMode?: string }).gpaMinMode ?? (linkedCatalog as { gpaMinMode?: string } | undefined)?.gpaMinMode;
        return raw === 'scale' || raw === 'percent' ? raw : undefined;
      })(),
      gpaMinValue: pickNumber((u as { gpaMinValue?: number }).gpaMinValue, linkedCatalog?.gpaMinValue),
      tagline: pickString((u as { tagline?: string }).tagline, linkedCatalog?.tagline),
      establishedYear: pickNumber((u as { establishedYear?: number }).establishedYear, linkedCatalog?.establishedYear),
      studentCount: pickNumber((u as { studentCount?: number }).studentCount, linkedCatalog?.studentCount),
      rating: (u as { rating?: number }).rating,
      createdAt: (u as { createdAt?: Date }).createdAt,
      matchScore: recMap[id]?.matchScore ?? null,
      breakdown: recMap[id]?.breakdown ?? null,
    };
  });

  const merged = [...catalogItems, ...profileItems]
    .filter((item) => {
      if (item._source === 'catalog') {
        const rawId = item.id.replace(/^catalog-/, '');
        return !interestedCatalogIdSet.has(rawId);
      }
      return !interestedProfileIdSet.has(item.id);
    })
    .filter((item) => {
      if (!useProfileFilters) return true;
      if (!explicitCountry) {
        const preferredSet = new Set(
          [
            studentCountry,
            ...preferredCountries,
          ]
            .map((value) => String(value ?? '').trim().toLowerCase())
            .filter(Boolean)
        );
        if (preferredSet.size > 0) {
          const universityTargetCountries = (item.targetStudentCountries ?? [])
            .map((value) => String(value ?? '').trim().toLowerCase())
            .filter(Boolean);
          if (universityTargetCountries.length === 0) return false;
          if (!universityTargetCountries.some((country) => preferredSet.has(country))) return false;
        }
      }
      if (explicitFacultyCodes.length > 0 || interestedFaculties.length === 0) {
        return true;
      }
      return item.facultyCodes.some((code) => interestedFaculties.includes(code));
    })
    .map((item) => {
      const match = calculateMatchScore(
        profileObject as Parameters<typeof calculateMatchScore>[0],
        {
          country: item.country,
          city: item.city,
          facultyCodes: item.facultyCodes,
          minLanguageLevel: item.minLanguageLevel,
          tuitionPrice: resolveTuitionPrice(item),
          programs: item.programs.map((program) => ({
            field: String(program.field ?? ''),
            language: program.language != null ? String(program.language) : undefined,
            tuitionFee: typeof (program.tuitionFee ?? program.tuition) === 'number' ? Number(program.tuitionFee ?? program.tuition) : undefined,
            degreeLevel: program.degreeLevel != null ? String(program.degreeLevel) : undefined,
            degree: program.degree != null ? String(program.degree) : undefined,
            entryRequirements: program.entryRequirements != null ? String(program.entryRequirements) : undefined,
          })),
          scholarships: item.scholarships.map((scholarship) => ({
            eligibility: scholarship.eligibility != null ? String(scholarship.eligibility) : undefined,
          })),
        }
      );
      return {
        ...item,
        matchScore: match.score,
        breakdown: match.breakdown,
        isSuitable: match.isSuitable,
      };
    })
    .filter((item) => matchesUniversityFilters(item, query));

  const strictMatches = merged
    .filter((item) => item.isSuitable)
    .sort((left, right) => compareUniversities(left, right, query.sort));

  /** When nothing passes isSuitable, still show a short ranked list (explore UI expects ~6 cards). */
  const FALLBACK_UNIVERSITIES_CAP = 6;
  const fallbackMatches = merged
    .slice()
    .sort((left, right) =>
      compareFallbackUniversities(
        left as Record<string, unknown>,
        right as Record<string, unknown>,
        profileObject as Record<string, unknown>
      )
    )
    .slice(0, FALLBACK_UNIVERSITIES_CAP);

  const visibleUniversities = strictMatches.length > 0 ? strictMatches : fallbackMatches;

  const total = visibleUniversities.length;
  const dataWithCount = visibleUniversities
    .slice(skip, skip + limit)
    .map((item) => ({
      id: item.id,
      name: item.name,
      universityName: item.universityName,
      country: item.country,
      city: item.city,
      description: item.description,
      hasScholarship: item.hasScholarship,
      logo: item.logo,
      logoUrl: item.logoUrl,
      matchScore: item.matchScore,
      breakdown: item.breakdown,
      matchBreakdown: item.breakdown,
      minLanguageLevel: item.minLanguageLevel,
      tuitionPrice: resolveTuitionPrice(item),
      ieltsMinBand: item.ieltsMinBand,
      gpaMinMode: item.gpaMinMode,
      gpaMinValue: item.gpaMinValue,
      facultyCodes: item.facultyCodes,
      targetStudentCountries: item.targetStudentCountries,
      foundedYear: item.establishedYear,
      studentCount: item.studentCount,
      rating: item.rating,
      programs: item.programs.slice(0, 3).map((program, index) => ({ ...program, id: program.id ?? `p-${index}` })),
      scholarships: item.scholarships.slice(0, 3),
      _source: item._source,
    }));

  return {
    data: dataWithCount,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getUniversityCountries(): Promise<string[]> {
  const [catalogCountries, profileCountries] = await Promise.all([
    UniversityCatalog.distinct('country', { country: { $exists: true, $ne: '' } }),
    UniversityProfile.distinct('country', { verified: true, country: { $exists: true, $ne: '' } }),
  ]);

  return Array.from(
    new Set(
      [...catalogCountries, ...profileCountries]
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeStringArray(values?: string[]) {
  return Array.isArray(values)
    ? values.map((value) => String(value).trim()).filter(Boolean)
    : [];
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function countryClosenessScore(universityCountry: unknown, studentProfile: Record<string, unknown>) {
  const uniCountry = normalizeString(universityCountry);
  if (!uniCountry) return 0;

  const studentCountry = normalizeString(studentProfile.country);
  if (studentCountry && uniCountry === studentCountry) return 3;

  const preferredCountries = Array.isArray(studentProfile.preferredCountries)
    ? (studentProfile.preferredCountries as unknown[]).map((value) => normalizeString(value)).filter(Boolean)
    : [];
  if (preferredCountries.includes(uniCountry)) return 2;

  return 0;
}

function compareFallbackUniversities(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  studentProfile: Record<string, unknown>
) {
  const leftCountryScore = countryClosenessScore(left.country, studentProfile);
  const rightCountryScore = countryClosenessScore(right.country, studentProfile);
  if (rightCountryScore !== leftCountryScore) return rightCountryScore - leftCountryScore;

  const leftMatch = typeof left.matchScore === 'number' ? left.matchScore : 0;
  const rightMatch = typeof right.matchScore === 'number' ? right.matchScore : 0;
  if (rightMatch !== leftMatch) return rightMatch - leftMatch;

  const leftScholarship = left.hasScholarship ? 1 : 0;
  const rightScholarship = right.hasScholarship ? 1 : 0;
  if (rightScholarship !== leftScholarship) return rightScholarship - leftScholarship;

  const leftRating = typeof left.rating === 'number' ? left.rating : 0;
  const rightRating = typeof right.rating === 'number' ? right.rating : 0;
  if (rightRating !== leftRating) return rightRating - leftRating;

  return compareUniversities(
    left as SearchableUniversityItem,
    right as SearchableUniversityItem,
    'match'
  );
}

function hasStringValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function hasFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function pickString(primary: unknown, fallback: unknown) {
  return hasStringValue(primary) ? primary : hasStringValue(fallback) ? fallback : undefined;
}

function pickNumber(primary: unknown, fallback: unknown) {
  return hasFiniteNumber(primary) ? primary : hasFiniteNumber(fallback) ? fallback : undefined;
}

function pickStringArray(primary: unknown, fallback: unknown) {
  const normalize = (value: unknown) =>
    Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
  const primaryList = normalize(primary);
  if (primaryList.length > 0) return primaryList;
  const fallbackList = normalize(fallback);
  return fallbackList.length > 0 ? fallbackList : [];
}

function mapCatalogPrograms(catalog: Record<string, unknown> | null | undefined) {
  return Array.isArray(catalog?.programs)
    ? (catalog.programs as Array<Record<string, unknown>>)
    : [];
}

function mapCatalogScholarships(catalog: Record<string, unknown> | null | undefined) {
  return Array.isArray(catalog?.scholarships)
    ? (catalog.scholarships as Array<Record<string, unknown>>)
    : [];
}

function mapCatalogFaculties(catalog: Record<string, unknown> | null | undefined) {
  const faculties = Array.isArray(catalog?.customFaculties)
    ? (catalog.customFaculties as Array<Record<string, unknown>>)
    : [];
  return faculties.map((faculty, index) => ({
    ...faculty,
    id: String(faculty._id ?? `catalog-faculty-${index}`),
    name: String(faculty.name ?? ''),
    description: faculty.description != null ? String(faculty.description) : '',
    items: Array.isArray(faculty.items) ? faculty.items.map((item) => String(item)).filter(Boolean) : [],
    order: faculty.order != null ? Number(faculty.order) : index,
  }));
}

function programMergeKey(program: Record<string, unknown>): string {
  const name = String(program.name ?? '').trim().toLowerCase();
  const field = String(program.field ?? '').trim().toLowerCase();
  const degree = String(program.degreeLevel ?? program.degree ?? '').trim().toLowerCase();
  return `${name}|${field}|${degree}`;
}

/** Keep profile programs and add catalog-only rows (linked universities often have partial profile + full catalog). */
function mergeProgramsWithCatalog(
  profilePrograms: Array<Record<string, unknown>>,
  catalogPrograms: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  if (!catalogPrograms.length) return profilePrograms;
  if (!profilePrograms.length) return catalogPrograms;
  const seen = new Set(profilePrograms.map(programMergeKey));
  const extras = catalogPrograms.filter((program) => !seen.has(programMergeKey(program)));
  return [...profilePrograms, ...extras];
}

function scholarshipMergeKey(scholarship: Record<string, unknown>): string {
  const name = String(scholarship.name ?? '').trim().toLowerCase();
  const coverage = String(scholarship.coveragePercent ?? '');
  const maxSlots = String(scholarship.maxSlots ?? '');
  return `${name}|${coverage}|${maxSlots}`;
}

function resolveScholarshipDeadlineRaw(row: Record<string, unknown>): unknown {
  return row.deadline ?? row.applicationDeadline ?? row.applicationDate;
}

function parseDeadlineToIso(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  const text = String(value).trim();
  if (!text || text.toLowerCase() === 'invalid date') return undefined;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function hasParsableDeadline(row: Record<string, unknown>): boolean {
  return parseDeadlineToIso(resolveScholarshipDeadlineRaw(row)) != null;
}

function enrichScholarshipFromCatalog(
  profileRow: Record<string, unknown>,
  catalogRow: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...profileRow };
  if (!hasParsableDeadline(out) && hasParsableDeadline(catalogRow)) {
    out.deadline = catalogRow.deadline ?? catalogRow.applicationDeadline ?? catalogRow.applicationDate;
  }
  const elig = out.eligibility;
  if (elig == null || String(elig).trim() === '') {
    if (catalogRow.eligibility != null && String(catalogRow.eligibility).trim() !== '') {
      out.eligibility = catalogRow.eligibility;
    }
  }
  return out;
}

function mergeScholarshipsWithCatalog(
  profileScholarships: Array<Record<string, unknown>>,
  catalogScholarships: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  if (!catalogScholarships.length) return profileScholarships;
  if (!profileScholarships.length) return catalogScholarships;
  const merged = new Map<string, Record<string, unknown>>();
  for (const scholarship of profileScholarships) {
    merged.set(scholarshipMergeKey(scholarship), { ...scholarship });
  }
  for (const scholarship of catalogScholarships) {
    const key = scholarshipMergeKey(scholarship);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...scholarship });
    } else {
      merged.set(key, enrichScholarshipFromCatalog(existing, scholarship));
    }
  }
  return Array.from(merged.values());
}

function mapStudentScholarship(scholarship: Record<string, unknown>, index: number): Record<string, unknown> {
  const rawDeadline = resolveScholarshipDeadlineRaw(scholarship);
  const deadlineIso = parseDeadlineToIso(rawDeadline);
  const maxSlots =
    typeof scholarship.maxSlots === 'number' && Number.isFinite(scholarship.maxSlots)
      ? scholarship.maxSlots
      : Number(scholarship.maxSlots) || 0;
  let remainingSlots = scholarship.remainingSlots;
  if (typeof remainingSlots !== 'number' || !Number.isFinite(remainingSlots)) {
    const used =
      typeof scholarship.usedSlots === 'number' && Number.isFinite(scholarship.usedSlots)
        ? scholarship.usedSlots
        : 0;
    remainingSlots = Math.max(0, maxSlots - used);
  }
  const coveragePercent =
    typeof scholarship.coveragePercent === 'number' && Number.isFinite(scholarship.coveragePercent)
      ? scholarship.coveragePercent
      : Number(scholarship.coveragePercent) || 0;
  return {
    ...scholarship,
    id: String(scholarship._id ?? scholarship.id ?? `scholarship-${index}`),
    deadline: deadlineIso,
    maxSlots,
    remainingSlots,
    coveragePercent,
  };
}

function mapStudentProgram(program: Record<string, unknown>, index: number): Record<string, unknown> {
  return {
    ...program,
    id: String(program._id ?? program.id ?? `program-${index}`),
    degreeLevel: program.degreeLevel ?? program.degree,
    degree: program.degree ?? program.degreeLevel,
    tuitionFee: program.tuitionFee ?? program.tuition,
    tuition: program.tuition ?? program.tuitionFee,
    durationYears: program.durationYears ?? program.duration,
    entryRequirements: program.entryRequirements ?? program.requirements,
  };
}

function matchesUniversityFilters(item: SearchableUniversityItem, query: StudentUniversitiesQuery) {
  const search = normalizeString(query.search);
  if (search) {
    const searchableFields = [
      item.name,
      item.country,
      item.description,
      item.tagline,
      item.minLanguageLevel,
      ...item.facultyCodes,
      ...item.targetStudentCountries,
      ...item.faculties.flatMap((faculty) => [faculty.name, faculty.description]),
      ...item.programs.flatMap((program) => [program.name, program.field, program.degreeLevel, program.language, program.entryRequirements]),
      ...item.scholarships.flatMap((scholarship) => [scholarship.name, scholarship.eligibility]),
    ];
    if (!searchableFields.some((value) => normalizeString(value).includes(search))) {
      return false;
    }
  }

  const country = normalizeString(query.country);
  if (country && normalizeString(item.country) !== country) return false;

  if (query.hasScholarship && !item.hasScholarship) return false;

  const facultyCodes = normalizeStringArray(query.facultyCodes).map((value) => value.toLowerCase());
  if (facultyCodes.length > 0 && !item.facultyCodes.some((code) => facultyCodes.includes(String(code).toLowerCase()))) {
    return false;
  }

  const degreeLevels = normalizeStringArray(query.degreeLevels).map((value) => value.toLowerCase());
  if (degreeLevels.length > 0) {
    const programDegreeLevels = item.programs.map((program) => normalizeString(program.degreeLevel));
    if (!programDegreeLevels.some((degreeLevel) => degreeLevels.includes(degreeLevel))) {
      return false;
    }
  }

  const programLanguages = normalizeStringArray(query.programLanguages).map((value) => value.toLowerCase());
  if (programLanguages.length > 0) {
    const programLanguageValues = item.programs.map((program) => normalizeString(program.language));
    if (!programLanguageValues.some((language) => programLanguages.includes(language))) {
      return false;
    }
  }

  const targetStudentCountries = normalizeStringArray(query.targetStudentCountries).map((value) => value.toLowerCase());
  if (targetStudentCountries.length > 0) {
    const targetCountryValues = item.targetStudentCountries.map((value) => String(value).trim().toLowerCase());
    if (!targetCountryValues.some((value) => targetStudentCountries.includes(value))) {
      return false;
    }
  }

  const programQuery = normalizeString(query.programQuery);
  if (programQuery) {
    const programFields = item.programs.flatMap((program) => [program.name, program.field, program.degreeLevel, program.language, program.entryRequirements]);
    if (!programFields.some((value) => normalizeString(value).includes(programQuery))) {
      return false;
    }
  }

  const requirementsQuery = normalizeString(query.requirementsQuery);
  if (requirementsQuery) {
    const requirementFields = [
      item.minLanguageLevel,
      ...item.programs.map((program) => program.entryRequirements),
      ...item.scholarships.map((scholarship) => scholarship.eligibility),
    ];
    if (!requirementFields.some((value) => normalizeString(value).includes(requirementsQuery))) {
      return false;
    }
  }

  const tuitionPrice = resolveTuitionPrice(item);
  if (query.minTuition != null && (tuitionPrice == null || tuitionPrice < query.minTuition)) return false;
  if (query.maxTuition != null && (tuitionPrice == null || tuitionPrice > query.maxTuition)) return false;
  if (query.minEstablishedYear != null && (item.establishedYear == null || item.establishedYear < query.minEstablishedYear)) return false;
  if (query.maxEstablishedYear != null && (item.establishedYear == null || item.establishedYear > query.maxEstablishedYear)) return false;
  if (query.minStudentCount != null && (item.studentCount == null || item.studentCount < query.minStudentCount)) return false;
  if (query.maxStudentCount != null && (item.studentCount == null || item.studentCount > query.maxStudentCount)) return false;

  return true;
}

function resolveTuitionPrice(item: SearchableUniversityItem) {
  if (typeof item.tuitionPrice === 'number' && Number.isFinite(item.tuitionPrice)) return item.tuitionPrice;
  const programTuition = item.programs
    .map((program) => {
      const value = program.tuitionFee ?? program.tuition;
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    })
    .filter((value): value is number => value != null);
  if (programTuition.length === 0) return null;
  return Math.min(...programTuition);
}

function compareNullableNumber(left: number | null | undefined, right: number | null | undefined, direction: 'asc' | 'desc') {
  const leftValue = left == null ? null : left;
  const rightValue = right == null ? null : right;
  if (leftValue == null && rightValue == null) return 0;
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;
  return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
}

function getUniversitySortName(item: Pick<SearchableUniversityItem, 'name' | 'universityName'>) {
  const byName = typeof item.name === 'string' ? item.name.trim() : '';
  if (byName) return byName;
  const byUniversityName = typeof item.universityName === 'string' ? item.universityName.trim() : '';
  if (byUniversityName) return byUniversityName;
  return '';
}

function compareUniversities(left: SearchableUniversityItem, right: SearchableUniversityItem, sort?: string) {
  const leftName = getUniversitySortName(left);
  const rightName = getUniversitySortName(right);

  if (sort === 'name') {
    return leftName.localeCompare(rightName);
  }

  if (sort === 'rating') {
    const ratingCompare = compareNullableNumber(left.rating, right.rating, 'desc');
    return ratingCompare !== 0 ? ratingCompare : leftName.localeCompare(rightName);
  }

  if (sort === 'tuition_asc') {
    const tuitionCompare = compareNullableNumber(resolveTuitionPrice(left), resolveTuitionPrice(right), 'asc');
    return tuitionCompare !== 0 ? tuitionCompare : leftName.localeCompare(rightName);
  }

  if (sort === 'tuition_desc') {
    const tuitionCompare = compareNullableNumber(resolveTuitionPrice(left), resolveTuitionPrice(right), 'desc');
    return tuitionCompare !== 0 ? tuitionCompare : leftName.localeCompare(rightName);
  }

  if (sort === 'newest') {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return leftName.localeCompare(rightName);
  }

  const matchCompare = compareNullableNumber(left.matchScore, right.matchScore, 'desc');
  if (matchCompare !== 0) return matchCompare;
  return leftName.localeCompare(rightName);
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
    const linkedFromCatalog = toObjectIdString((catalog as { linkedUniversityProfileId?: unknown }).linkedUniversityProfileId);
    if (linkedFromCatalog) {
      return getUniversityById(userId, linkedFromCatalog);
    }
    const catalogInterest = await CatalogInterest.findOne({
      studentId: profile._id,
      catalogUniversityId: catalogId,
    }).lean();
    const raw = catalog as unknown as Record<string, unknown>;
    const progs = Array.isArray(raw.programs) ? (raw.programs as Array<Record<string, unknown>>) : [];
    const schs = Array.isArray(raw.scholarships) ? (raw.scholarships as Array<Record<string, unknown>>) : [];
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
      programs: progs.map((program, index) => mapStudentProgram(program, index)),
      scholarships: schs.map((scholarship, index) => mapStudentScholarship(scholarship, index)),
      faculties: [],
      matchScore: null,
      breakdown: null,
      interest: catalogInterest ? { ...catalogInterest, id: String((catalogInterest as { _id: unknown })._id) } : null,
    };
  }

  const uid = toObjectIdString(universityId);
  if (!uid) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
  const university = await UniversityProfile.findById(uid).lean();
  if (!university) {
    const catalogRow = await UniversityCatalog.findById(uid).lean();
    if (catalogRow) {
      const linkedPid = toObjectIdString((catalogRow as { linkedUniversityProfileId?: unknown }).linkedUniversityProfileId);
      if (linkedPid) return getUniversityById(userId, linkedPid);
      return getUniversityById(userId, `catalog-${uid}`);
    }
    throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
  }

  const [rec, interest, programs, scholarships, faculties, linkedCatalog] = await Promise.all([
    Recommendation.findOne({ studentId: profile._id, universityId: uid }).lean(),
    Interest.findOne({ studentId: profile._id, universityId: uid }).lean(),
    Program.find({ universityId: uid }).lean(),
    Scholarship.find({ universityId: uid }).lean(),
    Faculty.find({ universityId: uid }).sort({ order: 1, name: 1 }).lean(),
    UniversityCatalog.findOne({ linkedUniversityProfileId: uid }).lean(),
  ]);

  const linkedCatalogRecord = linkedCatalog as Record<string, unknown> | null;
  const mergedPrograms = mergeProgramsWithCatalog(
    programs as unknown as Array<Record<string, unknown>>,
    mapCatalogPrograms(linkedCatalogRecord)
  );
  const mergedScholarships = mergeScholarshipsWithCatalog(
    scholarships as unknown as Array<Record<string, unknown>>,
    mapCatalogScholarships(linkedCatalogRecord)
  );
  const effectiveFaculties = faculties.length > 0 ? faculties.map((f) => ({ ...f, id: String((f as { _id: unknown })._id) })) : mapCatalogFaculties(linkedCatalogRecord);
  const effectiveName = pickString((university as { universityName?: string }).universityName, linkedCatalogRecord?.universityName) ?? '';
  const effectiveLogoUrl = pickString((university as { logoUrl?: string }).logoUrl, linkedCatalogRecord?.logoUrl);
  const effectiveCountry = pickString((university as { country?: string }).country, linkedCatalogRecord?.country);
  const effectiveCity = pickString((university as { city?: string }).city, linkedCatalogRecord?.city);
  const effectiveDescription = pickString((university as { description?: string }).description, linkedCatalogRecord?.description);
  const effectiveTagline = pickString((university as { tagline?: string }).tagline, linkedCatalogRecord?.tagline);
  const effectiveEstablishedYear = pickNumber((university as { establishedYear?: number }).establishedYear, linkedCatalogRecord?.establishedYear);
  const effectiveStudentCount = pickNumber((university as { studentCount?: number }).studentCount, linkedCatalogRecord?.studentCount);
  const effectiveFacultyCodes = pickStringArray((university as { facultyCodes?: string[] }).facultyCodes, linkedCatalogRecord?.facultyCodes);
  const effectiveFacultyItems =
    ((university as { facultyItems?: Record<string, string[]> }).facultyItems && Object.keys((university as { facultyItems?: Record<string, string[]> }).facultyItems ?? {}).length > 0)
      ? (university as { facultyItems?: Record<string, string[]> }).facultyItems
      : ((linkedCatalogRecord?.facultyItems as Record<string, string[]> | undefined) ?? undefined);
  const effectiveTargetCountries = pickStringArray((university as { targetStudentCountries?: string[] }).targetStudentCountries, linkedCatalogRecord?.targetStudentCountries);
  const effectiveMinLanguageLevel = pickString((university as { minLanguageLevel?: string }).minLanguageLevel, linkedCatalogRecord?.minLanguageLevel);
  const effectiveTuitionPrice = pickNumber((university as { tuitionPrice?: number }).tuitionPrice, linkedCatalogRecord?.tuitionPrice);
  const effectiveIeltsMinBand = pickNumber(
    (university as { ieltsMinBand?: number }).ieltsMinBand,
    (linkedCatalogRecord as { ieltsMinBand?: number } | undefined)?.ieltsMinBand
  );
  const rawGpaMode =
    (university as { gpaMinMode?: string }).gpaMinMode ??
    (linkedCatalogRecord as { gpaMinMode?: string } | undefined)?.gpaMinMode;
  const effectiveGpaMinMode =
    rawGpaMode === 'scale' || rawGpaMode === 'percent' ? rawGpaMode : undefined;
  const effectiveGpaMinValue = pickNumber(
    (university as { gpaMinValue?: number }).gpaMinValue,
    (linkedCatalogRecord as { gpaMinValue?: number } | undefined)?.gpaMinValue
  );

  return {
    ...university,
    id: String((university as { _id: unknown })._id),
    name: effectiveName,
    universityName: effectiveName,
    country: effectiveCountry,
    city: effectiveCity,
    description: effectiveDescription,
    tagline: effectiveTagline,
    slogan: effectiveTagline,
    logoUrl: effectiveLogoUrl,
    logo: effectiveLogoUrl,
    establishedYear: effectiveEstablishedYear,
    foundedYear: effectiveEstablishedYear,
    studentCount: effectiveStudentCount,
    facultyCodes: effectiveFacultyCodes,
    facultyItems: effectiveFacultyItems,
    targetStudentCountries: effectiveTargetCountries,
    minLanguageLevel: effectiveMinLanguageLevel,
    tuitionPrice: effectiveTuitionPrice,
    ieltsMinBand: effectiveIeltsMinBand ?? undefined,
    gpaMinMode: effectiveGpaMinMode,
    gpaMinValue: effectiveGpaMinValue ?? undefined,
    programs: mergedPrograms.map((program, index) => mapStudentProgram(program, index)),
    scholarships: mergedScholarships.map((scholarship, index) => mapStudentScholarship(scholarship, index)),
    faculties: effectiveFaculties,
    matchScore: rec ? (rec as { matchScore: number }).matchScore : null,
    breakdown: rec ? (rec as { breakdown?: unknown }).breakdown : null,
    interest: interest ? { ...interest, id: String((interest as { _id: unknown })._id) } : null,
  };
}

export async function getUniversityFlyers(userId: string, universityId: unknown) {
  const ensuredProfile = await ensureStudentProfile(userId);
  const profile = await StudentProfile.findById(ensuredProfile._id).select('_id').lean();
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);
  const uid = toObjectIdString(universityId);
  if (!uid) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
  const university = await UniversityProfile.findById(uid).select('_id').lean();
  if (!university) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
  const list = await UniversityFlyer.find({ universityId: uid, isPublished: true }).sort({ createdAt: -1 }).lean();
  return list.map((item) => ({ ...item, id: String((item as { _id: unknown })._id) }));
}

async function hasUploadedIeltsCertificate(studentProfileId: mongoose.Types.ObjectId): Promise<boolean> {
  const doc = await StudentDocument.findOne({
    studentId: studentProfileId,
    type: 'language_certificate',
    fileUrl: { $exists: true, $ne: '' },
    $or: [{ certificateType: { $regex: /ielts/i } }, { name: { $regex: /ielts/i } }],
  })
    .select('_id')
    .lean();
  return !!doc;
}

function assertInterestSubscriptionAllowed(
  subscription: Awaited<ReturnType<typeof subscriptionService.canSendApplication>>
): void {
  if (subscription.allowed) return;
  if (subscription.trialExpired) {
    throw new AppError(402, 'Trial expired. Upgrade to a paid plan to continue sending applications.', ErrorCodes.PAYMENT_REQUIRED);
  }
  throw new AppError(402, `Application limit reached (${subscription.current}/${subscription.limit ?? '?'}). Upgrade your plan to send more.`, ErrorCodes.PAYMENT_REQUIRED);
}

export async function addInterest(userId: string, universityId: unknown) {
  const profile = await ensureStudentProfile(userId);
  const idStr = String(universityId ?? '').trim();

  if (idStr.startsWith('catalog-')) {
    const catalogId = toObjectIdString(idStr.replace(/^catalog-/, ''));
    if (!catalogId) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
    const catalog = await UniversityCatalog.findById(catalogId);
    if (!catalog) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
    const linkedForInterest = toObjectIdString((catalog as { linkedUniversityProfileId?: unknown }).linkedUniversityProfileId);
    if (linkedForInterest) {
      return addInterest(userId, linkedForInterest);
    }

    const existingCatalog = await CatalogInterest.findOne({
      studentId: profile._id,
      catalogUniversityId: catalogId,
    }).lean();
    if (existingCatalog) {
      return { ...existingCatalog, id: String((existingCatalog as { _id: unknown })._id) };
    }

    const subscription = await subscriptionService.canSendApplication(userId);
    assertInterestSubscriptionAllowed(subscription);

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

  const existingInterest = await Interest.findOne({ studentId: profile._id, universityId: uid }).lean();
  if (existingInterest) {
    return { ...existingInterest, id: String((existingInterest as { _id: unknown })._id) };
  }

  const subscription = await subscriptionService.canSendApplication(userId);
  assertInterestSubscriptionAllowed(subscription);

  const uni = await UniversityProfile.findById(uid);
  if (!uni) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);

  const ieltsMin = getEffectiveIeltsMinBand(
    (uni as { ieltsMinBand?: number }).ieltsMinBand,
    (uni as { minLanguageLevel?: string }).minLanguageLevel
  );
  if (ieltsMin != null && ieltsMin > 0) {
    const ok = await hasUploadedIeltsCertificate(profile._id as mongoose.Types.ObjectId);
    if (!ok) {
      throw new AppError(
        400,
        'Upload an IELTS certificate under Documents before showing interest in this university.',
        ErrorCodes.VALIDATION
      );
    }
  }

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
  const ensuredProfile = await ensureStudentProfile(userId);
  const profile = await StudentProfile.findById(ensuredProfile._id).select('_id').lean();
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
  const profile = await ensureStudentProfile(userId);

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
  const profile = await ensureStudentProfile(userId);

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
      status: o.status,
      expiresAt: o.expiresAt,
    };
  });
}

export async function acceptOffer(userId: string, offerId: string) {
  const profile = await ensureStudentProfile(userId);

  const offer = await Offer.findById(offerId).populate('scholarshipId');
  if (!offer || String(offer.studentId) !== String(profile._id)) throw new AppError(404, 'Offer not found', ErrorCodes.NOT_FOUND);
  if (offer.status !== 'pending' && offer.status !== 'waiting') {
    throw new AppError(400, 'Offer already processed', ErrorCodes.CONFLICT);
  }
  const offerUniId = toObjectIdString(offer.universityId);
  if (!offerUniId) throw new AppError(404, 'Offer invalid', ErrorCodes.NOT_FOUND);

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await Offer.findByIdAndUpdate(offerId, { status: 'accepted', expiresAt: undefined }, { session });
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
  const profile = await ensureStudentProfile(userId);

  const offer = await Offer.findOne({ _id: offerId, studentId: profile._id });
  if (!offer) throw new AppError(404, 'Offer not found', ErrorCodes.NOT_FOUND);
  if (offer.status !== 'pending' && offer.status !== 'waiting') {
    throw new AppError(400, 'Offer already processed', ErrorCodes.CONFLICT);
  }

  await Offer.findByIdAndUpdate(offerId, { status: 'declined', expiresAt: undefined });
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

/** Student asks to wait with decision: move offer to 'waiting' and set/extend expiresAt for 14 days from now. */
export async function waitOnOffer(userId: string, offerId: string) {
  const profile = await ensureStudentProfile(userId);

  const offer = await Offer.findOne({ _id: offerId, studentId: profile._id });
  if (!offer) throw new AppError(404, 'Offer not found', ErrorCodes.NOT_FOUND);
  if (offer.status !== 'pending' && offer.status !== 'waiting') {
    throw new AppError(400, 'Offer already processed', ErrorCodes.CONFLICT);
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  await Offer.findByIdAndUpdate(offerId, { status: 'waiting', expiresAt });

  const updated = await Offer.findById(offerId).lean();
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}

const RECOMMENDATIONS_LIMIT = 5;
/** Load enough rows to score so we can return 3+ after isSuitable filtering (was capped at 5 total). */
const RECOMMENDATIONS_FETCH_POOL = 24;
/** Dashboard grid expects 3 cards; pad with next-best matches if fewer pass isSuitable. */
const RECOMMENDATIONS_MIN_FOR_DASHBOARD = 3;

export async function getRecommendations(userId: string) {
  const profile = await ensureStudentProfile(userId);
  const profileObject = profile.toObject ? profile.toObject() : profile;
  if (!isMinimalPortfolioComplete(profileObject as Record<string, unknown>)) {
    return [];
  }

  const [recDocs, catalogDocs] = await Promise.all([
    Recommendation.find({ studentId: profile._id })
      .sort({ matchScore: -1 })
      .limit(RECOMMENDATIONS_FETCH_POOL)
      .populate('universityId')
      .lean(),
    UniversityCatalog.find({ linkedUniversityProfileId: { $exists: false } })
      .limit(RECOMMENDATIONS_FETCH_POOL)
      .sort({ universityName: 1 })
      .lean(),
  ]);

  const recList = recDocs.map((r) => ({
    ...r,
    id: String((r as { _id: unknown })._id),
    university: (r as { universityId?: unknown }).universityId,
  }));

  const usedIds = new Set(
    recList
      .map((r) => (r as { university?: { _id?: unknown } }).university?._id)
      .filter(Boolean)
      .map((id) => String(id))
  );
  const catalogList = catalogDocs
    .filter((c) => {
      const cid = String((c as { _id: unknown })._id);
      return !usedIds.has(cid);
    })
    .slice(0, Math.max(0, RECOMMENDATIONS_FETCH_POOL - recList.length))
    .map((c) => {
      const id = `catalog-${String((c as { _id: unknown })._id)}`;
      return {
        ...c,
        id,
        universityId: id,
        university: c,
      };
    });

  const scored = [...recList, ...catalogList]
    .map((item) => {
      const university = item.university as Record<string, unknown> | undefined;
      const programs = Array.isArray(university?.programs) ? university?.programs as Array<Record<string, unknown>> : [];
      const scholarships = Array.isArray(university?.scholarships) ? university?.scholarships as Array<Record<string, unknown>> : [];
      const match = calculateMatchScore(
        profileObject as Parameters<typeof calculateMatchScore>[0],
        {
          country: university?.country as string | undefined,
          city: university?.city as string | undefined,
          facultyCodes: (university?.facultyCodes as string[] | undefined) ?? [],
          minLanguageLevel: university?.minLanguageLevel as string | undefined,
          tuitionPrice: typeof university?.tuitionPrice === 'number' ? Number(university.tuitionPrice) : undefined,
          programs: programs.map((program) => ({
            field: String(program.field ?? ''),
            language: program.language != null ? String(program.language) : undefined,
            tuitionFee: typeof (program.tuitionFee ?? program.tuition) === 'number' ? Number(program.tuitionFee ?? program.tuition) : undefined,
            degreeLevel: program.degreeLevel != null ? String(program.degreeLevel) : undefined,
            degree: program.degree != null ? String(program.degree) : undefined,
            entryRequirements: program.entryRequirements != null ? String(program.entryRequirements) : undefined,
          })),
          scholarships: scholarships.map((scholarship) => ({
            eligibility: scholarship.eligibility != null ? String(scholarship.eligibility) : undefined,
          })),
        }
      );
      return {
        ...item,
        matchScore: match.score,
        breakdown: match.breakdown,
        matchBreakdown: match.breakdown,
        isSuitable: match.isSuitable,
      };
    })
    .sort((left, right) =>
      compareFallbackUniversities(
        left as Record<string, unknown>,
        right as Record<string, unknown>,
        profileObject as Record<string, unknown>
      )
    );

  const getRecUniversityKey = (item: (typeof scored)[number]): string => {
    const raw = item as unknown as Record<string, unknown>;
    const uid = raw.universityId;
    if (typeof uid === 'string' && uid.startsWith('catalog-')) return uid;
    const uni = raw.university as { _id?: unknown } | undefined;
    if (uni?._id != null) return String(uni._id);
    if (uid != null) return String(uid);
    return '';
  };

  const suitableRecommendations = scored.filter((item) => item.isSuitable);
  if (suitableRecommendations.length > 0) {
    const merged: typeof scored = [];
    const seen = new Set<string>();
    const pushUnique = (items: typeof scored) => {
      for (const row of items) {
        if (merged.length >= RECOMMENDATIONS_LIMIT) return;
        const key = getRecUniversityKey(row);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(row);
      }
    };
    pushUnique(suitableRecommendations);
    if (merged.length < RECOMMENDATIONS_MIN_FOR_DASHBOARD) {
      pushUnique(scored);
    }
    return merged;
  }

  return scored.slice(0, Math.min(RECOMMENDATIONS_LIMIT, 3));
}

export async function getCompare(userId: string, ids: unknown[]) {
  const profile = await ensureStudentProfile(userId);
  const rawIds = (Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean);
  const compareMaxIds = 15;
  if (rawIds.length > compareMaxIds) {
    throw new AppError(400, `Provide 1-${compareMaxIds} university ids`, ErrorCodes.VALIDATION);
  }
  if (rawIds.length === 0) {
    return [];
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
