import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

/**
 * intelligence screens. Each route declares the permissions that may open it (any of);
 * the API enforces the same rule. Pages are lazy-loaded.
 */
const EarlyWarningPage = page(() => import('./EarlyWarningPage'));
const TalentPage = page(() => import('./TalentPage'));
const WellbeingPage = page(() => import('./WellbeingPage'));
const PortfolioPage = page(() => import('./PortfolioPage'));
const CopilotPage = page(() => import('./CopilotPage'));
const KnowledgePage = page(() => import('./KnowledgePage'));
const AnalyticsPage = page(() => import('./AnalyticsPage'));
const ReportsPage = page(() => import('./ReportsPage'));
const DayInLifePage = page(() => import('./DayInLifePage'));
const AutomationsPage = page(() => import('./AutomationsPage'));
const WhatsappAiPage = page(() => import('./WhatsappAiPage'));
const DesignSystemPage = page(() => import('./DesignSystemPage'));

const STAFF_STUDENTS = ['students.read', 'students.read_assigned'];

export const routes: AppRoute[] = [
  { path: '/early-warning', perm: ['earlywarning.read'], element: <EarlyWarningPage /> },
  { path: '/talent', perm: ['students.read', 'students.read_assigned', 'ai.use'], element: <TalentPage /> },
  { path: '/wellbeing', perm: STAFF_STUDENTS, element: <WellbeingPage /> },
  { path: '/portfolio', perm: STAFF_STUDENTS, element: <PortfolioPage /> },
  { path: '/copilot', perm: ['ai.use'], element: <CopilotPage /> },
  { path: '/knowledge-ai', perm: ['ai.use'], element: <KnowledgePage /> },
  { path: '/analytics', perm: ['reports.read'], element: <AnalyticsPage /> },
  { path: '/reports', perm: ['reports.read'], element: <ReportsPage /> },
  { path: '/day-in-life', perm: ['prototype.view'], element: <DayInLifePage /> },
  { path: '/automations', perm: ['prototype.view'], element: <AutomationsPage /> },
  { path: '/whatsapp-ai', perm: ['prototype.view'], element: <WhatsappAiPage /> },
  { path: '/design-system', perm: ['prototype.view'], element: <DesignSystemPage /> },
];
