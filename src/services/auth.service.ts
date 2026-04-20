import bcrypt from 'bcrypt';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { OAuth2Client } from 'google-auth-library';
import {
  User,
  RefreshToken,
  StudentProfile,
  UniversityProfile,
  PendingRegistration,
  PendingPhoneRegistration,
  TelegramAuthSession,
} from '../models';
import * as subscriptionService from './subscription.service';
import * as emailService from './email.service';
import * as settingsService from './settings.service';
import { config } from '../config';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { AppError, ErrorCodes } from '../utils/errors';
import { logger } from '../utils/logger';
import type { Role } from '../types/role';
import type {
  RegisterBody,
  LoginBody,
  LoginByPhoneBody,
  PhoneRegisterStartBody,
  GoogleAuthBody,
  YandexAuthBody,
  YandexAccessTokenAuthBody,
} from '../validators/auth.validator';
import { DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_NAME } from '../config/defaultAdmin';

const BCRYPT_ROUNDS = 12;
const TELEGRAM_DUMMY_PASSWORD_HASH =
  '$2b$12$DLYYjMrl4MQYMjLOVAJATuS5AHqMc/B/AJGWISclNx4FPkvJc2scG';
const TELEGRAM_WEB_AUTH_SESSION_ID_REGEX = /^[a-f0-9]{32}$/i;
const TELEGRAM_WEB_AUTH_SESSION_TTL_MS = 15 * 60 * 1000;
const TELEGRAM_WEB_AUTH_CODE_TTL_MS = 5 * 60 * 1000;

function normalizePhone(raw: string): string {
  const trimmed = String(raw || '').trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  return `${hasPlus ? '+' : ''}${digits}`;
}

function makePhonePlaceholderEmail(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `phone_${digits}@phone.edmission.local`;
}

function hasOAuthLinked(u: { googleSub?: string | null; yandexSub?: string | null }): boolean {
  const g = u.googleSub != null && String(u.googleSub).trim() !== '';
  const y = u.yandexSub != null && String(u.yandexSub).trim() !== '';
  return g || y;
}

/** OAuth (Google/Yandex) account without an explicit user-chosen login password (legacy: field missing). */
function computeMustSetLocalPassword(u: {
  localPasswordConfigured?: boolean | null;
  googleSub?: string | null;
  yandexSub?: string | null;
}): boolean {
  if (u.localPasswordConfigured === true) return false;
  return hasOAuthLinked(u);
}

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
  localPasswordConfigured?: boolean | null
  googleSub?: string | null
  yandexSub?: string | null
  onboardingTutorialSeen?: { student?: boolean; university?: boolean } | null
}) {
  const mustSetLocalPassword = computeMustSetLocalPassword(doc)
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
    mustSetLocalPassword,
    onboardingTutorialSeen: {
      student: doc.onboardingTutorialSeen?.student ?? false,
      university: doc.onboardingTutorialSeen?.university ?? false,
    },
  };
}

function generateVerificationCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function assertLoginAllowed(user: { email: string; emailVerified?: boolean; role: string; _id: unknown }) {
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
}

type UserDoc = InstanceType<typeof User>;

async function issueAuthTokens(user: UserDoc): Promise<{
  user: ReturnType<typeof toPlainUser> & { universityProfile?: { id: string; verified: boolean; universityName?: string } };
  accessToken: string;
  refreshToken: string;
}> {
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

  const plainUser = toPlainUser(user) as ReturnType<typeof toPlainUser> & {
    universityProfile?: { id: string; verified: boolean; universityName?: string };
  };
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

async function issueTokensAfterLoginChecks(user: UserDoc) {
  await assertLoginAllowed(user);
  return issueAuthTokens(user);
}

export async function loginWithGoogle(data: GoogleAuthBody) {
  if (!config.google.clientId) {
    throw new AppError(503, 'Google sign-in is not configured', ErrorCodes.SERVICE_UNAVAILABLE);
  }

  const oauthClient = new OAuth2Client(config.google.clientId);
  const googleAudiences = [
    config.google.clientId,
    config.google.expoClientId,
    config.google.iosClientId,
    config.google.androidClientId,
  ].filter((id): id is string => Boolean(id));
  let ticket;
  try {
    ticket = await oauthClient.verifyIdToken({
      idToken: data.idToken,
      audience: googleAudiences.length === 1 ? googleAudiences[0] : googleAudiences,
    });
  } catch {
    throw new AppError(401, 'Invalid Google credential', ErrorCodes.UNAUTHORIZED);
  }

  const payload = ticket.getPayload();
  if (!payload?.email) {
    throw new AppError(400, 'Google account has no email', ErrorCodes.VALIDATION);
  }
  if (!payload.email_verified) {
    throw new AppError(400, 'Google email is not verified', ErrorCodes.VALIDATION);
  }

  const email = payload.email.toLowerCase().trim();
  const sub = payload.sub;
  const name = (payload.name ?? '').trim();
  const picture = payload.picture?.trim();

  let user = await User.findOne({ googleSub: sub });
  if (!user) {
    user = await User.findOne({ email });
  }

  if (user) {
    if (['admin', 'school_counsellor', 'counsellor_coordinator', 'manager'].includes(user.role)) {
      throw new AppError(403, 'Use email and password to sign in to this account.', ErrorCodes.FORBIDDEN);
    }
    if (user.suspended) {
      throw new AppError(403, 'Account suspended. Contact support.', ErrorCodes.FORBIDDEN);
    }
    if (user.googleSub && user.googleSub !== sub) {
      throw new AppError(403, 'This account is linked to a different Google profile.', ErrorCodes.FORBIDDEN);
    }
    if (!user.googleSub) {
      user.googleSub = sub;
      user.emailVerified = true;
      user.localPasswordConfigured = true;
      await user.save();
    }
    return issueTokensAfterLoginChecks(user);
  }

  if (data.acceptTerms !== true) {
    throw new AppError(
      404,
      'No account for this sign-in. Please register first.',
      ErrorCodes.OAUTH_SIGNUP_REQUIRED
    );
  }

  /** Login-page OAuth: create a student account immediately unless registration sent another role. */
  const newUserRole = data.role ?? 'student';

  await PendingRegistration.deleteOne({ email });

  const oauthPasswordHash = await bcrypt.hash(`oauth-google:${sub}:${uuidv4()}`, BCRYPT_ROUNDS);
  const newUser = await User.create({
    email,
    name,
    passwordHash: oauthPasswordHash,
    role: newUserRole,
    emailVerified: true,
    googleSub: sub,
    localPasswordConfigured: false,
  });

  if (newUserRole === 'student') {
    await StudentProfile.create({
      userId: newUser._id,
      avatarUrl: picture || undefined,
    });
  }
  await subscriptionService.createForNewUser(String(newUser._id), newUserRole);

  return issueAuthTokens(newUser);
}

function assertYandexRedirectUri(redirectUri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new AppError(400, 'Invalid redirect URI', ErrorCodes.VALIDATION);
  }

  const pathNorm = parsed.pathname.replace(/\/$/, '') || '';
  /** Web: …/auth/yandex/callback */
  const webStyleOk = pathNorm.endsWith('/auth/yandex/callback');
  /** Native scheme edmission://auth/yandex/callback → hostname "auth", path /yandex/callback */
  const nativeEdmissionOk =
    parsed.protocol === 'edmission:' &&
    parsed.hostname === 'auth' &&
    pathNorm.replace(/\/$/, '') === '/yandex/callback';
  /** Expo Go: exp://host:port/--/auth/yandex/callback */
  const expoGoOk =
    parsed.protocol === 'exp:' && /\/auth\/yandex\/callback$/.test(pathNorm);

  if (!webStyleOk && !nativeEdmissionOk && !expoGoOk) {
    throw new AppError(400, 'Invalid redirect path', ErrorCodes.VALIDATION);
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    const allowedOrigins = new Set<string>();
    const fe = config.frontendUrl.trim();
    if (fe) {
      try {
        allowedOrigins.add(new URL(fe).origin);
      } catch {
        /* ignore */
      }
    }
    for (const o of config.cors.origin) {
      try {
        allowedOrigins.add(new URL(o).origin);
      } catch {
        /* ignore */
      }
    }
    if (!allowedOrigins.has(parsed.origin)) {
      throw new AppError(400, 'Redirect URI origin not allowed', ErrorCodes.VALIDATION);
    }
    return;
  }

  if (parsed.protocol === 'edmission:' || parsed.protocol === 'exp:') {
    return;
  }

  throw new AppError(400, 'Redirect URI origin not allowed', ErrorCodes.VALIDATION);
}

