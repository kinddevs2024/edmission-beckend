import mongoose from 'mongoose';
import { config } from './index';
import { logger } from '../utils/logger';

/** Опции для локального MongoDB (без replica set) */
const isLocalUri = (uri: string) =>
  uri.startsWith('mongodb://localhost') || uri.startsWith('mongodb://127.0.0.1');

function buildConnectOptions(): mongoose.ConnectOptions {
  const socketMs = config.mongodbSocketTimeoutMs;
  const options: mongoose.ConnectOptions = {
    serverSelectionTimeoutMS: config.mongodbServerSelectionTimeoutMs,
    connectTimeoutMS: config.mongodbConnectTimeoutMs,
    ...(socketMs > 0 ? { socketTimeoutMS: socketMs } : { socketTimeoutMS: 0 }),
    maxPoolSize: 10,
  };
  if (isLocalUri(config.mongodbUri)) {
    options.directConnection = true;
  }
  return options;
}

export async function connectDatabase(): Promise<void> {
  const uri = config.mongodbUri;
  if (!uri) throw new Error('MONGODB_URI or DATABASE_URL is required');

  const options = buildConnectOptions();
  const maxAttempts = config.mongodbConnectRetries;
  const retryDelayMs = config.mongodbConnectRetryDelayMs;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect().catch(() => {});
      }
      await mongoose.connect(uri, options);
      const dbName = mongoose.connection.db?.databaseName ?? 'edmission';
      logger.info(
        {
          db: dbName,
          attempt,
          serverSelectionTimeoutMS: options.serverSelectionTimeoutMS,
          connectTimeoutMS: options.connectTimeoutMS,
        },
        'Database (MongoDB) connected'
      );
      return;
    } catch (e) {
      lastError = e;
      const isLast = attempt === maxAttempts;
      logger.warn(
        {
          err: e,
          attempt,
          maxAttempts,
          nextRetryInMs: isLast ? 0 : retryDelayMs,
        },
        isLast ? 'Database connection failed (no more retries)' : 'Database connection attempt failed, will retry'
      );
      if (isLast) break;
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect().catch(() => {});
      }
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }

  logger.error(lastError, 'Database connection failed');
  throw lastError;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  logger.info('Database disconnected');
}
