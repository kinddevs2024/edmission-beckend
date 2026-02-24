import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../config/database';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { AppError, ErrorCodes } from '../utils/errors';
import type { Role } from '@prisma/client';
import type { RegisterBody, LoginBody } from '../validators/auth.validator';

const BCRYPT_ROUNDS = 12;

export async function register(data: RegisterBody) {
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    throw new AppError(409, 'Email already registered', ErrorCodes.CONFLICT);
  }

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
  const verifyToken = uuidv4();
  const verifyTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash,
      role: data.role,
      verifyToken,
      verifyTokenExpires,
    },
  });

  if (data.role === 'student') {
    await prisma.studentProfile.create({
      data: { userId: user.id },
    });
  } else if (data.role === 'university') {
    await prisma.universityProfile.create({
      data: { userId: user.id, universityName: 'New University' },
    });
  }

  // TODO: send verification email with verifyToken
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });
  const refreshToken = signRefreshToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: await bcrypt.hash(refreshToken, 10),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return {
    user: { id: user.id, email: user.email, role: user.role },
    accessToken,
    refreshToken,
  };
}

export async function login(data: LoginBody) {
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user || user.suspended) {
    throw new AppError(401, 'Invalid credentials', ErrorCodes.UNAUTHORIZED);
  }

  const valid = await bcrypt.compare(data.password, user.passwordHash);
  if (!valid) {
    throw new AppError(401, 'Invalid credentials', ErrorCodes.UNAUTHORIZED);
  }

  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });
  const refreshToken = signRefreshToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: await bcrypt.hash(refreshToken, 10),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return {
    user: { id: user.id, email: user.email, role: user.role },
    accessToken,
    refreshToken,
  };
}

export async function refresh(refreshToken: string) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError(401, 'Invalid refresh token', ErrorCodes.UNAUTHORIZED);
  }

  const stored = await prisma.refreshToken.findMany({
    where: { userId: payload.sub },
    orderBy: { createdAt: 'desc' },
  });

  let matched = false;
  for (const t of stored) {
    if (t.expiresAt < new Date()) continue;
    const ok = await bcrypt.compare(refreshToken, t.token);
    if (ok) {
      matched = true;
      break;
    }
  }
  if (!matched) {
    throw new AppError(401, 'Invalid refresh token', ErrorCodes.UNAUTHORIZED);
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
  });
  if (!user || user.suspended) {
    throw new AppError(401, 'User not found or suspended', ErrorCodes.UNAUTHORIZED);
  }

  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  return {
    user: { id: user.id, email: user.email, role: user.role },
    accessToken,
  };
}

export async function logout(userId: string, refreshToken?: string) {
  if (refreshToken) {
    const tokens = await prisma.refreshToken.findMany({
      where: { userId },
    });
    for (const t of tokens) {
      const ok = await bcrypt.compare(refreshToken, t.token);
      if (ok) {
        await prisma.refreshToken.delete({ where: { id: t.id } });
        break;
      }
    }
  } else {
    await prisma.refreshToken.deleteMany({ where: { userId } });
  }
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      emailVerified: true,
      suspended: true,
      createdAt: true,
      studentProfile: true,
      universityProfile: true,
    },
  });
  if (!user) {
    throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  }
  return user;
}

export async function verifyEmail(token: string) {
  const user = await prisma.user.findFirst({
    where: {
      verifyToken: token,
      verifyTokenExpires: { gt: new Date() },
    },
  });
  if (!user) {
    throw new AppError(400, 'Invalid or expired verification token', ErrorCodes.VALIDATION);
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      verifyToken: null,
      verifyTokenExpires: null,
    },
  });
  return { success: true };
}

export async function forgotPassword(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { success: true }; // do not leak existence

  const resetToken = uuidv4();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetToken,
      resetTokenExpires: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  // TODO: send email with reset link
  return { success: true };
}

export async function resetPassword(token: string, newPassword: string) {
  const user = await prisma.user.findFirst({
    where: {
      resetToken: token,
      resetTokenExpires: { gt: new Date() },
    },
  });
  if (!user) {
    throw new AppError(400, 'Invalid or expired reset token', ErrorCodes.VALIDATION);
  }
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      resetToken: null,
      resetTokenExpires: null,
    },
  });
  return { success: true };
}
