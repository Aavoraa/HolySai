import { Router } from 'express';
import * as c from '../controllers/students.controller.js';
import { requireAny, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  achievementSchema, behaviourSchema, idParam, observationSchema,
  studentCreateSchema, studentListQuery, studentUpdateSchema,
} from '../validators/students.validators.js';
import { historyQuerySchema, locationInputSchema } from '../validators/tracking.validators.js';
import { upload } from '../services/documents.service.js';

const r = Router();
const READ = requireAny('students.read', 'students.read_assigned', 'parent_portal.use', 'student_portal.use');
const STAFF_READ = requireAny('students.read', 'students.read_assigned');
const TRACK = requireAny('tracking.read_all', 'tracking.read_assigned', 'tracking.read_own_children');

r.get('/', STAFF_READ, validate(studentListQuery, 'query'), c.list);
r.get('/summary', STAFF_READ, c.summary);
r.post('/', requirePermission('students.create'), validate(studentCreateSchema), c.create);

r.get('/:id', READ, validate(idParam, 'params'), c.get);
r.put('/:id', requirePermission('students.update'), validate(idParam, 'params'), validate(studentUpdateSchema), c.update);
r.delete('/:id', requirePermission('students.delete'), validate(idParam, 'params'), c.remove);
r.get('/:id/profile', READ, validate(idParam, 'params'), c.profile);

r.post('/:id/behaviour', STAFF_READ, validate(idParam, 'params'), validate(behaviourSchema), c.addBehaviour);
// JSON, or multipart with an optional certificate/photo in "file" (stored only after the student check).
r.post('/:id/achievements', STAFF_READ, validate(idParam, 'params'), upload.single('file'), validate(achievementSchema), c.addAchievement);
r.post('/:id/observations', STAFF_READ, validate(idParam, 'params'), validate(observationSchema), c.addObservation);

// GPS tracking for one student. Scope (all / assigned / own child) is enforced in the controller.
r.get('/:id/location', TRACK, validate(idParam, 'params'), c.location);
r.get('/:id/location/history', TRACK, validate(idParam, 'params'), validate(historyQuerySchema, 'query'), c.locationHistory);
r.post('/:id/location', requirePermission('tracking.write'), validate(idParam, 'params'), validate(locationInputSchema), c.recordLocation);

export default r;
