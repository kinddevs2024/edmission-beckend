import { config } from '../config';
import { PaymentTransaction, Subscription, User } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';
import {
  PAID_SUBSCRIPTION_PLANS,
  SCHOOL_COUNSELLOR_PLAN,
  STUDENT_PLAN,
  UNIVERSITY_PLAN,
  isPlanAvailableForRole,
} from './subscription.service';
import crypto from 'crypto';

type PaymentServiceResult<T extends object = object> = T & {
  error?: string;
  statusCode?: number;
};

const CYBERSOURCE_CHECKOUT_ENDPOINTS = {
  test: 'https://testsecureacceptance.cybersource.com/pay',
  production: 'https://secureacceptance.cybersource.com/pay',
  live: 'https://secureacceptance.cybersource.com/pay',
} as const;

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function getCybersourceEndpoint(): string {
  const env = config.cybersource.environment as keyof typeof CYBERSOURCE_CHECKOUT_ENDPOINTS;
  return CYBERSOURCE_CHECKOUT_ENDPOINTS[env] ?? CYBERSOURCE_CHECKOUT_ENDPOINTS.test;
}

function signSecureAcceptanceFields(fields: Record<string, string>): string {
  const signedFieldNames = fields.signed_field_names.split(',');
  const data = signedFieldNames.map((field) => `${field}=${fields[field] ?? ''}`).join(',');
  return crypto.createHmac('sha256', config.cybersource.secretKey).update(data, 'utf8').digest('base64');
}

function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSecureAcceptanceDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function formatRecurringStartDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function currentPeriodEndForFrequency(frequency: string): Date {
  const now = new Date();
  if (frequency === 'annually') return addMonths(now, 12);
  if (frequency === 'quarterly') return addMonths(now, 3);
  if (frequency === 'semi-annually') return addMonths(now, 6);
  if (frequency === 'weekly') return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (frequency === 'bi-weekly') return new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  if (frequency === 'quad-weekly') return new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000);
  return addMonths(now, 1);
}

function getAmountForPlan(planId: string): string {
  if (planId === STUDENT_PLAN.STANDARD) return config.cybersource.planAmounts.studentStandard;
  if (planId === STUDENT_PLAN.MAX_PREMIUM) return config.cybersource.planAmounts.studentMaxPremium;
  if (planId === UNIVERSITY_PLAN.PREMIUM) return config.cybersource.planAmounts.universityPremium;
  if (planId === SCHOOL_COUNSELLOR_PLAN.PREMIUM) return config.cybersource.planAmounts.schoolCounsellorPremium;
  return '';
}

function assertValidAmount(amount: string): boolean {
  return /^(?:[1-9]\d*|0)(?:\.\d{1,2})?$/.test(amount) && Number(amount) > 0;
}

function getPlanDisplayName(planId: string): string {
  return planId.replace(/_/g, ' ');
}

function normalizeFormBody(body: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [key, Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')])
  );
}

