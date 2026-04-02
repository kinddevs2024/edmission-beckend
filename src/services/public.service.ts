import { UniversityCatalog, UniversityProfile, StudentProfile, Scholarship, LandingCertificate, SiteVisit } from '../models';

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export type TrustedUniversityLogo = {
  id: string;
  name: string;
  logoUrl: string;
};

export type TrustedUniversityLogoPage = {
  items: TrustedUniversityLogo[];
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
  hasMore: boolean;
};

type TrustedUniversityLogoAggregateResult = {
  items?: Array<{
    id: unknown;
    name?: unknown;
    logoUrl?: unknown;
  }>;
  meta?: Array<{
    total?: unknown;
  }>;
};

export async function getLandingCertificates(): Promise<Array<{ id: string; type: string; title: string; imageUrl: string; order: number }>> {
  const list = await LandingCertificate.find().sort({ order: 1, createdAt: 1 }).lean();
  return list.map((c) => ({
    id: String((c as { _id: unknown })._id),
    type: (c as { type: string }).type,
    title: (c as { title: string }).title,
    imageUrl: (c as { imageUrl: string }).imageUrl,
    order: (c as { order?: number }).order ?? 0,
  }));
}

export async function getPublicStats(): Promise<{
  universities: number;
  students: number;
  scholarships: number;
}> {
  const [universities, students, scholarships] = await Promise.all([
    UniversityProfile.countDocuments({ verified: true }),
    StudentProfile.countDocuments(),
    Scholarship.countDocuments(),
  ]);
  return { universities, students, scholarships };
}

/**
 * Logos for landing carousels: serve real catalog logos from the DB in stable pages
 * so clients can start quickly and progressively load the full set in the background.
 */
export async function getTrustedUniversityLogos(input: {
  limit?: number;
  offset?: number;
} = {}): Promise<TrustedUniversityLogoPage> {
  const safeLimit = Math.max(1, Math.min(Math.floor(Number(input.limit)) || 25, 60));
  const safeOffset = Math.max(0, Math.floor(Number(input.offset)) || 0);

  const [result] = await UniversityCatalog.aggregate<TrustedUniversityLogoAggregateResult>([
    {
      $match: {
        logoUrl: { $type: 'string', $nin: ['', null] },
      },
    },
    {
      $project: {
        catalogId: '$_id',
        name: {
          $trim: {
            input: { $ifNull: ['$universityName', ''] },
          },
        },
        logoUrl: {
          $trim: {
            input: { $ifNull: ['$logoUrl', ''] },
          },
        },
      },
    },
    {
      $match: {
        logoUrl: { $ne: '' },
      },
    },
    {
      $addFields: {
        urlLen: { $strLenCP: '$logoUrl' },
      },
    },
    {
      $sort: {
        urlLen: 1,
        logoUrl: 1,
        name: 1,
        catalogId: 1,
      },
    },
    {
      $group: {
        _id: '$logoUrl',
        id: { $first: '$catalogId' },
        name: { $first: '$name' },
        logoUrl: { $first: '$logoUrl' },
        urlLen: { $first: '$urlLen' },
      },
    },
    {
      $sort: {
        urlLen: 1,
        logoUrl: 1,
        name: 1,
        id: 1,
      },
    },
    {
      $facet: {
        items: [
          { $skip: safeOffset },
          { $limit: safeLimit },
        ],
        meta: [{ $count: 'total' }],
      },
    },
  ]);

  const total = Array.isArray(result?.meta) && result.meta[0]?.total ? Number(result.meta[0].total) : 0;
  const items = (Array.isArray(result?.items) ? result.items : [])
    .map((item: { id: unknown; name?: unknown; logoUrl?: unknown }) => ({
      id: String(item.id),
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Partner University',
      logoUrl: typeof item.logoUrl === 'string' ? item.logoUrl.trim() : '',
    }))
    .filter((item: TrustedUniversityLogo) => item.logoUrl);

  const nextOffset = safeOffset + items.length < total ? safeOffset + items.length : null;

  return {
    items,
    total,
    limit: safeLimit,
    offset: safeOffset,
    nextOffset,
    hasMore: nextOffset !== null,
  };
}

export async function recordSiteVisit(input: {
  visitorId: string;
  path?: string;
  user?: { id: string; role?: string | null } | null;
}): Promise<void> {
  const visitorId = String(input.visitorId ?? '').trim().slice(0, 120);
  if (!visitorId) return;

  const now = new Date();
  const visitedOn = startOfUtcDay(now);
  const safePath = (() => {
    const raw = String(input.path ?? '/').trim();
    if (!raw) return '/';
    return raw.startsWith('/') ? raw.slice(0, 300) : `/${raw.slice(0, 299)}`;
  })();
  const role = input.user?.role && ['student', 'university', 'admin', 'school_counsellor'].includes(input.user.role)
    ? input.user.role
    : 'anonymous';

  await SiteVisit.findOneAndUpdate(
    { visitorId, visitedOn },
    {
      $set: {
        path: safePath,
        lastSeenAt: now,
        ...(input.user?.id ? { userId: input.user.id, role } : {}),
      },
      $setOnInsert: {
        visitorId,
        visitedOn,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
}
