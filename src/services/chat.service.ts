import { User, StudentProfile, UniversityProfile, Chat, Message } from '../models';
import * as notificationService from './notification.service';
import { AppError, ErrorCodes } from '../utils/errors';

export async function getChats(userId: string) {
  const user = await User.findById(userId).lean();
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);

  const studentProfile = await StudentProfile.findOne({ userId }).lean();
  const universityProfile = await UniversityProfile.findOne({ userId }).lean();

  let chats: unknown[];
  if (studentProfile) {
    chats = await Chat.find({ studentId: (studentProfile as { _id: unknown })._id })
      .populate('universityId', 'universityName logoUrl')
      .lean();
    for (const c of chats as { _id: unknown; universityId?: { universityName: string; logoUrl?: string }; lastMessage?: unknown }[]) {
      const lastMsg = await Message.findOne({ chatId: c._id }).sort({ createdAt: -1 }).limit(1).populate('senderId', 'id email').lean();
      (c as { lastMessage?: unknown }).lastMessage = lastMsg ? [lastMsg] : [];
      (c as { university?: unknown }).university = (c as { universityId?: unknown }).universityId;
    }
  } else if (universityProfile) {
    chats = await Chat.find({ universityId: (universityProfile as { _id: unknown })._id })
      .populate('studentId', 'firstName lastName avatarUrl')
      .lean();
    for (const c of chats as { _id: unknown }[]) {
      const lastMsg = await Message.findOne({ chatId: c._id }).sort({ createdAt: -1 }).limit(1).populate('senderId', 'id email').lean();
      (c as { lastMessage?: unknown }).lastMessage = lastMsg ? [lastMsg] : [];
      (c as { student?: unknown }).student = (c as { studentId?: unknown }).studentId;
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
  const student = await StudentProfile.findById(typeof studentIdRef === 'object' && studentIdRef && '_id' in studentIdRef ? (studentIdRef as { _id: unknown })._id : studentIdRef).lean();
  const university = await UniversityProfile.findById(typeof universityIdRef === 'object' && universityIdRef && '_id' in universityIdRef ? (universityIdRef as { _id: unknown })._id : universityIdRef).lean();
  const studentUserId = student ? String((student as Record<string, unknown>).userId) : null;
  const universityUserId = university ? String((university as Record<string, unknown>).userId) : null;
  const participantIds = [studentUserId, universityUserId].filter(Boolean);
  if (!participantIds.includes(userId)) {
    throw new AppError(403, 'Not a participant', ErrorCodes.FORBIDDEN);
  }

  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;

  const [messages, total] = await Promise.all([
    Message.find({ chatId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('senderId', 'id email')
      .lean(),
    Message.countDocuments({ chatId }),
  ]);

  const data = messages.reverse().map((m) => ({
    ...m,
    id: String((m as { _id: unknown })._id),
    sender: (m as { senderId?: unknown }).senderId,
  }));

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
  const student = await StudentProfile.findById(typeof studentIdRef === 'object' && studentIdRef && '_id' in studentIdRef ? (studentIdRef as { _id: unknown })._id : studentIdRef).lean();
  const university = await UniversityProfile.findById(typeof universityIdRef === 'object' && universityIdRef && '_id' in universityIdRef ? (universityIdRef as { _id: unknown })._id : universityIdRef).lean();
  const participantIds = [
    student ? String((student as Record<string, unknown>).userId) : null,
    university ? String((university as Record<string, unknown>).userId) : null,
  ].filter(Boolean);
  if (!participantIds.includes(userId)) {
    throw new AppError(403, 'Not a participant', ErrorCodes.FORBIDDEN);
  }

  await Message.updateMany({ chatId, senderId: { $ne: userId } }, { isRead: true });
  return { success: true };
}

export async function getOrCreateChat(studentId: string, universityId: string) {
  const student = await StudentProfile.findById(studentId).lean();
  const university = await UniversityProfile.findById(universityId).lean();
  if (!student || !university) throw new AppError(404, 'Chat party not found', ErrorCodes.NOT_FOUND);

  let chat = await Chat.findOne({ studentId, universityId });
  if (!chat) {
    chat = await Chat.create({ studentId, universityId });
  }

  return {
    chat: chat.toObject ? chat.toObject() : chat,
    chatId: (chat as { _id: unknown })._id,
    studentUserId: String((student as { userId: unknown }).userId),
    universityUserId: String((university as { userId: unknown }).userId),
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
    return getOrCreateChat(body.studentId, String((university as { _id: unknown })._id));
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
    .populate('studentId', 'firstName lastName avatarUrl userId')
    .lean();
  if (!chat) throw new AppError(404, 'Chat not found', ErrorCodes.NOT_FOUND);

  const chatObj = chat as { studentId?: { userId?: unknown }; universityId?: { userId?: unknown }; _id: unknown };
  const studentUserId = chatObj.studentId && typeof chatObj.studentId === 'object' ? String(chatObj.studentId.userId) : null;
  const universityUserId = chatObj.universityId && typeof chatObj.universityId === 'object' ? String((chatObj.universityId as { userId?: unknown }).userId) : null;
  if (![studentUserId, universityUserId].filter(Boolean).includes(userId)) {
    throw new AppError(403, 'Not a participant', ErrorCodes.FORBIDDEN);
  }

  const lastMsg = await Message.findOne({ chatId }).sort({ createdAt: -1 }).limit(1).populate('senderId', 'id email').lean();
  const lastMessage = lastMsg ? [lastMsg] : [];

  return {
    ...chat,
    id: String(chatObj._id),
    lastMessage,
    university: chatObj.universityId,
    student: chatObj.studentId,
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
  const student = await StudentProfile.findById(typeof studentIdRef === 'object' && studentIdRef && '_id' in studentIdRef ? (studentIdRef as { _id: unknown })._id : studentIdRef).lean();
  const university = await UniversityProfile.findById(typeof universityIdRef === 'object' && universityIdRef && '_id' in universityIdRef ? (universityIdRef as { _id: unknown })._id : universityIdRef).lean();
  const studentU = student ? String((student as Record<string, unknown>).userId) : null;
  const universityU = university ? String((university as Record<string, unknown>).userId) : null;
  const participantIds = [studentU, universityU].filter(Boolean);
  if (!participantIds.includes(senderId)) {
    throw new AppError(403, 'Not a participant', ErrorCodes.FORBIDDEN);
  }

  const recipientId = studentU === senderId ? universityU : studentU;
  const msgBody = type === 'emotion' ? (message || (metadata?.emotion != null ? String(metadata.emotion) : '')) : (opts.text ?? message);

  const msg = await Message.create({
    chatId,
    senderId,
    type,
    message: msgBody,
    attachmentUrl: attachmentUrl ?? undefined,
    metadata: metadata ?? undefined,
  });
  const msgPop = await Message.findById(msg._id).populate('senderId', 'id email').lean();

  const notifBody = type === 'voice' ? '🎤 Voice message' : type === 'emotion' ? (msgBody || 'Reaction') : (msgBody || '').slice(0, 100);
  await notificationService.createNotification(recipientId!, {
    type: 'message',
    title: 'New message',
    body: notifBody,
    referenceType: 'chat',
    referenceId: String(chatId),
    metadata: { chatId: String(chatId) },
  });

  const sender = msgPop ? (msgPop as { senderId?: { _id?: unknown; id?: unknown } }).senderId : null;
  const senderIdStr = sender != null ? String((sender as { _id?: unknown })._id ?? (sender as { id?: unknown }).id ?? '') : undefined;
  const plain = msgPop as Record<string, unknown> | null;
  return {
    message: plain
      ? {
          ...plain,
          id: String(plain._id),
          text: (plain.message as string) ?? (plain.text as string) ?? '',
          type: plain.type ?? 'text',
          attachmentUrl: plain.attachmentUrl,
          metadata: plain.metadata,
          sender: senderIdStr ? { id: senderIdStr } : undefined,
        }
      : msg,
    recipientId,
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
  const plain = sysMsgPop as Record<string, unknown> | null;
  return {
    message: plain
      ? {
          ...plain,
          id: String(plain._id),
          text: (plain.message as string) ?? '',
          type: 'system',
          metadata: plain.metadata,
          sender: { id: userId },
        }
      : sysMsg,
    chat: { id: String(chatId), acceptedAt: new Date(), acceptancePositionType: params.positionType, acceptancePositionLabel: params.positionLabel },
  };
}
