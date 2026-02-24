import { prisma } from '../config/database';
import type { Role } from '@prisma/client';

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
  const profile = await prisma.studentProfile.findFirst({
    where: { userId },
    include: { user: { select: { email: true } } },
  });
  if (!profile) return 'Student profile not found.';

  const [recommendations, offers, interests] = await Promise.all([
    prisma.recommendation.findMany({
      where: { studentId: profile.id },
      orderBy: { matchScore: 'desc' },
      take: 5,
      include: { university: { select: { universityName: true, country: true } } },
    }),
    prisma.offer.findMany({
      where: { studentId: profile.id },
      include: {
        university: { select: { universityName: true } },
        scholarship: { select: { name: true, coveragePercent: true } },
      },
    }),
    prisma.interest.findMany({
      where: { studentId: profile.id },
      include: { university: { select: { universityName: true } } },
    }),
  ]);

  const lines: string[] = [];
  lines.push(`Student: ${profile.firstName ?? ''} ${profile.lastName ?? ''}. Country: ${profile.country ?? '—'}.`);
  if (profile.gpa != null) lines.push(`GPA: ${profile.gpa}.`);
  if (profile.gradeLevel) lines.push(`Grade level: ${profile.gradeLevel}.`);
  if (profile.languageLevel) lines.push(`Language level: ${profile.languageLevel}.`);
  lines.push('');
  lines.push('Top recommendations:');
  recommendations.forEach((r) => {
    lines.push(`- ${r.university.universityName} (${r.university.country ?? '—'}): match ${Math.round((r.matchScore as number) * 100)}%`);
  });
  lines.push('');
  lines.push('Offers:');
  offers.forEach((o) => {
    lines.push(`- ${o.university.universityName}${o.scholarship ? `, ${o.scholarship.name} (${o.scholarship.coveragePercent}%)` : ''}`);
  });
  lines.push('');
  lines.push('Applications (interests):');
  interests.forEach((i) => {
    lines.push(`- ${i.university.universityName}: ${i.status}`);
  });
  return lines.join('\n');
}

async function buildUniversityContext(userId: string): Promise<string> {
  const profile = await prisma.universityProfile.findFirst({
    where: { userId },
  });
  if (!profile) return 'University profile not found.';

  const [byStatus, scholarships, recs] = await Promise.all([
    prisma.interest.groupBy({
      by: ['status'],
      where: { universityId: profile.id },
      _count: true,
    }),
    prisma.scholarship.findMany({
      where: { universityId: profile.id },
      select: { name: true, coveragePercent: true, remainingSlots: true },
    }),
    prisma.recommendation.findMany({
      where: { universityId: profile.id },
      orderBy: { matchScore: 'desc' },
      take: 5,
      include: { student: { select: { firstName: true, lastName: true, gpa: true, country: true } } },
    }),
  ]);

  const lines: string[] = [];
  lines.push(`University: ${profile.universityName}. Country: ${profile.country ?? '—'}, City: ${profile.city ?? '—'}.`);
  lines.push('');
  lines.push('Pipeline (applications by status):');
  byStatus.forEach((s) => {
    lines.push(`- ${s.status}: ${s._count}`);
  });
  lines.push('');
  lines.push('Scholarships:');
  scholarships.forEach((s) => {
    lines.push(`- ${s.name}: ${s.coveragePercent}% coverage, ${s.remainingSlots} slots left`);
  });
  lines.push('');
  lines.push('Top recommended students:');
  recs.forEach((r) => {
    const name = [r.student.firstName, r.student.lastName].filter(Boolean).join(' ') || '—';
    lines.push(`- ${name}, GPA: ${r.student.gpa ?? '—'}, Country: ${r.student.country ?? '—'}, match ${Math.round((r.matchScore as number) * 100)}%`);
  });
  return lines.join('\n');
}
