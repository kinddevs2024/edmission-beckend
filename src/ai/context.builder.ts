import {
  StudentProfile,
  UniversityProfile,
  Recommendation,
  Offer,
  Interest,
  Scholarship,
} from '../models';
import type { Role } from '../types/role';

export async function buildContext(userId: string, role: Role): Promise<string> {
  if (role === 'student') {
    return buildStudentContext(userId);
  }
  if (role === 'university') {
    return buildUniversityContext(userId);
  }
  return 'You are an admin. Limited context for AI.';
}

async function buildStudentContext(userId: string): Promise<string> {
  const profile = await StudentProfile.findOne({ userId }).lean();
  if (!profile) return 'Student profile not found.';

  const [recommendations, offers, interests] = await Promise.all([
    Recommendation.find({ studentId: profile._id })
      .sort({ matchScore: -1 })
      .limit(5)
      .populate('universityId', 'universityName country')
      .lean(),
    Offer.find({ studentId: profile._id })
      .populate('universityId', 'universityName')
      .populate('scholarshipId', 'name coveragePercent')
      .lean(),
    Interest.find({ studentId: profile._id })
      .populate('universityId', 'universityName')
      .lean(),
  ]);

  const lines: string[] = [];
  lines.push(`Student: ${(profile as { firstName?: string }).firstName ?? ''} ${(profile as { lastName?: string }).lastName ?? ''}. Country: ${(profile as { country?: string }).country ?? '—'}.`);
  if ((profile as { gpa?: number }).gpa != null) lines.push(`GPA: ${(profile as { gpa: number }).gpa}.`);
  if ((profile as { gradeLevel?: string }).gradeLevel) lines.push(`Grade level: ${(profile as { gradeLevel: string }).gradeLevel}.`);
  if ((profile as { languageLevel?: string }).languageLevel) lines.push(`Language level: ${(profile as { languageLevel: string }).languageLevel}.`);
  lines.push('');
  lines.push('Top recommendations:');
  recommendations.forEach((r: unknown) => {
    const rr = r as { universityId?: { universityName: string; country?: string }; matchScore: number };
    const uni = rr.universityId;
    const name = uni ? uni.universityName : '—';
    const country = uni && uni.country != null ? uni.country : '—';
    lines.push(`- ${name} (${country}): match ${Math.round(rr.matchScore * 100)}%`);
  });
  lines.push('');
  lines.push('Offers:');
  offers.forEach((o: unknown) => {
    const oo = o as { universityId?: { universityName: string }; scholarshipId?: { name: string; coveragePercent: number } };
    const name = oo.universityId ? oo.universityId.universityName : '—';
    const suffix = oo.scholarshipId ? `, ${oo.scholarshipId.name} (${oo.scholarshipId.coveragePercent}%)` : '';
    lines.push(`- ${name}${suffix}`);
  });
  lines.push('');
  lines.push('Applications (interests):');
  interests.forEach((i: unknown) => {
    const ii = i as { universityId?: { universityName: string }; status: string };
    const name = ii.universityId ? ii.universityId.universityName : '—';
    lines.push(`- ${name}: ${ii.status}`);
  });
  return lines.join('\n');
}

async function buildUniversityContext(userId: string): Promise<string> {
  const profile = await UniversityProfile.findOne({ userId }).lean();
  if (!profile) return 'University profile not found.';

  const [byStatusAgg, scholarships, recs] = await Promise.all([
    Interest.aggregate([{ $match: { universityId: profile._id } }, { $group: { _id: '$status', _count: { $sum: 1 } } }]),
    Scholarship.find({ universityId: profile._id }).select('name coveragePercent remainingSlots').lean(),
    Recommendation.find({ universityId: profile._id })
      .sort({ matchScore: -1 })
      .limit(5)
      .populate('studentId', 'firstName lastName gpa country')
      .lean(),
  ]);

  const lines: string[] = [];
  lines.push(`University: ${(profile as { universityName: string }).universityName}. Country: ${(profile as { country?: string }).country ?? '—'}, City: ${(profile as { city?: string }).city ?? '—'}.`);
  lines.push('');
  lines.push('Pipeline (applications by status):');
  byStatusAgg.forEach((s: { _id: string; _count: number }) => {
    lines.push(`- ${s._id}: ${s._count}`);
  });
  lines.push('');
  lines.push('Scholarships:');
  scholarships.forEach((s) => {
    const sch = s as { name: string; coveragePercent: number; remainingSlots: number };
    lines.push(`- ${sch.name}: ${sch.coveragePercent}% coverage, ${sch.remainingSlots} slots left`);
  });
  lines.push('');
  lines.push('Top recommended students:');
  recs.forEach((r: unknown) => {
    const rr = r as { studentId?: { firstName?: string; lastName?: string; gpa?: number; country?: string }; matchScore: number };
    const student = rr.studentId;
    const name = student ? [student.firstName, student.lastName].filter(Boolean).join(' ') || '—' : '—';
    const gpa = student?.gpa ?? '—';
    const country = student?.country ?? '—';
    lines.push(`- ${name}, GPA: ${gpa}, Country: ${country}, match ${Math.round(rr.matchScore * 100)}%`);
  });
  return lines.join('\n');
}
