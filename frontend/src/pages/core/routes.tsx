import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

const CommandCenterPage = page(() => import('./CommandCenterPage'));
const OwnerOverviewPage = page(() => import('./OwnerOverviewPage'));
const NotificationsPage = page(() => import('./NotificationsPage'));
const MyTasksPage = page(() => import('./MyTasksPage'));
const AccountPage = page(() => import('./AccountPage'));
const HelpPage = page(() => import('./HelpPage'));
const AdminUsersPage = page(() => import('./AdminUsersPage'));
const AdminSettingsPage = page(() => import('./AdminSettingsPage'));

export const routes: AppRoute[] = [
  { path: '/command-center', perm: ['students.read'], element: <CommandCenterPage /> },
  { path: '/overview', perm: ['finance.read', 'audit.read'], element: <OwnerOverviewPage /> },
  { path: '/notifications', element: <NotificationsPage /> },
  { path: '/my-tasks', element: <MyTasksPage /> },
  { path: '/account', element: <AccountPage /> },
  { path: '/help', element: <HelpPage /> },
  { path: '/admin/users', perm: ['users.manage'], element: <AdminUsersPage /> },
  { path: '/admin/settings', perm: ['settings.manage'], element: <AdminSettingsPage /> },
];
