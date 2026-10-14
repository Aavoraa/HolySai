import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

/**
 * Admissions & CRM screens. Each route declares the permissions that may open it (any of);
 * the API enforces the same rule. Pages are lazy-loaded.
 */
const AdmissionsDashboardPage = page(() => import('./AdmissionsDashboardPage'));
const LeadsPage = page(() => import('./LeadsPage'));
const EnquiriesPage = page(() => import('./EnquiriesPage'));
const PipelinePage = page(() => import('./PipelinePage'));
const ApplicationsPage = page(() => import('./ApplicationsPage'));
const VisitsPage = page(() => import('./VisitsPage'));
const ConversionPage = page(() => import('./ConversionPage'));
const ReferralsPage = page(() => import('./ReferralsPage'));
const AlumniPage = page(() => import('./AlumniPage'));
const VendorsPage = page(() => import('./VendorsPage'));

const ADMISSIONS = ['admissions.read'];
const CRM = ['crm.read'];

export const routes: AppRoute[] = [
  { path: '/admissions', perm: ADMISSIONS, element: <AdmissionsDashboardPage /> },
  { path: '/leads', perm: ADMISSIONS, element: <LeadsPage /> },
  { path: '/enquiries', perm: ADMISSIONS, element: <EnquiriesPage /> },
  { path: '/pipeline', perm: ADMISSIONS, element: <PipelinePage /> },
  { path: '/applications', perm: ADMISSIONS, element: <ApplicationsPage /> },
  { path: '/visits', perm: ADMISSIONS, element: <VisitsPage /> },
  { path: '/conversion', perm: ADMISSIONS, element: <ConversionPage /> },
  { path: '/referrals', perm: ADMISSIONS, element: <ReferralsPage /> },
  { path: '/alumni', perm: CRM, element: <AlumniPage /> },
  { path: '/vendors', perm: CRM, element: <VendorsPage /> },
];
