import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database';
import { AppError, ErrorCodes } from '../utils/errors';

export async function getProfile(userId: string) {
  const profile = await prisma.universityProfile.findFirst({
    where: { userId },
    include: { user: { select: { email: true } }, programs: true, scholarships: true },
  });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  return profile;
}

export async function updateProfile(userId: string, data: Record<string, unknown>) {
  const profile = await prisma.universityProfile.findFirst({
    where: { userId },
  });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);

  const raw = data as {
    programs?: Array<Record<string, unknown>>;
    scholarships?: Array<Record<string, unknown>>;
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
  const { programs, scholarships, ...rest } = raw;

  const update: Parameters<typeof prisma.universityProfile.update>[0]['data'] = {
    needsRecalculation: true,
  };
  if (rest.universityName !== undefined) update.universityName = rest.universityName;
  if (rest.tagline !== undefined) update.tagline = rest.tagline;
  if (rest.establishedYear !== undefined) update.establishedYear = rest.establishedYear;
  if (rest.studentCount !== undefined) update.studentCount = rest.studentCount;
  if (rest.country !== undefined) update.country = rest.country;
  if (rest.city !== undefined) update.city = rest.city;
  if (rest.description !== undefined) update.description = rest.description;
  if (rest.logoUrl !== undefined) update.logoUrl = rest.logoUrl;
  if (rest.onboardingCompleted !== undefined) update.onboardingCompleted = rest.onboardingCompleted;

  const updated = await prisma.universityProfile.update({
    where: { id: profile.id },
    data: update,
  });

  if (programs?.length) {
    await prisma.program.deleteMany({ where: { universityId: profile.id } });
    for (const p of programs) {
      await prisma.program.create({
        data: {
          universityId: profile.id,
          name: String(p.name),
          degreeLevel: String(p.degreeLevel),
          field: String(p.field),
          durationYears: p.durationYears != null ? new Decimal(Number(p.durationYears)) : null,
          tuitionFee: p.tuitionFee != null ? new Decimal(Number(p.tuitionFee)) : null,
          language: p.language != null ? String(p.language) : null,
          entryRequirements: p.entryRequirements != null ? String(p.entryRequirements) : null,
        },
      });
    }
  }
  return updated;
}

export async function getDashboard(userId: string) {
  const profile = await prisma.universityProfile.findFirst({
    where: { userId },
  });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);

  const [byStatus, offers, recs] = await Promise.all([
    prisma.interest.groupBy({
      by: ['status'],
      where: { universityId: profile.id },
      _count: true,
    }),
    prisma.offer.count({ where: { universityId: profile.id, status: 'pending' } }),
    prisma.recommendation.findMany({
      where: { universityId: profile.id },
      orderBy: { matchScore: 'desc' },
      take: 5,
      include: { student: { select: { firstName: true, lastName: true, gpa: true, country: true } } },
    }),
  ]);

  return {
    pipeline: byStatus,
    pendingOffers: offers,
    topRecommendations: recs,
  };
}

