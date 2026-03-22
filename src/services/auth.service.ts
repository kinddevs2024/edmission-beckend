import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { User, RefreshToken, StudentProfile, UniversityProfile, PendingRegistration } from '../models';
import * as subscriptionService from './subscription.service';
import * as emailService from './email.service';
import * as settingsService from './settings.service';
import { config } from '../config';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { AppError, ErrorCodes } from '../utils/errors';
import { logger } from '../utils/logger';
import type { Role } from '../types/role';
import type { RegisterBody, LoginBody } from '../validators/auth.validator';
import { DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_NAME } from '../config/defaultAdmin';

const BCRYPT_ROUNDS = 12;

/** Вызывается при старте сервера: создаёт или обновляет дефолтного админа. */
export async function ensureDefaultAdmin(): Promise<void> {
  const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, BCRYPT_ROUNDS);
  const existing = await User.findOne({ email: DEFAULT_ADMIN_EMAIL });
  if (existing) {
    existing.role = 'admin';
    existing.passwordHash = passwordHash;
    existing.name = DEFAULT_ADMIN_NAME;
    existing.suspended = false;
    existing.emailVerified = true; // default admin never needs email verification
    await existing.save();
    return;
  }
  await User.create({
    email: DEFAULT_ADMIN_EMAIL,
    name: DEFAULT_ADMIN_NAME,
    passwordHash,
    role: 'admin',
    emailVerified: true, // default admin never needs email verification
  });
}

function toPlainUser(doc: {
  _id: unknown
  email: string
  role: string
  name?: string
  phone?: string
  socialLinks?: { telegram?: string; instagram?: string; linkedin?: string; facebook?: string; whatsapp?: string } | null
  mustChangePassword?: boolean
  onboardingTutorialSeen?: { student?: boolean; university?: boolean } | null
}) {
  return {
    id: String(doc._id),
    email: doc.email,
    role: doc.role as Role,
    name: doc.name ?? '',
    phone: doc.phone ?? '',
    socialLinks: {
      telegram: doc.socialLinks?.telegram ?? '',
      instagram: doc.socialLinks?.instagram ?? '',
      linkedin: doc.socialLinks?.linkedin ?? '',
      facebook: doc.socialLinks?.facebook ?? '',
      whatsapp: doc.socialLinks?.whatsapp ?? '',
    },
    mustChangePassword: Boolean(doc.mustChangePassword),
    onboardingTutorialSeen: {
      student: doc.onboardingTutorialSeen?.student ?? false,
      university: doc.onboardingTutorialSeen?.university ?? false,
    },
  };
}

function generateVerificationCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function register(data: RegisterBody) {
  const normalizedEmail = data.email.toLowerCase().trim();
  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    throw new AppError(409, 'Email already registered', ErrorCodes.CONFLICT);
  }

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
  const verifyCode = generateVerificationCode();
  const verifyTokenExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 min
  const avatarUrl = (data as { avatarUrl?: string }).avatarUrl?.trim();

  await PendingRegistration.findOneAndUpdate(
    { email: normalizedEmail },
    {
      email: normalizedEmail,
      passwordHash,
      role: data.role,
      avatarUrl: avatarUrl || undefined,
      verifyToken: verifyCode,
      verifyTokenExpires,
      verifyTokenSentAt: new Date(),
    },
    { upsert: true, new: true }
  );

  const sent = await emailService.sendVerificationCodeEmail(normalizedEmail, verifyCode);
  if (!sent && config.email.enabled) {
    await PendingRegistration.deleteOne({ email: normalizedEmail });
    throw new AppError(
      503,
      'Failed to send verification email. Please try again later.',
      ErrorCodes.SERVICE_UNAVAILABLE
    );
  }
  if (!sent) {
    logger.info({ email: normalizedEmail, code: verifyCode }, 'Email disabled: verification code (use in dev)');
  }

  return { email: normalizedEmail, needsVerification: true };
}

const RESEND_COOLDOWN_MS = 60 * 1000; // 1 min
const CODE_VALIDITY_MS = 5 * 60 * 1000; // 5 min

