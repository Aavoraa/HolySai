import { Navigate } from 'react-router-dom';
import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

const StudentsPage = page(() => import('./StudentsPage'));
const Student360Page = page(() => import('./Student360Page'));
const MyProfilePage = page(() => import('./MyProfilePage'));
const MyIdeasPage = page(() => import('./MyIdeasPage'));

const STAFF = ['students.read', 'students.read_assigned'];

export const routes: AppRoute[] = [
  { path: '/students', perm: STAFF, element: <StudentsPage /> },
  // The register is the Student 360 entry point; the old picker URL goes there.
  { path: '/student-360', perm: STAFF, element: <Navigate to="/students" replace /> },
  { path: '/student-360/:id', perm: STAFF, element: <Student360Page /> },
  { path: '/my-profile', perm: ['student_portal.use'], element: <MyProfilePage /> },
  { path: '/my-ideas', perm: ['student_portal.use'], element: <MyIdeasPage /> },
];
