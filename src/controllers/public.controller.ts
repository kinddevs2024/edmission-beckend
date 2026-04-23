import { Request, Response, NextFunction } from 'express';
import * as publicService from '../services/public.service';
import { config } from '../config';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getRequestOrigin(req: Request): string {
  const protoHeader = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const hostHeader = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim();
  const host = hostHeader || req.get('host') || '';
  const protocol = protoHeader || req.protocol || 'https';
  if (host) return `${protocol}://${host}`;
  return (config.frontendUrl || 'http://localhost:5173').replace(/\/+$/, '');
}

function toAbsoluteUrl(req: Request, rawUrl: string | undefined): string | undefined {
  const value = String(rawUrl ?? '').trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  const origin = getRequestOrigin(req);
  if (value.startsWith('/')) return `${origin}${value}`;
  return `${origin}/${value}`;
}

function renderShareHtml(params: {
  title: string;
  description: string;
  imageUrl?: string;
  shareUrl: string;
  redirectUrl: string;
}): string {
  const title = escapeHtml(params.title);
  const description = escapeHtml(params.description);
  const shareUrl = escapeHtml(params.shareUrl);
  const redirectUrl = escapeHtml(params.redirectUrl);
  const imageUrl = params.imageUrl ? escapeHtml(params.imageUrl) : '';
  const twitterCard = imageUrl ? 'summary_large_image' : 'summary';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="${shareUrl}" />
  ${imageUrl ? `<meta property="og:image" content="${imageUrl}" />` : ''}
  ${imageUrl ? `<meta property="og:image:secure_url" content="${imageUrl}" />` : ''}
  <meta name="twitter:card" content="${twitterCard}" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  ${imageUrl ? `<meta name="twitter:image" content="${imageUrl}" />` : ''}
  <meta http-equiv="refresh" content="0;url=${redirectUrl}" />
</head>
<body style="font-family: Arial, sans-serif; margin: 0; background: #f8fafc; color: #0f172a;">
  <main style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; text-align: center;">
    <div>
      <h1 style="font-size: 20px; margin: 0 0 8px;">Opening profile…</h1>
      <p style="margin: 0 0 14px; color: #475569;">If redirect does not start, continue manually.</p>
      <a href="${redirectUrl}" rel="noopener noreferrer" style="color: #0ea5e9; font-weight: 600;">Open in Edmission</a>
    </div>
  </main>
</body>
</html>`;
}

function sendSharePreview(
  req: Request,
  res: Response,
  payload: publicService.SharePreviewPayload
): void {
  const title = String(payload.title || 'Edmission').trim() || 'Edmission';
  const description = String(payload.description || 'Discover opportunities on Edmission.').trim() || 'Discover opportunities on Edmission.';
  const shareUrl = `${getRequestOrigin(req)}${req.originalUrl}`;
  const imageUrl = toAbsoluteUrl(req, payload.imageUrl);
  const redirectUrl = toAbsoluteUrl(req, payload.redirectUrl) ?? (config.frontendUrl || 'http://localhost:5173');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(
    renderShareHtml({
      title,
      description,
      imageUrl,
      shareUrl,
      redirectUrl,
    })
  );
}

export async function getLandingCertificates(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await publicService.getLandingCertificates();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await publicService.getPublicStats();
    res.json(stats);
  } catch (e) {
    next(e);
  }
}

export async function getPublicUniversities(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as { page?: number; limit?: number };
    const data = await publicService.getPublicUniversities({
      page: q.page,
      limit: q.limit,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getTrustedUniversityLogos(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as { limit?: number; offset?: number };
    const limit = q.limit ?? 25;
    const offset = q.offset ?? 0;
    const logos = await publicService.getTrustedUniversityLogos({ limit, offset });
    res.json(logos);
  } catch (e) {
    next(e);
  }
}

export async function trackSiteVisit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { visitorId: string; path?: string };
    await publicService.recordSiteVisit({
      visitorId: body.visitorId,
      path: body.path,
      user: req.user ? { id: req.user.id, role: req.user.role } : null,
    });
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

export async function getUniversitySharePreview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await publicService.getUniversitySharePreview(req.params.id);
    sendSharePreview(req, res, data);
  } catch (e) {
    next(e);
  }
}

export async function getStudentSharePreview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await publicService.getStudentSharePreview(req.params.id);
    sendSharePreview(req, res, data);
  } catch (e) {
    next(e);
  }
}
