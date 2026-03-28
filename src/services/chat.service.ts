import mongoose from 'mongoose';
import { User, StudentProfile, UniversityProfile, Chat, Interest, Message } from '../models';
import * as notificationService from './notification.service';
import * as emailService from './email.service';
import { AppError, ErrorCodes } from '../utils/errors';
import { toObjectIdString } from '../utils/objectId';
import { redactStudentForUniversityChat } from '../utils/studentProfilePrivacy';

function buildMessageVisibilityFilter(viewerUserId?: string): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    deletedForEveryoneAt: null,
  };

  if (viewerUserId && mongoose.Types.ObjectId.isValid(viewerUserId)) {
    filter.deletedForUserIds = { $ne: new mongoose.Types.ObjectId(viewerUserId) };
  }

  return filter;
}

function formatChatMessage(message: Record<string, unknown> | null) {
  if (!message) return null;
  const sender = message.senderId as { _id?: unknown; id?: unknown } | null | undefined;
  const senderId = sender ? String(sender._id ?? sender.id ?? '') : undefined;

  return {
    ...message,
    id: String(message._id),
    text: String(message.message ?? message.text ?? ''),
    type: String(message.type ?? 'text'),
    attachmentUrl: message.attachmentUrl,
    metadata: message.metadata,
    editedAt: message.editedAt,
    sender: senderId ? { id: senderId } : undefined,
  };
}

type ChatReadOnlyState = {
  isReadOnly: boolean;
  readOnlyReason?: 'rejected';
};

async function getChatReadOnlyStateForUser(
  studentProfileId: string | null,
  universityProfileId: string | null,
  viewerUserId: string,
  studentUserId: string | null
): Promise<ChatReadOnlyState> {
  if (!studentProfileId || !universityProfileId || !studentUserId || String(viewerUserId) !== String(studentUserId)) {
    return { isReadOnly: false };
  }

  const interest = await Interest.findOne({
    studentId: studentProfileId,
    universityId: universityProfileId,
  })
    .select('status')
    .lean();

  if ((interest as { status?: string } | null)?.status === 'rejected') {
    return {
      isReadOnly: true,
      readOnlyReason: 'rejected',
    };
  }

  return { isReadOnly: false };
}

async function assertChatMutationsAllowed(
  studentProfileId: string | null,
  universityProfileId: string | null,
  actorUserId: string,
  studentUserId: string | null
) {
  const state = await getChatReadOnlyStateForUser(studentProfileId, universityProfileId, actorUserId, studentUserId);
  if (state.isReadOnly) {
    throw new AppError(403, 'This chat has been closed by the university', ErrorCodes.FORBIDDEN);
  }
}

/** Fetch last message per chat in one query to avoid N+1. */
async function getLastMessagesByChatIds(chatIds: unknown[], viewerUserId?: string): Promise<Map<string, unknown[]>> {
  if (chatIds.length === 0) return new Map();
  const pipeline = [
    { $match: { chatId: { $in: chatIds }, ...buildMessageVisibilityFilter(viewerUserId) } },
    { $sort: { createdAt: -1 as 1 | -1 } },
    { $group: { _id: '$chatId', doc: { $first: '$$ROOT' } } },
    { $lookup: { from: 'users', localField: 'doc.senderId', foreignField: '_id', as: 'sender', pipeline: [{ $project: { id: '$_id', email: 1 } }] } },
    { $project: { chatId: '$_id', doc: 1, sender: { $arrayElemAt: ['$sender', 0] } } },
  ];
  const rows = await Message.aggregate(pipeline);
  const map = new Map<string, unknown[]>();
  for (const r of rows) {
    const doc = r.doc as Record<string, unknown>;
    const sender = r.sender;
    const msg = { ...doc, senderId: sender ?? doc.senderId };
    map.set(String(r.chatId), [msg]);
  }
  return map;
}

