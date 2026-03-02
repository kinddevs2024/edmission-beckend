import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { User, RefreshToken, StudentProfile, UniversityProfile } from '../models';
import * as subscriptionService from './subscription.service';
import * as notificationService from './notification.service';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { AppError, ErrorCodes } from '../utils/errors';
import type { Role } from '../types/role';
import type { RegisterBody, LoginBody } from '../validators/auth.validator';

const BCRYPT_ROUNDS = 12;

function toPlainUser(doc: { _id: unknown; email: string; role: string; name?: string }) {
  return {
    id: String(doc._id),
    email: doc.email,
    role: doc.role as Role,
    name: doc.name ?? '',
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
    name: data.name ?? '',
    passwordHash,
    role: data.role,
    verifyToken,
    verifyTokenExpires,
  });

  if (data.role === 'student') {
    await StudentProfile.create({ userId: user._id });
  } else if (data.role === 'university') {
    await UniversityProfile.create({ userId: user._id, universityName: 'New University', verified: false });
    const admins = await User.find({ role: 'admin' }).select('_id').lean();
    for (const admin of admins) {
      const adminId = String((admin as { _id: unknown })._id);
      await notificationService.createNotification(adminId, {
        type: 'university_verification_request',
        title: 'New university registration',
        body: `${data.email} registered as a university. Please review and verify in Admin → Verification.`,
        referenceType: 'university',
        referenceId: String(user._id),
        metadata: { email: data.email, universityName: 'New University' },
      });
    }
  }
  await subscriptionService.createForNewUser(String(user._id), data.role);

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

  const plainUser = toPlainUser(user) as ReturnType<typeof toPlainUser> & { universityProfile?: { id: string; verified: boolean; universityName?: string } };
  if (user.role === 'university') {
    const up = await UniversityProfile.findOne({ userId: user._id }).lean();
    if (up) {
      const u = up as { _id: unknown; verified?: boolean; universityName?: string };
      plainUser.universityProfile = { id: String(u._id), verified: !!u.verified, universityName: u.universityName };
    }
  }

  return {
    user: plainUser,
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
    .select('email name role emailVerified suspended createdAt notificationPreferences totpEnabled')
    .lean();
  if (!user) {
    throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  }
  const [studentProfile, universityProfile, subscription] = await Promise.all([
    StudentProfile.findOne({ userId }).lean(),
    UniversityProfile.findOne({ userId }).lean(),
    subscriptionService.getSubscriptionSummary(userId),
  ]);
  const u = user as { _id: unknown; email: string; name?: string; role: string; emailVerified?: boolean; suspended?: boolean; createdAt?: Date; notificationPreferences?: { emailApplicationUpdates?: boolean; emailTrialReminder?: boolean }; totpEnabled?: boolean };
  return {
    id: String(u._id),
    email: u.email,
    name: u.name ?? '',
    role: u.role,
    emailVerified: u.emailVerified,
    suspended: u.suspended,
    createdAt: u.createdAt,
    totpEnabled: !!u.totpEnabled,
    notificationPreferences: u.notificationPreferences ?? { emailApplicationUpdates: true, emailTrialReminder: true },
    studentProfile: studentProfile ? { ...studentProfile, id: String((studentProfile as { _id: unknown })._id), verifiedAt: (studentProfile as { verifiedAt?: Date }).verifiedAt } : null,
    universityProfile: universityProfile ? { ...universityProfile, id: String((universityProfile as { _id: unknown })._id), verified: (universityProfile as { verified?: boolean }).verified } : null,
    subscription,
  };
}

export async function updateMe(userId: string, data: { name?: string; notificationPreferences?: { emailApplicationUpdates?: boolean; emailTrialReminder?: boolean } }) {
  const update: Record<string, unknown> = {};
  if (data.name !== undefined) update.name = String(data.name);
  if (data.notificationPreferences !== undefined) update.notificationPreferences = data.notificationPreferences;
  if (Object.keys(update).length === 0) return getMe(userId);
  const user = await User.findByIdAndUpdate(userId, update, { new: true })
    .select('email name role emailVerified suspended createdAt notificationPreferences')
    .lean();
  if (!user) {
    throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  }
  return {
    id: String(user._id),
    email: user.email,
    name: (user as { name?: string }).name ?? '',
    role: user.role,
    emailVerified: user.emailVerified,
    suspended: user.suspended,
    createdAt: user.createdAt,
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
