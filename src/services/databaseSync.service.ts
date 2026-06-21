import mongoose from 'mongoose';
import type { Connection } from 'mongoose';
import { config } from '../config';
import { logger } from '../utils/logger';

type SyncDocument = Record<string, unknown> & { _id: any };

let targetConnection: Connection | null = null;
let syncTimer: NodeJS.Timeout | null = null;
let syncInProgress = false;

function isSyncEnabled(): boolean {
  return config.databaseSync.enabled && Boolean(config.databaseSync.targetUri);
}

function shouldSkipCollection(name: string): boolean {
  return name.startsWith('system.');
}

async function getTargetConnection(): Promise<Connection> {
  if (targetConnection?.readyState === 1) {
    return targetConnection;
  }

  if (targetConnection && targetConnection.readyState !== 0) {
    await targetConnection.close().catch(() => undefined);
  }

  targetConnection = mongoose.createConnection(config.databaseSync.targetUri, {
    serverSelectionTimeoutMS: config.mongodbServerSelectionTimeoutMs,
    connectTimeoutMS: config.mongodbConnectTimeoutMs,
    socketTimeoutMS: config.mongodbSocketTimeoutMs,
    maxPoolSize: 5,
  });

  await targetConnection.asPromise();
  logger.info('Database sync target connected');
  return targetConnection;
}

async function syncCollection(source: Connection, target: Connection, collectionName: string): Promise<void> {
  const sourceDb = source.db;
  const targetDb = target.db;
  if (!sourceDb || !targetDb) return;

  const sourceCollection = sourceDb.collection<SyncDocument>(collectionName);
  const targetCollection = targetDb.collection<SyncDocument>(collectionName);
  const batchSize = config.databaseSync.batchSize;
  const sourceIds: SyncDocument['_id'][] = [];
  const operations: any[] = [];

  const flush = async () => {
    if (operations.length === 0) return;
    const batch = operations.splice(0, operations.length);
    await targetCollection.bulkWrite(batch, { ordered: false });
  };

  const cursor = sourceCollection.find({}).batchSize(batchSize);
  for await (const document of cursor) {
    if (document._id === undefined || document._id === null) continue;
    sourceIds.push(document._id);
    operations.push({
      replaceOne: {
        filter: { _id: document._id },
        replacement: document,
        upsert: true,
      },
    });

    if (operations.length >= batchSize) {
      await flush();
    }
  }

  await flush();

  if (config.databaseSync.deleteMissing) {
    if (sourceIds.length === 0) {
      await targetCollection.deleteMany({});
    } else {
      await targetCollection.deleteMany({ _id: { $nin: sourceIds } } as any);
    }
  }

  logger.info({ collection: collectionName, documents: sourceIds.length }, 'Database sync collection completed');
}

export async function runDatabaseSync(reason = 'manual'): Promise<void> {
  if (!isSyncEnabled()) return;
  if (syncInProgress) {
    logger.debug({ reason }, 'Database sync skipped: previous sync still running');
    return;
  }

  if (!mongoose.connection.db) {
    logger.warn({ reason }, 'Database sync skipped: source database is not connected');
    return;
  }

  if (config.mongodbUri === config.databaseSync.targetUri) {
    logger.warn('Database sync disabled: source and target MongoDB URIs are identical');
    return;
  }

  syncInProgress = true;
  const startedAt = Date.now();
  try {
    const target = await getTargetConnection();
    const collections = await mongoose.connection.db.listCollections().toArray();
    const names = collections.map((collection) => collection.name).filter((name) => !shouldSkipCollection(name));

    for (const collectionName of names) {
      await syncCollection(mongoose.connection, target, collectionName);
    }

    logger.info(
      { reason, collections: names.length, durationMs: Date.now() - startedAt },
      'Database sync completed'
    );
  } catch (error) {
    logger.error({ err: error, reason }, 'Database sync failed');
  } finally {
    syncInProgress = false;
  }
}

export function startDatabaseSyncService(): void {
  if (!isSyncEnabled()) {
    logger.info('Database sync disabled');
    return;
  }

  if (process.env.VERCEL === '1') {
    logger.info('Database sync disabled on Vercel serverless runtime');
    return;
  }

  if (syncTimer) return;

  void runDatabaseSync('startup');
  syncTimer = setInterval(() => {
    void runDatabaseSync('interval');
  }, config.databaseSync.intervalMs);

  logger.info(
    {
      intervalMs: config.databaseSync.intervalMs,
      deleteMissing: config.databaseSync.deleteMissing,
      batchSize: config.databaseSync.batchSize,
    },
    'Database sync service started'
  );
}

export async function stopDatabaseSyncService(): Promise<void> {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  if (targetConnection) {
    await targetConnection.close().catch(() => undefined);
    targetConnection = null;
  }
}
