import { Notification } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';

export async function getNotifications(userId: string, query: { page?: number; limit?: number }) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    Notification.find({ userId })
      .sort({ readAt: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Notification.countDocuments({ userId }),
  ]);

  return {
    data: data.map((n) => ({ ...n, id: String((n as { _id: unknown })._id) })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function markRead(userId: string, notificationId: string) {
  const n = await Notification.findOne({ _id: notificationId, userId });
  if (!n) throw new AppError(404, 'Notification not found', ErrorCodes.NOT_FOUND);
  const updated = await Notification.findByIdAndUpdate(notificationId, { readAt: new Date() }, { new: true }).lean();
  return updated ? { ...updated, id: String((updated as { _id: unknown })._id) } : null;
}

export async function markAllRead(userId: string) {
  await Notification.updateMany({ userId, readAt: null }, { readAt: new Date() });
  return { success: true };
}
