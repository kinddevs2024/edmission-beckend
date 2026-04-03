import {
  User,
  StudentProfile,
  UniversityProfile,
  UniversityCatalog,
  UniversityVerificationRequest,
  Program,
  Scholarship,
  Faculty,
  Interest,
  Offer,
  Recommendation,
  StudentDocument,
  StudentProfileView,
  OfferCertificateTemplate,
  Chat,
  Message,
  UniversityFlyer,
} from '../models';
import * as notificationService from './notification.service';
import * as subscriptionService from './subscription.service';
import * as emailService from './email.service';
import { AppError, ErrorCodes } from '../utils/errors';
import { toObjectIdString } from '../utils/objectId';
import { safeRegExp } from '../utils/validators';
import { getIO } from '../socket';
import { effectiveProfileVisibility, redactStudentForUniversityListing } from '../utils/studentProfilePrivacy';
import { languageRowsFromApprovedCertificates, mergeProfileLanguagesWithCertificates } from '../utils/languageFromCertificate';

function isMongoDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 11000;
}

export async function getProfile(userId: string) {
  const profile = await UniversityProfile.findOne({ userId }).lean();
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const programs = await Program.find({ universityId: profile._id }).lean();
  const scholarships = await Scholarship.find({ universityId: profile._id }).lean();
  const faculties = await Faculty.find({ universityId: profile._id }).sort({ order: 1, name: 1 }).lean();
  const user = await User.findById(userId).select('email').lean();
  return {
    ...profile,
    id: String((profile as { _id: unknown })._id),
    user: user ? { email: (user as { email: string }).email } : undefined,
    programs,
    scholarships,
    faculties: faculties.map((f) => ({ ...f, id: String((f as { _id: unknown })._id) })),
  };
}

export async function updateProfile(userId: string, data: Record<string, unknown>) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);

  const raw = data as {
    programs?: Array<Record<string, unknown>>;
    universityName?: string;
    tagline?: string;
    establishedYear?: number;
    studentCount?: number;
    country?: string;
    city?: string;
    description?: string;
    logoUrl?: string | null;
    onboardingCompleted?: boolean;
    facultyCodes?: string[];
    facultyItems?: Record<string, string[]>;
    targetStudentCountries?: string[];
    minLanguageLevel?: string;
    tuitionPrice?: number;
  };
  const { programs, ...rest } = raw;

  const update: Record<string, unknown> = { needsRecalculation: true };
  if (rest.universityName !== undefined) update.universityName = rest.universityName;
  if (rest.tagline !== undefined) update.tagline = rest.tagline;
  if (rest.establishedYear !== undefined) update.establishedYear = rest.establishedYear;
  if (rest.studentCount !== undefined) update.studentCount = rest.studentCount;
  if (rest.country !== undefined) update.country = rest.country;
  if (rest.city !== undefined) update.city = rest.city;
  if (rest.description !== undefined) update.description = rest.description;
  if (rest.logoUrl !== undefined) {
    update.logoUrl = rest.logoUrl === null || rest.logoUrl === '' ? null : rest.logoUrl;
  }
  if (rest.onboardingCompleted !== undefined) update.onboardingCompleted = rest.onboardingCompleted;
  if (rest.facultyCodes !== undefined) {
    const arr = Array.isArray(rest.facultyCodes) ? rest.facultyCodes : [];
    update.facultyCodes = arr.map((s) => String(s)).filter((s) => s.trim()).slice(0, 50);
  }
  if (rest.facultyItems !== undefined) {
    const val = rest.facultyItems;
    update.facultyItems =
      val && typeof val === 'object' && !Array.isArray(val)
        ? Object.fromEntries(
            Object.entries(val)
              .filter(([, arr]) => Array.isArray(arr))
              .map(([k, arr]) => [k, (arr as string[]).map(String).filter(Boolean).slice(0, 200)])
          )
        : undefined;
  }
  if (rest.targetStudentCountries !== undefined) {
    const arr = Array.isArray(rest.targetStudentCountries) ? rest.targetStudentCountries : [];
    update.targetStudentCountries = arr.map((s) => String(s)).filter((s) => s.trim()).slice(0, 50);
  }
  if (rest.minLanguageLevel !== undefined) update.minLanguageLevel = rest.minLanguageLevel != null ? String(rest.minLanguageLevel).trim() || null : null;
  if (rest.tuitionPrice !== undefined) update.tuitionPrice = rest.tuitionPrice != null ? Number(rest.tuitionPrice) : null;

  const updated = await UniversityProfile.findByIdAndUpdate(profile._id, update, { new: true }).lean();

  if (programs?.length) {
    await Program.deleteMany({ universityId: profile._id });
    for (const p of programs) {
      await Program.create({
        universityId: profile._id,
        name: String(p.name),
        degreeLevel: String(p.degreeLevel),
        field: String(p.field),
        durationYears: p.durationYears != null ? Number(p.durationYears) : undefined,
        tuitionFee: p.tuitionFee != null ? Number(p.tuitionFee) : undefined,
        language: p.language != null ? String(p.language) : undefined,
        entryRequirements: p.entryRequirements != null ? String(p.entryRequirements) : undefined,
      });
    }
  }
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}

