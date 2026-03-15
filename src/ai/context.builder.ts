import {
  StudentProfile,
  UniversityProfile,
  Recommendation,
  Offer,
  Interest,
  Scholarship,
} from '../models';
import type { Role } from '../types/role';

/** Max number of universities to include in student context (name list). */
const MAX_UNIVERSITIES_IN_CONTEXT = 60;

export async function buildContext(userId: string, role: Role): Promise<string> {
  if (role === 'student') {
    return buildStudentContext(userId);
  }
  if (role === 'university') {
    return buildUniversityContext(userId);
  }
  if (role === 'admin') return 'You are an admin. Limited context for AI.';
  if (role === 'school_counsellor') return 'You are a school counsellor. You help schools and students with the platform. Limited context for AI.';
  return 'Limited context for AI.';
}

async function buildStudentContext(userId: string): Promise<string> {
  const profile = await StudentProfile.findOne({ userId }).lean();
  if (!profile) return 'Student profile not found.';

  const preferredCountries = Array.isArray((profile as { preferredCountries?: string[] }).preferredCountries)
    ? ((profile as { preferredCountries?: string[] }).preferredCountries ?? []).filter(Boolean)
    : [];

  const now = new Date();
  const [recommendations, offers, interests, universitiesByCountry, universityList, nearestDeadlines] = await Promise.all([
    Recommendation.find({ studentId: profile._id })
      .sort({ matchScore: -1 })
      .limit(5)
      .populate('universityId', 'universityName country city')
      .lean(),
    Offer.find({ studentId: profile._id })
      .populate('universityId', 'universityName')
      .populate('scholarshipId', 'name coveragePercent')
      .lean(),
    Interest.find({ studentId: profile._id })
      .populate('universityId', 'universityName')
      .lean(),
    UniversityProfile.aggregate([
      { $match: { verified: true } },
      { $group: { _id: '$country', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 25 },
    ]),
    UniversityProfile.find({ verified: true })
      .select('universityName country city')
      .sort({ universityName: 1 })
      .limit(MAX_UNIVERSITIES_IN_CONTEXT)
      .lean(),
    Scholarship.find({ deadline: { $gte: now } })
      .populate('universityId', 'universityName verified')
      .sort({ deadline: 1 })
      .limit(10)
      .lean(),
  ]);

  const lines: string[] = [];
  const p = profile as Record<string, unknown>;
  lines.push(`Student: ${[p.firstName, p.lastName].filter(Boolean).join(' ') || '—'}. Country: ${p.country ?? '—'}.`);
  if (p.birthDate != null) lines.push(`Birth date: ${p.birthDate}.`);
  if (p.gpa != null) lines.push(`GPA: ${p.gpa}.`);
  if (p.gradeLevel) lines.push(`Grade level: ${p.gradeLevel}.`);
  if (p.languageLevel) lines.push(`Language level: ${p.languageLevel}.`);
  if (p.bio) lines.push(`Bio: ${String(p.bio).slice(0, 300)}.`);
  if (p.portfolioCompletionPercent != null) {
    lines.push(`Profile completion: ${p.portfolioCompletionPercent}%.`);
    const pct = Number(p.portfolioCompletionPercent);
    if (pct < 70) lines.push('Consider suggesting once that they complete their profile at /student/profile (completion under 70%).');
  }
  if (preferredCountries.length > 0) lines.push(`Preferred countries: ${preferredCountries.join(', ')}.`);
  const hasNoApplications = !Array.isArray(interests) || interests.length === 0;
  const hasRecommendations = Array.isArray(recommendations) && recommendations.length > 0;
  if (hasNoApplications && hasRecommendations) lines.push('Student has no applications yet but has recommendations; consider suggesting they view recommendations and apply at /student/universities.');
  lines.push('');
  lines.push('Use this data to help the student fill in missing info, find the right sections, or explain what to add. Do not invent data; suggest they complete their profile where relevant. When asked which universities exist, use ONLY the platform universities list below or suggest opening /student/universities.');
  lines.push('');
  const deadlinesFiltered = (nearestDeadlines as { deadline?: Date; name?: string; universityId?: { universityName?: string; verified?: boolean } }[]).filter(
    (d) => d.universityId && (d.universityId as { verified?: boolean }).verified
  );
  if (deadlinesFiltered.length > 0) {
    lines.push('Nearest scholarship deadlines (verified universities):');
    deadlinesFiltered.forEach((d) => {
      const uniName = (d.universityId as { universityName?: string })?.universityName ?? '—';
      const dateStr = d.deadline ? new Date(d.deadline).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
      lines.push(`- ${uniName}: ${d.name ?? '—'} — ${dateStr}`);
    });
    lines.push('');
  }
  lines.push('Platform universities (verified) by country:');
  (universitiesByCountry as { _id: string | null; count: number }[]).forEach((row) => {
    const country = row._id ?? '—';
    lines.push(`- ${country}: ${row.count} university(ies)`);
  });
  lines.push('');
  lines.push('Platform universities list (name, country, city):');
  (universityList as { universityName?: string; country?: string; city?: string }[]).forEach((u) => {
    const name = u.universityName ?? '—';
    const country = u.country ?? '—';
    const city = u.city ? `, ${u.city}` : '';
    lines.push(`- ${name} (${country}${city})`);
  });
  lines.push('');
  lines.push('Top recommendations:');
  recommendations.forEach((r: unknown) => {
    const rr = r as {
      universityId?: { universityName: string; country?: string; city?: string };
      matchScore: number;
      breakdown?: Record<string, number>;
    };
    const uni = rr.universityId;
    const name = uni ? uni.universityName : '—';
    const country = uni && uni.country != null ? uni.country : '—';
    let recLine = `- ${name} (${country}): match ${Math.round(rr.matchScore * 100)}%`;
    if (rr.breakdown && typeof rr.breakdown === 'object') {
      const parts: string[] = [];
      if (rr.breakdown.fieldMatch != null) parts.push(`field ${Math.round(rr.breakdown.fieldMatch * 100)}%`);
      if (rr.breakdown.language != null) parts.push(`language ${Math.round(rr.breakdown.language * 100)}%`);
      if (rr.breakdown.scholarshipFit != null) parts.push(`scholarship ${Math.round(rr.breakdown.scholarshipFit * 100)}%`);
      if (rr.breakdown.location != null) parts.push(`location ${Math.round(rr.breakdown.location * 100)}%`);
      if (parts.length > 0) recLine += ` (${parts.join(', ')})`;
    }
    lines.push(recLine);
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

  const [byStatusAgg, scholarships, recs, studentsByCountry] = await Promise.all([
    Interest.aggregate([{ $match: { universityId: profile._id } }, { $group: { _id: '$status', _count: { $sum: 1 } } }]),
    Scholarship.find({ universityId: profile._id }).select('name coveragePercent remainingSlots').lean(),
    Recommendation.find({ universityId: profile._id })
      .sort({ matchScore: -1 })
      .limit(5)
      .populate('studentId', 'firstName lastName gpa country')
      .lean(),
    StudentProfile.aggregate([
      { $match: { country: { $exists: true, $nin: [null, ''] } } },
      { $group: { _id: '$country', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
  ]);

  const lines: string[] = [];
  const p = profile as Record<string, unknown>;
  lines.push(`University: ${p.universityName}. Country: ${p.country ?? '—'}, City: ${p.city ?? '—'}.`);
  if (p.tagline) lines.push(`Tagline: ${p.tagline}.`);
  if (p.description) lines.push(`Description: ${String(p.description).slice(0, 400)}.`);
  if (p.studentCount != null) lines.push(`Student count: ${p.studentCount}.`);
  if (p.verified != null) lines.push(`Verified: ${p.verified}.`);
  lines.push('');
  lines.push('Use this data to help the university complete their profile or explain where to edit information. When asked about students on the platform, use only the aggregates below or suggest opening /university/students and search.');
  lines.push('');
  lines.push('Students on platform by country (for reference):');
  (studentsByCountry as { _id: string; count: number }[]).forEach((row) => {
    lines.push(`- ${row._id}: ${row.count} student(s)`);
  });
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
    const rr = r as {
      studentId?: { firstName?: string; lastName?: string; gpa?: number; country?: string };
      matchScore: number;
      breakdown?: Record<string, number>;
    };
    const student = rr.studentId;
    const name = student ? [student.firstName, student.lastName].filter(Boolean).join(' ') || '—' : '—';
    const gpa = student?.gpa ?? '—';
    const country = student?.country ?? '—';
    let recLine = `- ${name}, GPA: ${gpa}, Country: ${country}, match ${Math.round(rr.matchScore * 100)}%`;
    if (rr.breakdown && typeof rr.breakdown === 'object') {
      const parts: string[] = [];
      if (rr.breakdown.fieldMatch != null) parts.push(`field ${Math.round(rr.breakdown.fieldMatch * 100)}%`);
      if (rr.breakdown.gpa != null) parts.push(`GPA fit ${Math.round(rr.breakdown.gpa * 100)}%`);
      if (rr.breakdown.language != null) parts.push(`language ${Math.round(rr.breakdown.language * 100)}%`);
      if (parts.length > 0) recLine += ` (${parts.join(', ')})`;
    }
    lines.push(recLine);
  });
  return lines.join('\n');
}
