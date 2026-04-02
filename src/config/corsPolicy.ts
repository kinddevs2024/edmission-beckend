/**
 * CORS policy for Express and Socket.IO.
 * - Browsers (Expo Web, WebView) send Origin; native RN often omits it — those requests must still pass.
 * - In development, LAN IPs and Expo tunnel hosts are allowed in addition to CORS_ORIGIN.
 */

export const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://localhost:8081',
  'http://localhost:19006',
  'https://edmission.uz',
  'http://edmission.uz',
  'https://www.edmission.uz',
];

/** Parse CORS_ORIGIN; empty / missing env falls back to defaults (fixes CORS_ORIGIN= producing []). */
export function resolveCorsAllowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);
  if (raw && raw.length > 0) return raw;
  return [...DEFAULT_CORS_ORIGINS];
}

/** localhost, Android emulator → host, Expo web / dev */
const DEV_LOCAL_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2)(:\d+)?$/i;

/** Phone / desktop on LAN hitting API by machine IP */
const DEV_LAN_ORIGIN =
  /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$/i;

/** Expo tunnel (Go / dev client) */
const EXPO_TUNNEL_ORIGIN = /^https:\/\/[\w.-]+\.exp\.direct$/i;

function isDevExtraOrigin(origin: string, nodeEnv: string): boolean {
  if (nodeEnv === 'production') return false;
  return (
    DEV_LOCAL_ORIGIN.test(origin) ||
    DEV_LAN_ORIGIN.test(origin) ||
    EXPO_TUNNEL_ORIGIN.test(origin)
  );
}

export type CorsOriginCallback = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void
) => void;

/**
 * Express `cors` / Socket.IO compatible origin callback.
 * No Origin (typical for native mobile HTTP) → allow.
 */
export function createCorsOriginDelegate(
  allowedList: string[],
  nodeEnv: string
): CorsOriginCallback {
  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (allowedList.includes(origin)) {
      callback(null, true);
      return;
    }
    if (isDevExtraOrigin(origin, nodeEnv)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  };
}
