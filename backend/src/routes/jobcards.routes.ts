import { Router, type Request, type Response } from 'express';
import { requireAny, requirePermission } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { created, ok, paged } from '../utils/response.js';
import * as svc from '../services/jobcards.service.js';
import * as val from '../validators/jobcards.validators.js';

/**
 * Job Cards: inter-department work requests and the department register.
 * Mounted at /api behind authentication. Record-level visibility is applied
 * in the service (cards outside the user's departments return 404).
 */
const r = Router();
const USE = requireAny('jobcards.use', 'jobcards.manage');
const MANAGE = requirePermission('jobcards.manage');
const id = validate(val.idParam, 'params');
const pid = (req: Request) => v<{ id: string }>(req, 'params').id;

// ---- Job cards ----------------------------------------------------------------
r.get('/job-cards', USE, validate(val.jobCardListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await svc.listCards(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Job cards retrieved');
});
r.get('/job-cards/summary', USE, validate(val.jobCardSummaryQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await svc.summary(req.user!, v(req, 'query').campusId), 'Job card summary'));
r.get('/job-cards/:id', USE, id, async (req: Request, res: Response) =>
  ok(res, await svc.getCard(req, pid(req)), 'Job card retrieved'));
r.post('/job-cards', USE, validate(val.jobCardCreate), async (req: Request, res: Response) => {
  const c = await svc.createCard(req, v(req));
  return created(res, c, `Job card ${c.code} raised`);
});
r.put('/job-cards/:id', USE, id, validate(val.jobCardUpdate), async (req: Request, res: Response) => {
  await svc.updateCard(req, pid(req), v(req));
  return ok(res, null, 'Job card updated');
});
r.patch('/job-cards/:id/status', USE, id, validate(val.jobCardStatus), async (req: Request, res: Response) => {
  await svc.changeStatus(req, pid(req), v(req));
  return ok(res, null, `Job card moved to ${v(req).status}`);
});
r.post('/job-cards/:id/assign', USE, id, validate(val.jobCardAssign), async (req: Request, res: Response) =>
  ok(res, await svc.assignCard(req, pid(req), v(req)), 'Job card assigned'));
r.post('/job-cards/:id/comments', USE, id, validate(val.jobCardComment), async (req: Request, res: Response) =>
  created(res, await svc.addComment(req, pid(req), v(req).body), 'Comment added'));

// ---- Departments ------------------------------------------------------------------
r.get('/departments', USE, validate(val.departmentListQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await svc.listDepartments(req.user!, v(req, 'query')), 'Departments retrieved'));
r.get('/departments/:id/members', USE, id, async (req: Request, res: Response) =>
  ok(res, await svc.departmentMembers(pid(req)), 'Department members retrieved'));
r.post('/departments', MANAGE, validate(val.departmentCreate), async (req: Request, res: Response) =>
  created(res, await svc.createDepartment(req, v(req)), 'Department created'));
r.put('/departments/:id', MANAGE, id, validate(val.departmentUpdate), async (req: Request, res: Response) => {
  await svc.updateDepartment(req, pid(req), v(req));
  return ok(res, null, 'Department updated');
});

export default r;
