import mongoose from 'mongoose';
import type { Connection } from 'mongoose';
import { config } from '../config';
import { logger } from '../utils/logger';

type SyncDocument = Record<string, unknown> & { _id: any };
type SyncState = {
  _id: string;
  lastFullSyncAt?: Date;
  lastIncrementalSyncAt?: Date;
};

let targetConnection: Connection | null = null;
let syncTimer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;
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
    serverSelectionTimeoutMS: Math.min(config.mongodbServerSelectionTimeoutMs, 10000),
    connectTimeoutMS: Math.min(config.mongodbConnectTimeoutMs, 10000),
    socketTimeoutMS: config.mongodbSocketTimeoutMs,
    maxPoolSize: 2,
  });

  await targetConnection.asPromise();
  logger.info('Database sync target connected');
  return targetConnection;
}

async function getCollectionState(target: Connection, collectionName: string): Promise<SyncState | null> {
  const stateCollection = target.db?.collection<SyncState>('__backupSyncState');
  if (!stateCollection) return null;
  return stateCollection.findOne({ _id: collectionName });
}

function shouldRunFullScan(state: SyncState | null, startedAt: Date): boolean {
  if (!state?.lastFullSyncAt) return true;
  return startedAt.getTime() - state.lastFullSyncAt.getTime() >= config.databaseSync.fullScanIntervalMs;
}

async function saveCollectionState(
  target: Connection,
  collectionName: string,
  startedAt: Date,
  fullScan: boolean
): Promise<void> {
  const stateCollection = target.db?.collection<SyncState>('__backupSyncState');
  if (!stateCollection) return;

  await stateCollection.updateOne(
    { _id: collectionName },
    {
      $set: {
        lastIncrementalSyncAt: startedAt,
        ...(fullScan ? { lastFullSyncAt: startedAt } : {}),
      },
    },
    { upsert: true }
  );
}

async function syncCollection(
  source: Connection,
  target: Connection,
  collectionName: string,
  startedAt: Date
): Promise<void> {
  const sourceDb = source.db;
  const targetDb = target.db;
  if (!sourceDb || !targetDb) return;

  const sourceCollection = sourceDb.collection<SyncDocument>(collectionName);
  const targetCollection = targetDb.collection<SyncDocument>(collectionName);
  const state = await getCollectionState(target, collectionName);
  const fullScan = shouldRunFullScan(state, startedAt);
  const filter =
    fullScan || !state?.lastIncrementalSyncAt
      ? {}
      : { updatedAt: { $gte: state.lastIncrementalSyncAt } };
  const batchSize = config.databaseSync.batchSize;
  const operations: any[] = [];
  let documents = 0;

  const flush = async () => {
    if (operations.length === 0) return;
    const batch = operations.splice(0, operations.length);
    await targetCollection.bulkWrite(batch, { ordered: false });
  };

  const cursor = sourceCollection.find(filter).batchSize(batchSize);
  for await (const document of cursor) {
    if (document._id === undefined || document._id === null) continue;
    documents += 1;
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
  await saveCollectionState(target, collectionName, startedAt, fullScan);

  logger.info({ collection: collectionName, documents, fullScan }, 'Database backup collection synced');
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
    const syncStartedAt = new Date(startedAt);
    const target = await getTargetConnection();
    const collections = await mongoose.connection.db.listCollections().toArray();
    const names = collections.map((collection) => collection.name).filter((name) => !shouldSkipCollection(name));

    for (const collectionName of names) {
      await syncCollection(mongoose.connection, target, collectionName, syncStartedAt);
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

  startupTimer = setTimeout(() => {
    void runDatabaseSync('startup');
  }, config.databaseSync.startupDelayMs);
  startupTimer.unref?.();

  syncTimer = setInterval(() => {
    void runDatabaseSync('interval');
  }, config.databaseSync.intervalMs);
  syncTimer.unref?.();

  logger.info(
    {
      intervalMs: config.databaseSync.intervalMs,
      startupDelayMs: config.databaseSync.startupDelayMs,
      fullScanIntervalMs: config.databaseSync.fullScanIntervalMs,
      batchSize: config.databaseSync.batchSize,
    },
    'Database sync service started'
  );
}

export async function stopDatabaseSyncService(): Promise<void> {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  if (targetConnection) {
    await targetConnection.close().catch(() => undefined);
    targetConnection = null;
  }
}