/** Resend 6-digit verification code. Cooldown: 60s. Code validity: 5 min. */
export async function resendVerificationCode(email: string) {
  const normalized = email.toLowerCase().trim();
  const pending = await PendingRegistration.findOne({ email: normalized });
  if (!pending) {
    return { success: true }; // Don't leak whether pending exists
  }

  const sentAt = new Date(pending.verifyTokenSentAt).getTime();
  if (Date.now() - sentAt < RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - sentAt)) / 1000);
    throw new AppError(429, `Please wait ${waitSec} seconds before resending`, ErrorCodes.RATE_LIMIT);
  }

  const newCode = generateVerificationCode();
  const verifyTokenExpires = new Date(Date.now() + CODE_VALIDITY_MS);
  await PendingRegistration.updateOne(
    { email: normalized },
    { verifyToken: newCode, verifyTokenExpires, verifyTokenSentAt: new Date() }
  );

  const sent = await emailService.sendVerificationCodeEmail(normalized, newCode);
  if (!sent && config.email.enabled) {
    throw new AppError(503, 'Failed to send verification email. Please try again later.', ErrorCodes.SERVICE_UNAVAILABLE);
  }
  if (!sent) {
    logger.info({ email: normalized, code: newCode }, 'Email disabled: resend verification code (use in dev)');
  }

  return { success: true };
}

