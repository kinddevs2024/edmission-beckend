export type Role =
  | 'student'
  | 'university'
  | 'university_multi_manager'
  | 'multi_university_admin'
  | 'admin'
  | 'student_admin'
  | 'school_counsellor'
  | 'counsellor_coordinator'
  | 'manager';

export const ROLES: Role[] = [
  'student',
  'university',
  'university_multi_manager',
  'multi_university_admin',
  'admin',
  'student_admin',
  'school_counsellor',
  'counsellor_coordinator',
  'manager',
];

export const UNIVERSITY_LIKE_ROLES: Role[] = [
  'university',
  'university_multi_manager',
  'multi_university_admin',
];

export function isUniversityLikeRole(role: Role | string | null | undefined): role is Extract<Role, 'university' | 'university_multi_manager' | 'multi_university_admin'> {
  return role === 'university' || role === 'university_multi_manager' || role === 'multi_university_admin';
}
