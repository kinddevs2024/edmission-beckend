import path from 'path';
import dotenv from 'dotenv';
import { resolveCorsAllowedOrigins } from './corsPolicy';

// Load .env from project root (works when PM2 runs node dist/index.js from any cwd)
const roots = [
  require.main?.filename ? path.join(path.dirname(require.main.filename), '..') : null,
  path.join(__dirname, '..', '..'), // from dist/config -> project root
  process.cwd(),
].filter(Boolean) as string[];
for (const root of roots) {
  const envPath = path.join(root, '.env');
  const result = dotenv.config({ path: envPath });
  if (!result.error) break;
}

// If Google ID is only in edmission-front/.env (VITE_GOOGLE_CLIENT_ID), merge it without overriding backend keys.
const backendRoot = path.join(__dirname, '..', '..');
const siblingFrontEnv = path.join(backendRoot, '..', 'edmission-front', '.env');
dotenv.config({ path: siblingFrontEnv, override: false });

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  host: process.env.HOST || '0.0.0.0',
  mongodbUri: process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/edmission',
  /** Slow / unstable networks: longer waits for SRV lookup, TLS, server selection (ms). */
  mongodbServerSelectionTimeoutMs: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || '120000', 10),
  mongodbConnectTimeoutMs: parseInt(process.env.MONGODB_CONNECT_TIMEOUT_MS || '90000', 10),
  /** 0 = no socket idle timeout (recommended for flaky links; operations still bounded by server selection). */
  mongodbSocketTimeoutMs: parseInt(process.env.MONGODB_SOCKET_TIMEOUT_MS || '0', 10),
  /** How many times to retry initial connect after failure (e.g. DNS blip). */
  mongodbConnectRetries: Math.max(1, parseInt(process.env.MONGODB_CONNECT_RETRIES || '8', 10)),
  /** Delay between connect attempts (ms). */
  mongodbConnectRetryDelayMs: Math.max(500, parseInt(process.env.MONGODB_CONNECT_RETRY_DELAY_MS || '3000', 10)),
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  },
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  cors: {
    /** Explicit allowlist from CORS_ORIGIN + used for OAuth redirect checks */
    origin: resolveCorsAllowedOrigins(),
  },
  enableSwagger: process.env.ENABLE_SWAGGER === 'true',
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'deepseek-r1:1.5b',
    chatRateLimitPerMinute: parseInt(process.env.AI_CHAT_RATE_LIMIT_PER_MINUTE || '10', 10),
    chatTimeoutMs: parseInt(process.env.AI_CHAT_TIMEOUT_MS || '180000', 10),
  },
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    chatTimeoutMs: parseInt(process.env.AI_CHAT_TIMEOUT_MS || '180000', 10),
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    chatTimeoutMs: parseInt(process.env.AI_CHAT_TIMEOUT_MS || '60000', 10),
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    chatTimeoutMs: parseInt(process.env.AI_CHAT_TIMEOUT_MS || '60000', 10),
  },
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    studentStandardPriceId: process.env.STRIPE_STUDENT_STANDARD_PRICE_ID || '',
    studentMaxPriceId: process.env.STRIPE_STUDENT_MAX_PRICE_ID || '',
    universityPremiumPriceId: process.env.STRIPE_UNIVERSITY_PREMIUM_PRICE_ID || '',
  },
  /**
   * OAuth 2.0 Web client ID (Google Cloud Console → Web client).
   * Prefer GOOGLE_CLIENT_ID in edmission-beckend/.env; falls back to VITE_GOOGLE_CLIENT_ID after merging edmission-front/.env.
   */
  google: {
    clientId: (process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim(),
    /** Optional: native OAuth client IDs — id_token `aud` must match one of these (see mobile Google Sign-In). */
    iosClientId: (process.env.GOOGLE_IOS_CLIENT_ID || '').trim(),
    androidClientId: (process.env.GOOGLE_ANDROID_CLIENT_ID || '').trim(),
  },
  /**
   * Yandex OAuth (https://oauth.yandex.ru). Web flow: code + client_secret on server.
   * Client ID may be duplicated as VITE_YANDEX_CLIENT_ID in edmission-front/.env.
   */
  yandex: {
    clientId: (process.env.YANDEX_CLIENT_ID || process.env.VITE_YANDEX_CLIENT_ID || '').trim(),
    clientSecret: (process.env.YANDEX_CLIENT_SECRET || '').trim(),
  },
  email: {
    from: process.env.EMAIL_FROM || 'noreply@edmission.com',
    sendgridApiKey: process.env.SENDGRID_API_KEY || '',
    enabled: process.env.EMAIL_ENABLED === 'true',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  },
  telegram: {
<<<<<<< Updated upstream
    botToken: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
    botUsername: (process.env.TELEGRAM_BOT_USERNAME || '').trim(),
    pollingIntervalMs: Math.max(1000, parseInt(process.env.TELEGRAM_POLLING_INTERVAL_MS || '3000', 10)),
=======
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    frontendBaseUrl: process.env.TELEGRAM_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173',
    loginPath: process.env.TELEGRAM_LOGIN_PATH || '/login',
    registerPath: process.env.TELEGRAM_REGISTER_PATH || '/register',
    otpTtlMs: parseInt(process.env.TELEGRAM_OTP_TTL_MS || '300000', 10),
    maxOtpAttempts: Math.max(1, parseInt(process.env.TELEGRAM_OTP_MAX_ATTEMPTS || '5', 10)),
    notificationsPath: process.env.TELEGRAM_NOTIFICATIONS_PATH || '/notifications',
    forgotPasswordPath: process.env.TELEGRAM_FORGOT_PASSWORD_PATH || '/forgot-password',
>>>>>>> Stashed changes
  },
  /** Behind nginx/Cloudflare: set TRUST_PROXY=1 so rate limits use X-Forwarded-For (real client IP). */
  trustProxy: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true',
  /** Body size, rate limits (production; dev skips limits unless ENABLE_RATE_LIMIT_IN_DEV=true). */
  security: {
    jsonBodyLimit: process.env.JSON_BODY_LIMIT || '1mb',
    rateLimitGlobalMaxPerMinute: Math.max(50, parseInt(process.env.RATE_LIMIT_GLOBAL_MAX_PER_MINUTE || '400', 10)),
    rateLimitAuthMaxPer15Min: Math.max(10, parseInt(process.env.RATE_LIMIT_AUTH_MAX_PER_15MIN || '60', 10)),
    rateLimitSearchPerMinute: Math.max(10, parseInt(process.env.RATE_LIMIT_SEARCH_PER_MINUTE || '60', 10)),
    rateLimitUploadMaxPer15Min: Math.max(5, parseInt(process.env.RATE_LIMIT_UPLOAD_MAX_PER_15MIN || '40', 10)),
    /** Authenticated POST /upload (per user id); stricter than global API limit for disk abuse. */
    rateLimitUploadAuthMaxPer15Min: Math.max(20, parseInt(process.env.RATE_LIMIT_UPLOAD_AUTH_MAX_PER_15MIN || '200', 10)),
    rateLimitPublicVisitPerMinute: Math.max(5, parseInt(process.env.RATE_LIMIT_PUBLIC_VISIT_PER_MINUTE || '120', 10)),
    /** express-slow-down: start adding delay after this many /api hits per IP per window. */
    slowDownDelayAfter: Math.max(50, parseInt(process.env.SLOW_DOWN_DELAY_AFTER || '250', 10)),
    slowDownDelayStepMs: Math.max(25, parseInt(process.env.SLOW_DOWN_DELAY_STEP_MS || '100', 10)),
    slowDownMaxDelayMs: Math.max(500, parseInt(process.env.SLOW_DOWN_MAX_DELAY_MS || '10000', 10)),
    /**
     * connect-timeout (ms). 0 = off. Production default 120s; skips multipart + webhooks.
     * Override: API_REQUEST_TIMEOUT_MS=0 or DISABLE_API_REQUEST_TIMEOUT=true
     */
    apiRequestTimeoutMs: (() => {
      const dis = process.env.DISABLE_API_REQUEST_TIMEOUT?.toLowerCase().trim();
      if (dis === '1' || dis === 'true' || dis === 'yes') return 0;
      const raw = process.env.API_REQUEST_TIMEOUT_MS;
      if (raw !== undefined && raw.trim() !== '') {
        const n = parseInt(raw, 10);
        return Number.isFinite(n) && n >= 0 ? n : 0;
      }
      return (process.env.NODE_ENV || 'development') === 'production' ? 120000 : 0;
    })(),
  },
  /** Gzip/deflate JSON and text in production; lowers bandwidth (small CPU cost). */
  enableResponseCompression:
    ((process.env.NODE_ENV || 'development') === 'production' &&
      process.env.DISABLE_RESPONSE_COMPRESSION !== 'true') ||
    process.env.ENABLE_RESPONSE_COMPRESSION === 'true',
};

if (config.nodeEnv === 'production') {
  const insecureJwt =
    !process.env.JWT_SECRET ||
    !process.env.JWT_REFRESH_SECRET ||
    process.env.JWT_SECRET === 'dev-secret' ||
    process.env.JWT_REFRESH_SECRET === 'dev-refresh-secret';
  if (insecureJwt) {
    throw new Error('Insecure JWT configuration in production. Set strong JWT_SECRET and JWT_REFRESH_SECRET.');
  }
}
