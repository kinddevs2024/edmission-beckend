import mongoose from 'mongoose';
import { config } from './index';
import { logger } from '../utils/logger';

export async function connectDatabase(): Promise<void> {
  try {
    const uri = config.mongodbUri;
    if (!uri) throw new Error('MONGODB_URI or DATABASE_URL is required');
    await mongoose.connect(uri);
    logger.info('Database (MongoDB) connected');
  } catch (e) {
    logger.error(e, 'Database connection failed');
    throw e;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  logger.info('Database disconnected');
}
