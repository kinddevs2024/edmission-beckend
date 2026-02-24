import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database';
import { AppError, ErrorCodes } from '../utils/errors';

export async function getProfile(userId: string) {
  const profile = await prisma.studentProfile.findFirst({
    where: { userId },
    include: { user: { select: { email: true, emailVerified: true } } },
  });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);
  return profile;
}

export async function updateProfile(userId: string, data: Record<string, unknown>) {
  const profile = await prisma.studentProfile.findFirst({
    where: { userId },
  });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const update: {
    firstName?: string;
    lastName?: string;
    birthDate?: Date | null;
    country?: string;
    gradeLevel?: string;
    gpa?: Decimal;
    languageLevel?: string;
    bio?: string;
    avatarUrl?: string;
    needsRecalculation: boolean;
  } = { needsRecalculation: true };

  if (data.firstName !== undefined) update.firstName = String(data.firstName);
  if (data.lastName !== undefined) update.lastName = String(data.lastName);
  if (data.birthDate !== undefined) {
    update.birthDate = data.birthDate ? new Date(data.birthDate as string) : null;
  }
  if (data.country !== undefined) update.country = String(data.country);
  if (data.gradeLevel !== undefined) update.gradeLevel = String(data.gradeLevel);
  if (data.gpa !== undefined) update.gpa = new Decimal(Number(data.gpa));
  if (data.languageLevel !== undefined) update.languageLevel = String(data.languageLevel);
  if (data.bio !== undefined) update.bio = String(data.bio);
  if (data.avatarUrl !== undefined) update.avatarUrl = String(data.avatarUrl);

  return prisma.studentProfile.update({
    where: { id: profile.id },
    data: update,
  });
}

export async function getDashboard(userId: string) {
  const profile = await prisma.studentProfile.findFirst({
    where: { userId },
  });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const [recommendations, interests, offers] = await Promise.all([
    prisma.recommendation.findMany({
      where: { studentId: profile.id },
      orderBy: { matchScore: 'desc' },
      take: 5,
      include: { university: { select: { universityName: true, country: true, city: true } } },
    }),
    prisma.interest.findMany({
      where: { studentId: profile.id },
      include: { university: { select: { universityName: true } } },
    }),
    prisma.offer.findMany({
      where: { studentId: profile.id },
      include: {
        university: { select: { universityName: true } },
        scholarship: { select: { name: true } },
      },
    }),
  ]);

  const chatCount = await prisma.chat.count({
    where: { studentId: profile.id },
  });

  return {
    profile: { portfolioCompletionPercent: profile.portfolioCompletionPercent },
    topRecommendations: recommendations,
    applications: interests,
    offers,
    chatCount,
  };
}

export async function getUniversities(userId: string, query: { page?: number; limit?: number; country?: string }) {
  const profile = await prisma.studentProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;

  const where = { verified: true } as { verified: boolean; country?: string };
  if (query.country) where.country = query.country;

  const [list, total] = await Promise.all([
    prisma.universityProfile.findMany({
      where,
      skip,
      take: limit,
      include: {
        programs: { take: 3 },
        _count: { select: { scholarships: true } },
      },
    }),
    prisma.universityProfile.count({ where }),
  ]);

  const recs = await prisma.recommendation.findMany({
    where: { studentId: profile.id, universityId: { in: list.map((u) => u.id) } },
  });
  const recMap = Object.fromEntries(recs.map((r) => [r.universityId, r]));

  const data = list.map((u) => ({
    ...u,
    matchScore: recMap[u.id]?.matchScore ?? null,
    breakdown: recMap[u.id]?.breakdown ?? null,
  }));

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getUniversityById(userId: string, universityId: string) {
  const profile = await prisma.studentProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const university = await prisma.universityProfile.findUnique({
    where: { id: universityId },
    include: { programs: true, scholarships: true },
  });
  if (!university) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);

  const rec = await prisma.recommendation.findUnique({
    where: {
      studentId_universityId: { studentId: profile.id, universityId },
    },
  });

  const interest = await prisma.interest.findUnique({
    where: {
      studentId_universityId: { studentId: profile.id, universityId },
    },
  });

  return { ...university, matchScore: rec?.matchScore ?? null, breakdown: rec?.breakdown ?? null, interest };
}