async function createCybersourceCheckoutSession(
  userId: string,
  planId: string,
  successUrl: string,
  cancelUrl: string
): Promise<PaymentServiceResult<{ url?: string }>> {
  if (!config.cybersource.profileId || !config.cybersource.accessKey || !config.cybersource.secretKey) {
    return { error: 'Visa payment is not configured. Please contact support to upgrade.', statusCode: 500 };
  }
  if (!isAllowedRedirectUrl(successUrl) || !isAllowedRedirectUrl(cancelUrl)) {
    return { error: 'Invalid success or cancel URL' };
  }

  const user = await User.findById(userId).select('email name phone role yandexSub yandexProfile').lean();
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);

  const role = String((user as { role?: string }).role ?? '');
  if (!PAID_SUBSCRIPTION_PLANS.includes(planId as (typeof PAID_SUBSCRIPTION_PLANS)[number])) {
    return { error: 'Invalid plan' };
  }
  if (!isPlanAvailableForRole(role, planId)) {
    return { error: 'This subscription plan is not available for your account role.' };
  }

  const amount = getAmountForPlan(planId);
  if (!assertValidAmount(amount)) {
    return {
      error: `Payment amount is not configured for ${planId}. Set the matching CYBERSOURCE_*_AMOUNT env variable.`,
      statusCode: 500,
    };
  }

  const u = user as {
    email: string;
    name?: string;
    phone?: string;
    yandexProfile?: {
      firstName?: string;
      lastName?: string;
      displayName?: string;
      realName?: string;
      phone?: string;
    };
  };
  const fullName = String(
    u.name ||
      u.yandexProfile?.realName ||
      u.yandexProfile?.displayName ||
      [u.yandexProfile?.firstName, u.yandexProfile?.lastName].filter(Boolean).join(' ')
  ).trim();
  const [forenameRaw, ...surnameParts] = fullName.split(/\s+/).filter(Boolean);
  const forename = (forenameRaw || 'Edmission').slice(0, 60);
  const surname = (surnameParts.join(' ') || 'User').slice(0, 60);
  const referenceNumber = `EDM-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`.slice(0, 50);
  const transactionUuid = crypto.randomUUID();
  const responseUrl = `${normalizeBaseUrl(config.backendUrl)}/api/payment/secure-acceptance/response`;
  const now = new Date();
  const recurringStartDate = formatRecurringStartDate(addMonths(now, 1));

  const fields: Record<string, string> = {
    access_key: config.cybersource.accessKey,
    profile_id: config.cybersource.profileId,
    transaction_uuid: transactionUuid,
    signed_date_time: formatSecureAcceptanceDate(now),
    locale: config.cybersource.locale,
    transaction_type: 'sale,create_payment_token',
    reference_number: referenceNumber,
    amount,
    currency: config.cybersource.currency,
    recurring_frequency: config.cybersource.recurringFrequency,
    recurring_start_date: recurringStartDate,
    recurring_amount: amount,
    bill_to_forename: forename,
    bill_to_surname: surname,
    bill_to_email: u.email,
    bill_to_phone: String(u.phone || u.yandexProfile?.phone || '').trim().slice(0, 15),
    merchant_defined_data1: userId,
    merchant_defined_data2: planId,
    merchant_defined_data3: role,
    merchant_defined_data4: config.cybersource.accountId || config.cybersource.merchantId,
    override_custom_receipt_page: responseUrl,
    override_custom_cancel_page: responseUrl,
    unsigned_field_names: '',
  };
  Object.keys(fields).forEach((key) => {
    if (fields[key] === '' && key !== 'unsigned_field_names') delete fields[key];
  });
  fields.signed_field_names = [...Object.keys(fields), 'signed_field_names'].join(',');
  fields.signature = signSecureAcceptanceFields(fields);

  await PaymentTransaction.create({
    provider: 'cybersource',
    referenceNumber,
    transactionUuid,
    userId,
    role,
    planId,
    status: 'pending',
    amount,
    currency: config.cybersource.currency,
    recurringFrequency: config.cybersource.recurringFrequency,
    requestPayload: fields,
  });

  return {
    url: `${normalizeBaseUrl(config.backendUrl)}/api/payment/secure-acceptance/checkout/${encodeURIComponent(referenceNumber)}`,
  };
}

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
): Promise<PaymentServiceResult<{ url?: string }>> {
  if (config.cybersource.enabled) {
    return createCybersourceCheckoutSession(userId, planId, successUrl, cancelUrl);
  }

  if (!config.stripe.secretKey) {
    return { error: 'Payment is not configured. Please contact support to upgrade.' };
  }
  if (!config.stripe.secretKey.startsWith('sk_')) {
    return { error: 'Stripe secret key must start with sk_test_ or sk_live_.', statusCode: 500 };
  }
  if (!isAllowedRedirectUrl(successUrl) || !isAllowedRedirectUrl(cancelUrl)) {
    return { error: 'Invalid success or cancel URL' };
  }

  const user = await User.findById(userId).select('email name phone role yandexSub yandexProfile').lean();
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);

  const role = String((user as { role?: string }).role ?? '');
  if (!isPlanAvailableForRole(role, planId)) {
    return { error: 'This subscription plan is not available for your account role.' };
  }
  if (role !== 'student' && role !== 'university') {
    return { error: 'Stripe fallback subscriptions are currently available only for students and universities.' };
  }

  let priceId: string | null = null;
  if (planId === STUDENT_PLAN.STANDARD) priceId = config.stripe.studentStandardPriceId;
  else if (planId === STUDENT_PLAN.MAX_PREMIUM) priceId = config.stripe.studentMaxPriceId;
  else if (planId === UNIVERSITY_PLAN.PREMIUM) priceId = config.stripe.universityPremiumPriceId;
  if (!priceId) return { error: 'Invalid plan' };
  if (!priceId.startsWith('price_')) {
    return { error: 'Stripe Price ID must start with price_.', statusCode: 500 };
  }

  try {
    const stripe = await import('stripe');
    const stripeClient = new stripe.default(config.stripe.secretKey, { apiVersion: '2023-10-16' });
    await stripeClient.prices.retrieve(priceId);
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
    return { error: `Stripe checkout failed: ${msg}`, statusCode: 502 };
  }
}

