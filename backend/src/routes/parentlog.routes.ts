import { Router, type Request, type Response } from 'express';
import { requireAny, requirePermission } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { created, ok, paged } from '../utils/response.js';
import * as val from '../validators/parentlog.validators.js';
import * as svc from '../services/parentlog.service.js';

/**
 * Parent & staff contact log: how often parents (and teachers) approach or
 * try to reach the principal and staff. Manual entries (walk-ins, calls)
 * plus contacts the app already records. Mounted at /api behind authentication.
 *
 * parentlog.read   → the whole log
 * parentlog.manage → record and update contacts; without parentlog.read the
 *                    reads are limited to entries the user logged or that targeted them.
 */
const r = Router();

const VIEW = requireAny('parentlog.read', 'parentlog.manage');
const MANAGE = requirePermission('parentlog.manage');

r.get('/parent-log', VIEW, validate(val.listQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await svc.listLog(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Contact log retrieved');
});

r.get('/parent-log/summary', VIEW, validate(val.summaryQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await svc.summary(req.user!, v(req, 'query')), 'Contact log summary'));

r.get('/parent-log/targets', VIEW, validate(val.targetsQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await svc.targets(v(req, 'query').campusId), 'Contact targets'));

r.get('/parent-log/parent-search', MANAGE, validate(val.parentSearchQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  return ok(res, await svc.searchParents(req.user!, f.q, f.limit), 'Parents retrieved');
});

r.get('/parent-log/parents/:parentId', VIEW, validate(val.parentParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await svc.parentHistory(req.user!, v(req, 'params').parentId), 'Parent contact history'));

r.post('/parent-log', MANAGE, validate(val.createBody), async (req: Request, res: Response) =>
  created(res, await svc.createEntry(req, v(req)), 'Contact logged'));

r.patch('/parent-log/:id', MANAGE, validate(val.idParam, 'params'), validate(val.patchBody), async (req: Request, res: Response) =>
  ok(res, await svc.updateEntry(req, v(req, 'params').id, v(req)), 'Contact updated'));

export default r;
