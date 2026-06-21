import dotenv from 'dotenv';
dotenv.config();

import { connectDatabase, disconnectDatabase } from '../config/database';
import { startDatabaseSyncService, stopDatabaseSyncService } from '../services/databaseSync.service';
import { logger } from '../utils/logger';

async function main() {
  await connectDatabase();
  startDatabaseSyncService();
  logger.info('Database backup sync worker started. Press Ctrl+C to exit.');
}

main().catch((e) => {
  logger.error(e, 'Database backup sync worker failed to start');
  process.exit(1);
});

async function shutdown() {
  await stopDatabaseSyncService();
  await disconnectDatabase();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
