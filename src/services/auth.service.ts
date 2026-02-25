import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { User, RefreshToken, StudentProfile, UniversityProfile } from '../models';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { AppError, ErrorCodes } from '../utils/errors';
import type { Role } from '../types/role';
import type { RegisterBody, LoginBody } from '../validators/auth.validator';

const BCRYPT_ROUNDS = 12;

function toPlainUser(doc: { _id: unknown; email: string; role: string }) {
  return {
    id: String(doc._id),
    email: doc.email,
    role: doc.role as Role,
  };
}

export async function register(data: RegisterBody) {
  const existing = await User.findOne({ email: data.email });
  if (existing) {
    throw new AppError(409, 'Email already registered', ErrorCodes.CONFLICT);
  }

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
  const verifyToken = uuidv4();
  const verifyTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const user = await User.create({
    email: data.email,
    passwordHash,
    role: data.role,
    verifyToken,
    verifyTokenExpires,
  });

  if (data.role === 'student') {
    await StudentProfile.create({ userId: user._id });
  } else if (data.role === 'university') {
    await UniversityProfile.create({ userId: user._id, universityName: 'New University' });
  }

  const accessToken = signAccessToken({
    sub: String(user._id),
    email: user.email,
    role: user.role as Role,
  });
  const refreshToken = signRefreshToken({
    sub: String(user._id),
    email: user.email,
    role: user.role as Role,
  });

  await RefreshToken.create({
    userId: user._id,
    token: await bcrypt.hash(refreshToken, 10),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  return {
    user: toPlainUser(user),
    accessToken,
    refreshToken,
  };
}

export async function login(data: LoginBody) {
  const user = await User.findOne({ email: data.email });
  if (!user || user.suspended) {
    throw new AppError(401, 'Invalid credentials', ErrorCodes.UNAUTHORIZED);
  }

  const valid = await bcrypt.compare(data.password, user.passwordHash);
  if (!valid) {
    throw new AppError(401, 'Invalid credentials', ErrorCodes.UNAUTHORIZED);
  }

  const accessToken = signAccessToken({
    sub: String(user._id),
    email: user.email,
    role: user.role as Role,
  });
  const refreshToken = signRefreshToken({
    sub: String(user._id),
    email: user.email,
    role: user.role as Role,
  });

  await RefreshToken.create({
    userId: user._id,
    token: await bcrypt.hash(refreshToken, 10),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  return {
    user: toPlainUser(user),
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

  const stored = await RefreshToken.find({ userId: payload.sub })
    .sort({ createdAt: -1 })
    .lean();

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

  const user = await User.findById(payload.sub);
  if (!user || user.suspended) {
    throw new AppError(401, 'User not found or suspended', ErrorCodes.UNAUTHORIZED);
  }

  const accessToken = signAccessToken({
    sub: String(user._id),
    email: user.email,
    role: user.role as Role,
  });

  return {
    user: toPlainUser(user),
    accessToken,
  };
}

export async function logout(userId: string, refreshToken?: string) {
  if (refreshToken) {
    const tokens = await RefreshToken.find({ userId });
    for (const t of tokens) {
      const ok = await bcrypt.compare(refreshToken, t.token);
      if (ok) {
        await RefreshToken.findByIdAndDelete(t._id);
        break;
      }
    }
  } else {
    await RefreshToken.deleteMany({ userId });
  }
}

export async function getMe(userId: string) {
  const user = await User.findById(userId)
    .select('email role emailVerified suspended createdAt')
    .lean();
  if (!user) {
    throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  }
  const studentProfile = await StudentProfile.findOne({ userId }).lean();
  const universityProfile = await UniversityProfile.findOne({ userId }).lean();
  return {
    id: String(user._id),
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    suspended: user.suspended,
    createdAt: user.createdAt,
    studentProfile: studentProfile ? { ...studentProfile, id: String((studentProfile as { _id: unknown })._id) } : null,
    universityProfile: universityProfile ? { ...universityProfile, id: String((universityProfile as { _id: unknown })._id) } : null,
  };
}

export async function verifyEmail(token: string) {
  const user = await User.findOne({
    verifyToken: token,
    verifyTokenExpires: { $gt: new Date() },
  });
  if (!user) {
    throw new AppError(400, 'Invalid or expired verification token', ErrorCodes.VALIDATION);
  }
  await User.findByIdAndUpdate(user._id, {
    emailVerified: true,
    verifyToken: null,
    verifyTokenExpires: null,
  });
  return { success: true };
}

export async function forgotPassword(email: string) {
  const user = await User.findOne({ email });
  if (!user) return { success: true };

  const resetToken = uuidv4();
  await User.findByIdAndUpdate(user._id, {
    resetToken,
    resetTokenExpires: new Date(Date.now() + 60 * 60 * 1000),
  });
  return { success: true };
}

export async function resetPassword(token: string, newPassword: string) {
  const user = await User.findOne({
    resetToken: token,
    resetTokenExpires: { $gt: new Date() },
  });
  if (!user) {
    throw new AppError(400, 'Invalid or expired reset token', ErrorCodes.VALIDATION);
  }
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await User.findByIdAndUpdate(user._id, {
    passwordHash,
    resetToken: null,
    resetTokenExpires: null,
  });
  return { success: true };
}
