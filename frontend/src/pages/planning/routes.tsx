import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

/** Budget & Planning and the Super Admin's central Approvals inbox. */
const BudgetPlanningPage = page(() => import('./BudgetPlanningPage'));
const ApprovalsPage = page(() => import('./ApprovalsPage'));

export const routes: AppRoute[] = [
  { path: '/budget-planning', perm: ['planning.read', 'approvals.decide'], element: <BudgetPlanningPage /> },
  { path: '/approvals', perm: ['approvals.decide'], element: <ApprovalsPage /> },
];
