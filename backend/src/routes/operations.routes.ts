import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAny, requirePermission } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { created, ok, paged } from '../utils/response.js';
import { ALL_PERMISSIONS } from '../config/rbac.js';
import * as ops from '../services/operations.service.js';
import * as rec from '../services/operations-records.service.js';
import * as val from '../validators/operations.validators.js';
import { assertDecider } from '../services/approvals-guard.js';

/**
 * Operations domain: assets, facilities, maintenance, inventory, school
 * documents, certificates, compliance calendar, audit-trail facets.
 * Mounted at /api behind authentication.
 */
const r = Router();
const READ = requirePermission('operations.read');
const MANAGE = requirePermission('operations.manage');
const DOC_READ = requirePermission('documents.read');
const DOC_MANAGE = requirePermission('documents.manage');
const SIGNED_IN = requireAny(...ALL_PERMISSIONS);
const id = validate(val.idParam, 'params');
const pid = (req: Request) => v<{ id: string }>(req, 'params').id;

// ---- Assets -----------------------------------------------------------------
r.get('/assets', READ, validate(val.assetListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await ops.listAssets(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Assets retrieved');
});
r.get('/assets/summary', READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await ops.assetSummary(v(req, 'query').campusId), 'Asset summary'));
r.post('/assets', MANAGE, validate(val.assetCreate), async (req: Request, res: Response) =>
  created(res, await ops.createAsset(req, v(req)), 'Asset added'));
r.put('/assets/:id', MANAGE, id, validate(val.assetUpdate), async (req: Request, res: Response) => {
  await ops.updateAsset(req, pid(req), v(req));
  return ok(res, null, 'Asset updated');
});
r.delete('/assets/:id', MANAGE, id, async (req: Request, res: Response) => {
  await ops.retireAsset(req, pid(req));
  return ok(res, null, 'Asset retired');
});
r.post('/assets/:id/service', MANAGE, id, validate(val.assetService), async (req: Request, res: Response) => {
  await ops.recordService(req, pid(req), v(req));
  return ok(res, null, 'Service recorded');
});

// ---- Facilities & bookings -----------------------------------------------------
r.get('/facilities', READ, validate(z.object({ campusId: z.uuid().optional(), q: z.string().trim().max(100).optional() }), 'query'),
  async (req: Request, res: Response) => {
    const f = v(req, 'query');
    return ok(res, await ops.listFacilities(f.campusId, f.q), 'Facilities retrieved');
  });
r.post('/facilities', MANAGE, validate(val.facilityCreate), async (req: Request, res: Response) =>
  created(res, await ops.createFacility(req, v(req)), 'Facility added'));
r.put('/facilities/:id', MANAGE, id, validate(val.facilityUpdate), async (req: Request, res: Response) => {
  await ops.updateFacility(req, pid(req), v(req));
  return ok(res, null, 'Facility updated');
});
r.get('/facilities/:id/bookings', READ, id, validate(val.bookingQuery, 'query'), async (req: Request, res: Response) => {
  const q = v(req, 'query');
  return ok(res, await ops.listBookings(pid(req), q.from, q.to), 'Bookings retrieved');
});
r.post('/facilities/:id/bookings', READ, id, validate(val.bookingCreate), async (req: Request, res: Response) =>
  created(res, await ops.createBooking(req, pid(req), v(req)), 'Room booked'));
r.delete('/facility-bookings/:id', READ, id, async (req: Request, res: Response) => {
  await ops.cancelBooking(req, pid(req));
  return ok(res, null, 'Booking cancelled');
});

// ---- Maintenance ----------------------------------------------------------------
r.get('/maintenance', READ, validate(val.maintenanceListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await ops.listMaintenance(req, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Maintenance requests retrieved');
});
r.get('/maintenance/summary', READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await ops.maintenanceSummary(v(req, 'query').campusId), 'Maintenance summary'));
// Any member of staff with operations access may raise a request.
r.post('/maintenance', READ, validate(val.maintenanceCreate), async (req: Request, res: Response) =>
  created(res, await ops.createMaintenance(req, v(req)), 'Maintenance request raised'));
r.patch('/maintenance/:id/status', MANAGE, id, validate(val.maintenanceStatus), async (req: Request, res: Response) => {
  // Assigning and progressing work stays with Operations; approving or rejecting is the Super Admin's.
  if (['Approved', 'Rejected'].includes(v(req).status)) assertDecider(req.user, 'Approving or rejecting a maintenance request');
  await ops.updateMaintenanceStatus(req, pid(req), v(req));
  return ok(res, null, `Request ${String(v(req).status).toLowerCase()}`);
});

