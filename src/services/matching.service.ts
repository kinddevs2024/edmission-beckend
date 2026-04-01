import { StudentProfile, UniversityProfile, Program, Scholarship, Recommendation } from '../models';

export interface MatchBreakdown {
  fieldMatch: number;
  gpa: number;
  language: number;
  tuitionFit: number;
  scholarshipFit: number;
  location: number;
  criteriaMatch: number;
  criteriaOverlap?: { skills: number; interests: number; hobbies: number };
}

export interface MatchComputation {
  score: number;
  breakdown: MatchBreakdown;
  isSuitable: boolean;
  reasons: string[];
}

const WEIGHTS = {
  fieldMatch: 0.2,
  gpa: 0.15,
  language: 0.1,
  tuitionFit: 0.15,
  scholarshipFit: 0.1,
  location: 0.1,
  criteriaMatch: 0.2,
};

function normalizeGpa(gpa: number | null | undefined): number {
  if (gpa == null) return 0.5;
  if (gpa <= 0) return 0;
  if (gpa >= 4) return 1;
  return gpa / 4;
}

function overlapScore(arr1: string[] | undefined, arr2: string[] | undefined): number {
  if (!arr1?.length || !arr2?.length) return 0.5;
  const set2 = new Set(arr2);
  const match = arr1.filter((s) => set2.has(s)).length;
  return Math.min(1, 0.3 + 0.7 * (match / Math.max(arr1.length, arr2.length)));
}

