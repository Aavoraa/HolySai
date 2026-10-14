import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

const GroupDashboardPage = page(() => import('./GroupDashboardPage'));
const CampusComparisonPage = page(() => import('./CampusComparisonPage'));
const CampusesPage = page(() => import('./CampusesPage'));
const TransfersPage = page(() => import('./TransfersPage'));
const GroupPoliciesPage = page(() => import('./GroupPoliciesPage'));

/**
 * Group management (multi-campus) screens. The API enforces the same permissions.
 */
export const routes: AppRoute[] = [
  { path: '/group-dashboard', perm: ['dashboard.group'], element: <GroupDashboardPage /> },
  { path: '/campus-comparison', perm: ['group.read'], element: <CampusComparisonPage /> },
  { path: '/campuses', perm: ['group.read'], element: <CampusesPage /> },
  { path: '/transfers', perm: ['group.read'], element: <TransfersPage /> },
  { path: '/group-policies', perm: ['group.read'], element: <GroupPoliciesPage /> },
];
