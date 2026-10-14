import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

const ParentDirectoryPage = page(() => import('./ParentDirectoryPage'));
const ParentCommunicationPage = page(() => import('./ParentCommunicationPage'));
const PtmPage = page(() => import('./PtmPage'));
const CircularsPage = page(() => import('./CircularsPage'));
const OpCircularsPage = page(() => import('./OpCircularsPage'));
const EventsPage = page(() => import('./EventsPage'));
const AcknowledgementsPage = page(() => import('./AcknowledgementsPage'));

/**
 * parents-experience screens. Each route declares the permissions that may open it (any of);
 * the API enforces the same rule. Parent 360 (/parent-360) is owned by another module.
 */
export const routes: AppRoute[] = [
  { path: '/parent-directory', perm: ['parents.read'], element: <ParentDirectoryPage /> },
  { path: '/parent-communication', perm: ['communication.read'], element: <ParentCommunicationPage /> },
  { path: '/ptm', perm: ['communication.read'], element: <PtmPage /> },
  { path: '/circulars', perm: ['communication.read'], element: <CircularsPage /> },
  { path: '/op-circulars', perm: ['operations.read'], element: <OpCircularsPage /> },
  { path: '/events', perm: ['communication.read'], element: <EventsPage /> },
  { path: '/acknowledgements', perm: ['communication.read'], element: <AcknowledgementsPage /> },
];