export async function getChats(userId: string) {
  const user = await User.findById(userId).lean();
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);

  const studentProfile = await StudentProfile.findOne({ userId }).lean();
  const universityProfile = await UniversityProfile.findOne({ userId }).lean();

  let chats: unknown[];
  if (studentProfile) {
    chats = await Chat.find({ studentId: (studentProfile as { _id: unknown })._id })
      .populate('universityId', 'universityName logoUrl userId')
      .lean();
    const chatIds = (chats as { _id: unknown }[]).map((c) => c._id);
    const lastByChat = await getLastMessagesByChatIds(chatIds, userId);
    const uniUserIds = (chats as { universityId?: { userId?: unknown } }[])
      .map((c) => (c.universityId && typeof c.universityId === 'object' ? (c.universityId as { userId?: unknown }).userId : null))
      .filter((id): id is unknown => !!id);
    const uniUsers = uniUserIds.length
      ? await User.find({ _id: { $in: uniUserIds } }).select('email').lean()
      : [];
    const universityProfileIds = (chats as { universityId?: unknown }[])
      .map((c) => toObjectIdString(c.universityId))
      .filter((id): id is string => !!id);
    const readOnlyInterests = universityProfileIds.length > 0
      ? await Interest.find({
        studentId: (studentProfile as { _id: unknown })._id,
        universityId: { $in: universityProfileIds },
        status: 'rejected',
      })
        .select('universityId')
        .lean()
      : [];
    const readOnlyUniversityIds = new Set(
      readOnlyInterests.map((interest) => String((interest as { universityId: unknown }).universityId))
    );
    const uniUserById = new Map<string, { email?: string }>();
    for (const u of uniUsers as { _id: unknown; email?: string }[]) {
      uniUserById.set(String(u._id), { email: u.email });
    }
    for (const c of chats as { _id: unknown; universityId?: { userId?: unknown }; lastMessage?: unknown; university?: unknown; isReadOnly?: boolean; readOnlyReason?: string }[]) {
      (c as { lastMessage?: unknown }).lastMessage = lastByChat.get(String(c._id)) ?? [];
      const uni = c.universityId;
      if (uni && typeof uni === 'object') {
        const uid = (uni as { userId?: unknown }).userId;
        const extra = uid ? uniUserById.get(String(uid)) : undefined;
        (c as { university?: unknown }).university = { ...(uni as object), ...(extra ? { userEmail: extra.email } : {}) };
        const universityProfileId = toObjectIdString(uni);
        (c as { isReadOnly?: boolean }).isReadOnly = !!universityProfileId && readOnlyUniversityIds.has(universityProfileId);
        (c as { readOnlyReason?: string }).readOnlyReason = (c as { isReadOnly?: boolean }).isReadOnly ? 'rejected' : undefined;
      } else {
        (c as { university?: unknown }).university = uni as unknown;
        (c as { isReadOnly?: boolean }).isReadOnly = false;
        (c as { readOnlyReason?: string }).readOnlyReason = undefined;
      }
    }
  } else if (universityProfile) {
    chats = await Chat.find({ universityId: (universityProfile as { _id: unknown })._id })
      .populate('studentId', 'firstName lastName avatarUrl userId profileVisibility')
      .lean();
    const chatIds = (chats as { _id: unknown }[]).map((c) => c._id);
    const lastByChat = await getLastMessagesByChatIds(chatIds, userId);
    const studentUserIds = (chats as { studentId?: { userId?: unknown } }[])
      .map((c) => (c.studentId && typeof c.studentId === 'object' ? (c.studentId as { userId?: unknown }).userId : null))
      .filter((id): id is unknown => !!id);
    const studentUsers = studentUserIds.length
      ? await User.find({ _id: { $in: studentUserIds } }).select('email').lean()
      : [];
    const studentUserById = new Map<string, { email?: string }>();
    for (const u of studentUsers as { _id: unknown; email?: string }[]) {
      studentUserById.set(String(u._id), { email: u.email });
    }
    for (const c of chats as { _id: unknown; studentId?: { userId?: unknown }; lastMessage?: unknown; student?: unknown; isReadOnly?: boolean; readOnlyReason?: string }[]) {
      (c as { lastMessage?: unknown }).lastMessage = lastByChat.get(String(c._id)) ?? [];
      const stu = c.studentId;
      if (stu && typeof stu === 'object') {
        const sid = (stu as { userId?: unknown }).userId;
        const extra = sid ? studentUserById.get(String(sid)) : undefined;
        const merged = { ...(stu as object), ...(extra ? { userEmail: extra.email } : {}) } as Record<string, unknown>;
        const redacted = redactStudentForUniversityChat(merged);
        (c as { student?: unknown }).student = redacted;
        (c as { studentId?: unknown }).studentId = redacted;
      } else {
        (c as { student?: unknown }).student = stu as unknown;
      }
      (c as { isReadOnly?: boolean }).isReadOnly = false;
      (c as { readOnlyReason?: string }).readOnlyReason = undefined;
    }
  } else {
    chats = [];
  }

  return chats.map((c: unknown) => {
    const cc = c as Record<string, unknown>;
    return { ...cc, id: String(cc._id) };
  });
}

