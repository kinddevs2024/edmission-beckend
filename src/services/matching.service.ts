import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database';

const WEIGHTS = {
  fieldMatch: 0.25,
  gpa: 0.2,
  language: 0.15,
  tuitionFit: 0.2,
  scholarshipFit: 0.1,
  location: 0.1,
};

export interface MatchBreakdown {
  fieldMatch: number;
  gpa: number;
  language: number;
  tuitionFit: number;
  scholarshipFit: number;
  location: number;
}

function normalizeGpa(gpa: number | Decimal | null): number {
  if (gpa == null) return 0.5;
  const n = typeof gpa === 'object' && 'toNumber' in gpa ? (gpa as Decimal).toNumber() : Number(gpa);
  if (n <= 0) return 0;
  if (n >= 4) return 1;
  return n / 4;
}

export function calculateMatchScore(
  student: {
    gpa?: Decimal | null;
    country?: string | null;
    languageLevel?: string | null;
    gradeLevel?: string | null;
  },
  university: {
    country?: string | null;
    city?: string | null;
    programs: Array<{ field: string; language?: string | null; tuitionFee?: Decimal | null }>;
    scholarships: Array<{ eligibility?: string | null }>;
  }
): { score: number; breakdown: MatchBreakdown } {
  let fieldMatch = 0.5;
  if (university.programs.length) {
    fieldMatch = 0.5 + 0.5 * Math.min(1, university.programs.length / 3);
  }

  const gpa = normalizeGpa(student.gpa ?? null);

  let language = 0.5;
  const langLevel = (student.languageLevel ?? '').toLowerCase();
  const hasEn = university.programs.some((p) => (p.language ?? '').toLowerCase().includes('english'));
  if (hasEn && (langLevel.includes('eng') || langLevel.includes('b2') || langLevel.includes('c1'))) {
    language = 1;
  } else if (university.programs.some((p) => (p.language ?? '').toLowerCase().includes('russian')) && langLevel) {
    language = 0.8;
  }

  const tuitionFit = 0.7;

  let scholarshipFit = 0;
  if (university.scholarships.length) {
    scholarshipFit = 0.5 + 0.5 * Math.min(1, university.scholarships.length / 2);
  } else {
    scholarshipFit = 0.3;
  }

  let location = 0.5;
  if (student.country && university.country && student.country === university.country) {
    location = 1;
  }

  const score =
    WEIGHTS.fieldMatch * fieldMatch +
    WEIGHTS.gpa * gpa +
    WEIGHTS.language * language +
    WEIGHTS.tuitionFit * tuitionFit +
    WEIGHTS.scholarshipFit * scholarshipFit +
    WEIGHTS.location * location;

  const breakdown: MatchBreakdown = {
    fieldMatch,
    gpa,
    language,
    tuitionFit,
    scholarshipFit,
    location,
  };

  return { score: Math.min(1, Math.max(0, score)), breakdown };
}

export async function recalculateForStudent(studentId: string): Promise<void> {
  const student = await prisma.studentProfile.findUnique({
    where: { id: studentId },
  });
  if (!student) return;

  const universities = await prisma.universityProfile.findMany({
    where: { verified: true },
    include: {
      programs: true,
      scholarships: true,
    },
  });

  for (const uni of universities) {
    const { score, breakdown } = calculateMatchScore(student, uni);
    await prisma.recommendation.upsert({
      where: {
        studentId_universityId: { studentId, universityId: uni.id },
      },
      create: {
        studentId,
        universityId: uni.id,
        matchScore: score,
        breakdown: breakdown as object,
      },
      update: {
        matchScore: score,
        breakdown: breakdown as object,
      },
    });
  }

  await prisma.studentProfile.update({
    where: { id: studentId },
    data: { needsRecalculation: false },
  });
}

export async function runRecommendationWorker(): Promise<number> {
  const students = await prisma.studentProfile.findMany({
    where: { needsRecalculation: true },
    select: { id: true },
    take: 50,
  });
  for (const s of students) {
    await recalculateForStudent(s.id);
  }
  return students.length;
}
