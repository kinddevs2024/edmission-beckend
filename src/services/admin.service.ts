import { User, UniversityProfile, Offer, Scholarship, ActivityLog, UniversityDocument, Subscription } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';
import * as subscriptionService from './subscription.service';
import * as ticketService from './ticket.service';
import * as studentDocumentService from './studentDocument.service';

export async function getDashboard() {
  const [users, universities, offers, pendingVerification, subStats] = await Promise.all([
    User.countDocuments(),
    UniversityProfile.countDocuments(),
    Offer.countDocuments({ status: 'pending' }),
    UniversityProfile.countDocuments({ verified: false }),
    Subscription.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$plan', count: { $sum: 1 } } },
    ]),
  ]);
  const byPlan: Record<string, number> = {};
  for (const s of subStats) {
    byPlan[s._id] = s.count;
  }
  const mrr = (byPlan['student_standard'] ?? 0) * 9.99 + (byPlan['student_max_premium'] ?? 0) * 19.99 + (byPlan['university_premium'] ?? 0) * 29.99;
  return { users, universities, pendingOffers: offers, pendingVerification, subscriptionsByPlan: byPlan, mrr: Math.round(mrr * 100) / 100 };
}

export async function getUsers(query: { page?: number; limit?: number; role?: string }) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const where = query.role ? { role: query.role } : {};
  const [list, total] = await Promise.all([
    User.find(where).skip(skip).limit(limit).select('email role emailVerified suspended createdAt').lean(),
    User.countDocuments(where),
  ]);
  return {
    data: list.map((u) => ({ ...u, id: String((u as { _id: unknown })._id) })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function suspendUser(userId: string, suspend: boolean) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  if (user.role === 'admin') throw new AppError(403, 'Cannot suspend admin', ErrorCodes.FORBIDDEN);
  const updated = await User.findByIdAndUpdate(userId, { suspended: suspend }, { new: true }).lean();
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}

export async function getVerificationQueue() {
  const list = await UniversityProfile.find({ verified: false })
    .populate('userId', 'email')
    .lean();
  const withDocs = await Promise.all(
    list.map(async (u: Record<string, unknown>) => {
      const documents = await UniversityDocument.find({ universityId: u._id }).lean();
      const userId = u.userId as { email?: string } | undefined;
      return {
        ...u,
        id: String(u._id),
        user: userId && typeof userId === 'object' && 'email' in userId ? { email: String(userId.email) } : undefined,
        documents: documents.map((d: Record<string, unknown>) => ({ ...d, id: String(d._id) })),
      };
    })
  );
  return withDocs;
}

export async function verifyUniversity(universityId: string, approve: boolean) {
  const uni = await UniversityProfile.findById(universityId);
  if (!uni) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
  const updated = await UniversityProfile.findByIdAndUpdate(universityId, { verified: approve }, { new: true }).lean();
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}

export async function getScholarshipsMonitor() {
  const list = await Scholarship.find().populate('universityId', 'universityName').lean();
  return list.map((s: Record<string, unknown>) => {
    const uni = s.universityId as { universityName?: string } | undefined;
    return {
      ...s,
      id: String(s._id),
      university: uni && typeof uni === 'object' && 'universityName' in uni ? { universityName: String(uni.universityName) } : undefined,
    };
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
    ActivityLog.find(where).skip(skip).limit(limit).sort({ createdAt: -1 }).lean(),
    ActivityLog.countDocuments(where),
  ]);
  return {
    data: list.map((l) => ({ ...l, id: String((l as { _id: unknown })._id) })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getSubscriptions(query: {
  page?: number;
  limit?: number;
  role?: string;
  plan?: string;
  status?: string;
}) {
  return subscriptionService.listSubscriptions(query);
}

export async function getSubscriptionByUser(userId: string) {
  return subscriptionService.getSubscriptionByUserId(userId);
}

export async function updateUserSubscription(
  userId: string,
  data: { plan?: string; status?: string; trialEndsAt?: Date | null; currentPeriodEnd?: Date | null }
) {
  return subscriptionService.updateSubscription(userId, data);
}

export async function getTickets(query: { page?: number; limit?: number; status?: string; role?: string }) {
  return ticketService.listTickets(query);
}

export async function getTicketById(ticketId: string, adminUserId: string) {
  return ticketService.getTicketById(ticketId, adminUserId, true);
}

export async function updateTicketStatus(ticketId: string, status: string) {
  return ticketService.updateTicketStatus(ticketId, status);
}

export async function addTicketReply(ticketId: string, adminUserId: string, message: string) {
  return ticketService.addReply(ticketId, adminUserId, 'admin', message, true);
}

export async function getPendingDocuments() {
  return studentDocumentService.listPendingForAdmin();
}

export async function reviewDocument(docId: string, adminUserId: string, decision: 'approved' | 'rejected', rejectionReason?: string) {
  return studentDocumentService.reviewDocument(docId, adminUserId, decision, rejectionReason);
}