const CEFR_RANK: Record<string, number> = {
  a1: 1,
  a2: 2,
  b1: 3,
  b2: 4,
  c1: 5,
  c2: 6,
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStudentLanguageRank(student: {
  languageLevel?: string | null;
  languages?: Array<{ language?: string | null; level?: string | null }> | null;
}): number | null {
  const candidates = [
    ...(Array.isArray(student.languages) ? student.languages.map((entry) => entry?.level ?? '') : []),
    student.languageLevel ?? '',
  ];
  let best: number | null = null;
  for (const candidate of candidates) {
    const raw = normalizeText(candidate);
    if (!raw) continue;
    const cefr = raw.match(/\b(a1|a2|b1|b2|c1|c2)\b/);
    if (cefr) {
      const rank = CEFR_RANK[cefr[1]];
      best = best == null ? rank : Math.max(best, rank);
      continue;
    }
    if (raw.includes('ielts')) {
      const number = toNumber(raw.replace(/[^\d.]/g, ''));
      if (number != null) {
        const rank = number >= 7.5 ? 6 : number >= 6.5 ? 5 : number >= 5.5 ? 4 : number >= 4.5 ? 3 : 2;
        best = best == null ? rank : Math.max(best, rank);
      }
      continue;
    }
    const directNumber = toNumber(raw.replace(/[^\d.]/g, ''));
    if (directNumber != null && directNumber <= 9) {
      const rank = directNumber >= 7.5 ? 6 : directNumber >= 6.5 ? 5 : directNumber >= 5.5 ? 4 : directNumber >= 4.5 ? 3 : 2;
      best = best == null ? rank : Math.max(best, rank);
    }
  }
  return best;
}

function parseUniversityLanguageRequirementRank(input: unknown): number | null {
  const raw = normalizeText(input);
  if (!raw) return null;
  const cefr = raw.match(/\b(a1|a2|b1|b2|c1|c2)\b/);
  if (cefr) return CEFR_RANK[cefr[1]];
  if (raw.includes('ielts')) {
    const number = toNumber(raw.replace(/[^\d.]/g, ''));
    if (number == null) return null;
    return number >= 7.5 ? 6 : number >= 6.5 ? 5 : number >= 5.5 ? 4 : number >= 4.5 ? 3 : 2;
  }
  const number = toNumber(raw.replace(/[^\d.]/g, ''));
  if (number != null && number <= 9) {
    return number >= 7.5 ? 6 : number >= 6.5 ? 5 : number >= 5.5 ? 4 : number >= 4.5 ? 3 : 2;
  }
  return null;
}

function degreeMatches(
  targetDegreeLevel: string | null | undefined,
  programs: Array<{ degreeLevel?: string | null; degree?: string | null }>
): boolean {
  const target = normalizeText(targetDegreeLevel);
  if (!target || programs.length === 0) return true;
  return programs.some((program) => {
    const value = normalizeText(program.degreeLevel ?? program.degree);
    return value.includes(target);
  });
}

function budgetScore(
  budgetAmount: number | null | undefined,
  programs: Array<{ tuitionFee?: number | null }>,
  tuitionPrice?: number | null
): { score: number; suitable: boolean } {
  const budget = budgetAmount ?? null;
  if (budget == null || budget <= 0) return { score: 0.6, suitable: true };
  const candidateTuitions = programs
    .map((program) => program.tuitionFee)
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  const minTuition =
    candidateTuitions.length > 0
      ? Math.min(...candidateTuitions)
      : tuitionPrice != null && Number.isFinite(tuitionPrice) && tuitionPrice > 0
        ? tuitionPrice
        : null;
  if (minTuition == null) return { score: 0.5, suitable: true };
  if (minTuition <= budget) return { score: 1, suitable: true };
  if (minTuition <= budget * 1.15) return { score: 0.7, suitable: true };
  if (minTuition <= budget * 1.35) return { score: 0.35, suitable: false };
  return { score: 0.1, suitable: false };
}

function fieldFit(
  interestedFaculties: string[] | undefined,
  university: { facultyCodes?: string[]; programs: Array<{ field: string }> }
): { score: number; suitable: boolean } {
  const normalizedStudentFields = (interestedFaculties ?? []).map((value) => normalizeText(value)).filter(Boolean);
  if (normalizedStudentFields.length === 0) return { score: 0.65, suitable: true };
  const normalizedUniversityFields = [
    ...((university.facultyCodes ?? []).map((value) => normalizeText(value))),
    ...university.programs.map((program) => normalizeText(program.field)),
  ].filter(Boolean);
  if (normalizedUniversityFields.length === 0) return { score: 0.25, suitable: false };
  const overlap = normalizedStudentFields.filter((field) =>
    normalizedUniversityFields.some((candidate) => candidate.includes(field) || field.includes(candidate))
  );
  if (overlap.length === 0) return { score: 0.15, suitable: false };
  return { score: Math.min(1, 0.45 + overlap.length / normalizedStudentFields.length), suitable: true };
}

export function calculateMatchScore(
  student: {
    gpa?: number | null;
    country?: string | null;
    languageLevel?: string | null;
    languages?: Array<{ language?: string | null; level?: string | null }> | null;
    gradeLevel?: string | null;
    preferredCountries?: string[] | null;
    interestedFaculties?: string[] | null;
    budgetAmount?: number | null;
    targetDegreeLevel?: string | null;
    skills?: string[];
    interests?: string[];
    hobbies?: string[];
  },
  university: {
    country?: string | null;
    city?: string | null;
    facultyCodes?: string[] | null;
    minLanguageLevel?: string | null;
    tuitionPrice?: number | null;
    programs: Array<{ field: string; language?: string | null; tuitionFee?: number | null; degreeLevel?: string | null; degree?: string | null; entryRequirements?: string | null }>;
    scholarships: Array<{ eligibility?: string | null }>;
    preferredSkills?: string[];
    preferredInterests?: string[];
  }
): MatchComputation {
  const reasons: string[] = [];
  const fieldFitResult = fieldFit(student.interestedFaculties ?? undefined, {
    facultyCodes: university.facultyCodes ?? undefined,
    programs: university.programs,
  });
  const fieldMatch = fieldFitResult.score;

  const gpa = normalizeGpa(student.gpa ?? null);

  let language = 0.6;
  const studentLanguageRank = parseStudentLanguageRank(student);
  const universityLanguageRank =
    parseUniversityLanguageRequirementRank(university.minLanguageLevel) ??
    university.programs
      .map((program) => parseUniversityLanguageRequirementRank(program.entryRequirements))
      .find((value) => value != null) ??
    null;
  if (studentLanguageRank != null && universityLanguageRank != null) {
    if (studentLanguageRank >= universityLanguageRank) {
      language = Math.min(1, 0.7 + (studentLanguageRank - universityLanguageRank) * 0.08);
    } else {
      language = Math.max(0.1, 0.45 - (universityLanguageRank - studentLanguageRank) * 0.18);
      reasons.push('language');
    }
  }

  const tuitionResult = budgetScore(student.budgetAmount, university.programs, university.tuitionPrice);
  const tuitionFit = tuitionResult.score;

  let scholarshipFit = 0;
  if (university.scholarships.length) {
    scholarshipFit = 0.5 + 0.5 * Math.min(1, university.scholarships.length / 2);
  } else {
    scholarshipFit = 0.3;
  }

  let location = 0.5;
  const preferredCountries = (student.preferredCountries ?? []).map((value) => normalizeText(value)).filter(Boolean);
  const universityCountry = normalizeText(university.country);
  const studentCountry = normalizeText(student.country);
  if (preferredCountries.length > 0 && universityCountry) {
    location = preferredCountries.includes(universityCountry) ? 1 : 0.25;
    if (location < 0.3) reasons.push('country');
  } else if (studentCountry && universityCountry && studentCountry === universityCountry) {
    location = 1;
  }

  const programFields = university.programs.map((p) => (p.field ?? '').toLowerCase()).filter(Boolean);
  const skillOverlap = programFields.length
    ? overlapScore(student.skills, programFields)
    : overlapScore(student.skills, university.preferredSkills);
  const interestOverlap = overlapScore(student.interests, university.preferredInterests);
  const hobbyOverlap = overlapScore(student.hobbies, university.preferredInterests);
  const criteriaOverlap = { skills: skillOverlap, interests: interestOverlap, hobbies: hobbyOverlap };
  const criteriaMatch = (skillOverlap + interestOverlap + hobbyOverlap) / 3;
  const degreeSuitable = degreeMatches(student.targetDegreeLevel, university.programs);
  if (!degreeSuitable) reasons.push('degree');
  if (!fieldFitResult.suitable) reasons.push('faculty');
  if (!tuitionResult.suitable) reasons.push('budget');

  const score =
    WEIGHTS.fieldMatch * fieldMatch +
    WEIGHTS.gpa * gpa +
    WEIGHTS.language * language +
    WEIGHTS.tuitionFit * tuitionFit +
    WEIGHTS.scholarshipFit * scholarshipFit +
    WEIGHTS.location * location +
    WEIGHTS.criteriaMatch * criteriaMatch;

  const breakdown: MatchBreakdown = {
    fieldMatch,
    gpa,
    language,
    tuitionFit,
    scholarshipFit,
    location,
    criteriaMatch,
    criteriaOverlap,
  };

  const isSuitable =
    fieldFitResult.suitable &&
    tuitionResult.suitable &&
    degreeSuitable &&
    !reasons.includes('country') &&
    !reasons.includes('language') &&
    Math.min(1, Math.max(0, score)) >= 0.42;

  return { score: Math.min(1, Math.max(0, score)), breakdown, isSuitable, reasons };
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
