import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { ok } from '../utils/response.js';
import { forbidden } from '../utils/errors.js';
import * as svc from '../services/exam-correction.service.js';

/**
 * Paper Correction — AI marking of handwritten answer sheets (EXAM Vision).
 * Everything needs assessments.manage (teachers, principal, administrators); the
 * service then applies its own exam assignment rules to the role Holy Sai gives it.
 */
const r = Router();
const MARKS = requirePermission('assessments.manage');

r.get('/exam-correction/status', MARKS, async (req: Request, res: Response) =>
  ok(res, await svc.status(req.user!), 'Paper Correction status'));

r.post('/exam-correction/sync', MARKS, async (req: Request, res: Response) => {
  if (svc.examRole(req.user!) === 'teacher') throw forbidden('Roster sync needs a school-level role');
  return ok(res, await svc.syncRoster(), 'Students and staff synced to Paper Correction');
});

r.post('/exam-correction/exams/:examId/push-marks', MARKS,
  validate(z.object({ examId: z.string().regex(/^[0-9a-f]{32}$/, 'Invalid exam id') }), 'params'),
  validate(z.object({ assessmentId: z.uuid() })),
  async (req: Request, res: Response) => {
    const out = await svc.pushMarks(req, v<{ examId: string }>(req, 'params').examId, v<{ assessmentId: string }>(req).assessmentId);
    return ok(res, out, `${out.sent} mark(s) sent to the marks register`);
  });

// Everything else under /exam-correction/api/ is forwarded to the service as the signed-in user.
r.all('/exam-correction/api/*path', MARKS, async (req: Request, res: Response) => {
  const path = (req.params as { path: string[] }).path.join('/');
  await svc.forward(req, res, path);
});

export default r;
