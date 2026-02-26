import mongoose from 'mongoose';
import { config } from './index';
import { logger } from '../utils/logger';

/** Опции для локального MongoDB (без replica set) */
const isLocalUri = (uri: string) =>
  uri.startsWith('mongodb://localhost') || uri.startsWith('mongodb://127.0.0.1');

export async function connectDatabase(): Promise<void> {
  const uri = config.mongodbUri;
  if (!uri) throw new Error('MONGODB_URI or DATABASE_URL is required');

  const options: mongoose.ConnectOptions = {
    serverSelectionTimeoutMS: 10000,
  };
  if (isLocalUri(uri)) {
    options.directConnection = true;
  }

  try {
    await mongoose.connect(uri, options);
    const dbName = mongoose.connection.db?.databaseName ?? 'edmission';
    logger.info({ db: dbName }, 'Database (MongoDB) connected');
  } catch (e) {
    logger.error(e, 'Database connection failed');
    throw e;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  logger.info('Database disconnected');
}
