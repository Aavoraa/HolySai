import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

/**
 * Cambridge IGCSE syllabus (Grades 9–10) and the school grading scheme
 * (A* to G, U below G). Paths and permissions match layouts/nav.ts.
 */
const SyllabusPage = page(() => import('./SyllabusPage'));
const SyllabusDetailPage = page(() => import('./SyllabusDetailPage'));
const GradingPage = page(() => import('./GradingPage'));

export const routes: AppRoute[] = [
  { path: '/syllabus', perm: ['academics.read'], element: <SyllabusPage /> },
  { path: '/syllabus/:id', perm: ['academics.read'], element: <SyllabusDetailPage /> },
  { path: '/grading', perm: ['academics.read'], element: <GradingPage /> },
];
