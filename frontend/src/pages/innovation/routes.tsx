import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

const InnovationDashboardPage = page(() => import('./InnovationDashboardPage'));
const IdeasPage = page(() => import('./IdeasPage'));
const ProjectsPage = page(() => import('./ProjectsPage'));
const ProjectPage = page(() => import('./ProjectPage'));
const MentorsPage = page(() => import('./MentorsPage'));
const MilestonesPage = page(() => import('./MilestonesPage'));
const CompetitionsPage = page(() => import('./CompetitionsPage'));
const AchievementsPage = page(() => import('./AchievementsPage'));

const perm = ['innovation.read'];

/**
 * Student Innovation Lab screens. Teachers see only projects of students in their scope
 * (enforced by the API).
 */
export const routes: AppRoute[] = [
  { path: '/innovation', perm, element: <InnovationDashboardPage /> },
  { path: '/ideas', perm, element: <IdeasPage /> },
  { path: '/projects', perm, element: <ProjectsPage /> },
  { path: '/projects/:id', perm, element: <ProjectPage /> },
  { path: '/mentors', perm, element: <MentorsPage /> },
  { path: '/milestones', perm, element: <MilestonesPage /> },
  { path: '/competitions', perm, element: <CompetitionsPage /> },
  { path: '/achievements', perm, element: <AchievementsPage /> },
];
