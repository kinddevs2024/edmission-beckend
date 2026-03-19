import { Notification, User } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';
import { getIO } from '../socket';
import { type ApiLocale } from '../i18n/apiMessages';
import { translateRuntimeText } from '../i18n/runtimeMessages';

export type CreateNotificationParams = {
  type: string;
  title: string;
  body: string;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
};

type NotificationRecord = {
  _id?: unknown;
  id?: string;
  title?: string | null;
  body?: string | null;
  [key: string]: unknown;
};

function localizeNotificationRecord<T extends NotificationRecord>(notification: T, locale: ApiLocale): T {
  const next = { ...notification };
  if (typeof next.title === 'string') {
    next.title = translateRuntimeText(next.title, locale);
  }
  if (typeof next.body === 'string') {
    next.body = translateRuntimeText(next.body, locale);
  }
  return next;
}

export async function getNotifications(
  userId: string,
  query: { page?: number; limit?: number; type?: string; unread?: boolean },
  locale: ApiLocale = 'en'
) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;

  const filter: { userId: unknown; type?: string; readAt?: Date | null } = { userId };
  if (query.type) filter.type = query.type;
  if (query.unread === true) filter.readAt = null;

  const [data, total] = await Promise.all([
    Notification.find(filter)
      .sort({ readAt: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
  ]);

  return {
    data: data.map((n) => localizeNotificationRecord({ ...n, id: String((n as { _id: unknown })._id) }, locale)),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function createNotification(userId: string, params: CreateNotificationParams) {
  const doc = await Notification.create({
    userId,
    type: params.type,
    title: params.title,
    body: params.body,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    metadata: params.metadata,
  });
  const plain = doc.toObject ? doc.toObject() : (doc as unknown as Record<string, unknown>);
  const id = String(plain._id);
  const link = buildNotificationLink(params.type, params.referenceId, params.referenceType, params.metadata);
  const recipient = await User.findById(userId).select('language').lean();
  const locale = ((recipient as { language?: ApiLocale } | null)?.language ?? 'en') as ApiLocale;
  const localizedPayload = localizeNotificationRecord(
    {
      id,
      type: params.type,
      title: params.title,
      body: params.body,
      link: link ?? undefined,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      metadata: params.metadata,
      createdAt: (plain as { createdAt?: Date }).createdAt,
    },
    locale
  );

  const io = getIO();
  if (io) {
    io.to(`user:${userId}`).emit('notification', localizedPayload);
  }

  return { ...plain, id };
}

function buildNotificationLink(
  type: string,
  referenceId?: string,
  _referenceType?: string,
  _metadata?: Record<string, unknown>
): string | null {
  switch (type) {
    case 'message':
      return referenceId ? `/chat/${referenceId}` : null;
    case 'offer':
      return '/student/offers';
    case 'document':
      return referenceId ? `/student/received-documents/${referenceId}` : '/student/received-documents';
    case 'document_viewed':
    case 'document_accepted':
    case 'document_declined':
    case 'document_postponed':
    case 'document_expired':
    case 'document_revoked':
      return referenceId ? `/university/documents?documentId=${referenceId}` : '/university/documents';
    case 'offer_accepted':
    case 'offer_declined':
    case 'offer_expired':
    case 'interest':
      return '/university/pipeline';
    case 'status_update':
      return '/student/applications';
    case 'university_verification_request':
      return '/admin/university-requests';
    case 'school_join_request':
      return '/school/join-requests';
    case 'school_invitation':
      return '/student/school-invitations';
    case 'school_invitation_accepted':
    case 'school_invitation_declined':
      return '/school/my-students';
    default:
      return null;
  }
}

export async function markRead(userId: string, notificationId: string, locale: ApiLocale = 'en') {
  const n = await Notification.findOne({ _id: notificationId, userId });
  if (!n) throw new AppError(404, 'Notification not found', ErrorCodes.NOT_FOUND);
  const updated = await Notification.findByIdAndUpdate(notificationId, { readAt: new Date() }, { new: true }).lean();
  return updated
    ? localizeNotificationRecord({ ...updated, id: String((updated as { _id: unknown })._id) }, locale)
    : null;
}

export async function markAllRead(userId: string) {
  await Notification.updateMany({ userId, readAt: null }, { readAt: new Date() });
  return { success: true };
}

export async function deleteOne(userId: string, notificationId: string) {
  const n = await Notification.findOne({ _id: notificationId, userId });
  if (!n) throw new AppError(404, 'Notification not found', ErrorCodes.NOT_FOUND);
  await Notification.findByIdAndDelete(notificationId);
  return { success: true };
}

export type DeleteBulkParams = {
  ids?: string[];
  readOnly?: boolean;
  beforeDate?: string;
};

const MAX_BULK_IDS = 200;

export async function deleteBulk(userId: string, params: DeleteBulkParams) {
  const filter: { userId: unknown; _id?: { $in: unknown[] }; readAt?: { $ne: null }; createdAt?: { $lt: Date } } = {
    userId,
  };
  if (params.ids?.length) {
    filter._id = { $in: params.ids.slice(0, MAX_BULK_IDS) };
  } else {
    if (params.readOnly === true) {
      filter.readAt = { $ne: null };
    }
    if (params.beforeDate) {
      filter.createdAt = { $lt: new Date(params.beforeDate) };
    }
  }
  const result = await Notification.deleteMany(filter);
  return { deletedCount: result.deletedCount };
}