export async function getMessages(chatId: string, userId: string, query: { page?: number; limit?: number }) {
  const chat = await Chat.findById(chatId)
    .populate('studentId', 'userId')
    .populate('universityId', 'userId')
    .lean();
  if (!chat) throw new AppError(404, 'Chat not found', ErrorCodes.NOT_FOUND);

  const chatObj = chat as Record<string, unknown>;
  const studentIdRef = chatObj.studentId;
  const universityIdRef = chatObj.universityId;
  const studentIdStr = toObjectIdString(studentIdRef);
  const universityIdStr = toObjectIdString(universityIdRef);
  const student = studentIdStr ? await StudentProfile.findById(studentIdStr).lean() : null;
  const university = universityIdStr ? await UniversityProfile.findById(universityIdStr).lean() : null;
  const studentUserId = student ? String((student as Record<string, unknown>).userId) : null;
  const universityUserId = university ? String((university as Record<string, unknown>).userId) : null;
  const participantIds = [studentUserId, universityUserId].filter(Boolean);
  // If chat was fetched via getChats, we already know current user is participant.
  // To avoid blocking chats because of inconsistent data, we no longer hard-fail here.

  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;
  const visibilityFilter = {
    chatId,
    ...buildMessageVisibilityFilter(userId),
  };

  const [messages, total] = await Promise.all([
    Message.find(visibilityFilter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('senderId', 'id email')
      .lean(),
    Message.countDocuments(visibilityFilter),
  ]);

  const data = messages
    .reverse()
    .map((m) => formatChatMessage({ ...(m as Record<string, unknown>), senderId: (m as { senderId?: unknown }).senderId }))
    .filter(Boolean);

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function markRead(chatId: string, userId: string) {
  const chat = await Chat.findById(chatId)
    .populate('studentId', 'userId')
    .populate('universityId', 'userId')
    .lean();
  if (!chat) throw new AppError(404, 'Chat not found', ErrorCodes.NOT_FOUND);

  const chatObj = chat as Record<string, unknown>;
  const studentIdRef = chatObj.studentId;
  const universityIdRef = chatObj.universityId;
  const studentIdStr = toObjectIdString(studentIdRef);
  const universityIdStr = toObjectIdString(universityIdRef);
  const student = studentIdStr ? await StudentProfile.findById(studentIdStr).lean() : null;
  const university = universityIdStr ? await UniversityProfile.findById(universityIdStr).lean() : null;
  const participantIds = [
    student ? String((student as Record<string, unknown>).userId) : null,
    university ? String((university as Record<string, unknown>).userId) : null,
  ].filter(Boolean);
  // Same as in getMessages: don't hard-fail if relations are inconsistent.

  await Message.updateMany(
    {
      chatId,
      senderId: { $ne: userId },
      ...buildMessageVisibilityFilter(userId),
    },
    { isRead: true }
  );
  return { success: true };
}

export async function getOrCreateChat(studentId: string, universityId: unknown) {
  const uid = toObjectIdString(universityId);
  if (!uid) throw new AppError(404, 'Chat party not found', ErrorCodes.NOT_FOUND);
  const student = await StudentProfile.findById(studentId).lean();
  const university = await UniversityProfile.findById(uid).lean();
  if (!student || !university) throw new AppError(404, 'Chat party not found', ErrorCodes.NOT_FOUND);

  let chat = await Chat.findOne({ studentId, universityId: uid });
  let created = false;
  if (!chat) {
    chat = await Chat.create({ studentId, universityId: uid });
    created = true;
  }

  await syncInterestStatusForChat(studentId, uid);

  return {
    chat: chat.toObject ? chat.toObject() : chat,
    chatId: (chat as { _id: unknown })._id,
    studentUserId: String((student as { userId: unknown }).userId),
    universityUserId: String((university as { userId: unknown }).userId),
    universityName: String((university as { universityName?: string }).universityName ?? 'This university'),
    created,
  };
}

/** Get or create chat from current user (student or university) and other party id. */
export async function getOrCreateChatForUser(
  userId: string,
  body: { studentId?: string; universityId?: string }
) {
  const user = await User.findById(userId).select('role').lean();
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);

  const role = (user as { role?: string }).role;
  if (body.studentId && role === 'university') {
    const university = await UniversityProfile.findOne({ userId }).lean();
    if (!university) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
    const result = await getOrCreateChat(body.studentId, String((university as { _id: unknown })._id));
    const hasMessages = await Message.exists({ chatId: result.chatId });

    if (!hasMessages) {
      const universityName = String((university as { universityName?: string }).universityName ?? 'The university');
      const systemText = `${universityName} opened the chat. You can now communicate with this university here.`;

      await Message.create({
        chatId: result.chatId,
        senderId: userId,
        type: 'system',
        message: systemText,
        metadata: {
          subtype: 'chat_opened',
          universityName,
        },
      });

      await notificationService.createNotification(result.studentUserId, {
        type: 'message',
        title: 'Chat opened',
        body: `${universityName} opened the chat and you can now communicate with them.`,
        referenceType: 'chat',
        referenceId: String(result.chatId),
        metadata: {
          chatId: String(result.chatId),
          subtype: 'chat_opened',
          universityName,
        },
      });
    }

    return result;
  }
  if (body.universityId && role === 'student') {
    const student = await StudentProfile.findOne({ userId }).lean();
    if (!student) throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);
    return getOrCreateChat(String((student as { _id: unknown })._id), body.universityId);
  }
  throw new AppError(400, 'Provide studentId (as university) or universityId (as student)', ErrorCodes.VALIDATION);
}

