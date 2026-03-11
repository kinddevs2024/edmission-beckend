import { SystemSettings } from '../models';

const KEY = 'global';

export interface SystemSettingsDoc {
  requireAccountConfirmation: boolean;
  requireEmailVerification: boolean;
  maintenanceMode: boolean;
}

let cache: SystemSettingsDoc | null = null;
let cacheTime = 0;
const CACHE_MS = 5000;

export async function getSettings(): Promise<SystemSettingsDoc> {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_MS) {
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
