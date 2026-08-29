export type StudentLevelId = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface StudentLevelStats {
  profileCompletionPercent: number;
  offersCount: number;
  grantsCount: number;
}
export interface StudentLevelState {
  level: StudentLevelId;
  levelRank: number;
  nextLevel: StudentLevelId | null;
  progressPercent: number;
  nextMilestone: string;
}

export const STUDENT_LEVEL_CRITERIA = {
  silverProfileCompletion: 75,
  goldOffers: 3,
  platinumOffers: 10,
  platinumGrants: 2,
  grantCoveragePercent: 50,
} as const;

const LEVEL_RANK: Record<StudentLevelId, number> = {
  bronze: 1,
  silver: 2,
  gold: 3,
  platinum: 4,
};

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function resolveStudentLevel(stats: StudentLevelStats): StudentLevelState {
  const profileCompletionPercent = clampPercent(stats.profileCompletionPercent);
  const offersCount = Math.max(0, Math.floor(stats.offersCount));
  const grantsCount = Math.max(0, Math.floor(stats.grantsCount));

  if (offersCount >= STUDENT_LEVEL_CRITERIA.platinumOffers || grantsCount >= STUDENT_LEVEL_CRITERIA.platinumGrants) {
    return {
      level: 'platinum',
      levelRank: LEVEL_RANK.platinum,
      nextLevel: null,
      progressPercent: 100,
      nextMilestone: 'Top level unlocked. Keep building your academic story.',
    };
  }

  if (offersCount >= STUDENT_LEVEL_CRITERIA.goldOffers) {
    const offerProgress = (offersCount / STUDENT_LEVEL_CRITERIA.platinumOffers) * 100;
    const grantProgress = (grantsCount / STUDENT_LEVEL_CRITERIA.platinumGrants) * 100;
    return {
      level: 'gold',
      levelRank: LEVEL_RANK.gold,
      nextLevel: 'platinum',
      progressPercent: clampPercent(Math.max(offerProgress, grantProgress)),
      nextMilestone: `${Math.max(0, STUDENT_LEVEL_CRITERIA.platinumOffers - offersCount)} more offers or ${Math.max(0, STUDENT_LEVEL_CRITERIA.platinumGrants - grantsCount)} more grants to reach Platinum.`,
    };
  }

  if (profileCompletionPercent >= STUDENT_LEVEL_CRITERIA.silverProfileCompletion) {
    return {
      level: 'silver',
      levelRank: LEVEL_RANK.silver,
      nextLevel: 'gold',
      progressPercent: clampPercent((offersCount / STUDENT_LEVEL_CRITERIA.goldOffers) * 100),
      nextMilestone: `${Math.max(0, STUDENT_LEVEL_CRITERIA.goldOffers - offersCount)} more offers to reach Gold.`,
    };
  }

  return {
    level: 'bronze',
    levelRank: LEVEL_RANK.bronze,
    nextLevel: 'silver',
    progressPercent: clampPercent((profileCompletionPercent / STUDENT_LEVEL_CRITERIA.silverProfileCompletion) * 100),
    nextMilestone: `${Math.max(0, STUDENT_LEVEL_CRITERIA.silverProfileCompletion - profileCompletionPercent)}% more certificate progress to reach Silver.`,
  };
}