async function exchangeYandexCode(code: string, redirectUri: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.yandex.clientId,
    client_secret: config.yandex.clientSecret,
    redirect_uri: redirectUri,
  });
  const res = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!json.access_token) {
    logger.warn({ err: json.error, desc: json.error_description }, 'Yandex token exchange failed');
    throw new AppError(401, 'Yandex authorization failed', ErrorCodes.UNAUTHORIZED);
  }
  return json.access_token;
}

async function fetchYandexLoginInfo(accessToken: string): Promise<{
  id: string;
  email: string;
  name: string;
  picture?: string;
}> {
  const res = await fetch('https://login.yandex.ru/info?format=json', {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!res.ok) {
    throw new AppError(401, 'Failed to load Yandex profile', ErrorCodes.UNAUTHORIZED);
  }
  const info = (await res.json()) as {
    id?: string;
    login?: string;
    default_email?: string;
    emails?: string[];
    display_name?: string;
    real_name?: string;
    first_name?: string;
    last_name?: string;
    default_avatar_id?: string;
    is_avatar_empty?: boolean;
  };
  const id = info.id != null ? String(info.id) : '';
  if (!id) {
    throw new AppError(400, 'Invalid Yandex profile', ErrorCodes.VALIDATION);
  }
  const emailRaw = info.default_email || (Array.isArray(info.emails) && info.emails[0]) || '';
  const email = String(emailRaw).toLowerCase().trim();
  if (!email || !email.includes('@')) {
    throw new AppError(
      400,
      'Yandex account has no email. Enable login:email for your OAuth app in Yandex.',
      ErrorCodes.VALIDATION
    );
  }
  const name = (
    info.display_name ||
    info.real_name ||
    `${info.first_name || ''} ${info.last_name || ''}` ||
    info.login ||
    ''
  ).trim();
  let picture: string | undefined;
  if (!info.is_avatar_empty && info.default_avatar_id) {
    picture = `https://avatars.yandex.net/get-yapic/${info.default_avatar_id}/islands-200`;
  }
  return { id, email, name, picture };
}

async function finalizeYandexOAuthProfile(
  sub: string,
  email: string,
  name: string,
  picture: string | undefined,
  data: { role?: 'student' | 'university'; acceptTerms?: boolean }
) {
  let user = await User.findOne({ yandexSub: sub });
  if (!user) {
    user = await User.findOne({ email });
  }

  if (user) {
    if (['admin', 'school_counsellor', 'counsellor_coordinator', 'manager'].includes(user.role)) {
      throw new AppError(403, 'Use email and password to sign in to this account.', ErrorCodes.FORBIDDEN);
    }
    if (user.suspended) {
      throw new AppError(403, 'Account suspended. Contact support.', ErrorCodes.FORBIDDEN);
    }
    if (user.yandexSub && user.yandexSub !== sub) {
      throw new AppError(403, 'This account is linked to a different Yandex profile.', ErrorCodes.FORBIDDEN);
    }
    if (!user.yandexSub) {
      user.yandexSub = sub;
      user.emailVerified = true;
      user.localPasswordConfigured = true;
      await user.save();
    }
    return issueTokensAfterLoginChecks(user);
  }

  if (data.acceptTerms !== true) {
    throw new AppError(
      404,
      'No account for this sign-in. Please register first.',
      ErrorCodes.OAUTH_SIGNUP_REQUIRED
    );
  }

  const newUserRole = data.role ?? 'student';

  await PendingRegistration.deleteOne({ email });

  const oauthPasswordHash = await bcrypt.hash(`oauth-yandex:${sub}:${uuidv4()}`, BCRYPT_ROUNDS);
  const newUser = await User.create({
    email,
    name,
    passwordHash: oauthPasswordHash,
    role: newUserRole,
    emailVerified: true,
    yandexSub: sub,
    localPasswordConfigured: false,
  });

  if (newUserRole === 'student') {
    await StudentProfile.create({
      userId: newUser._id,
      avatarUrl: picture || undefined,
    });
  }
  await subscriptionService.createForNewUser(String(newUser._id), newUserRole);

  return issueAuthTokens(newUser);
}

export async function loginWithYandex(data: YandexAuthBody) {
  if (!config.yandex.clientId || !config.yandex.clientSecret) {
    throw new AppError(503, 'Yandex sign-in is not configured', ErrorCodes.SERVICE_UNAVAILABLE);
  }

  assertYandexRedirectUri(data.redirectUri);

  let accessToken: string;
  try {
    accessToken = await exchangeYandexCode(data.code, data.redirectUri);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(401, 'Yandex authorization failed', ErrorCodes.UNAUTHORIZED);
  }

  const { id: sub, email, name, picture } = await fetchYandexLoginInfo(accessToken);
  return finalizeYandexOAuthProfile(sub, email, name, picture, {
    role: data.role,
    acceptTerms: data.acceptTerms,
  });
}

/** Yandex Passport SDK (response_type=token): validate token via login.yandex.ru/info. No client_secret. */
export async function loginWithYandexAccessToken(data: YandexAccessTokenAuthBody) {
  if (!config.yandex.clientId) {
    throw new AppError(503, 'Yandex sign-in is not configured', ErrorCodes.SERVICE_UNAVAILABLE);
  }

  const { id: sub, email, name, picture } = await fetchYandexLoginInfo(data.accessToken);
  return finalizeYandexOAuthProfile(sub, email, name, picture, {
    role: data.role,
    acceptTerms: data.acceptTerms,
  });
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
      verifyFailedAttempts: 0,
      verifyLockedUntil: null,
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
const VERIFY_CODE_MAX_ATTEMPTS = 5;
const VERIFY_CODE_LOCK_MS = 15 * 60 * 1000;

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
    {
      verifyToken: newCode,
      verifyTokenExpires,
      verifyTokenSentAt: new Date(),
      verifyFailedAttempts: 0,
      verifyLockedUntil: null,
    }
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
  const normalizedEmail = data.email.toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail });
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

  if (user.localPasswordConfigured !== true) {
    user.localPasswordConfigured = true;
    await user.save();
  }

  return issueTokensAfterLoginChecks(user);
}