export async function getDashboard(userId: string) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);

  const [byStatusAgg, offers, recs] = await Promise.all([
    Interest.aggregate([{ $match: { universityId: profile._id } }, { $group: { _id: '$status', _count: { $sum: 1 } } }]),
    Offer.countDocuments({ universityId: profile._id, status: 'pending' }),
    Recommendation.find({ universityId: profile._id })
      .sort({ matchScore: -1 })
      .limit(5)
      .populate({
        path: 'studentId',
        select: 'firstName lastName gpa country userId profileVisibility',
        populate: { path: 'userId', select: 'email name' },
      })
      .lean(),
  ]);

  const pipeline = byStatusAgg.map((s: { _id: string; _count: number }) => ({ status: s._id, _count: s._count }));
  const totalInterests = pipeline.reduce((s, p) => s + (p._count ?? 0), 0);
  const acceptedCount = pipeline.find((p) => p.status === 'accepted')?._count ?? 0;
  const interestedCount = pipeline.find((p) => p.status === 'interested')?._count ?? 0;
  const chatCount = pipeline.find((p) => p.status === 'chat_opened')?._count ?? 0;
  const offerSentCount = pipeline.find((p) => p.status === 'offer_sent')?._count ?? 0;

  return {
    pipeline,
    pendingOffers: offers,
    totalInterests,
    interestedCount,
    chatCount,
    offerSentCount,
    acceptedCount,
    acceptanceRate: totalInterests > 0 ? Math.round((acceptedCount / totalInterests) * 100) : 0,
    verified: (profile as { verified?: boolean }).verified ?? false,
    topRecommendations: recs.map((r) => {
      const sidRaw = (r as { studentId?: unknown }).studentId;
      const studentProfileId = toObjectIdString(sidRaw) ?? undefined;
      const rawStudent = (r as { studentId?: { userId?: { email?: string }; profileVisibility?: unknown } }).studentId;
      let student: Record<string, unknown> | undefined;
      if (rawStudent && typeof rawStudent === 'object') {
        const merged = {
          ...rawStudent,
          userEmail:
            rawStudent.userId && typeof rawStudent.userId === 'object'
              ? String((rawStudent.userId as { email?: string }).email ?? '').trim() || undefined
              : undefined,
          name:
            rawStudent.userId && typeof rawStudent.userId === 'object'
              ? String((rawStudent.userId as { name?: string }).name ?? '').trim() || undefined
              : undefined,
        } as Record<string, unknown>;
        student = redactStudentForUniversityListing(merged);
      }

      return {
        ...r,
        id: String((r as { _id: unknown })._id),
        studentProfileId,
        student,
        matchScore: (r as { matchScore?: number }).matchScore,
      };
    }),
  };
}

