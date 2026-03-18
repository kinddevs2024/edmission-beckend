import { UniversityProfile, StudentProfile, Scholarship, LandingCertificate } from '../models';

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
