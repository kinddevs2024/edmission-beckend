import { UniversityProfile, StudentProfile, Scholarship, LandingCertificate, SiteVisit } from '../models';

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

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

export async function getTrustedUniversityLogos(limit = 15): Promise<Array<{ id: string; name: string; logoUrl: string }>> {
  const safeLimit = Math.max(1, Math.min(limit, 30));
  const list = await UniversityProfile.aggregate([
    {
      $match: {
        verified: true,
        logoUrl: { $type: 'string', $nin: ['', null] },
      },
    },
    {
      $project: {
        _id: 1,
        name: '$universityName',
        logoUrl: 1,
      },
    },
    { $sample: { size: safeLimit } },
  ]);

  return list
    .filter((item) => typeof item.logoUrl === 'string' && item.logoUrl.trim())
    .map((item) => ({
      id: String(item._id),
      name: typeof item.name === 'string' && item.name.trim() ? item.name : 'Partner University',
      logoUrl: String(item.logoUrl).trim(),
    }));
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
