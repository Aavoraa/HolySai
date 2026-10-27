import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { created, ok, paged } from '../utils/response.js';
import * as svc from '../services/group.service.js';
import * as val from '../validators/group.validators.js';
import { assertDecider } from '../services/approvals-guard.js';

/**
 * Group management (multi-campus). Mounted at /api behind authentication.
 */
const r = Router();
const READ = requirePermission('group.read');
const MANAGE = requirePermission('group.manage');
const id = validate(val.idParam, 'params');
const pid = (req: Request) => v<{ id: string }>(req, 'params').id;

// ---- Dashboard & comparison ------------------------------------------------------
r.get('/group/dashboard', requirePermission('dashboard.group'), async (req: Request, res: Response) =>
  ok(res, await svc.groupDashboard(req.user!), 'Group dashboard'));
r.get('/group/comparison', READ, async (_req: Request, res: Response) =>
  ok(res, await svc.comparison(), 'Campus comparison'));

// ---- Campuses ---------------------------------------------------------------------
r.get('/group/campuses', READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await svc.campusMetrics(v(req, 'query').campusId), 'Campuses retrieved'));
r.put('/group/campuses/:id', MANAGE, id, validate(val.campusUpdate), async (req: Request, res: Response) => {
  await svc.updateCampus(req, pid(req), v(req));
  return ok(res, null, 'Campus updated');
});

// ---- Transfers ----------------------------------------------------------------------
r.get('/group/transfers', READ, validate(val.transferListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await svc.listTransfers(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Transfers retrieved');
});
r.get('/group/transfers/summary', READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await svc.transferSummary(req.user!, v(req, 'query').campusId), 'Transfer summary'));
r.get('/group/transfers/:id', READ, id, async (req: Request, res: Response) =>
  ok(res, await svc.getTransfer(req, pid(req)), 'Transfer retrieved'));
r.post('/group/transfers', MANAGE, validate(val.transferCreate), async (req: Request, res: Response) =>
  created(res, await svc.createTransfer(req, v(req)), 'Transfer requested'));
r.post('/group/transfers/:id/decision', MANAGE, id, validate(val.transferDecision), async (req: Request, res: Response) => {
  // Moving a request to review prepares it; approving or rejecting is the Super Admin's.
  if (v(req).action !== 'review') assertDecider(req.user, 'Approving or rejecting a transfer');
  const out = await svc.decideTransfer(req, pid(req), v(req));
  return ok(res, out, `Transfer ${out.status.toLowerCase()}`);
});
r.post('/group/transfers/:id/complete', MANAGE, id, validate(val.transferComplete), async (req: Request, res: Response) => {
  const out = await svc.completeTransfer(req, pid(req), v(req));
  return ok(res, out, `Student moved to ${out.section}`);
});

// ---- Policies -------------------------------------------------------------------------
r.get('/group/policies', READ, validate(val.policyListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await svc.listPolicies(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Policies retrieved');
});
r.get('/group/policies/:id', READ, id, async (req: Request, res: Response) => ok(res, await svc.getPolicy(pid(req)), 'Policy retrieved'));
r.post('/group/policies', MANAGE, validate(val.policyCreate), async (req: Request, res: Response) => {
  // Making a policy Active is its approval — Super Admin only.
  if (v(req).status === 'Active') assertDecider(req.user, 'Approving a policy');
  return created(res, await svc.createPolicy(req, v(req)), 'Policy created');
});
r.put('/group/policies/:id', MANAGE, id, validate(val.policyUpdate), async (req: Request, res: Response) => {
  if (v(req).status === 'Active' && (await svc.getPolicy(pid(req))).status !== 'Active') assertDecider(req.user, 'Approving a policy');
  await svc.updatePolicy(req, pid(req), v(req));
  return ok(res, null, 'Policy updated');
});
r.delete('/group/policies/:id', MANAGE, id, async (req: Request, res: Response) => {
  const out = await svc.deletePolicy(req, pid(req));
  return ok(res, { result: out }, out === 'deleted' ? 'Draft policy deleted' : 'Policy retired');
});

export default r;
