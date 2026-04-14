import { config } from '../config';

const PRODUCTION_DEFAULT_FRONTEND = 'https://edmission.uz';
const DEVELOPMENT_DEFAULT_FRONTEND = 'http://localhost:5173';

function normalizeBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]'
  );
}

function isProduction(): boolean {
  return (config.nodeEnv || '').toLowerCase() === 'production';
}

export function getPublicSiteBaseUrl(): string {
  const fallback = isProduction() ? PRODUCTION_DEFAULT_FRONTEND : DEVELOPMENT_DEFAULT_FRONTEND;
  const candidates = [config.telegram.frontendBaseUrl, config.frontendUrl, fallback]
    .map((value) => normalizeBase(String(value ?? '')))
    .filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      if (isProduction() && isLoopbackHost(parsed.hostname)) {
        continue;
      }
      return normalizeBase(parsed.toString());
    } catch {
      continue;
    }
  }

  return fallback;
}

export function toPublicSiteUrl(pathOrUrl: string): string {
  const value = String(pathOrUrl ?? '').trim();
  if (!value) return getPublicSiteBaseUrl();
  if (/^https?:\/\//i.test(value)) return value;
  const path = value.startsWith('/') ? value : `/${value}`;
  return `${getPublicSiteBaseUrl()}${path}`;
}