export async function getStudents(
  userId: string,
  query: {
    page?: number;
    limit?: number;
    search?: string;
    skills?: string[];
    interests?: string[];
    hobbies?: string[];
    country?: string;
    city?: string;
    schoolName?: string;
    educationStatus?: string;
    targetDegreeLevel?: string;
    schoolCompleted?: boolean;
    languages?: string[];
    languageLevels?: string[];
    certType?: string;
    certMinScore?: string;
    documentTypes?: string[];
    documentQuery?: string;
    preferredCountries?: string[];
    interestedFaculties?: string[];
    minBudget?: number;
    maxBudget?: number;
    budgetCurrency?: string;
    gpaMin?: number;
    gpaMax?: number;
    graduationYearMin?: number;
    graduationYearMax?: number;
    verifiedOnly?: boolean;
    hasPortfolio?: boolean;
    useProfileFilters?: boolean;
  }
) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);

  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const useProfileFilters = query.useProfileFilters !== false;

  const filter: Record<string, unknown> = {};
  const andFilters: Record<string, unknown>[] = [];

  if (query.country?.trim()) filter.country = query.country.trim();
  if (query.city?.trim()) filter.city = safeRegExp(query.city.trim());
  if (query.educationStatus?.trim()) filter.educationStatus = query.educationStatus.trim();
  if (query.targetDegreeLevel?.trim()) filter.targetDegreeLevel = query.targetDegreeLevel.trim();
  if (typeof query.schoolCompleted === 'boolean') filter.schoolCompleted = query.schoolCompleted;
  if (query.budgetCurrency?.trim()) filter.budgetCurrency = query.budgetCurrency.trim();
  if (query.verifiedOnly) filter.verifiedAt = { $ne: null };
  if (query.hasPortfolio) andFilters.push({ 'portfolioWorks.0': { $exists: true } });

  if (query.search?.trim()) {
    const searchRegex = safeRegExp(query.search.trim());
    const emailMatches = await User.find({ email: searchRegex }).select('_id').lean();
    const emailUserIds = emailMatches.map((user) => (user as { _id: unknown })._id);
    const searchOr: Record<string, unknown>[] = [
      { firstName: searchRegex },
      { lastName: searchRegex },
      { city: searchRegex },
      { country: searchRegex },
      { schoolName: searchRegex },
      { 'schoolsAttended.institutionName': searchRegex },
    ];
    if (emailUserIds.length > 0) {
      searchOr.push({ userId: { $in: emailUserIds } });
    }
    andFilters.push({ $or: searchOr });
  }

  if (query.schoolName?.trim()) {
    const schoolRegex = safeRegExp(query.schoolName.trim());
    andFilters.push({
      $or: [
        { schoolName: schoolRegex },
        { 'schoolsAttended.institutionName': schoolRegex },
      ],
    });
  }

  if (useProfileFilters) {
    // Filter by university's targetStudentCountries if set
    const targetCountries = Array.isArray((profile as { targetStudentCountries?: string[] }).targetStudentCountries)
      ? ((profile as { targetStudentCountries?: string[] }).targetStudentCountries ?? []).filter(Boolean)
      : [];
    if (targetCountries.length > 0) {
      mergeInConstraint(filter, 'country', targetCountries);
    }

    // Filter by faculties: student interestedFaculties intersect university facultyCodes
    const facultyCodes = Array.isArray((profile as { facultyCodes?: string[] }).facultyCodes)
      ? ((profile as { facultyCodes?: string[] }).facultyCodes ?? []).filter(Boolean)
      : [];
    if (facultyCodes.length > 0) {
      mergeInConstraint(filter, 'interestedFaculties', facultyCodes);
    }
  }

  const skills = Array.isArray(query.skills) ? query.skills.filter(Boolean) : [];
  const interests = Array.isArray(query.interests) ? query.interests.filter(Boolean) : [];
  const hobbies = Array.isArray(query.hobbies) ? query.hobbies.filter(Boolean) : [];
  if (skills.length > 0) filter.skills = { $in: skills };
  if (interests.length > 0) filter.interests = { $in: interests };
  if (hobbies.length > 0) filter.hobbies = { $in: hobbies };

  const preferredCountries = Array.isArray(query.preferredCountries) ? query.preferredCountries.filter(Boolean) : [];
  if (preferredCountries.length > 0) filter.preferredCountries = { $in: preferredCountries };

  const interestedFaculties = Array.isArray(query.interestedFaculties) ? query.interestedFaculties.filter(Boolean) : [];
  if (interestedFaculties.length > 0) filter.interestedFaculties = { $in: interestedFaculties };

  const languages = Array.isArray(query.languages) ? query.languages.filter(Boolean) : [];
  if (languages.length > 0) filter['languages.language'] = { $in: languages };

  const languageLevels = Array.isArray(query.languageLevels) ? query.languageLevels.filter(Boolean) : [];
  if (languageLevels.length > 0) {
    andFilters.push({
      $or: [
        { 'languages.level': { $in: languageLevels } },
        { languageLevel: { $in: languageLevels } },
      ],
    });
  }

  const minBudget = query.minBudget != null && Number.isFinite(Number(query.minBudget)) ? Number(query.minBudget) : undefined;
  const maxBudget = query.maxBudget != null && Number.isFinite(Number(query.maxBudget)) ? Number(query.maxBudget) : undefined;
  if (minBudget != null && maxBudget != null) {
    filter.budgetAmount = { $gte: minBudget, $lte: maxBudget };
  } else if (minBudget != null) {
    filter.budgetAmount = { $gte: minBudget };
  } else if (maxBudget != null) {
    filter.budgetAmount = { $lte: maxBudget };
  }

  const gpaMin = query.gpaMin != null && Number.isFinite(Number(query.gpaMin)) ? Number(query.gpaMin) : undefined;
  const gpaMax = query.gpaMax != null && Number.isFinite(Number(query.gpaMax)) ? Number(query.gpaMax) : undefined;
  if (gpaMin != null && gpaMax != null) {
    filter.gpa = { $gte: gpaMin, $lte: gpaMax };
  } else if (gpaMin != null) {
    filter.gpa = { $gte: gpaMin };
  } else if (gpaMax != null) {
    filter.gpa = { $lte: gpaMax };
  }

  const graduationYearMin =
    query.graduationYearMin != null && Number.isFinite(Number(query.graduationYearMin))
      ? Number(query.graduationYearMin)
      : undefined;
  const graduationYearMax =
    query.graduationYearMax != null && Number.isFinite(Number(query.graduationYearMax))
      ? Number(query.graduationYearMax)
      : undefined;
  if (graduationYearMin != null && graduationYearMax != null) {
    filter.graduationYear = { $gte: graduationYearMin, $lte: graduationYearMax };
  } else if (graduationYearMin != null) {
    filter.graduationYear = { $gte: graduationYearMin };
  } else if (graduationYearMax != null) {
    filter.graduationYear = { $lte: graduationYearMax };
  }

  const documentTypes = Array.isArray(query.documentTypes) ? query.documentTypes.filter(Boolean) : [];
  const hasDocumentFilters =
    Boolean(query.certType?.trim()) ||
    Boolean(query.documentQuery?.trim()) ||
    documentTypes.length > 0 ||
    Boolean(query.certMinScore?.trim());

  if (hasDocumentFilters) {
    const documentFilter: Record<string, unknown> = { status: 'approved' };
    if (documentTypes.length > 0) {
      documentFilter.type = { $in: documentTypes };
    }

    if (query.certType?.trim()) {
      if (documentTypes.length > 0 && !documentTypes.includes('language_certificate')) {
        mergeObjectIdConstraint(filter, []);
      } else {
        documentFilter.type = 'language_certificate';
        documentFilter.certificateType = safeRegExp(query.certType.trim());
      }
    }

    if (query.documentQuery?.trim()) {
      const documentRegex = safeRegExp(query.documentQuery.trim());
      documentFilter.$and = [
        ...((documentFilter.$and as Record<string, unknown>[] | undefined) ?? []),
        {
          $or: [
            { certificateType: documentRegex },
            { name: documentRegex },
            { type: documentRegex },
          ],
        },
      ];
    }

    const documents = await StudentDocument.find(documentFilter).select('studentId score').lean();
    const minScore = query.certMinScore != null && query.certMinScore !== '' ? Number(query.certMinScore) : NaN;
    const matchedStudentIds = documents
      .filter((document) => Number.isNaN(minScore) || parseFloat((document as { score?: string }).score ?? '0') >= minScore)
      .map((document) => (document as { studentId: unknown }).studentId);

    mergeObjectIdConstraint(filter, matchedStudentIds);
  }

  if (andFilters.length > 0) {
    filter.$and = andFilters;
  }

  const [students, total, interestStudentIds] = await Promise.all([
    StudentProfile.find(filter)
      .select('firstName lastName avatarUrl country city gpa gradeLevel languageLevel languages skills interests hobbies schoolName graduationYear interestedFaculties preferredCountries budgetAmount budgetCurrency userId targetDegreeLevel educationStatus schoolCompleted verifiedAt portfolioCompletionPercent profileVisibility')
      .sort({ gpa: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    StudentProfile.countDocuments(filter),
    Interest.find({ universityId: profile._id }).select('studentId').lean(),
  ]);

  const userIds = students
    .map((student) => {
      const userId = (student as { userId?: unknown }).userId;
      return userId ? String(userId) : '';
    })
    .filter(Boolean);
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select('_id email name').lean()
    : [];
  const emailByUserId = new Map(
    users.map((user) => [
      String((user as { _id: unknown })._id),
      {
        email: String((user as { email?: string }).email ?? '').trim() || undefined,
        name: String((user as { name?: string }).name ?? '').trim() || undefined,
      },
    ])
  );

  const inPipelineSet = new Set(interestStudentIds.map((i) => String((i as { studentId: unknown }).studentId)));

  const data = students.map((s) => {
    const id = String((s as { _id: unknown })._id);
    const userId = (s as { userId?: unknown }).userId;
    const studentUserMeta = userId ? emailByUserId.get(String(userId)) : undefined;
    const { userId: _studentUserId, ...studentData } = s as Record<string, unknown>;
    const merged = { ...studentData, userEmail: studentUserMeta?.email, name: studentUserMeta?.name } as Record<string, unknown>;
    return {
      id,
      student: redactStudentForUniversityListing(merged),
      inPipeline: inPipelineSet.has(id),
    };
  });

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

function mergeObjectIdConstraint(filter: Record<string, unknown>, ids: unknown[]) {
  const normalizedIds = ids.length > 0 ? uniqueUnknownValues(ids) : [null];
  const currentIds = readIdConstraint(filter._id);
  if (currentIds.length === 0) {
    filter._id = { $in: normalizedIds };
    return;
  }

  const nextIds = currentIds.filter((currentId) =>
    normalizedIds.some((id) => String(id) === String(currentId))
  );
  filter._id = { $in: nextIds.length > 0 ? uniqueUnknownValues(nextIds) : [null] };
}

function mergeInConstraint(filter: Record<string, unknown>, field: string, values: string[]) {
  const normalizedValues = values.map(String);
  const currentValues = readInConstraint(filter[field]);
  if (currentValues.length === 0) {
    filter[field] = { $in: normalizedValues };
    return;
  }

  const nextValues = currentValues.filter((value) => normalizedValues.includes(String(value)));
  filter[field] = { $in: nextValues.length > 0 ? uniqueUnknownValues(nextValues) : ['__no_match__'] };
}

function readIdConstraint(value: unknown) {
  if (!value || typeof value !== 'object' || !('$in' in (value as Record<string, unknown>))) return [];
  const ids = (value as { $in?: unknown[] }).$in;
  return Array.isArray(ids) ? ids : [];
}

function readInConstraint(value: unknown) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || !('$in' in (value as Record<string, unknown>))) return [];
  const ids = (value as { $in?: unknown[] }).$in;
  return Array.isArray(ids) ? ids.map(String) : [];
}

