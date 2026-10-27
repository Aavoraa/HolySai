import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

const JobCardsPage = page(() => import('./JobCardsPage'));
const DepartmentsPage = page(() => import('./DepartmentsPage'));

/** Job Cards screens; the API enforces the same permissions and record visibility. */
export const routes: AppRoute[] = [
  { path: '/job-cards', perm: ['jobcards.use', 'jobcards.manage'], element: <JobCardsPage /> },
  { path: '/departments', perm: ['jobcards.manage'], element: <DepartmentsPage /> },
];
