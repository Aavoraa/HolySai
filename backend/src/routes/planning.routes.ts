import { Router, type Request, type Response } from 'express';
import { requireAny, requirePermission } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { ok, created, paged } from '../utils/response.js';
import * as V from '../validators/planning.validators.js';
import * as plans from '../services/planning.service.js';
import * as approvals from '../services/approvals.service.js';

/**
 * Budget & Planning + the central Approvals inbox. Mounted at /api behind authentication.
 *   read       planning.read
 *   prepare    planning.manage (create, edit, submit, reopen, delete drafts)
 *   decide     approvals.decide — Super Admin only (review, approve, reject)
 *   /approvals approvals.decide — everything awaiting a Super Admin decision, across modules
 */
const r = Router();
const READ = requireAny('planning.read', 'approvals.decide');
const MANAGE = requirePermission('planning.manage');
const DECIDE = requirePermission('approvals.decide');
const idP = validate(V.idParam, 'params');
const pid = (req: Request) => v<{ id: string }>(req, 'params').id;

// ---- Budget plans ----------------------------------------------------------------
r.get('/planning/lookups', READ, async (_req: Request, res: Response) => ok(res, await plans.lookups(), 'Planning lookups'));

r.get('/planning/summary', READ, validate(V.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await plans.summary(v(req, 'query')), 'Budget planning summary'));

r.get('/planning/plans', READ, validate(V.planListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await plans.listPlans(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Budget plans retrieved');
});

r.get('/planning/plans/:id', READ, idP, async (req: Request, res: Response) => ok(res, await plans.getPlan(pid(req)), 'Budget plan'));

r.post('/planning/plans', MANAGE, validate(V.planCreate), async (req: Request, res: Response) => {
  const out = await plans.createPlan(req, v(req));
  return created(res, out, `${out!.code} ${out!.status === 'Draft' ? 'saved as draft' : 'submitted for Super Admin approval'}`);
});

r.put('/planning/plans/:id', MANAGE, idP, validate(V.planUpdate), async (req: Request, res: Response) =>
  ok(res, await plans.updatePlan(req, pid(req), v(req)), 'Budget plan updated'));

r.delete('/planning/plans/:id', MANAGE, idP, async (req: Request, res: Response) =>
  ok(res, await plans.deletePlan(req, pid(req)), 'Draft budget plan deleted'));

r.post('/planning/plans/:id/submit', MANAGE, idP, async (req: Request, res: Response) =>
  ok(res, await plans.transitionPlan(req, pid(req), 'submit'), 'Submitted for Super Admin approval'));

r.post('/planning/plans/:id/reopen', MANAGE, idP, async (req: Request, res: Response) =>
  ok(res, await plans.transitionPlan(req, pid(req), 'reopen'), 'Plan reopened as a draft'));

r.post('/planning/plans/:id/review', DECIDE, idP, async (req: Request, res: Response) =>
  ok(res, await plans.transitionPlan(req, pid(req), 'review'), 'Plan moved to review'));

r.post('/planning/plans/:id/approve', DECIDE, idP, validate(V.approveBody), async (req: Request, res: Response) => {
  const b = v(req);
  return ok(res, await plans.transitionPlan(req, pid(req), 'approve', { note: b.note, amountApproved: b.amountApproved }), 'Plan approved and added to the budget');
});

r.post('/planning/plans/:id/reject', DECIDE, idP, validate(V.reasonBody), async (req: Request, res: Response) =>
  ok(res, await plans.transitionPlan(req, pid(req), 'reject', { note: v(req).reason }), 'Plan rejected'));

// ---- Approvals inbox (Super Admin) ------------------------------------------------------
r.get('/approvals/summary', DECIDE, validate(V.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await approvals.summary(v(req, 'query').campusId), 'Pending approvals summary'));

r.get('/approvals/pending', DECIDE, validate(V.pendingQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await approvals.pending(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Pending approvals');
});

r.post('/approvals/:module/:id/decide', DECIDE, validate(V.decideParams, 'params'), validate(V.decideBody), async (req: Request, res: Response) => {
  const p = v(req, 'params');
  const out = await approvals.decide(req, p.module, p.id, v(req));
  return ok(res, out, `${approvals.MODULE_LABELS[p.module as V.ApprovalModule]}: ${out.decision === 'approve' ? 'approved' : 'rejected'}`);
});

export default r;
