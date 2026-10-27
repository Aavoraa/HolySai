import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAny, requirePermission } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { paginationSchema } from '../utils/pagination.js';
import { created, ok, paged } from '../utils/response.js';
import * as val from '../validators/parents-experience.validators.js';
import * as comms from '../services/parents-experience-comms.service.js';
import * as circ from '../services/parents-experience-circulars.service.js';
import * as ptm from '../services/parents-experience-ptm.service.js';
import { audienceLabel, countAudience, normalizeAudience } from '../services/parents-experience.service.js';

/**
 * Parent experience: engagement directory, unified communication history,
 * parent ↔ staff conversations, PTM, circulars & acknowledgements, events,
 * and the family-facing endpoints used by Parent 360.
 * Mounted at /api behind authentication.
 */
const r = Router();

const READ = requirePermission('communication.read');
const SEND = requirePermission('communication.send');
const FAMILY = requirePermission('parent_portal.use');
const campusQuery = z.object({ campusId: z.uuid().optional() });

// =============================================================================
// Parent directory (engagement view; profile/create/update live under /parents)
// =============================================================================
r.get('/parent-directory', requirePermission('parents.read'), validate(val.directoryQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await comms.listDirectory(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Parent directory retrieved');
});

r.get('/parent-directory/summary', requirePermission('parents.read'), validate(campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await comms.directorySummary(req.user!, v(req, 'query').campusId), 'Parent engagement summary'));

// =============================================================================
// Communication history, unanswered queue, outbound messages
// =============================================================================
r.get('/communications', READ, validate(val.communicationsQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await comms.listCommunications(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Communications retrieved');
});

r.get('/communications/summary', READ, validate(campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await comms.communicationSummary(req.user!, v(req, 'query').campusId), 'Communication summary'));

r.post('/communications', SEND, validate(val.logCommunicationBody), async (req: Request, res: Response) =>
  created(res, await comms.logCommunication(req, v(req)), 'Interaction logged'));

r.post('/communications/send', SEND, validate(val.sendMessageBody), async (req: Request, res: Response) => {
  const out = await comms.sendMessage(req, v(req));
  return created(res, out, out.queued ? `Message sent to ${out.parentName}` : `Message recorded — ${out.parentName} has no app account, so nothing could be delivered`);
});

r.post('/communications/:id/replied', SEND, validate(val.idParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await comms.markReplied(req, v(req, 'params').id), 'Marked as replied'));

// ---- Conversations (staff side) ------------------------------------------------
r.get('/communication/threads', READ, validate(val.threadsQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await comms.listStaffThreads(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Conversations retrieved');
});

r.post('/communication/threads', SEND, validate(val.startThreadBody), async (req: Request, res: Response) =>
  created(res, await comms.startStaffThread(req, v(req)), 'Conversation started'));

r.get('/communication/threads/:id', READ, validate(val.idParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await comms.getStaffThread(req.user!, v(req, 'params').id), 'Conversation retrieved'));

r.post('/communication/threads/:id/reply', SEND, validate(val.idParam, 'params'), validate(val.replyBody), async (req: Request, res: Response) =>
  created(res, await comms.replyStaffThread(req, v(req, 'params').id, v(req).body), 'Reply sent'));

r.post('/communication/threads/:id/close', SEND, validate(val.idParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await comms.setThreadStatus(req, v(req, 'params').id, 'Closed'), 'Conversation closed'));

r.post('/communication/threads/:id/reopen', SEND, validate(val.idParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await comms.setThreadStatus(req, v(req, 'params').id, 'Open'), 'Conversation reopened'));

// =============================================================================
// PTM
// =============================================================================
r.get('/ptm/sessions', READ, validate(val.ptmQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await ptm.listSessions(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'PTM sessions retrieved');
});

r.get('/ptm/summary', READ, validate(campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await ptm.ptmSummary(req.user!, v(req, 'query').campusId), 'PTM summary'));

r.post('/ptm/sessions', SEND, validate(val.ptmSessionBody), async (req: Request, res: Response) =>
  created(res, await ptm.createSession(req, v(req)), 'PTM session created'));

r.get('/ptm/sessions/:id', READ, validate(val.idParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await ptm.getSession(req.user!, v(req, 'params').id), 'PTM session retrieved'));

r.patch('/ptm/sessions/:id', SEND, validate(val.idParam, 'params'), validate(val.ptmSessionPatch), async (req: Request, res: Response) =>
  ok(res, await ptm.updateSession(req, v(req, 'params').id, v(req)), 'PTM session updated'));

r.post('/ptm/sessions/:id/notify', SEND, validate(val.idParam, 'params'), async (req: Request, res: Response) => {
  const out = await ptm.notifyUnbooked(req, v(req, 'params').id);
  return ok(res, out, `Booking reminder sent to ${out.notified} parents`);
});

r.post('/ptm/bookings/:id/status', SEND, validate(val.idParam, 'params'), validate(val.bookingStatusBody), async (req: Request, res: Response) =>
  ok(res, await ptm.setBookingStatus(req, v(req, 'params').id, v(req).status), 'Booking updated'));

// =============================================================================
// Circulars & acknowledgements (also the operations view: /op-circulars)
// =============================================================================
const CIRC_READ = requireAny('communication.read', 'operations.read');

r.get('/circulars', CIRC_READ, validate(val.circularsQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await circ.listCirculars(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Circulars retrieved');
});

r.get('/circulars/summary', CIRC_READ, validate(campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await circ.acknowledgementSummary(v(req, 'query').campusId), 'Acknowledgement summary'));

r.post('/circulars/audience-count', SEND, validate(z.object({ audience: val.audienceSchema, campusId: z.uuid().nullable().optional() })),
  async (req: Request, res: Response) => {
    const a = normalizeAudience(v(req).audience);
    return ok(res, { label: audienceLabel(a), count: await countAudience(a, v(req).campusId) }, 'Audience size');
  });

r.post('/circulars', SEND, validate(val.circularBody), async (req: Request, res: Response) =>
  created(res, await circ.createCircular(req, v(req)), 'Circular saved as draft'));

r.get('/circulars/:id', CIRC_READ, validate(val.idParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await circ.getCircular(v(req, 'params').id), 'Circular retrieved'));

r.put('/circulars/:id', SEND, validate(val.idParam, 'params'), validate(val.circularPatch), async (req: Request, res: Response) =>
  ok(res, await circ.updateCircular(req, v(req, 'params').id, v(req)), 'Circular updated'));

r.get('/circulars/:id/acknowledgements', CIRC_READ, validate(val.idParam, 'params'), validate(val.ackListQuery, 'query'),
  async (req: Request, res: Response) => {
    const f = v(req, 'query');
    const { rows, total } = await circ.listAcknowledgements(v(req, 'params').id, f);
    return paged(res, rows, total, f.page, f.pageSize, 'Acknowledgements retrieved');
  });

r.post('/circulars/:id/submit', SEND, validate(val.idParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await circ.submitCircular(req, v(req, 'params').id), 'Circular sent for approval'));

// Releasing (or returning) a circular is an approval decision: Super Admin only (approvals.decide).
r.post('/circulars/:id/release', requirePermission('approvals.decide'), validate(val.idParam, 'params'),
  async (req: Request, res: Response) => {
    const out = await circ.releaseCircular(req, v(req, 'params').id);
    return ok(res, out, `Circular released to ${out.targetCount} recipients`);
  });

r.post('/circulars/:id/return', requirePermission('approvals.decide'), validate(val.idParam, 'params'),
  async (req: Request, res: Response) => ok(res, await circ.returnCircular(req, v(req, 'params').id), 'Circular returned to draft'));

r.post('/circulars/:id/withdraw', requirePermission('communication.send', 'notifications.broadcast'), validate(val.idParam, 'params'),
  async (req: Request, res: Response) => ok(res, await circ.withdrawCircular(req, v(req, 'params').id), 'Circular withdrawn'));

r.post('/circulars/:id/remind', SEND, validate(val.idParam, 'params'), async (req: Request, res: Response) => {
  const out = await circ.remindCircular(req, v(req, 'params').id);
  return ok(res, out, `Reminder sent to ${out.reminded} of ${out.pending} families`);
});

// =============================================================================
// Events
// =============================================================================
r.get('/events', READ, validate(val.eventsQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await circ.listEvents(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Events retrieved');
});

r.get('/events/summary', READ, validate(campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await circ.eventSummary(v(req, 'query').campusId), 'Event summary'));

r.post('/events', SEND, validate(val.eventBody), async (req: Request, res: Response) =>
  created(res, await circ.createEvent(req, v(req)), 'Event created'));

r.get('/events/:id', READ, validate(val.idParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await circ.getEvent(v(req, 'params').id), 'Event retrieved'));

r.put('/events/:id', SEND, validate(val.idParam, 'params'), validate(val.eventPatch), async (req: Request, res: Response) =>
  ok(res, await circ.updateEvent(req, v(req, 'params').id, v(req)), 'Event updated'));

r.post('/events/:id/cancel', SEND, validate(val.idParam, 'params'), async (req: Request, res: Response) => {
  const out = await circ.cancelEvent(req, v(req, 'params').id);
  return ok(res, out, out.notified ? `Event cancelled — ${out.notified} parents notified` : 'Event cancelled');
});

r.post('/events/:id/notify', SEND, validate(val.idParam, 'params'), async (req: Request, res: Response) => {
  const out = await circ.notifyEvent(req, v(req, 'params').id);
  return ok(res, out, `${out.notified} app users notified`);
});

// =============================================================================
// Family (Parent 360) — always scoped to the signed-in parent
// =============================================================================
r.get('/family/circulars', FAMILY, async (req: Request, res: Response) =>
  ok(res, await circ.familyCirculars(req.user!), 'Circulars retrieved'));

r.post('/family/circulars/:id/acknowledge', FAMILY, validate(val.idParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await circ.acknowledgeCircular(req, v(req, 'params').id), 'Thank you — acknowledgement recorded'));

r.get('/family/ptm', FAMILY, validate(val.familyPtmQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await ptm.familyPtm(req.user!, v(req, 'query').studentId), 'PTM sessions retrieved'));

r.post('/family/ptm/bookings/:id/cancel', FAMILY, validate(val.idParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await ptm.familyCancel(req, v(req, 'params').id), 'Booking cancelled'));

r.post('/family/ptm/:sessionId/book', FAMILY, validate(val.sessionParam, 'params'), validate(val.familyBookBody), async (req: Request, res: Response) =>
  created(res, await ptm.familyBook(req, v(req, 'params').sessionId, v(req)), 'PTM slot booked'));

r.get('/family/events', FAMILY, async (req: Request, res: Response) =>
  ok(res, await circ.familyEvents(req.user!), 'Events retrieved'));

r.get('/family/messages', FAMILY, validate(paginationSchema.extend({ pageSize: z.coerce.number().int().min(1).max(200).default(100) }), 'query'),
  async (req: Request, res: Response) => ok(res, (await comms.listFamilyThreads(req.user!, v(req, 'query'))).rows, 'Messages retrieved'));

r.post('/family/messages', FAMILY, validate(val.familyMessageBody), async (req: Request, res: Response) =>
  created(res, await comms.startFamilyThread(req, v(req)), 'Message sent to the class teacher'));

r.get('/family/messages/:threadId', FAMILY, validate(val.threadParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await comms.getFamilyThread(req.user!, v(req, 'params').threadId), 'Conversation retrieved'));

r.post('/family/messages/:threadId/reply', FAMILY, validate(val.threadParam, 'params'), validate(val.replyBody), async (req: Request, res: Response) =>
  created(res, await comms.replyFamilyThread(req, v(req, 'params').threadId, v(req).body), 'Reply sent'));

export default r;
