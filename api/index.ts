import type { IncomingMessage, ServerResponse } from 'http';
import mongoose from 'mongoose';
import app from '../src/app';
import { connectDatabase } from '../src/config/database';
import { ensureDefaultAdmin } from '../src/services/auth.service';
import { logger } from '../src/utils/logger';

let bootPromise: Promise<void> | null = null;

async function boot(): Promise<void> {
  if (mongoose.connection.readyState !== 1) {
    await connectDatabase();
    await ensureDefaultAdmin();
    logger.info('Vercel function boot completed');
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  bootPromise ??= boot().catch((error) => {
    bootPromise = null;
    throw error;
  });

  try {
    await bootPromise;
  } catch (error) {
    logger.error(error, 'Vercel function boot failed');
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ message: 'Service unavailable', code: 'DATABASE_UNAVAILABLE' }));
    return;
  }

  app(req, res);
}
