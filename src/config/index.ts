import path from 'path';
import dotenv from 'dotenv';

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

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  host: process.env.HOST || '0.0.0.0',
  mongodbUri: process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/edmission',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  },
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) || [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:8080',
      'https://edmission.uz',
      'http://edmission.uz',
    ],
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
  email: {
    from: process.env.EMAIL_FROM || 'noreply@edmission.com',
    sendgridApiKey: process.env.SENDGRID_API_KEY || '',
    enabled: process.env.EMAIL_ENABLED === 'true',
  },
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
