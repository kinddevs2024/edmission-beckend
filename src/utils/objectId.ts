import mongoose from 'mongoose';

/**
 * Normalize a value to a string suitable for Mongoose ObjectId (findById, etc.).
 * Handles: string, object with _id or id. Avoids passing objects that stringify to "[object Object]".
 */
export function toObjectIdString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const s = value.trim();
    return s && s.length === 24 && mongoose.Types.ObjectId.isValid(s) ? s : null;
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const id = o._id ?? o.id;
    if (typeof id === 'string') {
      const s = id.trim();
      return s && s.length === 24 && mongoose.Types.ObjectId.isValid(s) ? s : null;
    }
    if (id != null && typeof id !== 'object') {
      const s = String(id).trim();
      return s && s.length === 24 && mongoose.Types.ObjectId.isValid(s) ? s : null;
    }
  }
  return null;
}

/**
 * Normalize an array of ids (e.g. from query params) to valid ObjectId strings.
 * Filters out "[object Object]", invalid ids, and duplicates.
 */
export function toObjectIdStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const id = toObjectIdString(v);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