function uniqueUnknownValues(values: unknown[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = String(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getStudentProfileForUniversity(_userId: string, studentId: string) {
  const profile = await UniversityProfile.findOne({ userId: _userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);

  const sid = toObjectIdString(studentId);
  if (!sid) throw new AppError(404, 'Student not found', ErrorCodes.NOT_FOUND);

  let student = await StudentProfile.findById(sid).lean();
  if (!student) {
    student = await StudentProfile.findOne({ userId: sid }).lean();
  }
  if (!student) {
    const interest = await Interest.findOne({ _id: sid, universityId: profile._id }).select('studentId').lean();
    if (interest) {
      const profileId = toObjectIdString((interest as { studentId?: unknown }).studentId);
      if (profileId) student = await StudentProfile.findById(profileId).lean();
    }
  }
  if (!student) throw new AppError(404, 'Student not found', ErrorCodes.NOT_FOUND);

  // Enforce profile view limits based on university subscription.
  const sub = await subscriptionService.getSubscription(_userId);
  const isPremium = subscriptionService.hasPremiumUniversityPlan(sub);

  if (!isPremium) {
    const universityUserIdNorm = toObjectIdString(_userId) ?? String(_userId);
    const studentProfileIdNorm = toObjectIdString((student as { _id: unknown })._id);
    if (studentProfileIdNorm) {
      const existingView = await StudentProfileView.findOne({
        universityUserId: universityUserIdNorm,
        studentProfileId: studentProfileIdNorm,
      }).lean();

      if (!existingView) {
        const totalViews = await StudentProfileView.countDocuments({ universityUserId: universityUserIdNorm });
        const LIMIT = 15;
        if (totalViews >= LIMIT) {
          throw new AppError(403, 'Student profile view limit reached for your current plan', ErrorCodes.FORBIDDEN);
        }
        try {
          await StudentProfileView.create({
            universityUserId: universityUserIdNorm,
            studentProfileId: studentProfileIdNorm,
          });
        } catch (e: unknown) {
          if (!isMongoDuplicateKeyError(e)) throw e;
          // Concurrent insert or findOne miss: unique index already has this pair — treat as already viewed.
        }
      }
    }
  }

  const studentProfileId = (student as { _id: unknown })._id;
  const studentUserId = (student as { userId?: unknown }).userId;
  const documents = await StudentDocument.find({ studentId: studentProfileId, status: 'approved' })
    .select('type source name certificateType score fileUrl previewImageUrl canvasJson pageFormat width height editorVersion')
    .lean();
  const studentUser = studentUserId ? await User.findById(studentUserId).select('email phone socialLinks').lean() : null;

  const docList = documents.map((d) => ({
    id: String((d as { _id: unknown })._id),
    type: (d as { type: string }).type,
    source: (d as { source?: string }).source ?? 'upload',
    name: (d as { name?: string }).name,
    certificateType: (d as { certificateType?: string }).certificateType,
    score: (d as { score?: string }).score,
    fileUrl: (d as { fileUrl?: string }).fileUrl,
    previewImageUrl: (d as { previewImageUrl?: string }).previewImageUrl,
    canvasJson: (d as { canvasJson?: string }).canvasJson,
    pageFormat: (d as { pageFormat?: string }).pageFormat,
    width: (d as { width?: number }).width,
    height: (d as { height?: number }).height,
    editorVersion: (d as { editorVersion?: string }).editorVersion,
  }));

  const s = student as Record<string, unknown>;
  const hasProfile = (s.country != null && String(s.country).trim() !== '') || (s.city != null && String(s.city).trim() !== '');
  const hasEducation = (s.gpa != null) || (s.gradeLevel != null && String(s.gradeLevel).trim() !== '') || (s.schoolName != null && String(s.schoolName).trim() !== '') || (s.graduationYear != null) || (s.gradeScale != null) || (Array.isArray(s.schoolsAttended) && s.schoolsAttended.length > 0);
  const hasCertificates = docList.some((d) => d.type === 'language_certificate' || d.type === 'course_certificate' || (d.type === 'other' && d.name && /ielts|toefl|sat/i.test(String(d.name))));
  const readiness = {
    profile: hasProfile,
    education: hasEducation,
    certificates: hasCertificates,
    ready: hasProfile && hasEducation && hasCertificates,
  };

  const visibility = effectiveProfileVisibility(s.profileVisibility);
  const out = { ...student } as Record<string, unknown>;
  delete out.userId;

  let email =
    studentUser && typeof studentUser === 'object' ? String((studentUser as { email?: string }).email ?? '').trim() || undefined : undefined;
  let phone =
    studentUser && typeof studentUser === 'object' ? String((studentUser as { phone?: string }).phone ?? '').trim() || undefined : undefined;
  let socialLinks =
    studentUser && typeof studentUser === 'object'
      ? {
          telegram: String((studentUser as { socialLinks?: { telegram?: string } }).socialLinks?.telegram ?? '').trim() || undefined,
          instagram: String((studentUser as { socialLinks?: { instagram?: string } }).socialLinks?.instagram ?? '').trim() || undefined,
          linkedin: String((studentUser as { socialLinks?: { linkedin?: string } }).socialLinks?.linkedin ?? '').trim() || undefined,
          facebook: String((studentUser as { socialLinks?: { facebook?: string } }).socialLinks?.facebook ?? '').trim() || undefined,
          whatsapp: String((studentUser as { socialLinks?: { whatsapp?: string } }).socialLinks?.whatsapp ?? '').trim() || undefined,
        }
      : undefined;

  if (visibility === 'private') {
    delete out.firstName;
    delete out.lastName;
    delete out.avatarUrl;
    delete out.birthDate;
    email = undefined;
    phone = undefined;
    socialLinks = undefined;
    if (Array.isArray(out.portfolioWorks)) {
      out.portfolioWorks = (out.portfolioWorks as Record<string, unknown>[]).map((w) => {
        const { fileUrl: _f, linkUrl: _l, ...rest } = w;
        return rest;
      });
    }
  }

  const profileLangRows = Array.isArray(out.languages)
    ? (out.languages as { language?: string; level?: string }[])
        .map((x) => ({
          language: String(x?.language ?? '').trim(),
          level: String(x?.level ?? '').trim(),
        }))
        .filter((x) => x.language || x.level)
    : [];
  const fromCertificates = languageRowsFromApprovedCertificates(docList);
  const languagesMerged = mergeProfileLanguagesWithCertificates(profileLangRows, fromCertificates);

  return {
    ...out,
    id: String((out as { _id: unknown })._id),
    profileVisibility: visibility,
    email,
    phone,
    socialLinks,
    languages: languagesMerged,
    documents: docList,
    readiness,
  };
}

export async function getFunnelAnalytics(userId: string) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const funnel = await Interest.aggregate([
    { $match: { universityId: profile._id } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const byStatus: Record<string, number> = {};
  for (const f of funnel) {
    byStatus[f._id] = f.count;
  }
  return { byStatus, total: funnel.reduce((s, f) => s + f.count, 0) };
}

export async function getPipeline(
  userId: string,
  query?: { skills?: string[]; interests?: string[]; hobbies?: string[] }
) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);

  let list = await Interest.find({ universityId: profile._id })
    .populate({
      path: 'studentId',
      select: 'firstName lastName country city avatarUrl userId profileVisibility',
      populate: { path: 'userId', select: 'email name' },
    })
    .sort({ updatedAt: -1 })
    .lean();

  const skills = Array.isArray(query?.skills) ? query.skills.filter(Boolean) : [];
  const interests = Array.isArray(query?.interests) ? query.interests.filter(Boolean) : [];
  const hobbies = Array.isArray(query?.hobbies) ? query.hobbies.filter(Boolean) : [];

  if (skills.length > 0 || interests.length > 0 || hobbies.length > 0) {
    const and: Array<Record<string, { $in: string[] }>> = [];
    if (skills.length > 0) and.push({ skills: { $in: skills } });
    if (interests.length > 0) and.push({ interests: { $in: interests } });
    if (hobbies.length > 0) and.push({ hobbies: { $in: hobbies } });
    const matchingIds = await StudentProfile.find({ $and: and }).select('_id').lean();
    const idSet = new Set(matchingIds.map((m) => String((m as { _id: unknown })._id)));
    list = list.filter((i) => {
      const student = (i as { studentId?: { _id?: unknown } }).studentId;
      const sid = student && typeof student === 'object' && '_id' in student ? String(student._id) : '';
      return idSet.has(sid);
    });
  }

  return list.map((i) => {
    const sidRaw = (i as { studentId?: unknown }).studentId;
    const studentProfileId = toObjectIdString(sidRaw) ?? undefined;
    const rawStudent = (i as { studentId?: { userId?: { email?: string }; profileVisibility?: unknown } }).studentId;
    let student: Record<string, unknown> | undefined;
    if (rawStudent && typeof rawStudent === 'object') {
      const merged = {
        ...rawStudent,
        userEmail:
          rawStudent.userId && typeof rawStudent.userId === 'object'
            ? String((rawStudent.userId as { email?: string }).email ?? '').trim() || undefined
            : undefined,
        name:
          rawStudent.userId && typeof rawStudent.userId === 'object'
            ? String((rawStudent.userId as { name?: string }).name ?? '').trim() || undefined
            : undefined,
      } as Record<string, unknown>;
      student = redactStudentForUniversityListing(merged);
    }

    return {
      ...i,
      id: String((i as { _id: unknown })._id),
      studentProfileId,
      student,
    };
  });
}

export async function updateInterestStatus(
  userId: string,
  interestId: string,
  status: 'under_review' | 'chat_opened' | 'offer_sent' | 'rejected' | 'accepted'
) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);

  const interest = await Interest.findOne({ _id: interestId, universityId: profile._id });
  if (!interest) throw new AppError(404, 'Interest not found', ErrorCodes.NOT_FOUND);
  const previousStatus = String((interest as { status?: string }).status ?? '');

  const updated = await Interest.findByIdAndUpdate(interestId, { status }, {
    new: true,
    populate: { path: 'studentId', select: 'userId firstName lastName', populate: { path: 'userId', select: 'email' } },
    lean: true,
  });
  if (updated) {
    const student = (updated as { studentId?: { userId?: unknown | { email?: string }; firstName?: string; lastName?: string } }).studentId;
    const studentUserId =
      student && typeof student.userId !== 'undefined'
        ? typeof student.userId === 'object' && student.userId !== null
          ? String((student.userId as { _id?: unknown })._id ?? '')
          : String(student.userId)
        : null;
    const studentEmail =
      student?.userId && typeof student.userId === 'object'
        ? String((student.userId as { email?: string }).email ?? '').trim() || undefined
        : undefined;
    const studentName = student ? [student.firstName, student.lastName].filter(Boolean).join(' ') || studentEmail || 'Student' : 'Student';
    const relatedChat =
      status === 'rejected' && previousStatus !== 'rejected'
        ? await Chat.findOne({ studentId: (interest as { studentId: unknown }).studentId, universityId: profile._id }).lean()
        : null;

    if (relatedChat) {
      const systemText = `${profile.universityName} closed the chat after rejecting your application. You can still view the conversation, but you can no longer send messages.`;
      const systemMessage = await Message.create({
        chatId: (relatedChat as { _id: unknown })._id,
        senderId: userId,
        type: 'system',
        message: systemText,
        metadata: {
          subtype: 'chat_blocked',
          reason: 'rejected',
          universityName: profile.universityName,
        },
      });

      const io = getIO();
      if (io) {
        io.to(`chat:${String((relatedChat as { _id: unknown })._id)}`).emit('new_message', {
          chatId: String((relatedChat as { _id: unknown })._id),
          message: {
            id: String((systemMessage as { _id: unknown })._id),
            chatId: String((relatedChat as { _id: unknown })._id),
            text: systemText,
            type: 'system',
            createdAt: (systemMessage as { createdAt?: Date }).createdAt ?? new Date(),
            metadata: {
              subtype: 'chat_blocked',
              reason: 'rejected',
              universityName: profile.universityName,
            },
            sender: { id: userId },
          },
        });
      }
    }

    if (studentUserId) {
      await notificationService.createNotification(studentUserId, {
        type: 'status_update',
        title: 'Application status updated',
        body: `${profile.universityName} updated your application status to ${status.replace('_', ' ')}`,
        referenceType: 'interest',
        referenceId: String(interestId),
        metadata: {
          interestId,
          status,
          universityName: profile.universityName,
          ...(relatedChat ? { chatId: String((relatedChat as { _id: unknown })._id) } : {}),
        },
      });
      const studentUser = await User.findById(studentUserId).select('email notificationPreferences').lean();
      const prefs = (studentUser as { notificationPreferences?: { emailApplicationUpdates?: boolean } })?.notificationPreferences;
      if (studentUser && (prefs?.emailApplicationUpdates !== false)) {
        const html = emailService.applicationStatusChangedHtml(profile.universityName ?? 'University', status, studentName);
        await emailService.sendMail((studentUser as { email: string }).email, 'Application status updated', html);
      }
    }
    return { ...updated, id: String((updated as { _id: unknown })._id) };
  }
  return null;
}

export async function getScholarships(userId: string) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const list = await Scholarship.find({ universityId: profile._id }).lean();
  return list.map((s) => ({ ...s, id: String((s as { _id: unknown })._id) }));
}

export async function createScholarship(
  userId: string,
  data: { name: string; coveragePercent: number; maxSlots: number; deadline?: Date; eligibility?: string }
) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const doc = await Scholarship.create({
    universityId: profile._id,
    name: data.name,
    coveragePercent: data.coveragePercent,
    maxSlots: data.maxSlots,
    remainingSlots: data.maxSlots,
    deadline: data.deadline ?? undefined,
    eligibility: data.eligibility ?? undefined,
  });
  return doc.toObject ? doc.toObject() : doc;
}