export async function addInterest(userId: string, universityId: string) {
  const profile = await prisma.studentProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const uni = await prisma.universityProfile.findUnique({ where: { id: universityId } });
  if (!uni) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);

  const interest = await prisma.interest.upsert({
    where: {
      studentId_universityId: { studentId: profile.id, universityId },
    },
    create: { studentId: profile.id, universityId, status: 'interested' },
    update: { status: 'interested' },
  });
  return interest;
}

export async function getApplications(userId: string) {
  const profile = await prisma.studentProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  return prisma.interest.findMany({
    where: { studentId: profile.id },
    include: { university: { select: { universityName: true, country: true, city: true } } },
  });
}

export async function getOffers(userId: string) {
  const profile = await prisma.studentProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  return prisma.offer.findMany({
    where: { studentId: profile.id },
    include: {
      university: { select: { universityName: true } },
      scholarship: { select: { name: true, coveragePercent: true } },
    },
  });
}

export async function acceptOffer(userId: string, offerId: string) {
  const profile = await prisma.studentProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const offer = await prisma.offer.findFirst({
    where: { id: offerId, studentId: profile.id },
    include: { scholarship: true },
  });
  if (!offer) throw new AppError(404, 'Offer not found', ErrorCodes.NOT_FOUND);
  if (offer.status !== 'pending') throw new AppError(400, 'Offer already processed', ErrorCodes.CONFLICT);

  await prisma.$transaction([
    prisma.offer.update({
      where: { id: offerId },
      data: { status: 'accepted' },
    }),
    prisma.interest.updateMany({
      where: { studentId: profile.id, universityId: offer.universityId },
      data: { status: 'accepted' },
    }),
    ...(offer.scholarshipId && offer.scholarship
      ? [
          prisma.scholarship.update({
            where: { id: offer.scholarshipId },
            data: { remainingSlots: { decrement: 1 } },
          }),
        ]
      : []),
  ]);

  return prisma.offer.findUnique({ where: { id: offerId } });
}

export async function declineOffer(userId: string, offerId: string) {
  const profile = await prisma.studentProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  const offer = await prisma.offer.findFirst({
    where: { id: offerId, studentId: profile.id },
  });
  if (!offer) throw new AppError(404, 'Offer not found', ErrorCodes.NOT_FOUND);
  if (offer.status !== 'pending') throw new AppError(400, 'Offer already processed', ErrorCodes.CONFLICT);

  await prisma.offer.update({
    where: { id: offerId },
    data: { status: 'declined' },
  });
  return prisma.offer.findUnique({ where: { id: offerId } });
}

export async function getRecommendations(userId: string) {
  const profile = await prisma.studentProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);

  return prisma.recommendation.findMany({
    where: { studentId: profile.id },
    orderBy: { matchScore: 'desc' },
    include: { university: { include: { programs: { take: 2 } } } },
  });
}

export async function getCompare(userId: string, ids: string[]) {
  const profile = await prisma.studentProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);
  if (!ids.length || ids.length > 5) {
    throw new AppError(400, 'Provide 1-5 university ids', ErrorCodes.VALIDATION);
  }

  const universities = await prisma.universityProfile.findMany({
    where: { id: { in: ids } },
    include: { programs: true, scholarships: true },
  });
  const recs = await prisma.recommendation.findMany({
    where: { studentId: profile.id, universityId: { in: ids } },
  });
  const recMap = Object.fromEntries(recs.map((r) => [r.universityId, r]));
  return universities.map((u) => ({
    ...u,
    matchScore: recMap[u.id]?.matchScore ?? null,
    breakdown: recMap[u.id]?.breakdown ?? null,
  }));
}