function normalizeTelegramChatId(raw: string): string {
  const value = String(raw ?? '').trim();
  if (!/^-?\d{1,20}$/.test(value)) return '';
  return value;
}

function normalizeTelegramWebAuthSessionId(raw: string): string {
  const value = String(raw ?? '').trim().toLowerCase();
  return TELEGRAM_WEB_AUTH_SESSION_ID_REGEX.test(value) ? value : '';
}

function createTelegramWebAuthSessionId(): string {
  return crypto.randomBytes(16).toString('hex');
}

function createTelegramWebAuthCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function isMongoDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const row = error as { code?: unknown };
  return Number(row.code) === 11000;
}

async function unlinkTelegramFromOtherUsers(chatId: string, exceptUserId?: string): Promise<void> {
  const where: Record<string, unknown> = {
    $or: [{ 'telegram.chatId': chatId }, { 'socialLinks.telegram': chatId }],
  };
  if (exceptUserId) {
    where._id = { $ne: exceptUserId };
  }

  await User.updateMany(where, {
    $set: {
      'socialLinks.telegram': '',
      'telegram.username': '',
      'telegram.phone': '',
      'telegram.linkedAt': null,
    },
    $unset: {
      'telegram.chatId': 1,
    },
  });
}

export async function authenticateTelegramCredentials(email: string, password: string) {
  const normalizedEmail = String(email ?? '').toLowerCase().trim();
  const rawPassword = String(password ?? '');
  if (!normalizedEmail || !rawPassword.trim()) {
    throw new AppError(400, 'Email and password are required', ErrorCodes.VALIDATION);
  }
  if (normalizedEmail.length > 254 || rawPassword.length > 256) {
    throw new AppError(400, 'Invalid credentials', ErrorCodes.UNAUTHORIZED);
  }

  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    await bcrypt.compare(rawPassword, TELEGRAM_DUMMY_PASSWORD_HASH).catch(() => false);
    throw new AppError(401, 'Invalid credentials', ErrorCodes.UNAUTHORIZED);
  }
  if (user.suspended) {
    throw new AppError(403, 'Account suspended. Contact support.', ErrorCodes.FORBIDDEN);
  }

  const valid = await bcrypt.compare(rawPassword, user.passwordHash);
  if (!valid) {
    throw new AppError(401, 'Invalid credentials', ErrorCodes.UNAUTHORIZED);
  }

  if (user.localPasswordConfigured === false) {
    throw new AppError(
      400,
      'This account has no local password yet. Set a password on the website first.',
      ErrorCodes.VALIDATION
    );
  }

  if (user.localPasswordConfigured !== true) {
    user.localPasswordConfigured = true;
    await user.save();
  }

  await assertLoginAllowed(user);

  return {
    id: String(user._id),
    email: String(user.email ?? ''),
    name: String(user.name ?? '').trim(),
    role: user.role as Role,
  };
}

