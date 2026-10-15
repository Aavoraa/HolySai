import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

const StudentsPage = page(() => import('./StudentsPage'));
const Student360Page = page(() => import('./Student360Page'));
const MyProfilePage = page(() => import('./MyProfilePage'));
const MyIdeasPage = page(() => import('./MyIdeasPage'));

const STAFF = ['students.read', 'students.read_assigned'];

export const routes: AppRoute[] = [
  { path: '/students', perm: STAFF, element: <StudentsPage /> },
  { path: '/student-360', perm: STAFF, element: <Student360Page /> },
  { path: '/student-360/:id', perm: STAFF, element: <Student360Page /> },
  { path: '/my-profile', perm: ['student_portal.use'], element: <MyProfilePage /> },
  { path: '/my-ideas', perm: ['student_portal.use'], element: <MyIdeasPage /> },
];
