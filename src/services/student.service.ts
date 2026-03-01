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
import * as notificationService from './notification.service';
import * as subscriptionService from './subscription.service';
import { filterSkills, filterInterests, filterHobbies } from '../constants/profileCriteria';
import { AppError, ErrorCodes } from '../utils/errors';

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
  return {
    ...profile,
    id: String(profileObj._id),
    portfolioCompletionPercent,
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
  if (data.schoolCompleted !== undefined) update.schoolCompleted = Boolean(data.schoolCompleted);
  if (data.schoolName !== undefined) update.schoolName = String(data.schoolName);
  if (data.graduationYear !== undefined) update.graduationYear = data.graduationYear != null ? Number(data.graduationYear) : null;
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

export async function getUniversities(userId: string, query: { page?: number; limit?: number; country?: string; city?: string }) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;

  const where: { country?: string; city?: string } = {};
  if (query.country) where.country = query.country;
  if (query.city && String(query.city).trim()) where.city = String(query.city).trim();

  const [list, total] = await Promise.all([
    UniversityProfile.find(where).skip(skip).limit(limit).sort({ universityName: 1 }).lean(),
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
    const schCount = schCountMap[id] ?? 0;
    return {
      ...u,
      id,
      name: (u as { universityName?: string }).universityName ?? '',
      hasScholarship: schCount > 0,
      programs: programsMap[id] ?? [],
      _count: { scholarships: schCount },
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

  const subscription = await subscriptionService.canSendApplication(userId);
  if (!subscription.allowed) {
    if (subscription.trialExpired) {
      throw new AppError(402, 'Trial expired. Upgrade to a paid plan to continue sending applications.', ErrorCodes.PAYMENT_REQUIRED);
    }
    throw new AppError(402, `Application limit reached (${subscription.current}/${subscription.limit ?? '?'}). Upgrade your plan to send more.`, ErrorCodes.PAYMENT_REQUIRED);
  }

  const uni = await UniversityProfile.findById(universityId);
  if (!uni) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);

  const interest = await Interest.findOneAndUpdate(
    { studentId: profile._id, universityId },
    { status: 'interested' },
    { upsert: true, new: true }
  ).lean();
  const universityUserId = uni.userId ? String(uni.userId) : null;
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

export async function getApplications(userId: string) {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const list = await Interest.find({ studentId: profile._id })
    .populate('universityId', 'universityName country city')
    .lean();
  return list.map((i: Record<string, unknown>) => {
    const uni = i.universityId as { _id?: unknown; universityName?: string; country?: string; city?: string } | undefined;
    const universityIdStr = uni?._id != null ? String(uni._id) : i.universityId != null ? String(i.universityId) : '';
    return {
      ...i,
      id: String(i._id),
      universityId: universityIdStr,
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
    // Slot was already reserved when the offer was created; no need to decrement again
    await session.commitTransaction();
  } finally {
    session.endSession();
  }

  const universityProfile = await UniversityProfile.findById(offer.universityId).lean();
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

  const universityProfile = await UniversityProfile.findById(offer.universityId).lean();
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
