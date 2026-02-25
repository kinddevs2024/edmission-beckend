import { User, StudentProfile, UniversityProfile, Chat, Message, Notification } from '../models';
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
      (c as { messages?: unknown[] }).messages = lastMsg ? [lastMsg] : [];
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
    studentUserId: String((student as { userId: unknown }).userId),
    universityUserId: String((university as { userId: unknown }).userId),
  };
}

export async function saveMessage(chatId: string, senderId: string, message: string) {
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

  const msg = await Message.create({
    chatId,
    senderId,
    message,
  });
  const msgPop = await Message.findById(msg._id).populate('senderId', 'id email').lean();

  await Notification.create({
    userId: recipientId,
    type: 'message',
    title: 'New message',
    body: message.slice(0, 100),
    referenceId: chatId,
  });

  return {
    message: msgPop ? { ...msgPop, id: String((msgPop as { _id: unknown })._id), sender: (msgPop as { senderId?: unknown }).senderId } : msg,
    recipientId,
  };
}
