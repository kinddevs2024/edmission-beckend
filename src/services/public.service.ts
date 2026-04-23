import { UniversityCatalog, UniversityProfile, StudentProfile, Scholarship, LandingCertificate, SiteVisit, StudentDocument } from '../models';
import { config } from '../config';
import { AppError, ErrorCodes } from '../utils/errors';
import { toObjectIdString } from '../utils/objectId';
import { effectiveProfileVisibility } from '../utils/studentProfilePrivacy';

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

export type SharePreviewPayload = {
  title: string;
  description: string;
  imageUrl?: string;
  redirectUrl: string;
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

export type PublicUniversityListItem = {
  id: string;
  _source: 'catalog' | 'profile';
  name: string;
  universityName: string;
  country?: string;
  city?: string;
  description?: string;
  logo?: string;
  logoUrl?: string;
  rating?: number;
  hasScholarship: boolean;
  scholarships: Array<{ coveragePercent?: number; name?: string }>;
  minLanguageLevel?: string;
  tuitionPrice?: number;
  ieltsMinBand?: number;
  gpaMinMode?: 'scale' | 'percent';
  gpaMinValue?: number;
  foundedYear?: number;
  studentCount?: number;
};

type PublicUniversitiesQuery = {
  page?: number;
  limit?: number;
};

function mapEmbeddedScholarships(rows: unknown): Array<{ coveragePercent?: number; name?: string }> {
  if (!Array.isArray(rows)) return [];
  return rows
    .slice(0, 3)
    .map((raw) => {
      const row = raw as { coveragePercent?: unknown; name?: unknown };
      const coveragePercent = typeof row.coveragePercent === 'number' && Number.isFinite(row.coveragePercent)
        ? Number(row.coveragePercent)
        : undefined;
      const name = firstText(row.name);
      if (coveragePercent === undefined && !name) return null;
      return {
        ...(coveragePercent !== undefined ? { coveragePercent } : {}),
        ...(name ? { name } : {}),
      };
    })
    .filter((item): item is { coveragePercent?: number; name?: string } => item !== null);
}

function maxEmbeddedCoverage(rows: unknown): number | undefined {
  if (!Array.isArray(rows)) return undefined;
  const values = rows
    .map((raw) => {
      const coverage = (raw as { coveragePercent?: unknown }).coveragePercent;
      return typeof coverage === 'number' && Number.isFinite(coverage) ? Number(coverage) : undefined;
    })
    .filter((value): value is number => value !== undefined);
  if (values.length === 0) return undefined;
  return Math.max(...values);
}

/**
 * Public catalog for Landing/Explore pages (no auth):
 * - unlinked catalog universities
 * - verified university profiles
 * with simple pagination and no profile-based filters.
 */
export async function getPublicUniversities(
  query: PublicUniversitiesQuery = {}
): Promise<{
  data: PublicUniversityListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const limit = Math.min(50, Math.max(1, Math.floor(Number(query.limit)) || 8));
  const skip = (page - 1) * limit;

  const [catalogs, profiles] = await Promise.all([
    UniversityCatalog.find({ linkedUniversityProfileId: { $exists: false } })
      .sort({ universityName: 1, _id: 1 })
      .lean(),
    UniversityProfile.find({ verified: true })
      .sort({ universityName: 1, _id: 1 })
      .lean(),
  ]);

  const profileIds = profiles.map((profile) => (profile as { _id: unknown })._id);
  const [scholarshipStats, linkedCatalogs] = await Promise.all([
    profileIds.length > 0
      ? Scholarship.aggregate<{ _id: unknown; count: number; maxCoverage?: number }>([
          { $match: { universityId: { $in: profileIds } } },
          {
            $group: {
              _id: '$universityId',
              count: { $sum: 1 },
              maxCoverage: { $max: '$coveragePercent' },
            },
          },
        ])
      : [],
    profileIds.length > 0
      ? UniversityCatalog.find({ linkedUniversityProfileId: { $in: profileIds } }).lean()
      : [],
  ]);

  const scholarshipMap: Record<string, { count: number; maxCoverage?: number }> = {};
  for (const row of scholarshipStats) {
    const id = String(row._id);
    scholarshipMap[id] = {
      count: typeof row.count === 'number' && Number.isFinite(row.count) ? row.count : 0,
      maxCoverage:
        typeof row.maxCoverage === 'number' && Number.isFinite(row.maxCoverage)
          ? Number(row.maxCoverage)
          : undefined,
    };
  }

  const linkedCatalogMap: Record<string, Record<string, unknown>> = {};
  for (const catalog of linkedCatalogs) {
    const linkedProfileId = (catalog as { linkedUniversityProfileId?: unknown }).linkedUniversityProfileId;
    if (!linkedProfileId) continue;
    linkedCatalogMap[String(linkedProfileId)] = catalog as unknown as Record<string, unknown>;
  }

  const catalogItems: PublicUniversityListItem[] = catalogs.map((catalog) => {
    const catalogScholarshipsRaw = (catalog as { scholarships?: unknown }).scholarships;
    const catalogScholarships = mapEmbeddedScholarships(catalogScholarshipsRaw);
    const rawMode = (catalog as { gpaMinMode?: unknown }).gpaMinMode;
    const gpaMinMode = rawMode === 'scale' || rawMode === 'percent' ? rawMode : undefined;
    const logoUrl = firstText((catalog as { logoUrl?: unknown }).logoUrl);
    return {
      id: `catalog-${String((catalog as { _id: unknown })._id)}`,
      _source: 'catalog',
      name: firstText((catalog as { universityName?: unknown }).universityName, 'University') ?? 'University',
      universityName: firstText((catalog as { universityName?: unknown }).universityName, 'University') ?? 'University',
      country: firstText((catalog as { country?: unknown }).country),
      city: firstText((catalog as { city?: unknown }).city),
      description: firstText((catalog as { description?: unknown }).description),
      logo: logoUrl,
      logoUrl,
      rating: firstFiniteNumber((catalog as { rating?: unknown }).rating),
      hasScholarship: Array.isArray(catalogScholarshipsRaw) && catalogScholarshipsRaw.length > 0,
      scholarships: catalogScholarships,
      minLanguageLevel: firstText((catalog as { minLanguageLevel?: unknown }).minLanguageLevel),
      tuitionPrice: firstFiniteNumber((catalog as { tuitionPrice?: unknown }).tuitionPrice),
      ieltsMinBand: firstFiniteNumber((catalog as { ieltsMinBand?: unknown }).ieltsMinBand),
      gpaMinMode,
      gpaMinValue: firstFiniteNumber((catalog as { gpaMinValue?: unknown }).gpaMinValue),
      foundedYear: firstFiniteNumber((catalog as { establishedYear?: unknown }).establishedYear),
      studentCount: firstFiniteNumber((catalog as { studentCount?: unknown }).studentCount),
    };
  });

  const profileItems: PublicUniversityListItem[] = profiles.map((profile) => {
    const id = String((profile as { _id: unknown })._id);
    const linkedCatalog = linkedCatalogMap[id];
    const profileScholarshipStat = scholarshipMap[id];
    const linkedScholarshipsRaw = (linkedCatalog as { scholarships?: unknown } | undefined)?.scholarships;
    const linkedScholarships = mapEmbeddedScholarships(linkedScholarshipsRaw);
    const linkedCoverage = maxEmbeddedCoverage(linkedScholarshipsRaw);
    const hasScholarship = (profileScholarshipStat?.count ?? 0) > 0 || (Array.isArray(linkedScholarshipsRaw) && linkedScholarshipsRaw.length > 0);
    const maxCoverage = profileScholarshipStat?.maxCoverage ?? linkedCoverage;
    const scholarships = hasScholarship
      ? (typeof maxCoverage === 'number'
          ? [{ coveragePercent: maxCoverage }]
          : linkedScholarships)
      : [];
    const rawMode =
      (profile as { gpaMinMode?: unknown }).gpaMinMode ??
      (linkedCatalog as { gpaMinMode?: unknown } | undefined)?.gpaMinMode;
    const gpaMinMode = rawMode === 'scale' || rawMode === 'percent' ? rawMode : undefined;
    const logoUrl = firstText(
      (profile as { logoUrl?: unknown }).logoUrl,
      (linkedCatalog as { logoUrl?: unknown } | undefined)?.logoUrl
    );
    const universityName = firstText(
      (profile as { universityName?: unknown }).universityName,
      (linkedCatalog as { universityName?: unknown } | undefined)?.universityName,
      'University'
    ) ?? 'University';
    return {
      id,
      _source: 'profile',
      name: universityName,
      universityName,
      country: firstText(
        (profile as { country?: unknown }).country,
        (linkedCatalog as { country?: unknown } | undefined)?.country
      ),
      city: firstText(
        (profile as { city?: unknown }).city,
        (linkedCatalog as { city?: unknown } | undefined)?.city
      ),
      description: firstText(
        (profile as { description?: unknown }).description,
        (linkedCatalog as { description?: unknown } | undefined)?.description
      ),
      logo: logoUrl,
      logoUrl,
      rating: firstFiniteNumber((profile as { rating?: unknown }).rating),
      hasScholarship,
      scholarships,
      minLanguageLevel: firstText(
        (profile as { minLanguageLevel?: unknown }).minLanguageLevel,
        (linkedCatalog as { minLanguageLevel?: unknown } | undefined)?.minLanguageLevel
      ),
      tuitionPrice: firstFiniteNumber(
        (profile as { tuitionPrice?: unknown }).tuitionPrice,
        (linkedCatalog as { tuitionPrice?: unknown } | undefined)?.tuitionPrice
      ),
      ieltsMinBand: firstFiniteNumber(
        (profile as { ieltsMinBand?: unknown }).ieltsMinBand,
        (linkedCatalog as { ieltsMinBand?: unknown } | undefined)?.ieltsMinBand
      ),
      gpaMinMode,
      gpaMinValue: firstFiniteNumber(
        (profile as { gpaMinValue?: unknown }).gpaMinValue,
        (linkedCatalog as { gpaMinValue?: unknown } | undefined)?.gpaMinValue
      ),
      foundedYear: firstFiniteNumber(
        (profile as { establishedYear?: unknown }).establishedYear,
        (linkedCatalog as { establishedYear?: unknown } | undefined)?.establishedYear
      ),
      studentCount: firstFiniteNumber(
        (profile as { studentCount?: unknown }).studentCount,
        (linkedCatalog as { studentCount?: unknown } | undefined)?.studentCount
      ),
    };
  });

  const merged = [...catalogItems, ...profileItems].sort((left, right) =>
    left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })
  );

  const total = merged.length;
  const data = merged.slice(skip, skip + limit);

  return {
    data,
    total,
    page,
    limit,
    totalPages: total > 0 ? Math.ceil(total / limit) : 0,
  };
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
  const role = input.user?.role && ['student', 'university', 'admin', 'school_counsellor', 'counsellor_coordinator', 'manager'].includes(input.user.role)
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

