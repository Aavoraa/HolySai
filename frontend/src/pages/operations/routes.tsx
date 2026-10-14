import { page } from '@/lib/page';
import type { AppRoute } from '../registry';

const AssetsPage = page(() => import('./AssetsPage'));
const FacilitiesPage = page(() => import('./FacilitiesPage'));
const MaintenancePage = page(() => import('./MaintenancePage'));
const InventoryPage = page(() => import('./InventoryPage'));
const DocumentsPage = page(() => import('./DocumentsPage'));
const CertificatesPage = page(() => import('./CertificatesPage'));
const CompliancePage = page(() => import('./CompliancePage'));
const AuditPage = page(() => import('./AuditPage'));

/**
 * Operations screens. Each route declares the permissions that may open it (any of);
 * the API enforces the same rule.
 */
export const routes: AppRoute[] = [
  { path: '/assets', perm: ['operations.read'], element: <AssetsPage /> },
  { path: '/facilities', perm: ['operations.read'], element: <FacilitiesPage /> },
  { path: '/maintenance', perm: ['operations.read'], element: <MaintenancePage /> },
  { path: '/inventory', perm: ['operations.read'], element: <InventoryPage /> },
  { path: '/documents', perm: ['documents.read'], element: <DocumentsPage /> },
  { path: '/certificates', perm: ['documents.read'], element: <CertificatesPage /> },
  { path: '/compliance', perm: ['operations.read'], element: <CompliancePage /> },
  { path: '/audit', perm: ['audit.read'], element: <AuditPage /> },
];
