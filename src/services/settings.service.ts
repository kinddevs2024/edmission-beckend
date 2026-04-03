import mongoose from 'mongoose';
import { SystemSettings } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';

const KEY = 'global';

export interface SystemSettingsDoc {
  requireAccountConfirmation: boolean;
  requireEmailVerification: boolean;
  maintenanceMode: boolean;
}

let cache: SystemSettingsDoc | null = null;
let cacheTime = 0;
const CACHE_MS = 5000;
const DEFAULTS_WHEN_DB_DOWN: SystemSettingsDoc = {
  requireAccountConfirmation: false,
  requireEmailVerification: false,
  // When MongoDB is down we should not force the whole web site into
  // "maintenance" mode; otherwise the frontend redirects to `/maintenance`
  // and you can’t reach the normal UI.
  maintenanceMode: false,
};

export async function getSettings(): Promise<SystemSettingsDoc> {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_MS) {
    return cache;
  }

  // Avoid Mongoose buffering timeouts on startup when MongoDB is not reachable.
  if (mongoose.connection.readyState !== 1) {
    cache = DEFAULTS_WHEN_DB_DOWN;
    cacheTime = now;
    return cache;
  }

  const doc = await SystemSettings.findOne({ key: KEY }).lean();
  if (doc) {
    cache = {
      requireAccountConfirmation: Boolean((doc as { requireAccountConfirmation?: boolean }).requireAccountConfirmation),
      requireEmailVerification: Boolean((doc as { requireEmailVerification?: boolean }).requireEmailVerification),
      maintenanceMode: Boolean((doc as { maintenanceMode?: boolean }).maintenanceMode),
    };
  } else {
    cache = {
      requireAccountConfirmation: false,
      requireEmailVerification: false,
      maintenanceMode: false,
    };
  }
  cacheTime = now;
  return cache;
}

export async function updateSettings(patch: Partial<SystemSettingsDoc>): Promise<SystemSettingsDoc> {
  if (mongoose.connection.readyState !== 1) {
    throw new AppError(503, 'Database unavailable. Try again when MongoDB is up.', ErrorCodes.SERVICE_UNAVAILABLE);
  }
  const updated = await SystemSettings.findOneAndUpdate(
    { key: KEY },
    {
      $set: {
        ...(patch.requireAccountConfirmation !== undefined && { requireAccountConfirmation: patch.requireAccountConfirmation }),
        ...(patch.requireEmailVerification !== undefined && { requireEmailVerification: patch.requireEmailVerification }),
        ...(patch.maintenanceMode !== undefined && { maintenanceMode: patch.maintenanceMode }),
      },
    },
    { upsert: true, new: true }
  ).lean();
  cache = null;
  return {
    requireAccountConfirmation: Boolean((updated as { requireAccountConfirmation?: boolean }).requireAccountConfirmation),
    requireEmailVerification: Boolean((updated as { requireEmailVerification?: boolean }).requireEmailVerification),
    maintenanceMode: Boolean((updated as { maintenanceMode?: boolean }).maintenanceMode),
  };
}
