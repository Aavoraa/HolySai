import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAny, requirePermission, has } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { paginationSchema } from '../utils/pagination.js';
import { historyQuerySchema } from '../validators/tracking.validators.js';
import * as svc from '../services/parents.service.js';
import * as tracking from '../services/tracking.service.js';
import { assertSelfParent, canAccessStudent, isGuardianOf, resolveStudentId } from '../services/access.service.js';
import { isClassScoped, visibleParent } from '../services/parents-experience.service.js';
import { audit } from '../services/audit.service.js';
import { created, ok, paged } from '../utils/response.js';
import { forbidden, notFound } from '../utils/errors.js';

const r = Router();

const parentParam = z.object({ id: z.uuid() });
const childParams = z.object({ id: z.uuid(), studentId: z.string().min(1).max(64) });
const parentBody = z.object({
  fullName: z.string().min(2).max(120),
  phone: z.string().regex(/^\+?[0-9 ]{8,16}$/, 'Enter a valid phone number'),
  altPhone: z.string().regex(/^\+?[0-9 ]{8,16}$/).optional(),
  email: z.email().optional(),
  occupation: z.string().max(80).optional(),
  address: z.string().max(300).optional(),
  preferredChannel: z.enum(['whatsapp', 'sms', 'email', 'push', 'call']).optional(),
});

/**
 * A parent can only address their own parent id. School-wide staff with
 * parents.read may look up any family (for the front office); class-scoped
 * staff (teachers) only families with a child in their sections (404 otherwise).
 */
async function assertFamily(req: Request, parentId: string) {
  assertSelfParent(req, parentId);
  if (!req.user!.parentId && isClassScoped(req.user!)) await visibleParent(req.user!, parentId);
}

/** Resolves :id/:studentId for family routes: the family, and only children linked to it. */
async function familyChild(req: Request, requireTracking = false) {
  const { id, studentId } = v(req, 'params');
  await assertFamily(req, id);
  const sid = await resolveStudentId(studentId);
  if (!(await isGuardianOf(id, sid, requireTracking))) throw notFound('Student not found', 'STUDENT_NOT_FOUND');
  if (!req.user!.parentId && !(await canAccessStudent(req.user!, sid))) throw notFound('Student not found', 'STUDENT_NOT_FOUND');
  return { parentId: id as string, studentId: sid };
}

// ---- Parent's own record ----------------------------------------------------
r.get('/me', requirePermission('parent_portal.use'), async (req: Request, res: Response) => {
  if (!req.user!.parentId) throw notFound('No parent record is linked to this account', 'PARENT_NOT_LINKED');
  const [parent, children] = await Promise.all([svc.getParent(req.user!.parentId), svc.getChildren(req.user!.parentId)]);
  return ok(res, { ...parent, children }, 'Parent profile retrieved successfully');
});

// ---- Directory (staff) --------------------------------------------------------
r.get('/', requirePermission('parents.read'), validate(paginationSchema.extend({ campusId: z.uuid().optional() }), 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await svc.listParents(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Parents retrieved successfully');
});
r.post('/', requirePermission('parents.manage'), validate(parentBody), async (req: Request, res: Response) =>
  created(res, await svc.createParent(req, v(req)), 'Parent created successfully'));

r.get('/:id', requireAny('parents.read', 'parent_portal.use'), validate(parentParam, 'params'), async (req: Request, res: Response) => {
  await assertFamily(req, v(req, 'params').id);
  return ok(res, await svc.getParent(v(req, 'params').id), 'Parent retrieved successfully');
});
r.put('/:id', requirePermission('parents.manage'), validate(parentParam, 'params'), validate(parentBody.partial()), async (req: Request, res: Response) =>
  ok(res, await svc.updateParent(req, v(req, 'params').id, v(req)), 'Parent updated successfully'));

// ---- Children -------------------------------------------------------------------
r.get('/:id/children', requireAny('parents.read', 'parent_portal.use'), validate(parentParam, 'params'), async (req: Request, res: Response) => {
  await assertFamily(req, v(req, 'params').id);
  return ok(res, await svc.getChildren(v(req, 'params').id, req.user!.parentId ? undefined : req.user!), 'Children retrieved successfully');
});

r.get('/:id/children/:studentId/overview', requireAny('parents.read', 'parent_portal.use'), validate(childParams, 'params'), async (req: Request, res: Response) => {
  const { parentId, studentId } = await familyChild(req);
  return ok(res, await svc.childOverview(parentId, studentId), 'Child overview retrieved successfully');
});

// ---- Child tracking (parents: own children only) --------------------------------
r.get('/:id/children/:studentId/location', requireAny('tracking.read_own_children', 'tracking.read_all'), validate(childParams, 'params'),
  async (req: Request, res: Response) => {
    const { studentId } = await familyChild(req, !has(req, 'tracking.read_all'));
    const data = await tracking.getCurrentLocation(studentId);
    await audit(req, { action: 'view', module: 'tracking', description: `Parent viewed child tracking (${data.admissionNo})`, entityType: 'student', entityId: studentId });
    return ok(res, data, 'Child location retrieved successfully');
  });

r.get('/:id/children/:studentId/location/history', requireAny('tracking.read_own_children', 'tracking.history'),
  validate(childParams, 'params'), validate(historyQuerySchema, 'query'),
  async (req: Request, res: Response) => {
    const staff = has(req, 'tracking.history');
    if (!staff && !req.user!.parentId) throw forbidden();
    const { studentId } = await familyChild(req, !staff);
    const data = await tracking.getHistory(studentId, v(req, 'query'), staff ? {} : { maxDaysBack: 7 });
    await audit(req, { action: 'view', module: 'tracking', description: 'Parent viewed child location history', entityType: 'student', entityId: studentId });
    return ok(res, data, 'Child location history retrieved successfully');
  });

export default r;