/** Get one chat by id and return in same shape as getChats items (for getOrCreate response). */
export async function getOneChatFormatted(chatId: string, userId: string) {
  const chat = await Chat.findById(chatId)
    .populate('universityId', 'universityName logoUrl userId')
    .populate('studentId', 'firstName lastName avatarUrl userId profileVisibility')
    .lean();
  if (!chat) throw new AppError(404, 'Chat not found', ErrorCodes.NOT_FOUND);

  const chatObj = chat as {
    studentId?: { userId?: unknown };
    universityId?: { userId?: unknown };
    _id: unknown;
  };
  const studentProfileId = toObjectIdString(chatObj.studentId);
  const universityProfileId = toObjectIdString(chatObj.universityId);
  const studentUserId = chatObj.studentId && typeof chatObj.studentId === 'object' ? String(chatObj.studentId.userId) : null;
  const universityUserId = chatObj.universityId && typeof chatObj.universityId === 'object' ? String((chatObj.universityId as { userId?: unknown }).userId) : null;
  if (![studentUserId, universityUserId].filter(Boolean).includes(userId)) {
    throw new AppError(403, 'Not a participant', ErrorCodes.FORBIDDEN);
  }
  const readOnlyState = await getChatReadOnlyStateForUser(studentProfileId, universityProfileId, userId, studentUserId);

  const lastMsg = await Message.findOne({ chatId, ...buildMessageVisibilityFilter(userId) })
    .sort({ createdAt: -1 })
    .limit(1)
    .populate('senderId', 'id email')
    .lean();
  const lastMessage = lastMsg ? [formatChatMessage(lastMsg as Record<string, unknown>)] : [];

  let studentOut: unknown = chatObj.studentId;
  if (
    studentOut &&
    typeof studentOut === 'object' &&
    userId === universityUserId &&
    chatObj.studentId &&
    typeof chatObj.studentId === 'object'
  ) {
    studentOut = redactStudentForUniversityChat({ ...(chatObj.studentId as Record<string, unknown>) });
  }

  return {
    ...chat,
    id: String(chatObj._id),
    lastMessage,
    university: chatObj.universityId,
    studentId: studentOut,
    student: studentOut,
    isReadOnly: readOnlyState.isReadOnly,
    readOnlyReason: readOnlyState.readOnlyReason,
  };
}

