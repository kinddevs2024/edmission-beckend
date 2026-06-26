import mongoose from 'mongoose';
import { Subscription, Interest, CatalogInterest, Offer, StudentProfile, UniversityProfile, User } from '../models';
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

export const SCHOOL_COUNSELLOR_PLAN = {
  FREE: 'school_counsellor_free',
  PREMIUM: 'school_counsellor_premium',
} as const;

export const STAFF_PLAN = {
  INTERNAL: 'staff_internal',
} as const;

export const PAID_SUBSCRIPTION_PLANS = [
  STUDENT_PLAN.STANDARD,
  STUDENT_PLAN.MAX_PREMIUM,
  UNIVERSITY_PLAN.PREMIUM,
  SCHOOL_COUNSELLOR_PLAN.PREMIUM,
] as const;

export function getDefaultPlanForRole(role: Role): string {
  if (role === 'student') return STUDENT_PLAN.FREE_TRIAL;
  if (role === 'university' || role === 'university_multi_manager' || role === 'multi_university_admin') {
    return UNIVERSITY_PLAN.FREE;
  }
  if (role === 'school_counsellor') return SCHOOL_COUNSELLOR_PLAN.FREE;
  return STAFF_PLAN.INTERNAL;
}

export function isPlanAvailableForRole(role: Role | string, planId: string): boolean {
  if (role === 'student') return planId === STUDENT_PLAN.STANDARD || planId === STUDENT_PLAN.MAX_PREMIUM;
  if (role === 'university' || role === 'university_multi_manager' || role === 'multi_university_admin') {
    return planId === UNIVERSITY_PLAN.PREMIUM;
  }
  if (role === 'school_counsellor') return planId === SCHOOL_COUNSELLOR_PLAN.PREMIUM;
  return false;
}

/** Max applications (university interests) per student. null = unlimited */
const APPLICATION_LIMITS: Record<string, number | null> = {
  [STUDENT_PLAN.FREE_TRIAL]: 3,
  [STUDENT_PLAN.STANDARD]: 15,
  [STUDENT_PLAN.MAX_PREMIUM]: null,
};

const FREE_STUDENT_INTEREST_CAP = APPLICATION_LIMITS[STUDENT_PLAN.FREE_TRIAL] ?? 3;

/**
 * Unknown / legacy plan values must not become "unlimited" (undefined key → null coalescing bug).
 * Only explicit `null` in APPLICATION_LIMITS means unlimited (e.g. max premium).
 */
function studentApplicationLimitForPlan(effectivePlan: string | null): number | null {
  if (!effectivePlan) return FREE_STUDENT_INTEREST_CAP;
  const lim = APPLICATION_LIMITS[effectivePlan];
  if (lim === undefined) return FREE_STUDENT_INTEREST_CAP;
  return lim;
}

/** Max offers ("student requests") per university. null = unlimited */
const OFFER_LIMITS: Record<string, number | null> = {
  [UNIVERSITY_PLAN.FREE]: 15,
  [UNIVERSITY_PLAN.PREMIUM]: null,
};

