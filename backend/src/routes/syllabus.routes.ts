import { Router, type Request, type Response } from 'express';
import { requireAny, requirePermission } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { ALL_PERMISSIONS } from '../config/rbac.js';
import { created, ok, paged } from '../utils/response.js';
import * as V from '../validators/syllabus.validators.js';
import * as grading from '../services/grading.service.js';
import * as svc from '../services/syllabus.service.js';

/**
 * Cambridge IGCSE syllabuses (Grades 9–10) and the school's grade scale
 * (A* to G, U below G). Mounted at /api behind authentication.
 *   - the grade scale is readable by every signed-in user (parents and students see grades too)
 *   - boundaries and syllabus definitions: grading.manage
 *   - topic coverage and student tier entries: academics.manage, limited to the teacher's sections
 */
const r = Router();

const ANY_USER = requireAny(...ALL_PERMISSIONS);
const READ = requirePermission('academics.read');
const DEFINE = requirePermission('grading.manage');
const TEACH = requirePermission('academics.manage');
const id = validate(V.idParam, 'params');
const params = <T>(req: Request) => v<T>(req, 'params');

// ---------------------------------------------------------------------------
// Grade scale
// ---------------------------------------------------------------------------
r.get('/grading/scale', ANY_USER,
  async (_req: Request, res: Response) => ok(res, await grading.scaleForApi(), 'Grade scale'));

r.put('/grading/scale/boundaries', DEFINE, validate(V.boundariesUpdate),
  async (req: Request, res: Response) => ok(res, await grading.updateBoundaries(req, v(req)), 'Grade boundaries updated'));

// ---------------------------------------------------------------------------
// Syllabuses
// ---------------------------------------------------------------------------
r.get('/syllabuses', READ, validate(V.syllabusesQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await svc.listSyllabuses(req.user!, v(req, 'query')), 'Syllabuses'));

// Cambridge IGCSE catalogue: every Cambridge syllabus with the document that applies to each grade.
r.get('/syllabus-catalogue', READ, validate(V.catalogueQuery, 'query'),
  async (req: Request, res: Response) => ok(res, await svc.listCatalogue(v(req, 'query')), 'Cambridge IGCSE catalogue'));

r.post('/syllabus-catalogue/add', DEFINE, validate(V.catalogueAdd),
  async (req: Request, res: Response) => created(res, await svc.addFromCatalogue(req, v(req)), 'Syllabus added from the Cambridge catalogue'));

r.get('/syllabuses/:id', READ, id,
  async (req: Request, res: Response) => ok(res, await svc.getSyllabus(req.user!, params<{ id: string }>(req).id), 'Syllabus'));

r.post('/syllabuses', DEFINE, validate(V.syllabusCreate),
  async (req: Request, res: Response) => created(res, await svc.createSyllabus(req, v(req)), 'Syllabus added'));

r.put('/syllabuses/:id', DEFINE, id, validate(V.syllabusUpdate),
  async (req: Request, res: Response) => ok(res, await svc.updateSyllabus(req, params<{ id: string }>(req).id, v(req)), 'Syllabus updated'));

// Components (papers)
r.post('/syllabuses/:id/components', DEFINE, id, validate(V.componentCreate),
  async (req: Request, res: Response) => created(res, await svc.createComponent(req, params<{ id: string }>(req).id, v(req)), 'Component added'));

r.put('/syllabuses/:id/components/:componentId', DEFINE, validate(V.componentParams, 'params'), validate(V.componentUpdate),
  async (req: Request, res: Response) => {
    const p = params<{ id: string; componentId: string }>(req);
    return ok(res, await svc.updateComponent(req, p.id, p.componentId, v(req)), 'Component updated');
  });

r.delete('/syllabuses/:id/components/:componentId', DEFINE, validate(V.componentParams, 'params'),
  async (req: Request, res: Response) => {
    const p = params<{ id: string; componentId: string }>(req);
    return ok(res, await svc.deleteComponent(req, p.id, p.componentId), 'Component removed');
  });

// Topics
r.post('/syllabuses/:id/topics', DEFINE, id, validate(V.topicCreate),
  async (req: Request, res: Response) => created(res, await svc.createTopic(req, params<{ id: string }>(req).id, v(req)), 'Topic added'));

r.put('/syllabuses/:id/topics/:topicId', DEFINE, validate(V.topicParams, 'params'), validate(V.topicUpdate),
  async (req: Request, res: Response) => {
    const p = params<{ id: string; topicId: string }>(req);
    return ok(res, await svc.updateTopic(req, p.id, p.topicId, v(req)), 'Topic updated');
  });

r.delete('/syllabuses/:id/topics/:topicId', DEFINE, validate(V.topicParams, 'params'),
  async (req: Request, res: Response) => {
    const p = params<{ id: string; topicId: string }>(req);
    return ok(res, await svc.deleteTopic(req, p.id, p.topicId), 'Topic removed');
  });

// Coverage — teachers mark topics for their own sections
r.post('/syllabuses/:id/topics/:topicId/coverage', TEACH, validate(V.topicParams, 'params'), validate(V.coverageSave),
  async (req: Request, res: Response) => {
    const p = params<{ id: string; topicId: string }>(req);
    return ok(res, await svc.saveCoverage(req, p.id, p.topicId, v(req)), 'Coverage updated');
  });

// Student entries (Core / Extended)
r.get('/syllabuses/:id/entries', READ, id, validate(V.entriesQuery, 'query'),
  async (req: Request, res: Response) => {
    const f = v(req, 'query');
    const { rows, total } = await svc.listEntries(req.user!, params<{ id: string }>(req).id, f);
    return paged(res, rows, total, f.page, f.pageSize, 'Syllabus entries');
  });

r.put('/syllabuses/:id/entries', TEACH, id, validate(V.entriesSave),
  async (req: Request, res: Response) => ok(res, await svc.saveEntries(req, params<{ id: string }>(req).id, v(req)), 'Entries saved'));

export default r;