export async function loginByPhone(data: LoginByPhoneBody) {
  const normalizedPhone = normalizePhone(data.phone);
  const user = await User.findOne({ phone: normalizedPhone });
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
  if (user.localPasswordConfigured !== true) {
    user.localPasswordConfigured = true;
    await user.save();
  }
  return issueTokensAfterLoginChecks(user);
}

function generatePhoneVerifyCode(): string {
  return `reg_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
}

export async function startPhoneRegistration(data: PhoneRegisterStartBody) {
  const normalizedPhone = normalizePhone(data.phone);
  if (!normalizedPhone) {
    throw new AppError(400, 'Invalid phone', ErrorCodes.VALIDATION);
  }
  const existingByPhone = await User.findOne({ phone: normalizedPhone }).select('_id').lean();
  if (existingByPhone) {
    throw new AppError(409, 'Phone already registered', ErrorCodes.CONFLICT);
  }

  const placeholderEmail = makePhonePlaceholderEmail(normalizedPhone);
  const existingByEmail = await User.findOne({ email: placeholderEmail }).select('_id').lean();
  if (existingByEmail) {
    throw new AppError(409, 'Phone already registered', ErrorCodes.CONFLICT);
  }

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
  const verifyCode = generatePhoneVerifyCode();
  const verifyCodeExpires = new Date(Date.now() + 10 * 60 * 1000);

  const fullName = [data.firstName?.trim(), data.lastName?.trim()].filter(Boolean).join(' ').trim();

  const pending = await PendingPhoneRegistration.findOneAndUpdate(
    { phone: normalizedPhone },
    {
      phone: normalizedPhone,
      passwordHash,
      role: data.role,
      name: fullName,
      avatarUrl: data.avatarUrl?.trim() || undefined,
      verifyCode,
      verifyCodeExpires,
      verifiedViaTelegram: false,
      telegramChatId: '',
      telegramUsername: '',
      verifiedAt: null,
    },
    { upsert: true, new: true }
  );

  const botUsername = config.telegram.botUsername;
  const deepLink = botUsername ? `https://t.me/${botUsername}?start=${verifyCode}` : '';
  return {
    registrationId: String((pending as { _id: unknown })._id),
    phone: normalizedPhone,
    verification: {
      method: 'telegram',
      code: verifyCode,
      expiresAt: verifyCodeExpires.toISOString(),
      deepLink,
    },
  };
}

export async function getPhoneRegistrationStatus(registrationId: string) {
  const pending = await PendingPhoneRegistration.findById(registrationId).lean();
  if (!pending) {
    throw new AppError(404, 'Registration request not found or expired', ErrorCodes.NOT_FOUND);
  }
  const p = pending as { verifiedViaTelegram?: boolean; verifiedAt?: Date; verifyCodeExpires?: Date };
  return {
    verifiedViaTelegram: Boolean(p.verifiedViaTelegram),
    verifiedAt: p.verifiedAt ? new Date(p.verifiedAt).toISOString() : null,
    expiresAt: p.verifyCodeExpires ? new Date(p.verifyCodeExpires).toISOString() : null,
  };
}

export async function completePhoneRegistration(registrationId: string) {
  const pending = await PendingPhoneRegistration.findById(registrationId);
  if (!pending) {
    throw new AppError(404, 'Registration request not found or expired', ErrorCodes.NOT_FOUND);
  }
  if (!pending.verifiedViaTelegram) {
    throw new AppError(400, 'Phone is not verified in Telegram yet', ErrorCodes.VALIDATION);
  }

  const existingByPhone = await User.findOne({ phone: pending.phone }).select('_id').lean();
  if (existingByPhone) {
    await PendingPhoneRegistration.findByIdAndDelete(pending._id);
    throw new AppError(409, 'Phone already registered', ErrorCodes.CONFLICT);
  }

  const email = makePhonePlaceholderEmail(pending.phone);
  const existingByEmail = await User.findOne({ email }).select('_id').lean();
  if (existingByEmail) {
    await PendingPhoneRegistration.findByIdAndDelete(pending._id);
    throw new AppError(409, 'Phone already registered', ErrorCodes.CONFLICT);
  }

  const normalizedTelegramChatId = normalizeTelegramChatId(String(pending.telegramChatId ?? ''));
  const normalizedTelegramUsername = String(pending.telegramUsername ?? '').trim();

  const user = await User.create({
    email,
    name: pending.name || '',
    phone: pending.phone,
    passwordHash: pending.passwordHash,
    role: pending.role as Role,
    emailVerified: true,
    localPasswordConfigured: true,
    telegram: {
      ...(normalizedTelegramChatId ? { chatId: normalizedTelegramChatId } : {}),
      username: normalizedTelegramUsername,
      linkedAt: pending.verifiedAt || new Date(),
    },
  });

  if (pending.role === 'student') {
    await StudentProfile.create({
      userId: user._id,
      avatarUrl: pending.avatarUrl || undefined,
    });
  }
  await subscriptionService.createForNewUser(String(user._id), pending.role);
  await PendingPhoneRegistration.findByIdAndDelete(pending._id);
  return issueAuthTokens(user);
}

export async function verifyPhoneRegistrationByTelegram(
  verifyCode: string,
  telegramChatId: string,
  telegramUsername: string
): Promise<{ ok: boolean; message: string }> {
  const normalizedVerifyCode = String(verifyCode ?? '').trim();
  const normalizedChatId = normalizeTelegramChatId(telegramChatId);
  if (!/^reg_[a-f0-9]{24}$/i.test(normalizedVerifyCode) || !normalizedChatId) {
    return { ok: false, message: 'Registration code is invalid or expired.' };
  }

  const pending = await PendingPhoneRegistration.findOne({
    verifyCode: normalizedVerifyCode,
    verifyCodeExpires: { $gt: new Date() },
  });

  if (!pending) {
    return { ok: false, message: 'Registration code is invalid or expired.' };
  }

  pending.verifiedViaTelegram = true;
  pending.telegramChatId = normalizedChatId;
  pending.telegramUsername = String(telegramUsername ?? '').trim().slice(0, 120);
  pending.verifiedAt = new Date();
  await pending.save();

  return { ok: true, message: 'Phone confirmed. Return to Edmission and finish registration.' };
}