export async function login(data: LoginBody) {
  const user = await User.findOne({ email: data.email });
  if (!user) {
    throw new AppError(401, 'Invalid credentials', ErrorCodes.UNAUTHORIZED);
  }
  if (user.suspended) {
    throw new AppError(403, 'Account suspended. Contact support.', ErrorCodes.FORBIDDEN);
  }

  const valid = await bcrypt.compare(data.password, user.passwordHash);
  if (!valid) {
    throw new AppError(401, 'Invalid credentials', ErrorCodes.UNAUTHORIZED);
  }

  const settings = await settingsService.getSettings();
  if (settings.requireEmailVerification && !user.emailVerified && user.email !== DEFAULT_ADMIN_EMAIL) {
    throw new AppError(403, 'Please verify your email before signing in.', ErrorCodes.FORBIDDEN);
  }
  if (settings.requireAccountConfirmation && user.role === 'university') {
    const profile = await UniversityProfile.findOne({ userId: user._id }).lean();
    if (!profile || !(profile as { verified?: boolean }).verified) {
      throw new AppError(403, 'Your account is pending approval by an administrator.', ErrorCodes.FORBIDDEN);
    }
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
  (plainUser as { mustChangePassword?: boolean }).mustChangePassword = Boolean((user as { mustChangePassword?: boolean }).mustChangePassword);
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

  const fullUser = await getMe(String(user._id));

  return {
    user: fullUser,
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
    .select('email name role phone socialLinks emailVerified suspended createdAt notificationPreferences totpEnabled mustChangePassword onboardingTutorialSeen')
    .lean();
  if (!user) {
    throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  }
  const [studentProfile, universityProfile, subscription] = await Promise.all([
    StudentProfile.findOne({ userId }).lean(),
    UniversityProfile.findOne({ userId }).lean(),
    subscriptionService.getSubscriptionSummary(userId),
  ]);
  const u = user as { _id: unknown; email: string; name?: string; phone?: string; socialLinks?: { telegram?: string; instagram?: string; linkedin?: string; facebook?: string; whatsapp?: string }; role: string; emailVerified?: boolean; suspended?: boolean; createdAt?: Date; notificationPreferences?: { emailApplicationUpdates?: boolean; emailTrialReminder?: boolean }; totpEnabled?: boolean; mustChangePassword?: boolean; onboardingTutorialSeen?: { student?: boolean; university?: boolean } };
  const avatar = studentProfile && (studentProfile as { avatarUrl?: string }).avatarUrl
    ? String((studentProfile as { avatarUrl: string }).avatarUrl).trim() || undefined
    : undefined;
  return {
    id: String(u._id),
    email: u.email,
    name: u.name ?? '',
    phone: u.phone ?? '',
    socialLinks: {
      telegram: u.socialLinks?.telegram ?? '',
      instagram: u.socialLinks?.instagram ?? '',
      linkedin: u.socialLinks?.linkedin ?? '',
      facebook: u.socialLinks?.facebook ?? '',
      whatsapp: u.socialLinks?.whatsapp ?? '',
    },
    role: u.role,
    avatar: avatar ?? undefined,
    emailVerified: u.emailVerified,
    suspended: u.suspended,
    createdAt: u.createdAt,
    totpEnabled: !!u.totpEnabled,
    mustChangePassword: Boolean(u.mustChangePassword),
    notificationPreferences: u.notificationPreferences ?? { emailApplicationUpdates: true, emailTrialReminder: true },
    onboardingTutorialSeen: u.onboardingTutorialSeen ?? { student: false, university: false },
    studentProfile: studentProfile ? { ...studentProfile, id: String((studentProfile as { _id: unknown })._id), verifiedAt: (studentProfile as { verifiedAt?: Date }).verifiedAt } : null,
    universityProfile: universityProfile ? { ...universityProfile, id: String((universityProfile as { _id: unknown })._id), verified: (universityProfile as { verified?: boolean }).verified } : null,
    subscription,
  };
}

export async function updateMe(userId: string, data: { name?: string; phone?: string; socialLinks?: { telegram?: string; instagram?: string; linkedin?: string; facebook?: string; whatsapp?: string }; notificationPreferences?: { emailApplicationUpdates?: boolean; emailTrialReminder?: boolean }; onboardingTutorialSeen?: { student?: boolean; university?: boolean } }) {
  const update: Record<string, unknown> = {};
  if (data.name !== undefined) update.name = String(data.name);
  if (data.phone !== undefined) update.phone = String(data.phone).trim();
  if (data.socialLinks !== undefined) {
    update.socialLinks = {
      telegram: String(data.socialLinks.telegram ?? '').trim(),
      instagram: String(data.socialLinks.instagram ?? '').trim(),
      linkedin: String(data.socialLinks.linkedin ?? '').trim(),
      facebook: String(data.socialLinks.facebook ?? '').trim(),
      whatsapp: String(data.socialLinks.whatsapp ?? '').trim(),
    };
  }
  if (data.notificationPreferences !== undefined) update.notificationPreferences = data.notificationPreferences;
  if (data.onboardingTutorialSeen !== undefined) {
    const prev = await User.findById(userId).select('onboardingTutorialSeen').lean();
    const prevObj = (prev as { onboardingTutorialSeen?: { student?: boolean; university?: boolean } })?.onboardingTutorialSeen ?? {};
    update.onboardingTutorialSeen = {
      student: data.onboardingTutorialSeen.student ?? prevObj.student ?? false,
      university: data.onboardingTutorialSeen.university ?? prevObj.university ?? false,
    };
  }
  if (Object.keys(update).length === 0) return getMe(userId);
  await User.findByIdAndUpdate(userId, update);
  return getMe(userId);
}

/** Verify by link token (legacy / link in email). */
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

/** Verify by 6-digit code (sent after register). Creates User and returns tokens. */
export async function verifyEmailByCode(email: string, code: string) {
  const normalized = email.toLowerCase().trim();
  const pending = await PendingRegistration.findOne({
    email: normalized,
    verifyToken: code.trim(),
    verifyTokenExpires: { $gt: new Date() },
  });
  if (!pending) {
    throw new AppError(400, 'Invalid or expired code', ErrorCodes.VALIDATION);
  }

  const user = await User.create({
    email: pending.email,
    name: '',
    passwordHash: pending.passwordHash,
    role: pending.role as Role,
    emailVerified: true,
  });

  if (pending.role === 'student') {
    await StudentProfile.create({
      userId: user._id,
      avatarUrl: pending.avatarUrl || undefined,
    });
  }
  await subscriptionService.createForNewUser(String(user._id), pending.role);

  await PendingRegistration.deleteOne({ email: normalized });

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

export async function forgotPassword(email: string) {
  const user = await User.findOne({ email });
  if (!user) return { success: true };

  if (!config.email.enabled && !config.email.sendgridApiKey) {
    throw new AppError(
      503,
      'Password reset is temporarily unavailable. Please contact support.',
      ErrorCodes.SERVICE_UNAVAILABLE
    );
  }

  const resetToken = uuidv4();
  await User.findByIdAndUpdate(user._id, {
    resetToken,
    resetTokenExpires: new Date(Date.now() + 60 * 60 * 1000),
  });

  const sent = await emailService.sendResetPasswordEmail(user.email, resetToken);
  if (!sent && config.email.enabled) {
    throw new AppError(
      503,
      'Failed to send reset email. Please try again later.',
      ErrorCodes.SERVICE_UNAVAILABLE
    );
  }

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

/** Set new password for logged-in user (e.g. after temp password from school counsellor). Clears mustChangePassword. */
export async function setPassword(userId: string, newPassword: string) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  const { passwordSchema } = await import('../validators/auth.validator');
  passwordSchema.parse(newPassword);
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await User.findByIdAndUpdate(userId, {
    passwordHash,
    mustChangePassword: false,
  });
  return { success: true };
}