export async function updateScholarship(
  userId: string,
  scholarshipId: string,
  data: Partial<{ name: string; coveragePercent: number; maxSlots: number; deadline: Date; eligibility: string }>
) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const sch = await Scholarship.findOne({ _id: scholarshipId, universityId: profile._id });
  if (!sch) throw new AppError(404, 'Scholarship not found', ErrorCodes.NOT_FOUND);
  const updated = await Scholarship.findByIdAndUpdate(scholarshipId, data, { new: true }).lean();
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}

export async function deleteScholarship(userId: string, scholarshipId: string) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const sch = await Scholarship.findOne({ _id: scholarshipId, universityId: profile._id });
  if (!sch) throw new AppError(404, 'Scholarship not found', ErrorCodes.NOT_FOUND);
  const activeOffers = await Offer.countDocuments({ scholarshipId: sch._id, status: 'pending' });
  if (activeOffers > 0) {
    throw new AppError(400, 'Cannot delete scholarship with active offers', ErrorCodes.CONFLICT);
  }
  await Scholarship.findByIdAndDelete(scholarshipId);
  return { success: true };
}

export async function createOffer(
  userId: string,
  data: {
    studentId: string;
    scholarshipId?: string;
    coveragePercent: number;
    deadline?: Date;
    certificateTemplateId?: string;
    certificateData?: Record<string, string>;
  }
) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);

  const subscription = await subscriptionService.canSendOffer(userId);
  if (!subscription.allowed) {
    throw new AppError(402, `Student request limit reached (${subscription.current}/${subscription.limit ?? '?'}). Upgrade to Premium for unlimited requests.`, ErrorCodes.PAYMENT_REQUIRED);
  }

  const studentProfile = await StudentProfile.findById(data.studentId);
  if (!studentProfile) throw new AppError(404, 'Student not found', ErrorCodes.NOT_FOUND);

  if (data.scholarshipId) {
    const sch = await Scholarship.findOne({ _id: data.scholarshipId, universityId: profile._id });
    if (!sch) throw new AppError(404, 'Scholarship not found', ErrorCodes.NOT_FOUND);
    if (sch.remainingSlots < 1) throw new AppError(400, 'No remaining slots', ErrorCodes.CONFLICT);
  }

  let certificateTitle: string | undefined;
  let certificateBody: string | undefined;
  let certificateMeta: Record<string, unknown> | undefined;

  if (data.certificateTemplateId) {
    const tmpl = await OfferCertificateTemplate.findOne({
      _id: data.certificateTemplateId,
      universityUserId: userId,
    }).lean();
    if (!tmpl) {
      throw new AppError(404, 'Offer certificate template not found', ErrorCodes.NOT_FOUND);
    }
    const payload = data.certificateData ?? {};
    const vis = effectiveProfileVisibility((studentProfile as { profileVisibility?: unknown }).profileVisibility);
    const studentName =
      vis === 'public'
        ? [studentProfile.firstName, studentProfile.lastName].filter(Boolean).join(' ') || 'Student'
        : 'Student';
    const universityName = profile.universityName ?? 'University';
    const replacements: Record<string, string> = {
      studentName,
      universityName,
      date: new Date().toLocaleDateString(),
      ...payload,
    };
    const render = (tpl?: string | null) =>
      tpl
        ? Object.entries(replacements).reduce(
            (acc, [key, val]) => acc.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), String(val)),
            tpl
          )
        : undefined;
    certificateTitle = render((tmpl as { titleTemplate?: string }).titleTemplate) ?? tmpl.name;
    certificateBody = render((tmpl as { bodyTemplate: string }).bodyTemplate);
    certificateMeta = { templateId: String(tmpl._id), ...payload };
  }

  const offer = await Offer.create({
    studentId: data.studentId,
    universityId: profile._id,
    scholarshipId: data.scholarshipId ?? undefined,
    coveragePercent: data.coveragePercent,
    deadline: data.deadline ?? undefined,
    certificateTemplateId: data.certificateTemplateId ?? undefined,
    certificateTitle,
    certificateBody,
    certificateMeta,
  });

  if (data.scholarshipId) {
    await Scholarship.findByIdAndUpdate(data.scholarshipId, { $inc: { remainingSlots: -1 } });
  }

  await Interest.updateMany(
    { studentId: data.studentId, universityId: profile._id },
    { status: 'offer_sent' }
  );

  await notificationService.createNotification(String(studentProfile.userId), {
    type: 'offer',
    title: 'New offer',
    body: `You have received an offer from ${profile.universityName}`,
    referenceType: 'offer',
    referenceId: String(offer._id),
    metadata: { offerId: String(offer._id), universityName: profile.universityName },
  });

  return offer.toObject ? offer.toObject() : offer;
}

