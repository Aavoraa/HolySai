import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

/**
 * safety screens. Each route declares the permissions that may open it (any of);
 * the API enforces the same rule. Pages are lazy-loaded.
 */
const SmartGatePage = page(() => import('./SmartGatePage'));
const GateLogPage = page(() => import('./GateLogPage'));
const PickupPage = page(() => import('./PickupPage'));
const VisitorsPage = page(() => import('./VisitorsPage'));
const BusTrackingPage = page(() => import('./BusTrackingPage'));
const RoutesPage = page(() => import('./RoutesPage'));
const BoardingPage = page(() => import('./BoardingPage'));
const EmergencyPage = page(() => import('./EmergencyPage'));
const SafeguardingPage = page(() => import('./SafeguardingPage'));
const InfirmaryPage = page(() => import('./InfirmaryPage'));
const CounsellingPage = page(() => import('./CounsellingPage'));

export const routes: AppRoute[] = [
  { path: '/smart-gate', perm: ['safety.read'], element: <SmartGatePage /> },
  { path: '/gate-log', perm: ['safety.read'], element: <GateLogPage /> },
  { path: '/pickup', perm: ['safety.read'], element: <PickupPage /> },
  { path: '/visitors', perm: ['safety.read'], element: <VisitorsPage /> },
  { path: '/bus-tracking', perm: ['transport.read'], element: <BusTrackingPage /> },
  { path: '/routes', perm: ['transport.read'], element: <RoutesPage /> },
  { path: '/boarding', perm: ['transport.read'], element: <BoardingPage /> },
  { path: '/emergency', perm: ['safety.read'], element: <EmergencyPage /> },
  { path: '/safeguarding', perm: ['safety.read'], element: <SafeguardingPage /> },
  { path: '/infirmary', perm: ['safety.read'], element: <InfirmaryPage /> },
  { path: '/counselling', perm: ['safety.read'], element: <CounsellingPage /> },
];
