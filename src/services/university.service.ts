import {
  User,
  StudentProfile,
  UniversityProfile,
  Program,
  Scholarship,
  Interest,
  Offer,
  Recommendation,
  Notification,
} from '../models';
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

  return {
    pipeline,
    pendingOffers: offers,
    topRecommendations: recs.map((r) => ({ ...r, id: String((r as { _id: unknown })._id), student: (r as { studentId?: unknown }).studentId })),
  };
}

export async function getStudents(userId: string, query: { page?: number; limit?: number }) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);

  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;

  const [recs, total] = await Promise.all([
    Recommendation.find({ universityId: profile._id })
      .sort({ matchScore: -1 })
      .skip(skip)
      .limit(limit)
      .populate('studentId')
      .lean(),
    Recommendation.countDocuments({ universityId: profile._id }),
  ]);

  return {
    data: recs.map((r) => ({ ...r, id: String((r as { _id: unknown })._id), student: (r as { studentId?: unknown }).studentId })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getPipeline(userId: string) {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);

  const list = await Interest.find({ universityId: profile._id })
    .populate('studentId')
    .sort({ updatedAt: -1 })
    .lean();
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

  const updated = await Interest.findByIdAndUpdate(interestId, { status }, { new: true }).lean();
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
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

  await Notification.create({
    userId: studentProfile.userId,
    type: 'offer',
    title: 'New offer',
    body: `You have received an offer from ${profile.universityName}`,
    referenceId: String(offer._id),
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