export async function listOfferTemplates(userId: string) {
  const templates = await OfferCertificateTemplate.find({ universityUserId: userId })
    .sort({ createdAt: -1 })
    .lean();
  return templates.map((t) => ({ ...t, id: String((t as { _id: unknown })._id) }));
}

export async function createOfferTemplate(
  userId: string,
  body: {
    name: string;
    layoutKey?: 'classic' | 'modern' | 'minimal';
    primaryColor?: string;
    accentColor?: string;
    backgroundImageUrl?: string;
    bodyTemplate: string;
    titleTemplate?: string;
    isDefault?: boolean;
  }
) {
  const doc = await OfferCertificateTemplate.create({
    universityUserId: userId,
    name: body.name,
    layoutKey: body.layoutKey ?? 'classic',
    primaryColor: body.primaryColor,
    accentColor: body.accentColor,
    backgroundImageUrl: body.backgroundImageUrl,
    bodyTemplate: body.bodyTemplate,
    titleTemplate: body.titleTemplate,
    isDefault: body.isDefault ?? false,
  });
  const t = doc.toObject() as Record<string, unknown>;
  return { ...t, id: String(t._id) };
}

export async function updateOfferTemplate(
  userId: string,
  templateId: string,
  patch: {
    name?: string;
    layoutKey?: 'classic' | 'modern' | 'minimal';
    primaryColor?: string;
    accentColor?: string;
    backgroundImageUrl?: string;
    bodyTemplate?: string;
    titleTemplate?: string;
    isDefault?: boolean;
  }
) {
  const doc = await OfferCertificateTemplate.findOneAndUpdate(
    { _id: templateId, universityUserId: userId },
    patch,
    { new: true }
  ).lean();
  if (!doc) throw new AppError(404, 'Offer certificate template not found', ErrorCodes.NOT_FOUND);
  return { ...doc, id: String((doc as { _id: unknown })._id) };
}

