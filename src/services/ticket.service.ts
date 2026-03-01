import mongoose from 'mongoose';
import { Ticket } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';
import type { Role } from '../types/role';

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;

export async function createTicket(userId: string, role: Role, data: { subject: string; message: string }) {
  if (role !== 'student' && role !== 'university') {
    throw new AppError(403, 'Only students and universities can create support tickets', ErrorCodes.FORBIDDEN);
  }
  const ticket = await Ticket.create({
    userId,
    role,
    subject: data.subject.trim(),
    message: data.message.trim(),
    status: 'open',
    replies: [],
  });
  const doc = ticket.toObject() as Record<string, unknown>;
  return { ...doc, id: String(doc._id) };
}

export async function getMyTickets(userId: string, query: { page?: number; limit?: number; status?: string }) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;
  const where: { userId: mongoose.Types.ObjectId; status?: string } = { userId: new mongoose.Types.ObjectId(userId) };
  if (query.status && STATUSES.includes(query.status as (typeof STATUSES)[number])) {
    where.status = query.status;
  }
  const [list, total] = await Promise.all([
    Ticket.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Ticket.countDocuments(where),
  ]);
  return {
    data: list.map((t) => ({ ...t, id: String((t as { _id: unknown })._id) })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getTicketById(ticketId: string, userId: string, isAdmin: boolean) {
  const ticket = await Ticket.findById(ticketId).lean();
  if (!ticket) throw new AppError(404, 'Ticket not found', ErrorCodes.NOT_FOUND);
  const ticketUserId = String((ticket as { userId: unknown }).userId);
  if (!isAdmin && ticketUserId !== userId) {
    throw new AppError(403, 'Access denied', ErrorCodes.FORBIDDEN);
  }
  return { ...ticket, id: String((ticket as { _id: unknown })._id) };
}

export async function addReply(
  ticketId: string,
  userId: string,
  role: Role,
  message: string,
  isStaff: boolean
) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new AppError(404, 'Ticket not found', ErrorCodes.NOT_FOUND);
  const ticketUserId = String(ticket.userId);
  if (!isStaff && ticketUserId !== userId) {
    throw new AppError(403, 'Access denied', ErrorCodes.FORBIDDEN);
  }
  ticket.replies = ticket.replies ?? [];
  ticket.replies.push({
    userId: new mongoose.Types.ObjectId(userId),
    role,
    message: message.trim(),
    isStaff,
  } as never);
  if (isStaff && ticket.status === 'open') {
    ticket.status = 'in_progress';
  }
  await ticket.save();
  const updated = await Ticket.findById(ticketId).lean();
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}

/** Admin: list all tickets */
export async function listTickets(query: {
  page?: number;
  limit?: number;
  status?: string;
  role?: string;
}) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;
  const where: Record<string, unknown> = {};
  if (query.status && STATUSES.includes(query.status as (typeof STATUSES)[number])) where.status = query.status;
  if (query.role === 'student' || query.role === 'university') where.role = query.role;
  const [list, total] = await Promise.all([
    Ticket.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('userId', 'email').lean(),
    Ticket.countDocuments(where),
  ]);
  return {
    data: list.map((t) => {
      const u = t as Record<string, unknown>;
      const userId = u.userId as { _id?: unknown; email?: string } | null;
      return {
        ...u,
        id: String(u._id),
        userEmail: userId && typeof userId === 'object' && 'email' in userId ? userId.email : undefined,
      };
    }),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/** Admin: update ticket status */
export async function updateTicketStatus(ticketId: string, status: string) {
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new AppError(400, 'Invalid status', ErrorCodes.VALIDATION);
  }
  const ticket = await Ticket.findByIdAndUpdate(ticketId, { status }, { new: true }).lean();
  if (!ticket) throw new AppError(404, 'Ticket not found', ErrorCodes.NOT_FOUND);
  return { ...ticket, id: String((ticket as { _id: unknown })._id) };
}