/** Chat model per plan follows the active AI provider priority: OpenAI -> Gemini -> DeepSeek -> Ollama. */
function getDefaultChatModel(): string {
  if (config.openai.apiKey?.trim()) return config.openai.model;
  if (config.gemini.apiKey?.trim()) return config.gemini.model;
  if (config.deepseek.apiKey?.trim()) return config.deepseek.model;
  return config.ollama.model;
}
const CHAT_MODELS: Record<string, string> = {
  [STUDENT_PLAN.FREE_TRIAL]: getDefaultChatModel(),
  [STUDENT_PLAN.STANDARD]: getDefaultChatModel(),
  [STUDENT_PLAN.MAX_PREMIUM]: getDefaultChatModel(),
  [UNIVERSITY_PLAN.FREE]: getDefaultChatModel(),
  [UNIVERSITY_PLAN.PREMIUM]: getDefaultChatModel(),
  [SCHOOL_COUNSELLOR_PLAN.FREE]: getDefaultChatModel(),
  [SCHOOL_COUNSELLOR_PLAN.PREMIUM]: getDefaultChatModel(),
  [STAFF_PLAN.INTERNAL]: getDefaultChatModel(),
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
  const defaultPlan = getDefaultPlanForRole(role);
  if (defaultPlan) {
    const sub = await Subscription.create({
      userId,
      role,
      plan: defaultPlan,
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

async function refreshUnusedTrialAfterPasswordSetup(
  userId: string,
  sub: SubscriptionInfo | null,
  currentApplications: number
): Promise<SubscriptionInfo | null> {
  if (!sub || sub.plan !== STUDENT_PLAN.FREE_TRIAL || !isTrialExpired(sub) || currentApplications > 0) {
    return sub;
  }

  const user = await User.findById(userId).select('passwordChangedAt').lean();
  const passwordChangedAtRaw = (user as { passwordChangedAt?: Date | string } | null)?.passwordChangedAt;
  const passwordChangedAt = passwordChangedAtRaw ? new Date(passwordChangedAtRaw) : null;
  const trialEndsAt = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;

  if (!passwordChangedAt || Number.isNaN(passwordChangedAt.getTime()) || !trialEndsAt || passwordChangedAt <= trialEndsAt) {
    return sub;
  }

  const trialEndsAtNext = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const updated = await Subscription.findOneAndUpdate(
    { userId, plan: STUDENT_PLAN.FREE_TRIAL },
    { $set: { status: 'active', trialEndsAt: trialEndsAtNext }, $unset: { trialReminderSentAt: 1 } },
    { new: true }
  ).lean();
  return updated as SubscriptionInfo | null;
}

/** Check if university has premium plan with active status (unlimited student profile views, offers, etc.) */
export function hasPremiumUniversityPlan(sub: SubscriptionInfo | null): boolean {
  const effective = getEffectivePlan(sub);
  return effective === UNIVERSITY_PLAN.PREMIUM;
}

/** Count interest “slots”: real universities (Interest) + catalog templates (CatalogInterest). */
async function countStudentInterestDocuments(studentProfileId: mongoose.Types.ObjectId): Promise<number> {
  const [profileInterests, catalogInterests] = await Promise.all([
    Interest.countDocuments({ studentId: studentProfileId }),
    CatalogInterest.countDocuments({ studentId: studentProfileId }),
  ]);
  return profileInterests + catalogInterests;
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

  let sub = await getSubscription(userId);
  if (!sub) {
    await createForNewUser(userId, 'student');
    sub = await getSubscription(userId);
  }

  const current = await countStudentInterestDocuments(profile._id);
  sub = await refreshUnusedTrialAfterPasswordSetup(userId, sub, current);

  const effectivePlan = getEffectivePlan(sub);
  const trialExpired = !!(sub?.plan === STUDENT_PLAN.FREE_TRIAL && isTrialExpired(sub));

  if (!effectivePlan) {
    return {
      allowed: false,
      current,
      limit: FREE_STUDENT_INTEREST_CAP,
      trialExpired: !!trialExpired,
    };
  }

  const limit = studentApplicationLimitForPlan(effectivePlan);
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
  const plan = effectivePlan ?? getDefaultPlanForRole(role);
  return CHAT_MODELS[plan] ?? getDefaultChatModel();
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
  const [studentProfile, universityProfile, user] = await Promise.all([
    StudentProfile.findOne({ userId }),
    UniversityProfile.findOne({ userId }),
    User.findById(userId).select('role').lean(),
  ]);
  if (!sub && user?.role) {
    const role = String((user as { role?: string }).role ?? '') as Role;
    await createForNewUser(userId, role);
    sub = await getSubscription(userId);
  }

  if (sub) sendTrialReminderIfNeeded(userId).catch(() => {});

  let applicationLimit: number | null = null;
  let applicationCurrent = 0;
  let offerLimit: number | null = null;
  let offerCurrent = 0;

  if (studentProfile) {
    applicationCurrent = await countStudentInterestDocuments(studentProfile._id);
    sub = await refreshUnusedTrialAfterPasswordSetup(userId, sub, applicationCurrent);
  }

  const effectivePlan = getEffectivePlan(sub);
  const trialExpired = isTrialExpired(sub);
  const chatModel = await getChatModel(userId, ((sub?.role ?? (user as { role?: string } | null)?.role) as Role) ?? 'student');

  if (studentProfile) {
    applicationLimit = studentApplicationLimitForPlan(effectivePlan);
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
  SCHOOL_COUNSELLOR_PLAN.FREE,
  SCHOOL_COUNSELLOR_PLAN.PREMIUM,
  STAFF_PLAN.INTERNAL,
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