export async function deleteOfferTemplate(userId: string, templateId: string) {
  const doc = await OfferCertificateTemplate.findOneAndDelete({ _id: templateId, universityUserId: userId }).lean();
  if (!doc) throw new AppError(404, 'Offer certificate template not found', ErrorCodes.NOT_FOUND);
  return { success: true };
}

export async function getRecommendations(userId: string) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const list = await Recommendation.find({ universityId: profile._id })
    .sort({ matchScore: -1 })
    .populate('studentId')
    .lean();
  return list.map((r) => ({ ...r, id: String((r as { _id: unknown })._id), student: (r as { studentId?: unknown }).studentId }));
}

/** List catalog universities for selection page (no auth to profile required). */
export async function getCatalogUniversities(query?: { search?: string; country?: string }) {
  const filter: Record<string, unknown> = {};
  if (query?.country?.trim()) filter.country = query.country.trim();
  if (query?.search?.trim()) {
    const re = safeRegExp(query.search.trim());
    filter.$or = [
      { universityName: re },
      { city: re },
    ];
  }
  const list = await UniversityCatalog.find(filter).sort({ universityName: 1 }).lean();
  return list.map((u) => ({
    ...u,
    id: String((u as { _id: unknown })._id),
    name: (u as { universityName?: string }).universityName ?? '',
  }));
}

