import { lazy } from 'react';
import type { AppRoute } from '../registry';

const CommandCenterPage = lazy(() => import('./CommandCenterPage'));
const NotificationsPage = lazy(() => import('./NotificationsPage'));
const MyTasksPage = lazy(() => import('./MyTasksPage'));
const AccountPage = lazy(() => import('./AccountPage'));
const HelpPage = lazy(() => import('./HelpPage'));
const AdminUsersPage = lazy(() => import('./AdminUsersPage'));
const AdminSettingsPage = lazy(() => import('./AdminSettingsPage'));

export const routes: AppRoute[] = [
  { path: '/command-center', perm: ['students.read'], element: <CommandCenterPage /> },
  { path: '/notifications', element: <NotificationsPage /> },
  { path: '/my-tasks', element: <MyTasksPage /> },
  { path: '/account', element: <AccountPage /> },
  { path: '/help', element: <HelpPage /> },
  { path: '/admin/users', perm: ['users.manage'], element: <AdminUsersPage /> },
  { path: '/admin/settings', perm: ['settings.manage'], element: <AdminSettingsPage /> },
];
