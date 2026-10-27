import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

const ParentLogPage = page(() => import('./ParentLogPage'));

/** Parent & staff contact log. The API enforces the same permissions (and scopes teachers to their own contacts). */
export const routes: AppRoute[] = [
  { path: '/parent-log', perm: ['parentlog.read', 'parentlog.manage'], element: <ParentLogPage /> },
];
