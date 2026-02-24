import { prisma } from '../config/database';
import { AppError, ErrorCodes } from '../utils/errors';

export async function getDashboard() {
  const [users, universities, offers, pendingVerification] = await Promise.all([
    prisma.user.count(),
    prisma.universityProfile.count(),
    prisma.offer.count({ where: { status: 'pending' } }),
    prisma.universityProfile.count({ where: { verified: false } }),
  ]);
  return { users, universities, pendingOffers: offers, pendingVerification };
}

export async function getUsers(query: { page?: number; limit?: number; role?: string }) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const where = query.role ? { role: query.role as 'student' | 'university' | 'admin' } : {};
  const [list, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      select: {
        id: true,
        email: true,
        role: true,
        emailVerified: true,
        suspended: true,
        createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);
  return { data: list, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function suspendUser(userId: string, suspend: boolean) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  if (user.role === 'admin') throw new AppError(403, 'Cannot suspend admin', ErrorCodes.FORBIDDEN);
  return prisma.user.update({
    where: { id: userId },
    data: { suspended: suspend },
  });
}

export async function getVerificationQueue() {
  return prisma.universityProfile.findMany({
    where: { verified: false },
    include: { user: { select: { email: true } }, documents: true },
  });
}

export async function verifyUniversity(universityId: string, approve: boolean) {
  const uni = await prisma.universityProfile.findUnique({
    where: { id: universityId },
  });
  if (!uni) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
  return prisma.universityProfile.update({
    where: { id: universityId },
    data: { verified: approve },
  });
}

export async function getScholarshipsMonitor() {
  return prisma.scholarship.findMany({
    include: { university: { select: { universityName: true } } },
  });
}

export async function getLogs(query: { page?: number; limit?: number; userId?: string; action?: string }) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const where: { userId?: string; action?: string } = {};
  if (query.userId) where.userId = query.userId;
  if (query.action) where.action = query.action;
  const [list, total] = await Promise.all([
    prisma.activityLog.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.activityLog.count({ where }),
  ]);
  return { data: list, total, page, limit, totalPages: Math.ceil(total / limit) };
}
