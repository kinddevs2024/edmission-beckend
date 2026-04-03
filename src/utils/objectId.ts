import mongoose from 'mongoose';

/**
 * Normalize a value to a string suitable for Mongoose ObjectId (findById, etc.).
 * Handles: string, object with _id or id. Avoids passing objects that stringify to "[object Object]".
 */
export function toObjectIdString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof mongoose.Types.ObjectId) {
    const s = value.toString();
    return s.length === 24 && mongoose.Types.ObjectId.isValid(s) ? s : null;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    return s && s.length === 24 && mongoose.Types.ObjectId.isValid(s) ? s : null;
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const oid = o.$oid;
    if (typeof oid === 'string') {
      const s = oid.trim();
      return s.length === 24 && mongoose.Types.ObjectId.isValid(s) ? s : null;
    }
    const id = o._id ?? o.id;
    if (id instanceof mongoose.Types.ObjectId) {
      const s = id.toString();
      return s.length === 24 && mongoose.Types.ObjectId.isValid(s) ? s : null;
    }
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
