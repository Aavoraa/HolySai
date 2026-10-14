import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

const StudentTrackingPage = page(() => import('./StudentTrackingPage'));
const DevicesPage = page(() => import('./DevicesPage'));
const DeviceAssignmentsPage = page(() => import('./DeviceAssignmentsPage'));
const PERM = ['tracking.read_all', 'tracking.read_assigned'];
const DEVICE_PERM = ['tracking.read_all', 'tracking.manage'];

export const routes: AppRoute[] = [
  { path: '/student-tracking', perm: PERM, element: <StudentTrackingPage /> },
  { path: '/student-tracking/:id', perm: PERM, element: <StudentTrackingPage /> },
  { path: '/gps-devices', perm: DEVICE_PERM, element: <DevicesPage /> },
  { path: '/device-assignments', perm: DEVICE_PERM, element: <DeviceAssignmentsPage /> },
];
