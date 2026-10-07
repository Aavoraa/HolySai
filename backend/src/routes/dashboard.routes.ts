import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAny, requirePermission } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { commandCenter } from '../services/dashboard.service.js';
import { ownerOverview } from '../services/owner-overview.service.js';
import { audit } from '../services/audit.service.js';
import { ok } from '../utils/response.js';
import { forbidden } from '../utils/errors.js';

const r = Router();

const scopeQuery = z.object({
  campusId: z.uuid().optional(),
  scope: z.enum(['campus', 'group']).default('campus'),
});

r.get('/command-center', requirePermission('dashboard.view', 'students.read'),
  validate(z.object({ campusId: z.uuid().optional(), scope: z.enum(['campus', 'group']).default('campus') }), 'query'),
  async (req: Request, res: Response) => {
    const { campusId, scope } = v(req, 'query');
    if (scope === 'group' && !req.user!.permissions.has('dashboard.group')) throw forbidden('Group view requires dashboard.group');
    const data = await commandCenter(req.user!, scope === 'group' ? null : campusId ?? req.user!.campusId);
    return ok(res, data, 'Dashboard retrieved successfully');
  });

/**
 * Owner Overview. Reads the signed-in person's own previous sign-in, so it is
 * per-user by design and never accepts a user id from the caller. Opening it is
 * itself audited: it exposes collection figures and the management trail.
 */
r.get('/overview', requireAny('finance.read', 'audit.read'),
  validate(scopeQuery, 'query'),
  async (req: Request, res: Response) => {
    const { campusId, scope } = v(req, 'query');
    if (scope === 'group' && !req.user!.permissions.has('dashboard.group')) throw forbidden('Group view requires dashboard.group');
    const data = await ownerOverview(req.user!, scope === 'group' ? null : campusId ?? req.user!.campusId);
    await audit(req, { action: 'view', module: 'reports', description: 'Viewed the Owner Overview' });
    return ok(res, data, 'Overview retrieved successfully');
  });

export default r;
