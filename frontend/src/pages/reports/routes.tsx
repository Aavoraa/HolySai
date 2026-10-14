import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

/**
 * Report Centre — the administrator's reporting console. Gated on `users.manage`,
 * which only Super Admin and School Admin hold; the API enforces the same rule and
 * additionally reserves the System group for Super Admin.
 */
const ReportCenterPage = page(() => import('./ReportCenterPage'));
const ReportViewerPage = page(() => import('./ReportViewerPage'));

export const routes: AppRoute[] = [
  { path: '/admin/reports', perm: ['users.manage'], element: <ReportCenterPage /> },
  { path: '/admin/reports/:key', perm: ['users.manage'], element: <ReportViewerPage /> },
];
