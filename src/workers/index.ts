import dotenv from 'dotenv';
dotenv.config();

import { connectDatabase, disconnectDatabase } from '../config/database';
import { startRecommendationWorker } from './recommendation.worker';
import { logger } from '../utils/logger';

async function main() {
  await connectDatabase();
  startRecommendationWorker();
  logger.info('Workers started. Press Ctrl+C to exit.');
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});

process.on('SIGINT', async () => {
  await disconnectDatabase();
  process.exit(0);
});
