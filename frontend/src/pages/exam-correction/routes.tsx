import { lazy } from 'react';
import type { AppRoute } from '../registry';

/**
 * Paper Correction — AI marking of handwritten answer sheets (EXAM Vision service).
 * The API enforces the same permission and the service applies exam assignments.
 */
const ExamsPage = lazy(() => import('./ExamsPage'));
const ExamPage = lazy(() => import('./ExamPage'));
const SheetPage = lazy(() => import('./SheetPage'));
const AiSettingsPage = lazy(() => import('./AiSettingsPage'));

export const routes: AppRoute[] = [
  { path: '/paper-correction', perm: ['assessments.manage'], element: <ExamsPage /> },
  { path: '/paper-correction/exams/:id', perm: ['assessments.manage'], element: <ExamPage /> },
  { path: '/paper-correction/sheets/:id', perm: ['assessments.manage'], element: <SheetPage /> },
  { path: '/paper-correction/settings', perm: ['settings.manage'], element: <AiSettingsPage /> },
];