export type SaveMessageParams = {
  text?: string;
  type?: 'text' | 'voice' | 'emotion' | 'system';
  attachmentUrl?: string;
  metadata?: Record<string, unknown>;
};

export async function saveMessage(chatId: string, senderId: string, params: string | SaveMessageParams) {
  const opts: SaveMessageParams = typeof params === 'string' ? { text: params, type: 'text' } : params;
  const type = opts.type ?? 'text';
  const emotionVal = opts.metadata && opts.metadata.emotion != null ? String(opts.metadata.emotion) : '';
  const message = opts.text ?? emotionVal;
  const attachmentUrl = opts.attachmentUrl;
  const metadata = opts.metadata;

  if (type === 'text' && !(opts.text && opts.text.trim())) {
    throw new AppError(400, 'Message text is required for text messages', ErrorCodes.VALIDATION);
  }
  if (type === 'voice' && !attachmentUrl) {
    throw new AppError(400, 'Attachment URL is required for voice messages', ErrorCodes.VALIDATION);
  }
  if (type === 'emotion' && !message.trim() && !(metadata?.emotion != null)) {
    throw new AppError(400, 'Emotion is required for emotion messages', ErrorCodes.VALIDATION);
  }

  const chat = await Chat.findById(chatId)
    .populate('studentId', 'userId')
    .populate('universityId', 'userId')
    .lean();
  if (!chat) throw new AppError(404, 'Chat not found', ErrorCodes.NOT_FOUND);

  const chatObj = chat as Record<string, unknown>;
  const studentIdRef = chatObj.studentId;
  const universityIdRef = chatObj.universityId;
  const studentIdStr = toObjectIdString(studentIdRef);
  const universityIdStr = toObjectIdString(universityIdRef);
  const student = studentIdStr ? await StudentProfile.findById(studentIdStr).lean() : null;
  const university = universityIdStr ? await UniversityProfile.findById(universityIdStr).lean() : null;
  const studentU = student ? String((student as Record<string, unknown>).userId) : null;
  const universityU = university ? String((university as Record<string, unknown>).userId) : null;
  const participantIds = [studentU, universityU].filter(Boolean);
  // Чат уже выбран из списка текущего пользователя; дополнительно не блокируем по неконсистентным связям.

  await assertChatMutationsAllowed(studentIdStr, universityIdStr, senderId, studentU);

  const recipientId = studentU === senderId ? universityU : studentU;
  const msgBody = type === 'emotion' ? (message || (metadata?.emotion != null ? String(metadata.emotion) : '')) : (opts.text ?? message);

  if (studentIdStr && universityIdStr) {
    await syncInterestStatusForChat(studentIdStr, universityIdStr);
  }

  const msg = await Message.create({
    chatId,
    senderId,
    type,
    message: msgBody,
    attachmentUrl: attachmentUrl ?? undefined,
    metadata: metadata ?? undefined,
  });
  const msgPop = await Message.findById(msg._id).populate('senderId', 'id email').lean();

  if (recipientId) {
    const notifBody = type === 'voice' ? '🎤 Voice message' : type === 'emotion' ? (msgBody || 'Reaction') : (msgBody || '').slice(0, 100);
    await notificationService.createNotification(recipientId, {
      type: 'message',
      title: 'New message',
      body: notifBody,
      referenceType: 'chat',
      referenceId: String(chatId),
      metadata: { chatId: String(chatId) },
    });

    // Send same message to recipient email (fire-and-forget)
    User.findById(recipientId)
      .select('email role notificationPreferences')
      .lean()
      .then((rec) => {
        if (!rec || !(rec as { email?: string }).email) return;
        const prefs = (rec as { notificationPreferences?: { emailApplicationUpdates?: boolean } }).notificationPreferences;
        if (prefs?.emailApplicationUpdates === false) return;
        return emailService.sendNewMessageEmail(
          (rec as { email: string }).email,
          notifBody,
          (rec as { role?: string }).role,
        );
      })
      .catch(() => {});
  }

  return {
    message: formatChatMessage(msgPop as Record<string, unknown> | null) ?? msg,
    recipientId,
  };
}