export async function startTelegramWebsiteAuthSession(): Promise<{
  sessionId: string;
  deepLink: string;
  expiresAt: string;
}> {
  const botUsername = config.telegram.botUsername.trim();
  if (!botUsername) {
    throw new AppError(503, 'Telegram login is not configured', ErrorCodes.SERVICE_UNAVAILABLE);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const sessionId = createTelegramWebAuthSessionId();
    const expiresAt = new Date(Date.now() + TELEGRAM_WEB_AUTH_SESSION_TTL_MS);
    try {
      await TelegramAuthSession.create({
        sessionId,
        expiresAt,
      });
      return {
        sessionId,
        deepLink: `https://t.me/${botUsername}?start=LOGIN_${sessionId}`,
        expiresAt: expiresAt.toISOString(),
      };
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        continue;
      }
      throw error;
    }
  }

  throw new AppError(500, 'Failed to create Telegram login session', ErrorCodes.INTERNAL_ERROR);
}

export async function bindTelegramWebsiteAuthSession(payload: {
  sessionId: string;
  telegramChatId: string;
  telegramUsername?: string;
  firstName?: string;
  lastName?: string;
}): Promise<{ ok: boolean; message: string }> {
  const sessionId = normalizeTelegramWebAuthSessionId(payload.sessionId);
  if (!sessionId) {
    return { ok: false, message: 'Login session is invalid. Start again from website.' };
  }

  const normalizedChatId = normalizeTelegramChatId(payload.telegramChatId);
  if (!normalizedChatId) {
    return { ok: false, message: 'Telegram chat id is invalid.' };
  }

  const telegramId = Number(normalizedChatId);
  if (!Number.isFinite(telegramId) || !Number.isSafeInteger(telegramId) || telegramId <= 0) {
    return { ok: false, message: 'Telegram chat id is invalid.' };
  }

  const firstName = String(payload.firstName ?? '').trim();
  const lastName = String(payload.lastName ?? '').trim();
  const name = [firstName, lastName].filter(Boolean).join(' ').trim().slice(0, 120);
  const telegramUsername = String(payload.telegramUsername ?? '').trim().slice(0, 120);

  const setPatch: Record<string, unknown> = {
    telegramId,
    telegramUsername,
  };
  if (name) {
    setPatch.name = name;
  }

  const session = await TelegramAuthSession.findOneAndUpdate(
    {
      sessionId,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: setPatch },
    { new: true }
  );

  if (!session) {
    return { ok: false, message: 'Session expired. Return to website and tap Telegram login again.' };
  }

  return { ok: true, message: 'Share your phone number to continue.' };
}