/** Create verification request: user claims a catalog university. If customName/customYear provided, creates a new catalog entry first. */
export async function createVerificationRequest(
  userId: string,
  universityCatalogIdOrCustom: string | { universityName: string; establishedYear?: number }
) {
  let universityCatalogId: unknown;
  let universityName = '';
  if (typeof universityCatalogIdOrCustom === 'string') {
    const catalog = await UniversityCatalog.findById(universityCatalogIdOrCustom);
    if (!catalog) throw new AppError(404, 'University not found in catalog', ErrorCodes.NOT_FOUND);
    universityCatalogId = (catalog as { _id: unknown })._id;
    universityName = (catalog as { universityName?: string }).universityName ?? '';
  } else {
    const { universityName: name, establishedYear } = universityCatalogIdOrCustom;
    const n = String(name ?? '').trim();
    if (!n) throw new AppError(400, 'University name is required', ErrorCodes.VALIDATION);
    const created = await UniversityCatalog.create({
      universityName: n,
      establishedYear: establishedYear != null ? Number(establishedYear) : undefined,
    });
    universityCatalogId = (created as { _id: unknown })._id;
    universityName = n;
  }

  const existing = await UniversityVerificationRequest.findOne({
    userId,
    universityCatalogId,
    status: 'pending',
  });
  if (existing) throw new AppError(400, 'Request already sent for this university', ErrorCodes.CONFLICT);
  const existingProfile = await UniversityProfile.findOne({ userId });
  if (existingProfile) throw new AppError(400, 'University profile already exists', ErrorCodes.CONFLICT);
  const req = await UniversityVerificationRequest.create({
    universityCatalogId,
    userId,
    status: 'pending',
  });

  const user = await User.findById(userId).select('email name').lean();
  const email = (user as { email?: string } | null)?.email ?? '';
  const applicantName = (user as { name?: string } | null)?.name?.trim();
  const applicantLabel = applicantName || email;
  const admins = await User.find({ role: 'admin' }).select('_id').lean();
  for (const admin of admins) {
    const adminId = String((admin as { _id: unknown })._id);
    await notificationService.createNotification(adminId, {
      type: 'university_verification_request',
      title: 'University verification request',
      body: `New university "${applicantLabel}" has submitted an application for "${universityName}". Review in Admin → University requests.`,
      referenceType: 'university_verification_request',
      referenceId: String((req as { _id: unknown })._id),
      metadata: { email, universityName, requestId: String((req as { _id: unknown })._id) },
    });
  }

  return { id: String((req as { _id: unknown })._id), status: 'pending' };
}

export async function listFlyers(userId: string) {
  const profile = await UniversityProfile.findOne({ userId }).select('_id').lean();
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const list = await UniversityFlyer.find({ universityId: (profile as { _id: unknown })._id })
    .sort({ createdAt: -1 })
    .lean();
  return list.map((item) => ({ ...item, id: String((item as { _id: unknown })._id) }));
}

export async function createFlyer(
  userId: string,
  payload: {
    title?: string;
    source?: 'upload' | 'url' | 'editor';
    mediaUrl?: string;
    mediaType?: string;
    canvasJson?: string;
    pageFormat?: 'A4_PORTRAIT' | 'A4_LANDSCAPE' | 'LETTER' | 'CUSTOM';
    width?: number;
    height?: number;
    editorVersion?: string;
    previewImageUrl?: string;
    isPublished?: boolean;
  }
) {
  const profile = await UniversityProfile.findOne({ userId }).select('_id').lean();
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const source = payload.source ?? 'url';
  if (source === 'editor' && !payload.canvasJson) {
    throw new AppError(400, 'canvasJson is required for editor flyer', ErrorCodes.VALIDATION);
  }
  if ((source === 'url' || source === 'upload') && !String(payload.mediaUrl ?? '').trim()) {
    throw new AppError(400, 'mediaUrl is required', ErrorCodes.VALIDATION);
  }
  const created = await UniversityFlyer.create({
    universityId: (profile as { _id: unknown })._id,
    title: payload.title?.trim() || undefined,
    source,
    mediaUrl: payload.mediaUrl?.trim() || undefined,
    mediaType: payload.mediaType?.trim() || undefined,
    canvasJson: payload.canvasJson,
    pageFormat: payload.pageFormat,
    width: payload.width,
    height: payload.height,
    editorVersion: payload.editorVersion,
    previewImageUrl: payload.previewImageUrl?.trim() || undefined,
    isPublished: payload.isPublished !== false,
  });
  const out = created.toObject() as Record<string, unknown>;
  return { ...out, id: String(out._id) };
}

export async function updateFlyer(
  userId: string,
  flyerId: string,
  payload: Record<string, unknown>
) {
  const profile = await UniversityProfile.findOne({ userId }).select('_id').lean();
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const flyer = await UniversityFlyer.findOneAndUpdate(
    { _id: flyerId, universityId: (profile as { _id: unknown })._id },
    payload,
    { new: true }
  ).lean();
  if (!flyer) throw new AppError(404, 'Flyer not found', ErrorCodes.NOT_FOUND);
  return { ...flyer, id: String((flyer as { _id: unknown })._id) };
}

export async function deleteFlyer(userId: string, flyerId: string) {
  const profile = await UniversityProfile.findOne({ userId }).select('_id').lean();
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const deleted = await UniversityFlyer.findOneAndDelete({ _id: flyerId, universityId: (profile as { _id: unknown })._id }).lean();
  if (!deleted) throw new AppError(404, 'Flyer not found', ErrorCodes.NOT_FOUND);
  return { success: true };
}