export async function getSecureAcceptanceCheckoutHtml(referenceNumber: string): Promise<PaymentServiceResult<{ html?: string }>> {
  const tx = await PaymentTransaction.findOne({ referenceNumber, provider: 'cybersource' }).lean();
  if (!tx || tx.status !== 'pending') {
    return { error: 'Payment session not found or already processed', statusCode: 404 };
  }
  const fields = (tx.requestPayload ?? {}) as Record<string, string>;
  const inputs = Object.entries(fields)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(String(value))}">`)
    .join('\n');
  const action = getCybersourceEndpoint();
  const title = `Edmission ${getPlanDisplayName(String(tx.planId))}`;
  return {
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, sans-serif; color: #14213d; background: #f7f8fb; }
    main { width: min(420px, calc(100vw - 32px)); padding: 28px; border: 1px solid #d9dee8; border-radius: 8px; background: #fff; box-shadow: 0 16px 40px rgba(20, 33, 61, .08); }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 0 0 18px; color: #5d6678; line-height: 1.5; }
    button { width: 100%; min-height: 44px; border: 0; border-radius: 8px; background: #2563eb; color: #fff; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>Redirecting to secure payment</h1>
    <p>You are being sent to Visa secure checkout for ${escapeHtml(getPlanDisplayName(String(tx.planId)))}.</p>
    <form id="payment-form" action="${escapeHtml(action)}" method="post">
      ${inputs}
      <button type="submit">Continue to payment</button>
    </form>
  </main>
  <script>document.getElementById('payment-form').submit();</script>
</body>
</html>`,
  };
}

export async function handleSecureAcceptanceResponse(
  body: Record<string, unknown>
): Promise<PaymentServiceResult<{ received: boolean; redirectUrl?: string }>> {
  const fields = normalizeFormBody(body);
  const referenceNumber = fields.req_reference_number || fields.reference_number;
  if (!referenceNumber) {
    return { received: false, error: 'Missing payment reference number', statusCode: 400 };
  }

  const tx = await PaymentTransaction.findOne({ referenceNumber, provider: 'cybersource' });
  if (!tx) {
    return { received: false, error: 'Payment transaction not found', statusCode: 404 };
  }

  if (!fields.signature || !fields.signed_field_names) {
    await PaymentTransaction.updateOne(
      { _id: tx._id },
      { $set: { status: 'error', responsePayload: fields, processedAt: new Date() } }
    );
    return { received: false, error: 'Missing payment signature', statusCode: 400 };
  }

  const expected = signSecureAcceptanceFields(fields);
  if (!timingSafeEqualString(expected, fields.signature)) {
    await PaymentTransaction.updateOne(
      { _id: tx._id },
      { $set: { status: 'error', responsePayload: fields, processedAt: new Date() } }
    );
    return { received: false, error: 'Invalid payment signature', statusCode: 400 };
  }

  const decision = String(fields.decision || '').toUpperCase();
  const reasonCode = fields.reason_code || fields.reasonCode || '';
  const accepted = decision === 'ACCEPT' && (!reasonCode || reasonCode === '100');
  const cancelled = decision === 'CANCEL';
  const status = accepted ? 'accepted' : cancelled ? 'cancelled' : 'declined';
  const transactionId = fields.transaction_id || fields.transactionId || '';
  const subscriptionId = fields.subscription_id || fields.recurring_subscription_id || fields.payment_token || '';
  const paymentToken = fields.payment_token || fields.req_payment_token || '';

  await PaymentTransaction.updateOne(
    { _id: tx._id },
    {
      $set: {
        status,
        responsePayload: fields,
        decision,
        reasonCode,
        transactionId,
        subscriptionId,
        paymentToken,
        processedAt: new Date(),
      },
    }
  );

  if (accepted) {
    await Subscription.findOneAndUpdate(
      { userId: tx.userId },
      {
        $set: {
          userId: tx.userId,
          role: tx.role,
          plan: tx.planId,
          status: 'active',
          trialEndsAt: null,
          currentPeriodEnd: currentPeriodEndForFrequency(String(tx.recurringFrequency || config.cybersource.recurringFrequency)),
          cybersourceReferenceNumber: tx.referenceNumber,
          cybersourceTransactionId: transactionId || undefined,
          cybersourceSubscriptionId: subscriptionId || undefined,
          cybersourcePaymentToken: paymentToken || undefined,
        },
      },
      { upsert: true, new: true }
    );
  }

  return {
    received: true,
    redirectUrl: accepted ? `${normalizeBaseUrl(config.frontendUrl)}/payment/success` : `${normalizeBaseUrl(config.frontendUrl)}/payment/cancel`,
  };
}

/** Handle Stripe webhook: subscription created/updated/deleted. Update Subscription model. */
export async function handleWebhook(payload: Buffer, signature: string): Promise<PaymentServiceResult<{ received: boolean }>> {
  if (!config.stripe.webhookSecret) {
    return { received: false, error: 'Stripe webhook secret is not configured', statusCode: 500 };
  }
  if (!config.stripe.webhookSecret.startsWith('whsec_')) {
    return {
      received: false,
      error: 'Invalid Stripe webhook secret. It must start with whsec_, not pk_ or sk_.',
      statusCode: 500,
    };
  }
  if (!signature) {
    return { received: false, error: 'Missing Stripe-Signature header', statusCode: 400 };
  }
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { received: false, error: `Stripe webhook verification failed: ${msg}`, statusCode: 400 };
  }
}
