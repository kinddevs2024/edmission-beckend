import { StudentProfile, UniversityProfile, Program, Scholarship, Recommendation } from '../models';

export interface MatchBreakdown {
  fieldMatch: number;
  gpa: number;
  language: number;
  tuitionFit: number;
  scholarshipFit: number;
  location: number;
}

const WEIGHTS = {
  fieldMatch: 0.25,
  gpa: 0.2,
  language: 0.15,
  tuitionFit: 0.2,
  scholarshipFit: 0.1,
  location: 0.1,
};

function normalizeGpa(gpa: number | null | undefined): number {
  if (gpa == null) return 0.5;
  if (gpa <= 0) return 0;
  if (gpa >= 4) return 1;
  return gpa / 4;
}

export function calculateMatchScore(
  student: {
    gpa?: number | null;
    country?: string | null;
    languageLevel?: string | null;
    gradeLevel?: string | null;
  },
  university: {
    country?: string | null;
    city?: string | null;
    programs: Array<{ field: string; language?: string | null; tuitionFee?: number | null }>;
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
  const student = await StudentProfile.findById(studentId).lean();
  if (!student) return;

  const universities = await UniversityProfile.find({ verified: true }).lean();
  const uniIds = universities.map((u) => (u as { _id: unknown })._id);

  const programsMap: Record<string, { field: string; language?: string; tuitionFee?: number }[]> = {};
  const programs = await Program.find({ universityId: { $in: uniIds } }).lean();
  for (const p of programs) {
    const uid = String((p as { universityId: unknown }).universityId);
    if (!programsMap[uid]) programsMap[uid] = [];
    programsMap[uid].push({
      field: (p as { field: string }).field,
      language: (p as { language?: string }).language,
      tuitionFee: (p as { tuitionFee?: number }).tuitionFee,
    });
  }

  const scholarshipsMap: Record<string, { eligibility?: string }[]> = {};
  const scholarships = await Scholarship.find({ universityId: { $in: uniIds } }).lean();
  for (const s of scholarships) {
    const uid = String((s as { universityId: unknown }).universityId);
    if (!scholarshipsMap[uid]) scholarshipsMap[uid] = [];
    scholarshipsMap[uid].push({ eligibility: (s as { eligibility?: string }).eligibility });
  }

  for (const uni of universities) {
    const id = String((uni as { _id: unknown })._id);
    const uniWithRelations = {
      ...uni,
      programs: programsMap[id] ?? [],
      scholarships: scholarshipsMap[id] ?? [],
    };
    const { score, breakdown } = calculateMatchScore(student as Parameters<typeof calculateMatchScore>[0], uniWithRelations as Parameters<typeof calculateMatchScore>[1]);

    await Recommendation.findOneAndUpdate(
      { studentId, universityId: id },
      { matchScore: score, breakdown },
      { upsert: true }
    );
  }

  await StudentProfile.findByIdAndUpdate(studentId, { needsRecalculation: false });
}

export async function runRecommendationWorker(): Promise<number> {
  const students = await StudentProfile.find({ needsRecalculation: true }).limit(50).select('_id').lean();
  for (const s of students) {
    await recalculateForStudent(String((s as { _id: unknown })._id));
  }
  return students.length;
}
