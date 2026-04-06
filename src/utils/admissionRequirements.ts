/** Parse IELTS band from free-text requirements (e.g. "IELTS 7", "ielts 6.5"). */
export function parseIeltsMinBandFromText(text?: string | null): number | null {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/\bIELTS\s*[:\s]*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0 || n > 9) return null;
  return n;
}

/** Effective minimum IELTS band from structured field or legacy text. */
export function getEffectiveIeltsMinBand(
  explicit: number | null | undefined,
  minLanguageLevel?: string | null
): number | null {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return Math.min(9, Math.max(0, explicit));
  }
  return parseIeltsMinBandFromText(minLanguageLevel ?? undefined);
}
