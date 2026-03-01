import mongoose from 'mongoose';
import { Subscription, Interest, Offer, StudentProfile, UniversityProfile, User } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';
import type { Role } from '../types/role';
import * as emailService from './email.service';
import { config } from '../config';

export interface SubscriptionInfo {
  userId: mongoose.Types.ObjectId;
  role: string;
  plan: string;
  status: string;
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Plan identifiers */
export const STUDENT_PLAN = {
  FREE_TRIAL: 'student_free_trial',
  STANDARD: 'student_standard',
  MAX_PREMIUM: 'student_max_premium',
} as const;

export const UNIVERSITY_PLAN = {
  FREE: 'university_free',
  PREMIUM: 'university_premium',
} as const;

/** Max applications (university interests) per student. null = unlimited */
const APPLICATION_LIMITS: Record<string, number | null> = {
  [STUDENT_PLAN.FREE_TRIAL]: 3,
  [STUDENT_PLAN.STANDARD]: 15,
  [STUDENT_PLAN.MAX_PREMIUM]: null,
};

/** Max offers ("student requests") per university. null = unlimited */
const OFFER_LIMITS: Record<string, number | null> = {
  [UNIVERSITY_PLAN.FREE]: 15,
  [UNIVERSITY_PLAN.PREMIUM]: null,
};

/** Chat model per plan. All use OLLAMA_MODEL (e.g. deepseek-r1:8b) from env; one Ollama instance for all. */
function getOllamaModel(): string {
  return config.ollama.model;
}
const CHAT_MODELS: Record<string, string> = {
  [STUDENT_PLAN.FREE_TRIAL]: getOllamaModel(),
  [STUDENT_PLAN.STANDARD]: getOllamaModel(),
  [STUDENT_PLAN.MAX_PREMIUM]: getOllamaModel(),
  [UNIVERSITY_PLAN.FREE]: getOllamaModel(),
  [UNIVERSITY_PLAN.PREMIUM]: getOllamaModel(),
};

const TRIAL_DAYS = 14;

/** Create subscription for a newly registered user */
export async function createForNewUser(userId: string, role: Role): Promise<SubscriptionInfo> {
  const existing = await Subscription.findOne({ userId }).lean();
  if (existing) {
    return existing as unknown as SubscriptionInfo;
  }

  const now = new Date();
  if (role === 'student') {
    const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const sub = await Subscription.create({
      userId,
      role: 'student',
      plan: STUDENT_PLAN.FREE_TRIAL,
      status: 'active',
      trialEndsAt,
    });
    const obj = sub.toObject() as Record<string, unknown>;
    return {
      userId: sub.userId,
      role: sub.role,
      plan: sub.plan,
      status: sub.status,
      trialEndsAt: obj.trialEndsAt as Date | undefined,
      currentPeriodEnd: obj.currentPeriodEnd as Date | undefined,
    };
  }
  if (role === 'university') {
    const sub = await Subscription.create({
      userId,
      role: 'university',
      plan: UNIVERSITY_PLAN.FREE,
      status: 'active',
    });
    return {
      userId: sub.userId,
      role: sub.role,
      plan: sub.plan,
      status: sub.status,
    };
  }
  throw new AppError(400, 'Invalid role for subscription', ErrorCodes.VALIDATION);
}

export async function getSubscription(userId: string): Promise<SubscriptionInfo | null> {
  const sub = await Subscription.findOne({ userId }).lean();
  return sub as SubscriptionInfo | null;
}

export function isTrialExpired(sub: SubscriptionInfo | null): boolean {
  if (!sub || sub.plan !== STUDENT_PLAN.FREE_TRIAL) return false;
  if (!sub.trialEndsAt) return false;
  return new Date() >= sub.trialEndsAt;
}

/** Effective plan for checks. If student is on free_trial and trial expired, treat as no access until upgrade */
export function getEffectivePlan(sub: SubscriptionInfo | null): string | null {
  if (!sub || sub.status !== 'active') return null;
  if (sub.plan === STUDENT_PLAN.FREE_TRIAL && sub.trialEndsAt && new Date() >= sub.trialEndsAt) {
    return null;
  }
  return sub.plan;
}

/** Check if student can send one more application (interest). Returns { allowed, current, limit } */
export async function canSendApplication(userId: string): Promise<{
  allowed: boolean;
  current: number;
  limit: number | null;
  trialExpired?: boolean;
}> {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) {
    throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);
  }
  const sub = await getSubscription(userId);
  const effectivePlan = getEffectivePlan(sub);
  const trialExpired = !!(sub?.plan === STUDENT_PLAN.FREE_TRIAL && isTrialExpired(sub));

  if (!effectivePlan) {
    return {
      allowed: false,
      current: await Interest.countDocuments({ studentId: profile._id }),
      limit: APPLICATION_LIMITS[STUDENT_PLAN.FREE_TRIAL] ?? 0,
      trialExpired: !!trialExpired,
    };
  }

  const limit = APPLICATION_LIMITS[effectivePlan] ?? null;
  const current = await Interest.countDocuments({ studentId: profile._id });
  const allowed = limit === null ? true : current < limit;
  return { allowed, current, limit, trialExpired };
}

