import {
  User,
  StudentProfile,
  UniversityProfile,
  Program,
  Scholarship,
  Interest,
  Offer,
  Recommendation,
  StudentDocument,
} from '../models';
import * as notificationService from './notification.service';
import * as subscriptionService from './subscription.service';
import * as emailService from './email.service';
import { AppError, ErrorCodes } from '../utils/errors';

export async function getProfile(userId: string) {
  const profile = await UniversityProfile.findOne({ userId }).lean();
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const programs = await Program.find({ universityId: profile._id }).lean();
  const scholarships = await Scholarship.find({ universityId: profile._id }).lean();
  const user = await User.findById(userId).select('email').lean();
  return {
    ...profile,
    id: String((profile as { _id: unknown })._id),
    user: user ? { email: (user as { email: string }).email } : undefined,
    programs,
    scholarships,
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
    logoUrl?: string;
    onboardingCompleted?: boolean;
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
  if (rest.logoUrl !== undefined) update.logoUrl = rest.logoUrl;
  if (rest.onboardingCompleted !== undefined) update.onboardingCompleted = rest.onboardingCompleted;

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
      .populate('studentId', 'firstName lastName gpa country')
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
    topRecommendations: recs.map((r) => ({ ...r, id: String((r as { _id: unknown })._id), student: (r as { studentId?: unknown }).studentId, matchScore: (r as { matchScore?: number }).matchScore })),
  };
}

export async function getStudents(
  userId: string,
  query: {
    page?: number;
    limit?: number;
    skills?: string[];
    interests?: string[];
    hobbies?: string[];
    country?: string;
    city?: string;
    languages?: string[];
    certType?: string;
    certMinScore?: string;
  }
) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);

  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};

  if (query.country?.trim()) filter.country = query.country.trim();
  if (query.city?.trim()) filter.city = new RegExp(query.city.trim(), 'i');

  const skills = Array.isArray(query.skills) ? query.skills.filter(Boolean) : [];
  const interests = Array.isArray(query.interests) ? query.interests.filter(Boolean) : [];
  const hobbies = Array.isArray(query.hobbies) ? query.hobbies.filter(Boolean) : [];
  if (skills.length > 0) filter.skills = { $in: skills };
  if (interests.length > 0) filter.interests = { $in: interests };
  if (hobbies.length > 0) filter.hobbies = { $in: hobbies };

  const languages = Array.isArray(query.languages) ? query.languages.filter(Boolean) : [];
  if (languages.length > 0) filter['languages.language'] = { $in: languages };

  let certStudentIds: unknown[] | undefined;
  if (query.certType?.trim()) {
    const certFilter: Record<string, unknown> = {
      type: 'language_certificate',
      certificateType: query.certType.trim(),
      status: 'approved',
    };
    const certDocs = await StudentDocument.find(certFilter).select('studentId score').lean();
    const minNum = query.certMinScore != null && query.certMinScore !== '' ? Number(query.certMinScore) : NaN;
    const ids = certDocs
      .filter((d) => Number.isNaN(minNum) || (parseFloat((d as { score?: string }).score ?? '0') >= minNum))
      .map((d) => (d as { studentId: unknown }).studentId);
    certStudentIds = ids.length > 0 ? [...new Set(ids)] : [null];
    filter._id = { $in: certStudentIds };
  }

  const [students, total, interestStudentIds] = await Promise.all([
    StudentProfile.find(filter)
      .select('firstName lastName country city gpa gradeLevel languages skills interests hobbies schoolName graduationYear')
      .sort({ gpa: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    StudentProfile.countDocuments(filter),
    Interest.find({ universityId: profile._id }).select('studentId').lean(),
  ]);

  const inPipelineSet = new Set(interestStudentIds.map((i) => String((i as { studentId: unknown }).studentId)));

  const data = students.map((s) => {
    const id = String((s as { _id: unknown })._id);
    return {
      id,
      student: s,
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

export async function getStudentProfileForUniversity(_userId: string, studentId: string) {
  const profile = await UniversityProfile.findOne({ userId: _userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);

  const student = await StudentProfile.findById(studentId).lean();
  if (!student) throw new AppError(404, 'Student not found', ErrorCodes.NOT_FOUND);

  const documents = await StudentDocument.find({ studentId, status: 'approved' })
    .select('type name certificateType score fileUrl')
    .lean();

  const docList = documents.map((d) => ({
    id: String((d as { _id: unknown })._id),
    type: (d as { type: string }).type,
    name: (d as { name?: string }).name,
    certificateType: (d as { certificateType?: string }).certificateType,
    score: (d as { score?: string }).score,
    fileUrl: (d as { fileUrl: string }).fileUrl,
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

  const out = { ...student };
  delete (out as Record<string, unknown>).userId;
  return {
    ...out,
    id: String((out as { _id: unknown })._id),
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
    .populate('studentId')
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

  return list.map((i) => ({ ...i, id: String((i as { _id: unknown })._id), student: (i as { studentId?: unknown }).studentId }));
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

  const updated = await Interest.findByIdAndUpdate(interestId, { status }, {
    new: true,
    populate: { path: 'studentId', select: 'userId firstName lastName' },
    lean: true,
  });
  if (updated) {
    const student = (updated as { studentId?: { userId?: unknown; firstName?: string; lastName?: string } }).studentId;
    const studentUserId = student && typeof student.userId !== 'undefined' ? String(student.userId) : null;
    const studentName = student ? [student.firstName, student.lastName].filter(Boolean).join(' ') || 'Student' : 'Student';
    if (studentUserId) {
      await notificationService.createNotification(studentUserId, {
        type: 'status_update',
        title: 'Application status updated',
        body: `${profile.universityName} updated your application status to ${status.replace('_', ' ')}`,
        referenceType: 'interest',
        referenceId: String(interestId),
        metadata: { interestId, status, universityName: profile.universityName },
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
  data: { studentId: string; scholarshipId?: string; coveragePercent: number; deadline?: Date }
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

  const offer = await Offer.create({
    studentId: data.studentId,
    universityId: profile._id,
    scholarshipId: data.scholarshipId ?? undefined,
    coveragePercent: data.coveragePercent,
    deadline: data.deadline ?? undefined,
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

export async function getRecommendations(userId: string) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const list = await Recommendation.find({ universityId: profile._id })
    .sort({ matchScore: -1 })
    .populate('studentId')
    .lean();
  return list.map((r) => ({ ...r, id: String((r as { _id: unknown })._id), student: (r as { studentId?: unknown }).studentId }));
}