// ---- Inventory -------------------------------------------------------------------
r.get('/inventory', READ, validate(val.inventoryListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await ops.listInventory(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Inventory retrieved');
});
r.get('/inventory/summary', READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await ops.inventorySummary(v(req, 'query').campusId), 'Inventory summary'));
r.get('/inventory/categories', READ, async (_req: Request, res: Response) => ok(res, await ops.inventoryCategories(), 'Categories'));
r.get('/inventory/movements', READ, validate(val.movementListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await ops.listMovements(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Stock movements retrieved');
});
r.post('/inventory', MANAGE, validate(val.inventoryCreate), async (req: Request, res: Response) =>
  created(res, await ops.createInventoryItem(req, v(req)), 'Item added'));
r.put('/inventory/:id', MANAGE, id, validate(val.inventoryUpdate), async (req: Request, res: Response) => {
  await ops.updateInventoryItem(req, pid(req), v(req));
  return ok(res, null, 'Item updated');
});
r.post('/inventory/:id/movements', MANAGE, id, validate(val.movementCreate), async (req: Request, res: Response) =>
  created(res, await ops.recordMovement(req, pid(req), v(req)), 'Stock movement recorded'));
r.post('/inventory/:id/purchase-request', MANAGE, id, validate(val.purchaseRequest), async (req: Request, res: Response) => {
  await ops.purchaseRequest(req, pid(req), v(req));
  return ok(res, null, 'Purchase request sent to Finance');
});

// ---- School documents (files go through core /documents routes) --------------------
r.get('/documents/summary', DOC_READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await rec.documentSummary(req.user!, v(req, 'query').campusId), 'Document summary'));
r.get('/documents/collections', DOC_READ, validate(z.object({ q: z.string().trim().max(100).optional() }), 'query'),
  async (req: Request, res: Response) => ok(res, await rec.listCollections(v(req, 'query').q), 'Document collections'));
r.get('/documents/school', DOC_READ, validate(val.schoolDocQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await rec.listSchoolDocuments(f);
  return paged(res, rows, total, f.page, f.pageSize, 'School documents retrieved');
});
r.get('/documents/pending', DOC_READ, validate(val.pendingDocQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await rec.listPendingStudentDocuments(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Documents awaiting verification');
});

// ---- Certificates ---------------------------------------------------------------------
r.get('/certificates', DOC_READ, validate(val.certListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await rec.listCertificates(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Certificates retrieved');
});
r.get('/certificates/summary', DOC_READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await rec.certificateSummary(req.user!, v(req, 'query').campusId), 'Certificate summary'));
r.get('/certificates/checks/:studentId', DOC_READ, validate(val.studentParam, 'params'),
  validate(z.object({ type: z.enum(val.CERT_TYPES).optional() }), 'query'),
  async (req: Request, res: Response) =>
    ok(res, await rec.studentCertificateChecks(req, v(req, 'params').studentId, v(req, 'query').type), 'Clearance checks'));
// Verification by QR code. Public-safe payload, but this build still requires sign-in.
r.get('/certificates/verify/:code', SIGNED_IN, validate(val.certCode, 'params'), async (req: Request, res: Response) =>
  ok(res, await rec.verifyCertificate(req, v(req, 'params').code), 'Verification result'));
r.post('/certificates', DOC_MANAGE, validate(val.certCreate), async (req: Request, res: Response) =>
  created(res, await rec.createCertificate(req, v(req)), 'Certificate requested'));
r.post('/certificates/:id/decision', DOC_MANAGE, id, validate(val.certDecision), async (req: Request, res: Response) => {
  if (['approve', 'reject'].includes(v(req).action)) assertDecider(req.user, 'Approving or rejecting a certificate');
  const out = await rec.decideCertificate(req, pid(req), v(req));
  return ok(res, out, `Certificate ${out.status.toLowerCase()}`);
});

// ---- Compliance calendar ------------------------------------------------------------------
r.get('/compliance', READ, validate(val.complianceListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await rec.listCompliance(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Compliance calendar retrieved');
});
r.get('/compliance/summary', READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await rec.complianceSummary(v(req, 'query').campusId), 'Compliance summary'));
r.post('/compliance', MANAGE, validate(val.complianceCreate), async (req: Request, res: Response) =>
  created(res, await rec.createCompliance(req, v(req)), 'Requirement added'));
r.put('/compliance/:id', MANAGE, id, validate(val.complianceUpdate), async (req: Request, res: Response) => {
  await rec.updateCompliance(req, pid(req), v(req));
  return ok(res, null, 'Requirement updated');
});
r.post('/compliance/:id/complete', MANAGE, id, validate(val.complianceComplete), async (req: Request, res: Response) =>
  ok(res, await rec.completeCompliance(req, pid(req), v(req)), 'Marked completed'));
r.post('/compliance/:id/escalate', MANAGE, id, validate(z.object({ note: z.string().trim().max(300).optional() })),
  async (req: Request, res: Response) => {
    await rec.escalateCompliance(req, pid(req), v(req).note);
    return ok(res, null, 'Escalated to the Principal and owner');
  });

// ---- Audit trail facets (list is GET /audit-logs in core) -------------------------------------
r.get('/audit/facets', requirePermission('audit.read'), validate(z.object({}), 'query'),
  async (_req: Request, res: Response) => ok(res, await rec.auditFacets(), 'Audit facets'));

export default r;