export async function issueTelegramWebsiteAuthCode(payload: {
  sessionId: string;
  telegramChatId: string;
  phone: string;
  telegramUsername?: string;
  firstName?: string;
  lastName?: string;
}): Promise<{ ok: boolean; message: string; code?: string; expiresAt?: string }> {
  const sessionId = normalizeTelegramWebAuthSessionId(payload.sessionId);
  if (!sessionId) {
    return { ok: false, message: 'Login session is invalid. Start again from website.' };
  }

  const normalizedChatId = normalizeTelegramChatId(payload.telegramChatId);
  if (!normalizedChatId) {
    return { ok: false, message: 'Telegram chat id is invalid.' };
  }

  const telegramId = Number(normalizedChatId);
  if (!Number.isFinite(telegramId) || !Number.isSafeInteger(telegramId) || telegramId <= 0) {
    return { ok: false, message: 'Telegram chat id is invalid.' };
  }

  const normalizedPhone = normalizePhone(payload.phone);
  if (!normalizedPhone) {
    return { ok: false, message: 'Phone number is invalid. Try sharing contact again.' };
  }

  const session = await TelegramAuthSession.findOne({
    sessionId,
    telegramId,
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  });

  if (!session) {
    return { ok: false, message: 'Session expired. Return to website and start Telegram login again.' };
  }

  const firstName = String(payload.firstName ?? '').trim();
  const lastName = String(payload.lastName ?? '').trim();
  const incomingName = [firstName, lastName].filter(Boolean).join(' ').trim().slice(0, 120);
  if (incomingName && !String(session.name ?? '').trim()) {
    session.name = incomingName;
  }

  session.phone = normalizedPhone;
  session.telegramUsername = String(payload.telegramUsername ?? '').trim().slice(0, 120);
  session.code = createTelegramWebAuthCode();
  session.expiresAt = new Date(Date.now() + TELEGRAM_WEB_AUTH_CODE_TTL_MS);
  await session.save();

  return {
    ok: true,
    message: 'Code generated.',
    code: session.code,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export async function verifyTelegramWebsiteAuthCode(payload: {
  sessionId: string;
  code: string;
}) {
  const sessionId = normalizeTelegramWebAuthSessionId(payload.sessionId);
  const normalizedCode = String(payload.code ?? '').trim();

  if (!sessionId || !/^\d{6}$/.test(normalizedCode)) {
    throw new AppError(400, 'Invalid session or code', ErrorCodes.VALIDATION);
  }

  const now = new Date();
  const session = await TelegramAuthSession.findOneAndUpdate(
    {
      sessionId,
      code: normalizedCode,
      consumedAt: null,
      expiresAt: { $gt: now },
      phone: { $type: 'string', $ne: '' },
      telegramId: { $type: 'number' },
    },
    {
      $set: {
        consumedAt: now,
      },
    },
    { new: true }
  );

  if (!session) {
    throw new AppError(400, 'Invalid or expired code', ErrorCodes.VALIDATION);
  }

  const phone = normalizePhone(String(session.phone ?? ''));
  const telegramChatId = normalizeTelegramChatId(String(session.telegramId ?? ''));
  const fullName = String(session.name ?? '').trim();
  const telegramUsername = String(session.telegramUsername ?? '').trim();

  if (!phone || !telegramChatId) {
    throw new AppError(400, 'Telegram session is incomplete. Start login again.', ErrorCodes.VALIDATION);
  }

  const existingByPhone = await findUserByPhone(phone);
  if (existingByPhone) {
    const role = String(existingByPhone.role ?? '');
    if (role !== 'student' && role !== 'university') {
      throw new AppError(
        403,
        'Telegram login is available only for student and university accounts.',
        ErrorCodes.FORBIDDEN
      );
    }

    await linkTelegramToUser(String(existingByPhone._id), {
      chatId: telegramChatId,
      username: telegramUsername,
      phone,
    });
    if (!String(existingByPhone.name ?? '').trim() && fullName) {
      existingByPhone.name = fullName;
      await existingByPhone.save();
    }
    return issueTokensAfterLoginChecks(existingByPhone);
  }

  const created = await registerFromTelegram({
    chatId: telegramChatId,
    phone,
    fullName,
    username: telegramUsername,
  });
  const user = await User.findById(created.userId);
  if (!user) {
    throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  }
  return issueTokensAfterLoginChecks(user);
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
  if (
    payload.iat &&
    user.passwordChangedAt instanceof Date &&
    payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)
  ) {
    throw new AppError(401, 'Invalid refresh token', ErrorCodes.UNAUTHORIZED);
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
    .select(
      'email name role phone socialLinks emailVerified suspended createdAt notificationPreferences totpEnabled mustChangePassword localPasswordConfigured googleSub yandexSub onboardingTutorialSeen managedUniversityUserIds universityMultiManagerApproved'
    )
    .lean();
  if (!user) {
    throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  }
  const [studentProfile, universityProfile, subscription] = await Promise.all([
    StudentProfile.findOne({ userId }).lean(),
    UniversityProfile.findOne({ userId }).lean(),
    subscriptionService.getSubscriptionSummary(userId),
  ]);
  const u = user as {
    _id: unknown
    email: string
    name?: string
    phone?: string
    socialLinks?: { telegram?: string; instagram?: string; linkedin?: string; facebook?: string; whatsapp?: string }
    role: string
    emailVerified?: boolean
    suspended?: boolean
    createdAt?: Date
    notificationPreferences?: { emailApplicationUpdates?: boolean; emailTrialReminder?: boolean }
    totpEnabled?: boolean
    mustChangePassword?: boolean
    localPasswordConfigured?: boolean
    googleSub?: string | null
    yandexSub?: string | null
    onboardingTutorialSeen?: { student?: boolean; university?: boolean }
  };
  const studentAvatar = studentProfile && (studentProfile as { avatarUrl?: string }).avatarUrl
    ? String((studentProfile as { avatarUrl: string }).avatarUrl).trim() || undefined
    : undefined;
  const universityLogo = universityProfile && (universityProfile as { logoUrl?: string }).logoUrl
    ? String((universityProfile as { logoUrl: string }).logoUrl).trim() || undefined
    : undefined;
  const avatar =
    u.role === 'student'
      ? studentAvatar ?? undefined
      : u.role === 'university'
        ? universityLogo ?? undefined
        : undefined;

  let managedUniversities:
    | Array<{ userId: string; universityName: string; logoUrl?: string; verified: boolean }>
    | undefined;
  let universityMultiManagerApproved: boolean | undefined;
  if (u.role === 'university_multi_manager') {
    universityMultiManagerApproved = Boolean((u as { universityMultiManagerApproved?: boolean }).universityMultiManagerApproved);
    const ids = ((u as { managedUniversityUserIds?: unknown[] }).managedUniversityUserIds ?? [])
      .map((x) => String(x))
      .filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (ids.length) {
      const profiles = await UniversityProfile.find({ userId: { $in: ids } })
        .select('userId universityName logoUrl verified')
        .lean();
      managedUniversities = profiles.map((p) => ({
        userId: String((p as { userId: unknown }).userId),
        universityName: String((p as { universityName?: string }).universityName ?? ''),
        logoUrl: (p as { logoUrl?: string }).logoUrl ? String((p as { logoUrl: string }).logoUrl).trim() || undefined : undefined,
        verified: Boolean((p as { verified?: boolean }).verified),
      }));
    } else {
      managedUniversities = [];
    }
  }

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
    mustSetLocalPassword: computeMustSetLocalPassword(u),
    localPasswordConfigured: u.localPasswordConfigured !== false,
    notificationPreferences: u.notificationPreferences ?? { emailApplicationUpdates: true, emailTrialReminder: true },
    onboardingTutorialSeen: u.onboardingTutorialSeen ?? { student: false, university: false },
    studentProfile: studentProfile ? { ...studentProfile, id: String((studentProfile as { _id: unknown })._id), verifiedAt: (studentProfile as { verifiedAt?: Date }).verifiedAt } : null,
    universityProfile: universityProfile ? { ...universityProfile, id: String((universityProfile as { _id: unknown })._id), verified: (universityProfile as { verified?: boolean }).verified } : null,
    subscription,
    ...(u.role === 'university_multi_manager'
      ? {
          universityMultiManagerApproved,
          managedUniversities,
        }
      : {}),
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
  const normalizedCode = String(code ?? '').trim();
  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new AppError(400, 'Invalid or expired code', ErrorCodes.VALIDATION);
  }

  const pending = await PendingRegistration.findOne({ email: normalized });
  if (!pending) {
    throw new AppError(400, 'Invalid or expired code', ErrorCodes.VALIDATION);
  }

  const now = Date.now();
  const expiresAt = new Date((pending as { verifyTokenExpires?: Date }).verifyTokenExpires ?? 0).getTime();
  if (!expiresAt || expiresAt <= now) {
    throw new AppError(400, 'Invalid or expired code', ErrorCodes.VALIDATION);
  }

  const lockedUntil = new Date((pending as { verifyLockedUntil?: Date | null }).verifyLockedUntil ?? 0).getTime();
  if (lockedUntil > now) {
    const waitSec = Math.ceil((lockedUntil - now) / 1000);
    throw new AppError(
      429,
      `Too many invalid attempts. Please wait ${waitSec} seconds or request a new code.`,
      ErrorCodes.RATE_LIMIT
    );
  }

  if (String((pending as { verifyToken?: string }).verifyToken ?? '') !== normalizedCode) {
    const failedAttempts = Number((pending as { verifyFailedAttempts?: number }).verifyFailedAttempts ?? 0) + 1;
    const nextLockedUntil = failedAttempts >= VERIFY_CODE_MAX_ATTEMPTS
      ? new Date(Date.now() + VERIFY_CODE_LOCK_MS)
      : null;

    await PendingRegistration.updateOne(
      { _id: pending._id },
      {
        verifyFailedAttempts: failedAttempts,
        verifyLockedUntil: nextLockedUntil,
      }
    );

    if (nextLockedUntil) {
      const waitSec = Math.ceil((nextLockedUntil.getTime() - Date.now()) / 1000);
      throw new AppError(
        429,
        `Too many invalid attempts. Please wait ${waitSec} seconds or request a new code.`,
        ErrorCodes.RATE_LIMIT
      );
    }

    throw new AppError(400, 'Invalid or expired code', ErrorCodes.VALIDATION);
  }

  let user: InstanceType<typeof User>;
  try {
    user = await User.create({
      email: pending.email,
      name: '',
      passwordHash: pending.passwordHash,
      role: pending.role as Role,
      emailVerified: true,
      localPasswordConfigured: true,
    });
  } catch (error: unknown) {
    if ((error as { code?: number }).code === 11000) {
      await PendingRegistration.deleteOne({ email: normalized }).catch(() => {});
      throw new AppError(409, 'Email already registered', ErrorCodes.CONFLICT);
    }
    throw error;
  }

  if (pending.role === 'student') {
    await StudentProfile.create({
      userId: user._id,
      avatarUrl: pending.avatarUrl || undefined,
    });
  }
  await subscriptionService.createForNewUser(String(user._id), pending.role);

  await PendingRegistration.deleteOne({ email: normalized });

  return issueAuthTokens(user);
}

export async function forgotPassword(email: string): Promise<{ success: true; resetLink?: string }> {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) return { success: true };

  const resetToken = uuidv4();
  const resetLink = emailService.buildResetPasswordLink(resetToken);
  await User.findByIdAndUpdate(user._id, {
    resetToken,
    resetTokenExpires: new Date(Date.now() + 60 * 60 * 1000),
  });

  const sent = await emailService.sendResetPasswordEmail(user.email, resetToken);
  if (!sent && config.email.enabled) {
    if (config.nodeEnv === 'production') {
      throw new AppError(
        503,
        'Failed to send reset email. Please try again later.',
        ErrorCodes.SERVICE_UNAVAILABLE
      );
    }
    logger.warn(
      { email: user.email, resetLink },
      'Password reset email could not be delivered; returning reset link for non-production use'
    );
    return { success: true, resetLink };
  }

  if (!sent) {
    logger.info({ email: user.email, resetLink }, 'Email disabled: password reset link (use in dev)');
    return { success: true, resetLink };
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
    localPasswordConfigured: true,
    passwordChangedAt: new Date(),
  });
  await RefreshToken.deleteMany({ userId: user._id });
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
    localPasswordConfigured: true,
    passwordChangedAt: new Date(),
  });
  await RefreshToken.deleteMany({ userId });
  const refreshed = await User.findById(userId);
  if (!refreshed) {
    throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  }
  return issueAuthTokens(refreshed);
}

