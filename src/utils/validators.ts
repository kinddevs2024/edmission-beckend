import mongoose from 'mongoose';
import { z } from 'zod';

export function isValidObjectId(id: string): boolean {
  return typeof id === 'string' && id.length === 24 && mongoose.Types.ObjectId.isValid(id);
}

/** Zod schema for MongoDB ObjectId */
export const objectIdZod = z.string().refine(isValidObjectId, { message: 'Invalid id format' });

/**
 * Create a safe RegExp from user input to prevent ReDoS.
 * Escapes special chars and limits length.
 */
export function safeRegExp(input: string, flags = 'i', maxLength = 100): RegExp {
  const safe = String(input || '')
    .trim()
    .slice(0, maxLength)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(safe, flags);
}