function getFrontendBaseUrl(): string {
  return (config.frontendUrl || 'http://localhost:5173').replace(/\/+$/, '');
}

function buildFrontendUrl(path: string): string {
  const base = getFrontendBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = toText(value);
    if (text) return text;
  }
  return undefined;
}

function firstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function truncateText(input: string, maxLen = 180): string {
  const normalized = input.trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1).trimEnd()}…`;
}

function degreeLabel(value: unknown): string | undefined {
  const normalized = toText(value).toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'bachelor') return 'Bachelor';
  if (normalized === 'master') return 'Master';
  if (normalized === 'phd') return 'PhD';
  return undefined;
}

function isImageUrl(value: string): boolean {
  return /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(value);
}

type StudentCertificateCandidate = {
  type?: unknown;
  certificateType?: unknown;
  name?: unknown;
  score?: unknown;
  previewImageUrl?: unknown;
  fileUrl?: unknown;
};

function certificatePriority(doc: StudentCertificateCandidate): number {
  const type = toText(doc.type);
  if (type === 'language_certificate') return 0;
  if (type === 'course_certificate') return 1;
  return 2;
}

function pickStudentCertificate(
  documents: StudentCertificateCandidate[]
): StudentCertificateCandidate | null {
  if (!documents.length) return null;
  const sorted = [...documents].sort((left, right) => certificatePriority(left) - certificatePriority(right));
  for (const doc of sorted) {
    const type = toText(doc.type);
    const hasName = !!firstText(doc.certificateType, doc.name);
    if (type === 'language_certificate' || type === 'course_certificate') return doc;
    if (type === 'other' && hasName) return doc;
  }
  return null;
}

function formatCertificateLine(doc: StudentCertificateCandidate): string | undefined {
  const rawName = firstText(doc.certificateType, doc.name, 'Certificate');
  if (!rawName) return undefined;
  const score = firstText(doc.score);
  const line = score ? `${rawName}: ${score}` : rawName;
  return truncateText(line, 80);
}

function pickCertificateImage(doc: StudentCertificateCandidate | null): string | undefined {
  if (!doc) return undefined;
  const preview = firstText(doc.previewImageUrl);
  if (preview) return preview;
  const fileUrl = firstText(doc.fileUrl);
  if (fileUrl && isImageUrl(fileUrl)) return fileUrl;
  return undefined;
}

async function getCatalogUniversitySharePreview(catalogId: string): Promise<SharePreviewPayload> {
  const catalog = await UniversityCatalog.findById(catalogId).lean();
  if (!catalog) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);

  const linkedProfileId = toObjectIdString((catalog as { linkedUniversityProfileId?: unknown }).linkedUniversityProfileId);
  if (linkedProfileId) {
    return getUniversitySharePreview(linkedProfileId);
  }

  const shareId = `catalog-${String((catalog as { _id: unknown })._id)}`;
  const name = firstText((catalog as { universityName?: unknown }).universityName, 'University');
  const tagline = firstText((catalog as { tagline?: unknown }).tagline);
  const description = firstText((catalog as { description?: unknown }).description);
  const city = firstText((catalog as { city?: unknown }).city);
  const country = firstText((catalog as { country?: unknown }).country);
  const location = [city, country].filter(Boolean).join(', ');
  const fallbackDescription = [tagline, description, location].filter(Boolean).join(' • ');
  const imageUrl = firstText((catalog as { logoUrl?: unknown }).logoUrl);

  return {
    title: truncateText(name ?? 'University', 90),
    description: truncateText(fallbackDescription || 'Explore this university profile on Edmission.', 180),
    imageUrl,
    redirectUrl: buildFrontendUrl(`/student/universities/${encodeURIComponent(shareId)}`),
  };
}

export async function getUniversitySharePreview(universityId: string): Promise<SharePreviewPayload> {
  const idStr = String(universityId ?? '').trim();
  if (!idStr) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);

  if (idStr.startsWith('catalog-')) {
    const catalogId = toObjectIdString(idStr.replace(/^catalog-/, ''));
    if (!catalogId) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);
    return getCatalogUniversitySharePreview(catalogId);
  }

  const uid = toObjectIdString(idStr);
  if (!uid) throw new AppError(404, 'University not found', ErrorCodes.NOT_FOUND);

  const profile = await UniversityProfile.findById(uid).lean();
  if (!profile) {
    return getCatalogUniversitySharePreview(uid);
  }

  const linkedCatalog = await UniversityCatalog.findOne({ linkedUniversityProfileId: uid }).lean();
  const name = firstText(
    (profile as { universityName?: unknown }).universityName,
    (linkedCatalog as { universityName?: unknown } | null)?.universityName,
    'University'
  );
  const tagline = firstText(
    (profile as { tagline?: unknown }).tagline,
    (linkedCatalog as { tagline?: unknown } | null)?.tagline
  );
  const description = firstText(
    (profile as { description?: unknown }).description,
    (linkedCatalog as { description?: unknown } | null)?.description
  );
  const city = firstText((profile as { city?: unknown }).city, (linkedCatalog as { city?: unknown } | null)?.city);
  const country = firstText((profile as { country?: unknown }).country, (linkedCatalog as { country?: unknown } | null)?.country);
  const foundedYear = firstFiniteNumber(
    (profile as { establishedYear?: unknown }).establishedYear,
    (linkedCatalog as { establishedYear?: unknown } | null)?.establishedYear
  );
  const location = [city, country].filter(Boolean).join(', ');
  const yearPart = foundedYear != null ? `Founded ${foundedYear}` : '';
  const descriptionParts = [tagline, description, location, yearPart].filter(Boolean);
  const imageUrl = firstText(
    (profile as { logoUrl?: unknown }).logoUrl,
    (profile as { coverImageUrl?: unknown }).coverImageUrl,
    (linkedCatalog as { logoUrl?: unknown } | null)?.logoUrl
  );

  return {
    title: truncateText(name ?? 'University', 90),
    description: truncateText(descriptionParts.join(' • ') || 'Explore this university profile on Edmission.', 180),
    imageUrl,
    redirectUrl: buildFrontendUrl(`/student/universities/${encodeURIComponent(uid)}`),
  };
}

export async function getStudentSharePreview(studentId: string): Promise<SharePreviewPayload> {
  const sid = toObjectIdString(studentId);
  if (!sid) throw new AppError(404, 'Student not found', ErrorCodes.NOT_FOUND);

  let student = await StudentProfile.findById(sid).lean();
  if (!student) {
    student = await StudentProfile.findOne({ userId: sid }).lean();
  }
  if (!student) throw new AppError(404, 'Student not found', ErrorCodes.NOT_FOUND);

  const studentProfileId = String((student as { _id: unknown })._id);
  const visibility = effectiveProfileVisibility((student as { profileVisibility?: unknown }).profileVisibility);
  if (visibility === 'private') {
    return {
      title: 'Private student profile',
      description: 'This student profile is private on Edmission.',
      redirectUrl: buildFrontendUrl(`/university/students/${encodeURIComponent(studentProfileId)}`),
    };
  }

  const documents = await StudentDocument.find({
    studentId: studentProfileId,
    status: 'approved',
  })
    .select('type certificateType name score previewImageUrl fileUrl')
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(8)
    .lean();

  const certificate = pickStudentCertificate(documents as StudentCertificateCandidate[]);
  const certificateLine = certificate ? formatCertificateLine(certificate) : undefined;
  const firstName = firstText((student as { firstName?: unknown }).firstName);
  const lastName = firstText((student as { lastName?: unknown }).lastName);
  const title = truncateText([firstName, lastName].filter(Boolean).join(' ') || 'Student profile', 90);

  const city = firstText((student as { city?: unknown }).city);
  const country = firstText((student as { country?: unknown }).country);
  const location = [city, country].filter(Boolean).join(', ');
  const targetDegree = degreeLabel((student as { targetDegreeLevel?: unknown }).targetDegreeLevel);
  const graduationYear = firstFiniteNumber((student as { graduationYear?: unknown }).graduationYear);
  const summaryParts = [
    location,
    targetDegree ? `Target degree: ${targetDegree}` : '',
    graduationYear != null ? `Graduation: ${graduationYear}` : '',
  ].filter(Boolean);
  const summary = summaryParts.slice(0, 2).join(' • ');
  const description = truncateText(
    [certificateLine, summary].filter(Boolean).join(' • ') || 'Student profile on Edmission.',
    180
  );

  const imageUrl = firstText(
    pickCertificateImage(certificate),
    (student as { avatarUrl?: unknown }).avatarUrl
  );

  return {
    title,
    description,
    imageUrl,
    redirectUrl: buildFrontendUrl(`/university/students/${encodeURIComponent(studentProfileId)}`),
  };
}
