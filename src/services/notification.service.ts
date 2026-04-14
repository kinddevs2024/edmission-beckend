import mongoose from 'mongoose';
import { Notification, User } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';
import { getIO } from '../socket';
import { type ApiLocale } from '../i18n/apiMessages';
import { translateRuntimeText } from '../i18n/runtimeMessages';
import { sendTelegramMessage } from './telegram.service';
import { toPublicSiteUrl } from '../utils/publicSiteUrl';

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

/** Last N notifications for Telegram bot (plain text lines). */
export async function getRecentNotificationsForBot(userId: string, limit: number = 5, locale: ApiLocale = 'en') {
  const cap = Math.min(10, Math.max(1, limit));
  const rows = await Notification.find({ userId })
    .sort({ createdAt: -1 })
    .limit(cap)
    .lean();
  return rows.map((n) =>
    localizeNotificationRecord(
      {
        ...n,
        id: String((n as { _id: unknown })._id),
      },
      locale
    )
  );
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
  const recipient = await User.findById(userId).select('language role').lean();
  const recipientRole = (recipient as { role?: string } | null)?.role;
  const link = buildNotificationLink(
    params.type,
    params.referenceId,
    params.referenceType,
    params.metadata,
    recipientRole
  );
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

  void sendExpoPushToUser(userId, {
    title: String(localizedPayload.title ?? ''),
    body: String(localizedPayload.body ?? ''),
    data: {
      notificationId: id,
      type: params.type,
      link: link ?? undefined,
    },
  });
  if (params.type !== 'message') {
    void sendTelegramToUser(userId, {
      title: String(localizedPayload.title ?? ''),
      body: String(localizedPayload.body ?? ''),
      link: typeof localizedPayload.link === 'string' ? localizedPayload.link : undefined,
    });
  }

  return { ...plain, id };
}

const MAX_EXPO_PUSH_TOKENS = 8;

export async function registerExpoPushToken(userId: string, token: string) {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new AppError(400, 'Push token is required', ErrorCodes.VALIDATION);
  }
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  type TokenRow = { token: string; updatedAt: Date };
  const existing = ((user as { expoPushTokens?: TokenRow[] }).expoPushTokens ?? []).filter(
    (t) => t.token !== trimmed
  );
  existing.push({ token: trimmed, updatedAt: new Date() });
  const next = existing.slice(-MAX_EXPO_PUSH_TOKENS);
  (user as { expoPushTokens: TokenRow[] }).expoPushTokens = next;
  await user.save();
  return { success: true };
}

async function sendExpoPushToUser(
  userId: string,
  payload: { title: string; body: string; data: Record<string, unknown> }
) {
  if (!payload.title && !payload.body) return;
  const doc = await User.findById(userId).select('expoPushTokens').lean();
  const rows = (doc as { expoPushTokens?: { token: string }[] } | null)?.expoPushTokens ?? [];
  const tokens = [...new Set(rows.map((r) => r.token).filter(Boolean))];
  if (!tokens.length) return;

  for (const to of tokens) {
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to,
          title: payload.title,
          body: payload.body,
          sound: 'default',
          data: payload.data,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.warn('[push] Expo send failed', res.status, text);
      }
    } catch (e) {
      console.warn('[push] Expo send error', e);
    }
  }
}

async function sendTelegramToUser(
  userId: string,
  payload: { title: string; body: string; link?: string }
) {
  const doc = await User.findById(userId).select('telegram.chatId socialLinks.telegram').lean();
  const chatId =
    (doc as { telegram?: { chatId?: string } } | null)?.telegram?.chatId
    || (doc as { socialLinks?: { telegram?: string } } | null)?.socialLinks?.telegram
    || '';
  const normalized = String(chatId).trim();
  if (!normalized) return;
  const normalizedLink = (() => {
    const link = String(payload.link ?? '').trim();
    if (!link) return '';
    return toPublicSiteUrl(link);
  })();
  const text = [payload.title, payload.body, normalizedLink].filter(Boolean).join('\n');
  if (!text.trim()) return;
  try {
    await sendTelegramMessage(normalized, text);
  } catch (e) {
    console.warn('[telegram] send failed', e);
  }
}

function buildNotificationLink(
  type: string,
  referenceId?: string,
  _referenceType?: string,
  _metadata?: Record<string, unknown>,
  recipientRole?: string
): string | null {
  switch (type) {
    case 'message':
      if (!referenceId) return null;
      if (recipientRole === 'student') return `/student/chat?chatId=${encodeURIComponent(referenceId)}`;
      if (recipientRole === 'university') return `/university/chat?chatId=${encodeURIComponent(referenceId)}`;
      if (
        recipientRole === 'admin'
        || recipientRole === 'school_counsellor'
        || recipientRole === 'counsellor_coordinator'
        || recipientRole === 'manager'
      ) {
        return `/admin/chats?chatId=${encodeURIComponent(referenceId)}`;
      }
      return `/student/chat?chatId=${encodeURIComponent(referenceId)}`;
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

/** When user opens a chat, mark all unread "message" notifications tied to that chat. */
export async function markMessageNotificationsReadByChatId(userId: string, chatId: string): Promise<void> {
  const chatIdStr = String(chatId).trim();
  if (!chatIdStr || !mongoose.Types.ObjectId.isValid(userId)) return;
  const uid = new mongoose.Types.ObjectId(userId);
  await Notification.updateMany(
    {
      userId: uid,
      type: 'message',
      readAt: null,
      $or: [{ referenceId: chatIdStr }, { 'metadata.chatId': chatIdStr }],
    },
    { $set: { readAt: new Date() } }
  );
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
