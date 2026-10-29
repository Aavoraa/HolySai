import type { Request, Response } from 'express';
import * as svc from '../services/students.service.js';
import * as tracking from '../services/tracking.service.js';
import { authorizeStudent, authorizeStudentTracking, resolveStudentId } from '../services/access.service.js';
import { audit } from '../services/audit.service.js';
import { has } from '../middleware/auth.js';
import { v } from '../middleware/validate.js';
import { created, ok, paged } from '../utils/response.js';
import { forbidden } from '../utils/errors.js';

export async function list(req: Request, res: Response) {
  const f = v(req, 'query');
  const { rows, total } = await svc.listStudents(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Students retrieved successfully');
}

export async function summary(req: Request, res: Response) {
  return ok(res, await svc.studentSummary(req.user!, req.query.campusId as string | undefined), 'Student summary');
}

export async function get(req: Request, res: Response) {
  const id = await authorizeStudent(req, v(req, 'params').id);
  return ok(res, await svc.getStudentRow(id), 'Student retrieved successfully');
}

export async function profile(req: Request, res: Response) {
  const id = await authorizeStudent(req, v(req, 'params').id);
  const data = await svc.getStudentProfile(req.user!, id);
  await audit(req, { action: 'view', module: 'students', description: `Viewed Student 360 of ${(data.student as any).admissionNo}`, entityType: 'student', entityId: id });
  return ok(res, data, 'Student profile retrieved successfully');
}

export async function create(req: Request, res: Response) {
  const id = await svc.createStudent(req, v(req));
  return created(res, await svc.getStudentRow(id), 'Student created successfully');
}

export async function update(req: Request, res: Response) {
  const id = await resolveStudentId(v(req, 'params').id);
  await svc.updateStudent(req, id, v(req));
  return ok(res, await svc.getStudentRow(id), 'Student updated successfully');
}

export async function remove(req: Request, res: Response) {
  const id = await resolveStudentId(v(req, 'params').id);
  await svc.archiveStudent(req, id);
  return ok(res, { id }, 'Student archived successfully');
}

export async function addBehaviour(req: Request, res: Response) {
  const id = await authorizeStudent(req, v(req, 'params').id);
  return created(res, await svc.addBehaviour(req, id, v(req)), 'Behaviour note added');
}

export async function addAchievement(req: Request, res: Response) {
  const id = await authorizeStudent(req, v(req, 'params').id);
  return created(res, await svc.addAchievement(req, id, v(req), req.file), 'Achievement recorded');
}

export async function addObservation(req: Request, res: Response) {
  const id = await authorizeStudent(req, v(req, 'params').id);
  return created(res, await svc.addObservation(req, id, v(req).observation), 'Observation added');
}

// ---- Per-student tracking ------------------------------------------------

export async function location(req: Request, res: Response) {
  const id = await authorizeStudentTracking(req, v(req, 'params').id);
  const data = await tracking.getCurrentLocation(id);
  await audit(req, {
    action: 'view', module: 'tracking',
    description: `${req.user!.parentId ? 'Parent viewed child tracking' : 'Viewed student location'} (${data.admissionNo})`,
    entityType: 'student', entityId: id,
  });
  return ok(res, data, 'Student location retrieved successfully');
}

export async function locationHistory(req: Request, res: Response) {
  const id = await authorizeStudentTracking(req, v(req, 'params').id);
  const isParent = !has(req, 'tracking.history');
  // Parents may review their own child's recent movements (last 7 days);
  // full history is restricted to staff holding tracking.history.
  if (isParent && !req.user!.parentId) throw forbidden('Missing permission: tracking.history');
  const data = await tracking.getHistory(id, v(req, 'query'), isParent ? { maxDaysBack: 7 } : {});
  await audit(req, {
    action: 'view', module: 'tracking',
    description: `${isParent ? 'Parent viewed child location history' : 'Viewed tracking history'}`,
    entityType: 'student', entityId: id, metadata: v(req, 'query'),
  });
  return ok(res, data, 'Location history retrieved successfully');
}

export async function recordLocation(req: Request, res: Response) {
  const id = await resolveStudentId(v(req, 'params').id);
  return created(res, await tracking.recordLocation(req, id, v(req)), 'Location recorded');
}
