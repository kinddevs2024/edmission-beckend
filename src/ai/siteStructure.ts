/**
 * Text map of app routes per role for the AI assistant (site-aware prompts).
 * Paths and descriptions match the frontend Router so the assistant can say
 * "Open /student/profile and fill …" and explain what to do where.
 */

import type { Role } from '../types/role';

type RouteEntry = { path: string; description: string };

const STUDENT_ROUTES: RouteEntry[] = [
  { path: '/student/dashboard', description: 'Student dashboard and overview' },
  { path: '/student/profile', description: 'Edit profile, GPA, documents, personal info' },
  { path: '/student/universities', description: 'Explore and search universities' },
  { path: '/student/universities/:id', description: 'University detail and apply' },
  { path: '/student/applications', description: 'View and manage applications' },
  { path: '/student/documents', description: 'Upload and manage documents' },
  { path: '/student/schools', description: 'Linked schools and counsellors' },
  { path: '/student/offers', description: 'View offers from universities' },
  { path: '/student/compare', description: 'Compare universities or programs' },
  { path: '/student/chat', description: 'Chat with universities' },
  { path: '/student/ai', description: 'AI assistant (this chat)' },
  { path: '/profile', description: 'Account and notification settings' },
  { path: '/notifications', description: 'Notifications' },
  { path: '/payment', description: 'Payment and subscription' },
  { path: '/support', description: 'Support tickets' },
];

const UNIVERSITY_ROUTES: RouteEntry[] = [
  { path: '/university/select', description: 'Select or create university profile' },
  { path: '/university/pending', description: 'Pending verification status' },
  { path: '/university/onboarding', description: 'Complete university onboarding' },
  { path: '/university/profile', description: 'Edit university profile and info' },
  { path: '/university/dashboard', description: 'University dashboard' },
  { path: '/university/students', description: 'Discover and search students' },
  { path: '/university/students/:studentId', description: 'View student profile and application' },
  { path: '/university/pipeline', description: 'Application pipeline' },
  { path: '/university/scholarships', description: 'Manage scholarships' },
  { path: '/university/faculties', description: 'Manage faculties' },
  { path: '/university/analytics', description: 'Analytics and reports' },
  { path: '/university/chat', description: 'Chat with students' },
  { path: '/university/ai', description: 'AI assistant (this chat)' },
  { path: '/profile', description: 'Account and notification settings' },
  { path: '/notifications', description: 'Notifications' },
  { path: '/payment', description: 'Payment and subscription' },
  { path: '/support', description: 'Support tickets' },
];

const ADMIN_ROUTES: RouteEntry[] = [
  { path: '/admin/dashboard', description: 'Admin dashboard' },
  { path: '/admin/users', description: 'User management' },
  { path: '/admin/verification', description: 'Verification queue' },
  { path: '/admin/universities', description: 'Universities list and management' },
  { path: '/admin/university-requests', description: 'University join requests' },
  { path: '/admin/investors', description: 'Investors' },
  { path: '/admin/documents', description: 'Document management' },
  { path: '/admin/offers', description: 'Offers management' },
  { path: '/admin/interests', description: 'Interests' },
  { path: '/admin/chats', description: 'Chats overview' },
  { path: '/admin/scholarships', description: 'Scholarships management' },
  { path: '/admin/support', description: 'Support tickets' },
  { path: '/admin/logs', description: 'System logs' },
  { path: '/admin/health', description: 'System health' },
  { path: '/admin/settings', description: 'Admin settings' },
];

const SCHOOL_COUNSELLOR_ROUTES: RouteEntry[] = [
  { path: '/school/dashboard', description: 'School counsellor dashboard' },
  { path: '/school/my-school', description: 'School profile and settings' },
  { path: '/school/my-students', description: 'List of linked students' },
  { path: '/school/students/:studentId/profile', description: 'Student profile (counsellor view)' },
  { path: '/school/join-requests', description: 'Student join requests' },
  { path: '/profile', description: 'Account and notification settings' },
  { path: '/notifications', description: 'Notifications' },
  { path: '/support', description: 'Support tickets' },
];

function formatRoutes(entries: RouteEntry[]): string {
  return entries.map((e) => `${e.path} – ${e.description}`).join('\n');
}

/**
 * Returns a text "map" of app routes and short descriptions for the given role.
 * Append this to the system prompt so the assistant can refer to paths and explain where to go.
 */
export function getSiteStructure(role: Role): string {
  const title = 'App routes (you can tell the user to open these paths):';
  switch (role) {
    case 'student':
      return `${title}\n${formatRoutes(STUDENT_ROUTES)}`;
    case 'university':
      return `${title}\n${formatRoutes(UNIVERSITY_ROUTES)}`;
    case 'admin':
      return `${title}\n${formatRoutes(ADMIN_ROUTES)}`;
    case 'school_counsellor':
      return `${title}\n${formatRoutes(SCHOOL_COUNSELLOR_ROUTES)}`;
    default:
      return '';
  }
}
