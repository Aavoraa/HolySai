import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { commandCenter } from '../services/dashboard.service.js';
import { ok } from '../utils/response.js';
import { forbidden } from '../utils/errors.js';

const r = Router();

r.get('/command-center', requirePermission('dashboard.view', 'students.read'),
  validate(z.object({ campusId: z.uuid().optional(), scope: z.enum(['campus', 'group']).default('campus') }), 'query'),
  async (req: Request, res: Response) => {
    const { campusId, scope } = v(req, 'query');
    if (scope === 'group' && !req.user!.permissions.has('dashboard.group')) throw forbidden('Group view requires dashboard.group');
    const data = await commandCenter(req.user!, scope === 'group' ? null : campusId ?? req.user!.campusId);
    return ok(res, data, 'Dashboard retrieved successfully');
  });

export default r;
