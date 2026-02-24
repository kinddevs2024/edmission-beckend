import { prisma } from '../config/database';
import { AppError, ErrorCodes } from '../utils/errors';

export async function getChats(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { studentProfile: true, universityProfile: true },
  });
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);

  let chats: Array<unknown>;
  if (user.studentProfile) {
    chats = await prisma.chat.findMany({
      where: { studentId: user.studentProfile.id },
      include: {
        university: { select: { universityName: true, logoUrl: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  } else if (user.universityProfile) {
    chats = await prisma.chat.findMany({
      where: { universityId: user.universityProfile.id },
      include: {
        student: { select: { firstName: true, lastName: true, avatarUrl: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  } else {
    chats = [];
  }
  return chats;
}

export async function getMessages(chatId: string, userId: string, query: { page?: number; limit?: number }) {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { student: { select: { userId: true } }, university: { select: { userId: true } } },
  });
  if (!chat) throw new AppError(404, 'Chat not found', ErrorCodes.NOT_FOUND);
  const participantIds = [chat.student.userId, chat.university.userId];
  if (!participantIds.includes(userId)) {
    throw new AppError(403, 'Not a participant', ErrorCodes.FORBIDDEN);
  }

  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 20));
  const skip = (page - 1) * limit;

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: { sender: { select: { id: true, email: true } } },
    }),
    prisma.message.count({ where: { chatId } }),
  ]);

  return {
    data: messages.reverse(),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function markRead(chatId: string, userId: string) {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { student: { select: { userId: true } }, university: { select: { userId: true } } },
  });
  if (!chat) throw new AppError(404, 'Chat not found', ErrorCodes.NOT_FOUND);
  const participantIds = [chat.student.userId, chat.university.userId];
  if (!participantIds.includes(userId)) {
    throw new AppError(403, 'Not a participant', ErrorCodes.FORBIDDEN);
  }

  await prisma.message.updateMany({
    where: { chatId, senderId: { not: userId } },
    data: { isRead: true },
  });
  return { success: true };
}

export async function getOrCreateChat(studentId: string, universityId: string) {
  const student = await prisma.studentProfile.findUnique({
    where: { id: studentId },
    include: { user: true },
  });
  const university = await prisma.universityProfile.findUnique({
    where: { id: universityId },
    include: { user: true },
  });
  if (!student || !university) throw new AppError(404, 'Chat party not found', ErrorCodes.NOT_FOUND);

  const chat = await prisma.chat.upsert({
    where: {
      studentId_universityId: { studentId, universityId },
    },
    create: { studentId, universityId },
    update: {},
  });
  return { chat, studentUserId: student.userId, universityUserId: university.userId };
}

export async function saveMessage(chatId: string, senderId: string, message: string) {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { student: { select: { userId: true } }, university: { select: { userId: true } } },
  });
  if (!chat) throw new AppError(404, 'Chat not found', ErrorCodes.NOT_FOUND);
  const participantIds = [chat.student.userId, chat.university.userId];
  if (!participantIds.includes(senderId)) {
    throw new AppError(403, 'Not a participant', ErrorCodes.FORBIDDEN);
  }

  const recipientId = chat.student.userId === senderId ? chat.university.userId : chat.student.userId;

  const msg = await prisma.message.create({
    data: { chatId, senderId, message },
    include: { sender: { select: { id: true, email: true } } },
  });

  await prisma.notification.create({
    data: {
      userId: recipientId,
      type: 'message',
      title: 'New message',
      body: message.slice(0, 100),
      referenceId: chatId,
    },
  });

  return { message: msg, recipientId };
}