/** Change password for logged-in user (knows current password). OAuth-only accounts must use set-password first. */
export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await User.findById(userId).select('passwordHash localPasswordConfigured').lean();
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  const doc = user as { passwordHash?: string; localPasswordConfigured?: boolean | null };
  if (doc.localPasswordConfigured === false) {
    throw new AppError(
      400,
      'Set a password for your account first (for example after signing in with Google or Yandex)',
      ErrorCodes.VALIDATION
    );
  }
  const hash = doc.passwordHash ?? '';
  const valid = await bcrypt.compare(currentPassword, hash);
  if (!valid) {
    throw new AppError(401, 'Current password is incorrect', ErrorCodes.UNAUTHORIZED);
  }
  const { passwordSchema } = await import('../validators/auth.validator');
  passwordSchema.parse(newPassword);
  if (await bcrypt.compare(newPassword, hash)) {
    throw new AppError(400, 'New password must be different from the current password', ErrorCodes.VALIDATION);
  }
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await User.findByIdAndUpdate(userId, {
    passwordHash,
    mustChangePassword: false,
    localPasswordConfigured: true,
    passwordChangedAt: new Date(),
  });
  await RefreshToken.deleteMany({ userId });
  const refreshed = await User.findById(userId);
  if (!refreshed) {
    throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  }
  return issueAuthTokens(refreshed);
}

function createTelegramCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function findUserByPhone(phone: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return User.findOne({ phone: normalized });
}

export async function issueTelegramPhoneCode(phone: string) {
  const user = await findUserByPhone(phone);
  if (!user) return null;
  const code = createTelegramCode();
  user.set('telegram.authCode', code);
  user.set('telegram.authCodeExpiresAt', new Date(Date.now() + config.telegram.otpTtlMs));
  user.set('telegram.authCodeAttempts', 0);
  user.set('telegram.authState', 'otp_pending');
  await user.save();
  return { userId: String(user._id), code };
}

