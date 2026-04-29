import { config } from '../config';
import { Subscription, User } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';
import { STUDENT_PLAN, UNIVERSITY_PLAN } from './subscription.service';

/** Allowed URL origins for success/cancel redirects (prevent open redirect) */
function isAllowedRedirectUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    const allowed = [config.frontendUrl, ...config.cors.origin].map((o) => {
      try {
        return new URL(o).origin;
      } catch {
        return o;
      }
    });
    return allowed.some((origin) => parsed.origin === origin);
  } catch {
    return false;
  }
}

/** Create Stripe Checkout session for subscription upgrade. Returns URL or error if Stripe not configured. */
export async function createCheckoutSession(
  userId: string,
  planId: string,
  successUrl: string,
  cancelUrl: string
): Promise<{ url?: string; error?: string }> {
  if (!config.stripe.secretKey) {
    return { error: 'Payment is not configured. Please contact support to upgrade.' };
  }
  if (!isAllowedRedirectUrl(successUrl) || !isAllowedRedirectUrl(cancelUrl)) {
    return { error: 'Invalid success or cancel URL' };
  }

  const user = await User.findById(userId).select('email name phone yandexSub yandexProfile').lean();
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);

  let priceId: string | null = null;
  if (planId === STUDENT_PLAN.STANDARD) priceId = config.stripe.studentStandardPriceId;
  else if (planId === STUDENT_PLAN.MAX_PREMIUM) priceId = config.stripe.studentMaxPriceId;
  else if (planId === UNIVERSITY_PLAN.PREMIUM) priceId = config.stripe.universityPremiumPriceId;
  if (!priceId) return { error: 'Invalid plan' };

  try {
    const stripe = await import('stripe');
    const stripeClient = new stripe.default(config.stripe.secretKey, { apiVersion: '2023-10-16' });
    const u = user as {
      email: string;
      name?: string;
      phone?: string;
      yandexSub?: string;
      yandexProfile?: {
        login?: string;
        psuid?: string;
        firstName?: string;
        lastName?: string;
        displayName?: string;
        realName?: string;
        birthday?: string;
        avatarUrl?: string;
        phone?: string;
      };
    };
    const billingName = String(
      u.name || u.yandexProfile?.realName || u.yandexProfile?.displayName || [u.yandexProfile?.firstName, u.yandexProfile?.lastName].filter(Boolean).join(' ')
    ).trim();
    const billingPhone = String(u.phone || u.yandexProfile?.phone || '').trim();
    const metadata = Object.fromEntries(
      Object.entries({
        userId,
        planId,
        yandexSub: u.yandexSub,
        yandexLogin: u.yandexProfile?.login,
        yandexPsuid: u.yandexProfile?.psuid,
        yandexFirstName: u.yandexProfile?.firstName,
        yandexLastName: u.yandexProfile?.lastName,
        yandexBirthday: u.yandexProfile?.birthday,
        yandexAvatarUrl: u.yandexProfile?.avatarUrl,
      })
        .map(([key, value]) => [key, String(value ?? '').trim().slice(0, 500)])
        .filter(([, value]) => value)
    );
    const customer = await stripeClient.customers.create({
      email: u.email,
      ...(billingName ? { name: billingName } : {}),
      ...(billingPhone ? { phone: billingPhone } : {}),
      metadata,
    });
    const session = await stripeClient.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer: customer.id,
      client_reference_id: userId,
      metadata,
      subscription_data: { metadata },
    });
    return { url: session.url ?? undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg };
  }
}

/** Handle Stripe webhook: subscription created/updated/deleted. Update Subscription model. */
export async function handleWebhook(payload: Buffer, signature: string): Promise<{ received: boolean }> {
  if (!config.stripe.webhookSecret) return { received: true };
  try {
    const stripe = await import('stripe');
    const stripeClient = new stripe.default(config.stripe.secretKey, { apiVersion: '2023-10-16' });
    const event = stripeClient.webhooks.constructEvent(payload, signature, config.stripe.webhookSecret);
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as { client_reference_id?: string; subscription?: string; customer?: string; metadata?: { userId?: string; planId?: string } };
      const userId = session.client_reference_id ?? session.metadata?.userId;
      const planId = session.metadata?.planId;
      if (userId && planId) {
        await Subscription.findOneAndUpdate(
          { userId },
          {
            plan: planId,
            status: 'active',
            stripeSubscriptionId: session.subscription ?? undefined,
            stripeCustomerId: session.customer ?? undefined,
            trialEndsAt: null,
          }
        );
      }
    }
    if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.updated') {
      const sub = event.data.object as { id: string; status: string };
      await Subscription.updateOne(
        { stripeSubscriptionId: sub.id },
        { status: sub.status === 'active' ? 'active' : 'cancelled' }
      );
    }
    return { received: true };
  } catch {
    return { received: false };
  }
}
