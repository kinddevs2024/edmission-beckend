import mongoose from 'mongoose';
import {
  StudentProfile,
  UniversityProfile,
  Program,
  Scholarship,
  Interest,
  Offer,
  Recommendation,
  Chat,
} from '../models';
import { AppError, ErrorCodes } from '../utils/errors';

export async function getProfile(userId: string) {
  const profile = await StudentProfile.findOne({ userId })
    .lean();
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);
  const user = await mongoose.model('User').findById(userId).select('email emailVerified').lean() as Record<string, unknown> | null;
  return {
    ...profile,
    id: String((profile as { _id: unknown })._id),
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
  if (data.gradeLevel !== undefined) update.gradeLevel = String(data.gradeLevel);
  if (data.gpa !== undefined) update.gpa = Number(data.gpa);
  if (data.languageLevel !== undefined) update.languageLevel = String(data.languageLevel);
  if (data.bio !== undefined) update.bio = String(data.bio);
  if (data.avatarUrl !== undefined) update.avatarUrl = String(data.avatarUrl);

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

export async function getUniversities(userId: string, query: { page?: number; limit?: number; country?: string }) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;

  const where: { verified: boolean; country?: string } = { verified: true };
  if (query.country) where.country = query.country;

  const [list, total] = await Promise.all([
    UniversityProfile.find(where).skip(skip).limit(limit).lean(),
    UniversityProfile.countDocuments(where),
  ]);

  const listIds = list.map((u) => (u as { _id: unknown })._id);
  const recs = await Recommendation.find({
    studentId: profile._id,
    universityId: { $in: listIds },
  }).lean();
  const recMap: Record<string, { matchScore: number; breakdown?: unknown }> = {};
  for (const r of recs) {
    const uid = String((r as { universityId: unknown }).universityId);
    recMap[uid] = { matchScore: (r as { matchScore: number }).matchScore, breakdown: (r as { breakdown?: unknown }).breakdown };
  }

  const scholarshipCounts = await Scholarship.aggregate([
    { $match: { universityId: { $in: listIds } } },
    { $group: { _id: '$universityId', count: { $sum: 1 } } },
  ]);
  const schCountMap: Record<string, number> = {};
  for (const s of scholarshipCounts) {
    schCountMap[String(s._id)] = s.count;
  }

  const programsByUni = await Program.aggregate([
    { $match: { universityId: { $in: listIds } } },
    { $sort: { createdAt: 1 } },
    { $group: { _id: '$universityId', programs: { $push: '$$ROOT' } } },
  ]);
  const programsMap: Record<string, unknown[]> = {};
  for (const p of programsByUni) {
    programsMap[String(p._id)] = (p.programs as unknown[]).slice(0, 3);
  }

  const dataWithCount = list.map((u) => {
    const id = String((u as { _id: unknown })._id);
    return {
      ...u,
      id,
      programs: programsMap[id] ?? [],
      _count: { scholarships: schCountMap[id] ?? 0 },
      matchScore: recMap[id]?.matchScore ?? null,
      breakdown: recMap[id]?.breakdown ?? null,
    };
  });

  return {
    data: dataWithCount,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getUniversityById(userId: string, universityId: string) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const university = await UniversityProfile.findById(universityId).lean();
  if (!university) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);

  const rec = await Recommendation.findOne({
    studentId: profile._id,
    universityId,
  }).lean();
  const interest = await Interest.findOne({
    studentId: profile._id,
    universityId,
  }).lean();

  const programs = await Program.find({ universityId }).lean();
  const scholarships = await Scholarship.find({ universityId }).lean();

  return {
    ...university,
    id: String((university as { _id: unknown })._id),
    programs,
    scholarships,
    matchScore: rec ? (rec as { matchScore: number }).matchScore : null,
    breakdown: rec ? (rec as { breakdown?: unknown }).breakdown : null,
    interest: interest ? { ...interest, id: String((interest as { _id: unknown })._id) } : null,
  };
}

export async function addInterest(userId: string, universityId: string) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const uni = await UniversityProfile.findById(universityId);
  if (!uni) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);

  const interest = await Interest.findOneAndUpdate(
    { studentId: profile._id, universityId },
    { status: 'interested' },
    { upsert: true, new: true }
  ).lean();
  return { ...interest, id: String((interest as { _id: unknown })._id) };
}

export async function getApplications(userId: string) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const list = await Interest.find({ studentId: profile._id })
    .populate('universityId', 'universityName country city')
    .lean();
  return list.map((i: Record<string, unknown>) => {
    const uni = i.universityId as { universityName?: string; country?: string; city?: string } | undefined;
    return {
      ...i,
      id: String(i._id),
      university: uni ? { universityName: uni.universityName, country: uni.country, city: uni.city } : undefined,
    };
  });
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

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await Offer.findByIdAndUpdate(offerId, { status: 'accepted' }, { session });
    await Interest.updateMany(
      { studentId: profile._id, universityId: offer.universityId },
      { status: 'accepted' },
      { session }
    );
    if (offer.scholarshipId) {
      await Scholarship.findByIdAndUpdate(
        offer.scholarshipId,
        { $inc: { remainingSlots: -1 } },
        { session }
      );
    }
    await session.commitTransaction();
  } finally {
    session.endSession();
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

export async function getCompare(userId: string, ids: string[]) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);
  if (!ids.length || ids.length > 5) {
    throw new AppError(400, 'Provide 1-5 university ids', ErrorCodes.VALIDATION);
  }

  const universities = await UniversityProfile.find({ _id: { $in: ids } })
    .populate('programs')
    .populate('scholarships')
    .lean();
  const recs = await Recommendation.find({
    studentId: profile._id,
    universityId: { $in: ids },
  }).lean();
  const recMap: Record<string, { matchScore: number; breakdown?: unknown }> = {};
  for (const r of recs) {
    const uid = String((r as { universityId: unknown }).universityId);
    recMap[uid] = { matchScore: (r as { matchScore: number }).matchScore, breakdown: (r as { breakdown?: unknown }).breakdown };
  }

  return universities.map((u) => {
    const id = String((u as { _id: unknown })._id);
    return {
      ...u,
      id,
      matchScore: recMap[id]?.matchScore ?? null,
      breakdown: recMap[id]?.breakdown ?? null,
    };
  });
}