export async function verifyTelegramPhoneCode(phone: string, code: string) {
  const user = await findUserByPhone(phone);
  if (!user) return null;
  const now = Date.now();
  const expires = user.telegram?.authCodeExpiresAt ? new Date(user.telegram.authCodeExpiresAt).getTime() : 0;
  if (!user.telegram?.authCode || !expires || expires < now) {
    throw new AppError(400, 'Code expired. Request a new code.', ErrorCodes.VALIDATION);
  }
  const attempts = Number(user.telegram?.authCodeAttempts ?? 0);
  if (attempts >= config.telegram.maxOtpAttempts) {
    throw new AppError(429, 'Too many attempts. Request a new code.', ErrorCodes.RATE_LIMIT);
  }
  if (String(code).trim() !== String(user.telegram.authCode).trim()) {
    user.set('telegram.authCodeAttempts', attempts + 1);
    await user.save();
    throw new AppError(400, 'Invalid code', ErrorCodes.VALIDATION);
  }
  user.set('telegram.authCode', '');
  user.set('telegram.authCodeAttempts', 0);
  user.set('telegram.authCodeExpiresAt', null);
  user.set('telegram.authState', '');
  await user.save();
  return user;
}

export async function findUserByTelegramChatId(chatId: string) {
  const id = normalizeTelegramChatId(chatId);
  if (!id) return null;
  return User.findOne({
    $or: [{ 'telegram.chatId': id }, { 'socialLinks.telegram': id }],
  })
    .select('name email role phone language telegram localPasswordConfigured')
    .lean();
}

export async function unlinkTelegramByChatId(chatId: string): Promise<boolean> {
  const id = normalizeTelegramChatId(chatId);
  if (!id) return false;
  const user = await User.findOne({
    $or: [{ 'telegram.chatId': id }, { 'socialLinks.telegram': id }],
  });
  if (!user) return false;
  await User.findByIdAndUpdate(user._id, {
    $set: {
      'socialLinks.telegram': '',
      'telegram.username': '',
      'telegram.phone': '',
      'telegram.linkedAt': null,
    },
    $unset: {
      'telegram.chatId': 1,
    },
  });
  return true;
}

export async function linkTelegramToUser(
  userId: string,
  payload: { chatId: string; username?: string; phone?: string }
): Promise<void> {
  const chatId = normalizeTelegramChatId(payload.chatId);
  if (!chatId) throw new AppError(400, 'Telegram chat id is required', ErrorCodes.VALIDATION);
  const phone = payload.phone ? normalizePhone(payload.phone) : '';
  await unlinkTelegramFromOtherUsers(chatId, userId);
  await User.findByIdAndUpdate(userId, {
    $set: {
      'socialLinks.telegram': chatId,
      'telegram.chatId': chatId,
      'telegram.username': String(payload.username ?? '').trim(),
      'telegram.phone': phone || undefined,
      'telegram.linkedAt': new Date(),
      'telegram.authState': '',
      'telegram.authCode': '',
      'telegram.authCodeAttempts': 0,
      'telegram.authCodeExpiresAt': null,
    },
  });
}

export async function linkTelegramByCode(
  code: string,
  payload: { chatId: string; username?: string }
): Promise<boolean> {
  const normalizedCode = String(code ?? '').trim();
  if (!/^[a-f0-9]{32}$/i.test(normalizedCode)) return false;
  const normalizedChatId = normalizeTelegramChatId(payload.chatId);
  if (!normalizedChatId) {
    throw new AppError(400, 'Telegram chat id is required', ErrorCodes.VALIDATION);
  }
  const user = await User.findOne({
    'telegram.linkCode': normalizedCode,
    'telegram.linkCodeExpiresAt': { $gt: new Date() },
  })
    .select('_id')
    .lean();
  if (!user) return false;
  const userId = String((user as { _id: unknown })._id);
  await unlinkTelegramFromOtherUsers(normalizedChatId, userId);

  const updated = await User.updateOne(
    {
      _id: userId,
      'telegram.linkCode': normalizedCode,
      'telegram.linkCodeExpiresAt': { $gt: new Date() },
    },
    {
      $set: {
        'socialLinks.telegram': normalizedChatId,
        'telegram.chatId': normalizedChatId,
        'telegram.username': String(payload.username ?? '').trim(),
        'telegram.linkedAt': new Date(),
        'telegram.linkCode': '',
        'telegram.linkCodeExpiresAt': null,
        'telegram.authState': '',
        'telegram.authCode': '',
        'telegram.authCodeAttempts': 0,
        'telegram.authCodeExpiresAt': null,
      },
    }
  );
  return updated.modifiedCount === 1;
}

export async function registerFromTelegram(payload: {
  chatId: string;
  phone: string;
  fullName: string;
  username?: string;
}) {
  const chatId = normalizeTelegramChatId(payload.chatId);
  if (!chatId) throw new AppError(400, 'Telegram chat id is required', ErrorCodes.VALIDATION);
  const phone = normalizePhone(payload.phone);
  if (!phone) throw new AppError(400, 'Phone is required', ErrorCodes.VALIDATION);
  const existing = await findUserByPhone(phone);
  if (existing) {
    await linkTelegramToUser(String(existing._id), {
      chatId,
      username: payload.username,
      phone,
    });
    return { userId: String(existing._id), created: false };
  }
  const passwordHash = await bcrypt.hash(`tg:${chatId}:${uuidv4()}`, BCRYPT_ROUNDS);
  const email = `tg_${chatId}_${Date.now()}@telegram.local`;
  const user = await User.create({
    role: 'student',
    language: 'en',
    email,
    name: String(payload.fullName ?? '').trim(),
    phone,
    passwordHash,
    emailVerified: true,
    localPasswordConfigured: false,
    telegram: {
      chatId,
      username: String(payload.username ?? '').trim(),
      phone,
      linkedAt: new Date(),
    },
    socialLinks: {
      telegram: chatId,
    },
  });
  await StudentProfile.create({ userId: user._id });
  await subscriptionService.createForNewUser(String(user._id), 'student');
  return { userId: String(user._id), created: true };
}