/** Check if university can send one more offer (student request). Returns { allowed, current, limit } */
export async function canSendOffer(userId: string): Promise<{
  allowed: boolean;
  current: number;
  limit: number | null;
}> {
  const profile = await UniversityProfile.findOne({ userId });
  if (!profile) {
    throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  }
  const sub = await getSubscription(userId);
  const effectivePlan = getEffectivePlan(sub) ?? UNIVERSITY_PLAN.FREE;
  const limit = OFFER_LIMITS[effectivePlan] ?? OFFER_LIMITS[UNIVERSITY_PLAN.FREE] ?? 15;
  const current = await Offer.countDocuments({ universityId: profile._id });
  const allowed = limit === null ? true : current < limit;
  return { allowed, current, limit };
}

/** Resolve chat model for the user's subscription (and role) */
export async function getChatModel(userId: string, role: Role): Promise<string> {
  const sub = await getSubscription(userId);
  const effectivePlan = getEffectivePlan(sub);
  const plan = effectivePlan ?? (role === 'student' ? STUDENT_PLAN.FREE_TRIAL : UNIVERSITY_PLAN.FREE);
  return CHAT_MODELS[plan] ?? getOllamaModel();
}

/** Send trial reminder email if trial ends in 2 days and not yet sent. */
export async function sendTrialReminderIfNeeded(userId: string): Promise<void> {
  const sub = await Subscription.findOne({ userId });
  if (!sub || sub.plan !== STUDENT_PLAN.FREE_TRIAL || !sub.trialEndsAt || (sub as { trialReminderSentAt?: Date }).trialReminderSentAt) return;
  const now = new Date();
  const end = new Date(sub.trialEndsAt);
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (daysLeft > 2 || daysLeft < 0) return;
  const user = await User.findById(userId).select('email notificationPreferences').lean();
  const prefs = (user as { notificationPreferences?: { emailTrialReminder?: boolean } })?.notificationPreferences;
  if (prefs?.emailTrialReminder === false) return;
  const html = emailService.trialReminderHtml(daysLeft, 'Standard');
  await emailService.sendMail((user as { email: string }).email, 'Your Edmission trial ends soon', html);
  await Subscription.updateOne({ userId }, { $set: { trialReminderSentAt: now } });
}

