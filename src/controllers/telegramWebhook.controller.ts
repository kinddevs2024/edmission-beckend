import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { handleTelegramWebhookUpdate } from '../services/telegramBot.service';
import { AppError, ErrorCodes } from '../utils/errors';

function secretsMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

export async function receiveTelegramWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const botToken = config.telegram.botToken;
    const webhookSecret = config.telegram.webhookSecret;
    if (!botToken || !webhookSecret) {
      throw new AppError(503, 'Telegram webhook is not configured.', ErrorCodes.SERVICE_UNAVAILABLE);
    }

    const providedSecret = String(req.header('x-telegram-bot-api-secret-token') ?? '').trim();
    if (!providedSecret || !secretsMatch(providedSecret, webhookSecret)) {
      throw new AppError(401, 'Telegram webhook signature is invalid.', ErrorCodes.UNAUTHORIZED);
    }

    await handleTelegramWebhookUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}