async function syncInterestStatusForChat(studentId: string, universityId: string) {
  await Interest.findOneAndUpdate(
    {
      studentId,
      universityId,
      status: 'interested',
    },
    { $set: { status: 'chat_opened' } }
  );
}

export async function updateMessage(chatId: string, messageId: string, userId: string, text: string) {
  const trimmedText = text.trim();
  if (!trimmedText) {
    throw new AppError(400, 'Message text is required', ErrorCodes.VALIDATION);
  }

  const chat = await Chat.findById(chatId)
    .populate('studentId', 'userId')
    .populate('universityId', 'userId')
    .lean();
  if (!chat) {
    throw new AppError(404, 'Chat not found', ErrorCodes.NOT_FOUND);
  }

  const chatObj = chat as Record<string, unknown>;
  const studentProfileId = toObjectIdString(chatObj.studentId);
  const universityProfileId = toObjectIdString(chatObj.universityId);
  const studentRef = chatObj.studentId as { userId?: unknown } | undefined;
  const studentUserId = studentRef && typeof studentRef === 'object' ? String(studentRef.userId ?? '') : null;
  await assertChatMutationsAllowed(studentProfileId, universityProfileId, userId, studentUserId);

  const existing = await Message.findOne({ _id: messageId, chatId }).lean();
  if (!existing) {
    throw new AppError(404, 'Message not found', ErrorCodes.NOT_FOUND);
  }

  const messageObj = existing as Record<string, unknown>;
  if (String(messageObj.senderId) !== userId) {
    throw new AppError(403, 'You can edit only your own messages', ErrorCodes.FORBIDDEN);
  }
  if (messageObj.type !== 'text') {
    throw new AppError(400, 'Only text messages can be edited', ErrorCodes.VALIDATION);
  }
  if (messageObj.deletedForEveryoneAt) {
    throw new AppError(409, 'Message already deleted', ErrorCodes.CONFLICT);
  }

  const updated = await Message.findOneAndUpdate(
    { _id: messageId, chatId },
    {
      message: trimmedText,
      editedAt: new Date(),
    },
    { new: true }
  )
    .populate('senderId', 'id email')
    .lean();

  return {
    message: formatChatMessage(updated as Record<string, unknown> | null),
  };
}

