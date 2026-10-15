import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

const Parent360Page = page(() => import('./Parent360Page'));
const TrackChildPage = page(() => import('./Parent360Page').then((m) => ({ default: m.TrackChildPage })));

export const routes: AppRoute[] = [
  { path: '/parent-360', perm: ['parent_portal.use'], element: <Parent360Page /> },
  { path: '/parent-360/track/:studentId', perm: ['tracking.read_own_children'], element: <TrackChildPage /> },
];
