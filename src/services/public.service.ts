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