/** Get subscription summary for current user (for frontend). Creates subscription if missing (e.g. legacy user). */
export async function getSubscriptionSummary(userId: string): Promise<{
  plan: string;
  status: string;
  trialEndsAt: Date | null;
  applicationLimit: number | null;
  applicationCurrent: number;
  offerLimit: number | null;
  offerCurrent: number;
  chatModel: string;
  trialExpired: boolean;
}> {
  let sub = await getSubscription(userId);
  const studentProfile = await StudentProfile.findOne({ userId });
  const universityProfile = await UniversityProfile.findOne({ userId });
  if (!sub && (studentProfile || universityProfile)) {
    const role: Role = studentProfile ? 'student' : 'university';
    await createForNewUser(userId, role);
    sub = await getSubscription(userId);
  }

  if (sub) sendTrialReminderIfNeeded(userId).catch(() => {});

  const effectivePlan = getEffectivePlan(sub);
  const trialExpired = isTrialExpired(sub);
  const chatModel = await getChatModel(userId, (sub?.role as Role) ?? 'student');

  let applicationLimit: number | null = null;
  let applicationCurrent = 0;
  let offerLimit: number | null = null;
  let offerCurrent = 0;

  if (studentProfile) {
    applicationCurrent = await Interest.countDocuments({ studentId: studentProfile._id });
    applicationLimit = effectivePlan ? APPLICATION_LIMITS[effectivePlan] ?? null : APPLICATION_LIMITS[STUDENT_PLAN.FREE_TRIAL];
  }
  if (universityProfile) {
    offerCurrent = await Offer.countDocuments({ universityId: universityProfile._id });
    offerLimit = effectivePlan ? OFFER_LIMITS[effectivePlan] ?? null : OFFER_LIMITS[UNIVERSITY_PLAN.FREE];
  }

  return {
    plan: sub?.plan ?? '',
    status: sub?.status ?? 'active',
    trialEndsAt: sub?.trialEndsAt ?? null,
    applicationLimit,
    applicationCurrent,
    offerLimit,
    offerCurrent,
    chatModel,
    trialExpired,
  };
}

const ALL_PLANS = [
  STUDENT_PLAN.FREE_TRIAL,
  STUDENT_PLAN.STANDARD,
  STUDENT_PLAN.MAX_PREMIUM,
  UNIVERSITY_PLAN.FREE,
  UNIVERSITY_PLAN.PREMIUM,
] as const;

/** Admin: list subscriptions with optional filters */
export async function listSubscriptions(query: {
  page?: number;
  limit?: number;
  role?: string;
  plan?: string;
  status?: string;
}): Promise<{ data: SubscriptionInfo[]; total: number; page: number; limit: number; totalPages: number }> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;
  const where: Record<string, unknown> = {};
  if (query.role) where.role = query.role;
  if (query.plan) where.plan = query.plan;
  if (query.status) where.status = query.status;
  const [list, total] = await Promise.all([
    Subscription.find(where).skip(skip).limit(limit).sort({ createdAt: -1 }).lean(),
    Subscription.countDocuments(where),
  ]);
  return {
    data: list as unknown as SubscriptionInfo[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/** Admin: get subscription by user id */
export async function getSubscriptionByUserId(userId: string): Promise<SubscriptionInfo | null> {
  return getSubscription(userId);
}

/** Admin: update subscription (plan, status, trialEndsAt, currentPeriodEnd) */
export async function updateSubscription(
  userId: string,
  data: { plan?: string; status?: string; trialEndsAt?: Date | null; currentPeriodEnd?: Date | null }
): Promise<SubscriptionInfo | null> {
  const sub = await Subscription.findOne({ userId });
  if (!sub) return null;
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  if (data.plan !== undefined && ALL_PLANS.includes(data.plan as (typeof ALL_PLANS)[number])) {
    set.plan = data.plan;
  }
  if (data.status !== undefined && ['active', 'expired', 'cancelled'].includes(data.status)) {
    set.status = data.status;
  }
  if (data.trialEndsAt !== undefined) {
    if (data.trialEndsAt == null) unset.trialEndsAt = 1;
    else set.trialEndsAt = data.trialEndsAt;
  }
  if (data.currentPeriodEnd !== undefined) {
    if (data.currentPeriodEnd == null) unset.currentPeriodEnd = 1;
    else set.currentPeriodEnd = data.currentPeriodEnd;
  }
  if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) {
    return sub.toObject() as unknown as SubscriptionInfo;
  }
  const update: Record<string, unknown> = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  const updated = await Subscription.findOneAndUpdate({ userId }, update, { new: true }).lean();
  return updated as unknown as SubscriptionInfo;
}
