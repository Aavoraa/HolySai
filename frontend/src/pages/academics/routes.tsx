import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

/**
 * academics screens. Each route declares the permissions that may open it (any of);
 * the API enforces the same rule. Paths and permissions match layouts/nav.ts.
 */
const TeacherDashboardPage = page(() => import('./TeacherDashboardPage'));
const AttendancePage = page(() => import('./AttendancePage'));
const AcademicPerformancePage = page(() => import('./AcademicPerformancePage'));
const AssessmentsPage = page(() => import('./AssessmentsPage'));
const CurriculumPage = page(() => import('./CurriculumPage'));
const ClassesPage = page(() => import('./ClassesPage'));
const SubjectsPage = page(() => import('./SubjectsPage'));
const TimetablePage = page(() => import('./TimetablePage'));
const LessonPlansPage = page(() => import('./LessonPlansPage'));
const HomeworkPage = page(() => import('./HomeworkPage'));
const QuestionBankPage = page(() => import('./QuestionBankPage'));
const ReportCardsPage = page(() => import('./ReportCardsPage'));
const ObjectivesPage = page(() => import('./ObjectivesPage'));

export const routes: AppRoute[] = [
  { path: '/teacher', perm: ['attendance.mark'], element: <TeacherDashboardPage /> },
  { path: '/attendance', perm: ['attendance.read'], element: <AttendancePage /> },
  { path: '/academic-performance', perm: ['students.read', 'students.read_assigned'], element: <AcademicPerformancePage /> },
  { path: '/assessments', perm: ['academics.read'], element: <AssessmentsPage /> },
  { path: '/curriculum', perm: ['academics.read'], element: <CurriculumPage /> },
  { path: '/classes', perm: ['academics.read'], element: <ClassesPage /> },
  { path: '/subjects', perm: ['academics.read'], element: <SubjectsPage /> },
  { path: '/timetable', perm: ['academics.read'], element: <TimetablePage /> },
  { path: '/lesson-plans', perm: ['academics.read'], element: <LessonPlansPage /> },
  { path: '/homework', perm: ['academics.read'], element: <HomeworkPage /> },
  { path: '/question-bank', perm: ['academics.read'], element: <QuestionBankPage /> },
  { path: '/report-cards', perm: ['academics.read'], element: <ReportCardsPage /> },
  { path: '/objectives', perm: ['academics.read'], element: <ObjectivesPage /> },
];