export async function deleteMessage(chatId: string, messageId: string, userId: string, scope: 'me' | 'everyone') {
  const existing = await Message.findOne({ _id: messageId, chatId }).lean();
  if (!existing) {
    throw new AppError(404, 'Message not found', ErrorCodes.NOT_FOUND);
  }

  const messageObj = existing as Record<string, unknown>;
  const chat = await Chat.findById(chatId)
    .populate('studentId', 'userId')
    .populate('universityId', 'userId')
    .lean();
  if (!chat) {
    throw new AppError(404, 'Chat not found', ErrorCodes.NOT_FOUND);
  }

  const chatObj = chat as { studentId?: { userId?: unknown }; universityId?: { userId?: unknown } };
  const studentProfileId = toObjectIdString(chatObj.studentId);
  const universityProfileId = toObjectIdString(chatObj.universityId);
  const studentUserId = chatObj.studentId && typeof chatObj.studentId === 'object' ? String(chatObj.studentId.userId ?? '') : null;
  const participantIds = [
    chatObj.studentId && typeof chatObj.studentId === 'object' ? String(chatObj.studentId.userId ?? '') : null,
    chatObj.universityId && typeof chatObj.universityId === 'object' ? String(chatObj.universityId.userId ?? '') : null,
  ].filter(Boolean);
  if (!participantIds.includes(userId)) {
    throw new AppError(403, 'Not a participant', ErrorCodes.FORBIDDEN);
  }

  await assertChatMutationsAllowed(studentProfileId, universityProfileId, userId, studentUserId);

  if (scope === 'everyone') {
    if (String(messageObj.senderId) !== userId) {
      throw new AppError(403, 'You can delete for everyone only your own messages', ErrorCodes.FORBIDDEN);
    }

    await Message.updateOne(
      { _id: messageId, chatId, deletedForEveryoneAt: null },
      { deletedForEveryoneAt: new Date() }
    );
  } else {
    await Message.updateOne(
      { _id: messageId, chatId },
      { $addToSet: { deletedForUserIds: new mongoose.Types.ObjectId(userId) } }
    );
  }

  return {
    success: true,
    messageId,
    scope,
  };
}

export type AcceptStudentParams = {
  positionType: 'budget' | 'grant' | 'other';
  positionLabel?: string;
  congratulatoryMessage: string;
};

export async function acceptStudent(chatId: string, userId: string, params: AcceptStudentParams) {
  const universityProfile = await UniversityProfile.findOne({ userId }).lean();
  if (!universityProfile) throw new AppError(403, 'Only university can accept students', ErrorCodes.FORBIDDEN);

  const chat = await Chat.findById(chatId)
    .populate('studentId', 'userId')
    .populate('universityId', 'userId')
    .lean();
  if (!chat) throw new AppError(404, 'Chat not found', ErrorCodes.NOT_FOUND);

  const chatObj = chat as { universityId?: { _id?: unknown }; studentId?: { userId?: unknown }; acceptedAt?: Date };
  const universityId = chatObj.universityId && typeof chatObj.universityId === 'object' ? chatObj.universityId._id : null;
  if (String(universityId) !== String((universityProfile as { _id: unknown })._id)) {
    throw new AppError(403, 'Not your chat', ErrorCodes.FORBIDDEN);
  }
  if (chatObj.acceptedAt) {
    throw new AppError(400, 'Student already accepted in this chat', ErrorCodes.CONFLICT);
  }

  const studentUserId = chatObj.studentId && typeof chatObj.studentId === 'object' ? String(chatObj.studentId.userId) : null;
  if (!studentUserId) throw new AppError(404, 'Student not found', ErrorCodes.NOT_FOUND);

  const positionLabel = params.positionLabel?.trim() || params.positionType;
  const congratulatoryMessage = (params.congratulatoryMessage || '').trim() || `Congratulations! You have been accepted (${positionLabel}).`;

  await Chat.findByIdAndUpdate(chatId, {
    acceptedAt: new Date(),
    acceptancePositionType: params.positionType,
    acceptancePositionLabel: params.positionLabel || undefined,
  });

  const systemText = `The university has accepted you for: ${positionLabel}. Congratulations!`;
  const sysMsg = await Message.create({
    chatId,
    senderId: userId,
    type: 'system',
    message: systemText,
    metadata: {
      subtype: 'acceptance',
      positionType: params.positionType,
      positionLabel: params.positionLabel,
      congratulatoryMessage,
    },
  });

  await notificationService.createNotification(studentUserId, {
    type: 'status_update',
    title: 'You have been accepted!',
    body: systemText,
    referenceType: 'chat',
    referenceId: String(chatId),
    metadata: { chatId: String(chatId), positionType: params.positionType, positionLabel },
  });

  const sysMsgPop = await Message.findById(sysMsg._id).populate('senderId', 'id email').lean();
  return {
    message: formatChatMessage(sysMsgPop as Record<string, unknown> | null) ?? sysMsg,
    chat: { id: String(chatId), acceptedAt: new Date(), acceptancePositionType: params.positionType, acceptancePositionLabel: params.positionLabel },
  };
}
