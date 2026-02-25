import dotenv from 'dotenv';

dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  mongodbUri: process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/edmission',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  },
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) || ['http://localhost:5173', 'http://localhost:3000'],
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'deepseek-llm:7b',
    chatRateLimitPerMinute: parseInt(process.env.AI_CHAT_RATE_LIMIT_PER_MINUTE || '10', 10),
    chatTimeoutMs: parseInt(process.env.AI_CHAT_TIMEOUT_MS || '60000', 10),
  },
  uploadDir: process.env.UPLOAD_DIR || './uploads',
};