export async function getStudents(userId: string, query: { page?: number; limit?: number }) {
  const profile = await prisma.universityProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);

  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;

  const recs = await prisma.recommendation.findMany({
    where: { universityId: profile.id },
    orderBy: { matchScore: 'desc' },
    skip,
    take: limit,
    include: { student: true },
  });

  const total = await prisma.recommendation.count({
    where: { universityId: profile.id },
  });

  return {
    data: recs,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getPipeline(userId: string) {
  const profile = await prisma.universityProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);

  return prisma.interest.findMany({
    where: { universityId: profile.id },
    include: { student: true },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function updateInterestStatus(
  userId: string,
  interestId: string,
  status: 'under_review' | 'chat_opened' | 'offer_sent' | 'rejected' | 'accepted'
) {
  const profile = await prisma.universityProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);

  const interest = await prisma.interest.findFirst({
    where: { id: interestId, universityId: profile.id },
  });
  if (!interest) throw new AppError(404, 'Interest not found', ErrorCodes.NOT_FOUND);

  return prisma.interest.update({
    where: { id: interestId },
    data: { status },
  });
}

export async function getScholarships(userId: string) {
  const profile = await prisma.universityProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  return prisma.scholarship.findMany({ where: { universityId: profile.id } });
}

export async function createScholarship(
  userId: string,
  data: { name: string; coveragePercent: number; maxSlots: number; deadline?: Date; eligibility?: string }
) {
  const profile = await prisma.universityProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  return prisma.scholarship.create({
    data: {
      universityId: profile.id,
      name: data.name,
      coveragePercent: data.coveragePercent,
      maxSlots: data.maxSlots,
      remainingSlots: data.maxSlots,
      deadline: data.deadline ?? null,
      eligibility: data.eligibility ?? null,
    },
  });
}

export async function updateScholarship(
  userId: string,
  scholarshipId: string,
  data: Partial<{ name: string; coveragePercent: number; maxSlots: number; deadline: Date; eligibility: string }>
) {
  const profile = await prisma.universityProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const sch = await prisma.scholarship.findFirst({
    where: { id: scholarshipId, universityId: profile.id },
  });
  if (!sch) throw new AppError(404, 'Scholarship not found', ErrorCodes.NOT_FOUND);
  return prisma.scholarship.update({
    where: { id: scholarshipId },
    data,
  });
}

export async function deleteScholarship(userId: string, scholarshipId: string) {
  const profile = await prisma.universityProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  const sch = await prisma.scholarship.findFirst({
    where: { id: scholarshipId, universityId: profile.id },
  });
  if (!sch) throw new AppError(404, 'Scholarship not found', ErrorCodes.NOT_FOUND);
  const activeOffers = await prisma.offer.count({
    where: { scholarshipId, status: 'pending' },
  });
  if (activeOffers > 0) {
    throw new AppError(400, 'Cannot delete scholarship with active offers', ErrorCodes.CONFLICT);
  }
  await prisma.scholarship.delete({ where: { id: scholarshipId } });
  return { success: true };
}

export async function createOffer(
  userId: string,
  data: { studentId: string; scholarshipId?: string; coveragePercent: number; deadline?: Date }
) {
  const profile = await prisma.universityProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);

  const studentProfile = await prisma.studentProfile.findUnique({
    where: { id: data.studentId },
  });
  if (!studentProfile) throw new AppError(404, 'Student not found', ErrorCodes.NOT_FOUND);

  if (data.scholarshipId) {
    const sch = await prisma.scholarship.findFirst({
      where: { id: data.scholarshipId, universityId: profile.id },
    });
    if (!sch) throw new AppError(404, 'Scholarship not found', ErrorCodes.NOT_FOUND);
    if (sch.remainingSlots < 1) throw new AppError(400, 'No remaining slots', ErrorCodes.CONFLICT);
  }

  const offer = await prisma.offer.create({
    data: {
      studentId: data.studentId,
      universityId: profile.id,
      scholarshipId: data.scholarshipId ?? null,
      coveragePercent: data.coveragePercent,
      deadline: data.deadline ?? null,
    },
  });

  if (data.scholarshipId) {
    await prisma.scholarship.update({
      where: { id: data.scholarshipId },
      data: { remainingSlots: { decrement: 1 } },
    });
  }

  await prisma.interest.updateMany({
    where: { studentId: data.studentId, universityId: profile.id },
    data: { status: 'offer_sent' },
  });

  await prisma.notification.create({
    data: {
      userId: studentProfile.userId,
      type: 'offer',
      title: 'New offer',
      body: `You have received an offer from ${profile.universityName}`,
      referenceId: offer.id,
    },
  });

  return offer;
}

export async function getRecommendations(userId: string) {
  const profile = await prisma.universityProfile.findFirst({ where: { userId } });
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  return prisma.recommendation.findMany({
    where: { universityId: profile.id },
    orderBy: { matchScore: 'desc' },
    include: { student: true },
  });
}
