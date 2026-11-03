import { Router, type Request, type Response } from 'express';
import { requireAny, requirePermission } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { created, ok, paged } from '../utils/response.js';
import * as val from '../validators/safety.validators.js';
import { audit } from '../services/audit.service.js';
import { searchStudents } from '../services/safety-common.service.js';
import * as gate from '../services/safety-gate.service.js';
import * as pickup from '../services/safety-pickup.service.js';
import * as visitors from '../services/safety-visitors.service.js';
import * as transport from '../services/safety-transport.service.js';
import * as care from '../services/safety-care.service.js';

/**
 * Safety & transport: Smart Gate, gate log, pickup, visitors, bus tracking,
 * routes, boarding, emergency alerts, safeguarding, infirmary, counselling,
 * plus the family (Parent 360) safety endpoints. Mounted at /api.
 */
const r = Router();

const SAFETY_READ = requirePermission('safety.read');
const SAFETY_MANAGE = requirePermission('safety.manage');
const TRANSPORT_READ = requirePermission('transport.read');
const TRANSPORT_MANAGE = requirePermission('transport.manage');
const EITHER_READ = requireAny('safety.read', 'transport.read');
const FAMILY = requirePermission('parent_portal.use');

const campusOf = (req: Request) => (v<{ campusId?: string }>(req, 'query').campusId);

// ---------------------------------------------------------------------------
// Shared: student picker
// ---------------------------------------------------------------------------
r.get('/safety/students', EITHER_READ, validate(val.studentSearchQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await searchStudents(req.user!, v(req, 'query')), 'Students'));

// ---------------------------------------------------------------------------
// Smart Gate & gate log
// ---------------------------------------------------------------------------
r.get('/gate/summary', SAFETY_READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await gate.gateSummary(req.user!, campusOf(req)), 'Gate summary'));

r.get('/gate/feed', SAFETY_READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await gate.gateFeed(req.user!, campusOf(req)), 'Gate activity'));

r.get('/gate/log', SAFETY_READ, validate(val.gateLogQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await gate.gateLog(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Gate log retrieved');
});

r.get('/gate/events', SAFETY_READ, validate(val.gateEventsQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await gate.gateEvents(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Gate events retrieved');
});

r.get('/gate/events/export', SAFETY_READ, validate(val.gateEventsQuery.partial(), 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const csv = await gate.gateEventsCsv(req.user!, f);
  await audit(req, { action: 'export', module: 'safety', description: `Exported gate log (${f.date ?? 'today'})`, metadata: { filters: f } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="gate-log-${f.date ?? new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send('﻿' + csv);
});

r.post('/gate/events', SAFETY_MANAGE, validate(val.gateEventSchema), async (req: Request, res: Response) => {
  const out = await gate.recordGateEvent(req, v(req));
  return created(res, out, out.direction === 'in'
    ? `Entry recorded${out.parentNotified ? ' — parents notified of safe arrival' : ''}`
    : `Exit recorded${out.parentNotified ? ' — parents notified' : ''}`);
});

// ---------------------------------------------------------------------------
// Pickup authorisation
// ---------------------------------------------------------------------------
r.get('/pickup/summary', SAFETY_READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await pickup.pickupSummary(req.user!, campusOf(req)), 'Pickup summary'));

r.get('/pickup/authorisations', SAFETY_READ, validate(val.pickupListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await pickup.listAuthorisations(req, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Pickup authorisations retrieved');
});

r.post('/pickup/authorisations', SAFETY_MANAGE, validate(val.pickupCreateSchema), async (req: Request, res: Response) =>
  created(res, await pickup.staffCreate(req, v(req)), 'Authorised person added — awaiting verification'));

r.post('/pickup/authorisations/:id/otp', SAFETY_MANAGE, validate(val.uuidParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await pickup.sendOtp(req, v(req, 'params').id), `One-time code sent to the registered parent (valid ${pickup.OTP_TTL_MINUTES} minutes)`));

r.post('/pickup/authorisations/:id/verify', SAFETY_MANAGE, validate(val.uuidParam, 'params'), validate(val.otpVerifySchema),
  async (req: Request, res: Response) => ok(res, await pickup.verifyOtp(req, v(req, 'params').id, v(req).code), 'Person verified'));

r.post('/pickup/authorisations/:id/revoke', SAFETY_MANAGE, validate(val.uuidParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await pickup.staffRevoke(req, v(req, 'params').id), 'Authorisation revoked'));

r.post('/pickup/authorisations/:id/collect', SAFETY_MANAGE, validate(val.uuidParam, 'params'), validate(val.collectionSchema),
  async (req: Request, res: Response) => created(res, await pickup.recordCollection(req, v(req, 'params').id, v(req)), 'Collection recorded — parents notified'));

r.post('/pickup/unauthorised', SAFETY_MANAGE, validate(val.unauthorisedSchema), async (req: Request, res: Response) => {
  const out = await pickup.reportUnauthorised(req, v(req));
  return created(res, out, `Collection held — incident ${out.incidentCode} raised, principal and office alerted`);
});

// ---------------------------------------------------------------------------
// Visitors
// ---------------------------------------------------------------------------
r.get('/visitors/summary', SAFETY_READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await visitors.visitorSummary(campusOf(req)), 'Visitor summary'));

r.get('/visitors', SAFETY_READ, validate(val.visitorListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await visitors.listVisitors(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Visitors retrieved');
});

r.post('/visitors', SAFETY_MANAGE, validate(val.visitorCreateSchema), async (req: Request, res: Response) => {
  const out = await visitors.createVisitor(req, v(req));
  return created(res, out, out.status === 'Expected' ? `Visit pre-approved — badge ${out.badgeNo}` : `Checked in — badge ${out.badgeNo}, host notified`);
});

// RFID cards: a tap on the desk reader checks in (pre-approved) or out. Registered before /visitors/:id.
r.post('/visitors/rfid-tap', SAFETY_MANAGE, validate(val.rfidTagSchema), async (req: Request, res: Response) => {
  const b = v(req);
  const out = await visitors.tapCard(req, b.tag, b.campusId);
  return ok(res, out, `${out.visitor.fullName} checked ${out.action}${out.action === 'in' ? ' — host notified' : ' — card returned'}`);
});

r.post('/visitors/:id/rfid', SAFETY_MANAGE, validate(val.uuidParam, 'params'), validate(val.rfidTagSchema), async (req: Request, res: Response) =>
  ok(res, await visitors.assignCard(req, v(req, 'params').id, v(req).tag), 'Card assigned'));

r.post('/visitors/:id/check-in', SAFETY_MANAGE, validate(val.uuidParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await visitors.checkIn(req, v(req, 'params').id), 'Visitor checked in — host notified'));

r.post('/visitors/:id/check-out', SAFETY_MANAGE, validate(val.uuidParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await visitors.checkOut(req, v(req, 'params').id), 'Visitor checked out'));

r.post('/visitors/:id/deny', SAFETY_MANAGE, validate(val.uuidParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await visitors.deny(req, v(req, 'params').id), 'Entry denied'));

// ---------------------------------------------------------------------------
// Transport: buses, routes, stops, boarding
// ---------------------------------------------------------------------------
r.get('/transport/routes', TRANSPORT_READ, validate(val.routeListQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await transport.listRoutes(v(req, 'query')), 'Routes retrieved'));

r.get('/transport/vehicles', TRANSPORT_READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await transport.listVehicles(campusOf(req)), 'Vehicles retrieved'));

r.get('/transport/boarding/summary', TRANSPORT_READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await transport.boardingSummary(campusOf(req)), 'Boarding reconciliation'));

r.post('/transport/boarding', TRANSPORT_MANAGE, validate(val.boardingSchema), async (req: Request, res: Response) => {
  const out = await transport.recordBoarding(req, v(req));
  return created(res, out, `${out.eventType === 'boarded' ? 'Boarding' : 'De-boarding'} confirmed — parents notified`);
});

r.get('/transport/routes/:id', TRANSPORT_READ, validate(val.uuidParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await transport.routeDetail(req.user!, v(req, 'params').id), 'Route retrieved'));

r.post('/transport/routes', TRANSPORT_MANAGE, validate(val.routeSchema), async (req: Request, res: Response) =>
  created(res, await transport.createRoute(req, v(req)), 'Route created'));

r.put('/transport/routes/:id', TRANSPORT_MANAGE, validate(val.uuidParam, 'params'), validate(val.routeUpdateSchema),
  async (req: Request, res: Response) => ok(res, await transport.updateRoute(req, v(req, 'params').id, v(req)), 'Route updated'));

r.delete('/transport/routes/:id', TRANSPORT_MANAGE, validate(val.uuidParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await transport.deleteRoute(req, v(req, 'params').id), 'Route deleted'));

r.patch('/transport/routes/:id/run', TRANSPORT_MANAGE, validate(val.uuidParam, 'params'), validate(val.runStatusSchema),
  async (req: Request, res: Response) => {
    const out = await transport.updateRun(req, v(req, 'params').id, v(req));
    return ok(res, out, `Run status updated${out.parentsNotified ? ` — ${out.parentsNotified} parents notified` : ''}`);
  });

r.post('/transport/routes/:id/notify', TRANSPORT_MANAGE, validate(val.uuidParam, 'params'), validate(val.routeNotifySchema),
  async (req: Request, res: Response) => {
    const out = await transport.notifyRouteParents(req, v(req, 'params').id, v(req).message);
    return ok(res, out, `Message sent to ${out.parentsNotified} parents`);
  });

r.post('/transport/routes/:id/stops', TRANSPORT_MANAGE, validate(val.uuidParam, 'params'), validate(val.stopSchema),
  async (req: Request, res: Response) => created(res, await transport.addStop(req, v(req, 'params').id, v(req)), 'Stop added'));

r.put('/transport/routes/:id/stops/order', TRANSPORT_MANAGE, validate(val.uuidParam, 'params'), validate(val.stopReorderSchema),
  async (req: Request, res: Response) => ok(res, await transport.reorderStops(req, v(req, 'params').id, v(req).stopIds), 'Stop order saved'));

r.put('/transport/routes/:id/stops/:stopId', TRANSPORT_MANAGE, validate(val.stopParams, 'params'), validate(val.stopUpdateSchema),
  async (req: Request, res: Response) => {
    const p = v(req, 'params');
    return ok(res, await transport.updateStop(req, p.id, p.stopId, v(req)), 'Stop updated');
  });

r.delete('/transport/routes/:id/stops/:stopId', TRANSPORT_MANAGE, validate(val.stopParams, 'params'), async (req: Request, res: Response) => {
  const p = v(req, 'params');
  return ok(res, await transport.deleteStop(req, p.id, p.stopId), 'Stop removed');
});

r.post('/transport/routes/:id/students', TRANSPORT_MANAGE, validate(val.uuidParam, 'params'), validate(val.assignStudentSchema),
  async (req: Request, res: Response) => ok(res, await transport.assignStudent(req, v(req, 'params').id, v(req)), 'Student assigned to route'));

r.delete('/transport/routes/:id/students/:studentId', TRANSPORT_MANAGE, validate(val.routeStudentParams, 'params'), async (req: Request, res: Response) => {
  const p = v(req, 'params');
  return ok(res, await transport.unassignStudent(req, p.id, p.studentId), 'Student removed from route');
});

// ---------------------------------------------------------------------------
// Emergency alerts
// ---------------------------------------------------------------------------
const BROADCAST = requireAny('notifications.broadcast', 'safety.manage');

r.get('/emergency/audience', SAFETY_READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await care.audience(campusOf(req)), 'Broadcast audience'));

r.get('/emergency/broadcasts', SAFETY_READ, validate(val.broadcastListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await care.listBroadcasts(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Broadcast history');
});

r.post('/emergency/broadcasts', BROADCAST, validate(val.broadcastSchema), async (req: Request, res: Response) => {
  const out = await care.sendBroadcast(req, v(req));
  return created(res, out, `Broadcast sent to ${out.recipients} recipients — logged in the audit trail`);
});

// ---------------------------------------------------------------------------
// Incidents & safeguarding
// ---------------------------------------------------------------------------
r.get('/incidents/summary', SAFETY_READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await care.incidentSummary(req.user!, campusOf(req)), 'Incident summary'));

r.get('/incidents', SAFETY_READ, validate(val.incidentListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await care.listIncidents(req, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Incidents retrieved');
});

r.get('/incidents/:id', SAFETY_READ, validate(val.uuidParam, 'params'), async (req: Request, res: Response) =>
  ok(res, await care.getIncident(req, v(req, 'params').id), 'Incident retrieved'));

r.post('/incidents', SAFETY_MANAGE, validate(val.incidentCreateSchema), async (req: Request, res: Response) =>
  created(res, await care.createIncident(req, v(req)), 'Incident logged'));

r.patch('/incidents/:id', SAFETY_MANAGE, validate(val.uuidParam, 'params'), validate(val.incidentUpdateSchema),
  async (req: Request, res: Response) => ok(res, await care.updateIncident(req, v(req, 'params').id, v(req)), 'Incident updated'));

// ---------------------------------------------------------------------------
// Infirmary
// ---------------------------------------------------------------------------
r.get('/infirmary/summary', SAFETY_READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await care.infirmarySummary(req.user!, campusOf(req)), 'Infirmary summary'));

r.get('/infirmary/visits', SAFETY_READ, validate(val.infirmaryListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await care.listVisits(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Infirmary visits retrieved');
});

r.post('/infirmary/visits', SAFETY_MANAGE, validate(val.infirmaryCreateSchema), async (req: Request, res: Response) =>
  created(res, await care.createVisit(req, v(req)), 'Visit logged'));

r.patch('/infirmary/visits/:id', SAFETY_MANAGE, validate(val.uuidParam, 'params'), validate(val.infirmaryUpdateSchema),
  async (req: Request, res: Response) => ok(res, await care.updateVisit(req, v(req, 'params').id, v(req)), 'Visit updated'));

// ---------------------------------------------------------------------------
// Counselling
// ---------------------------------------------------------------------------
r.get('/counselling/summary', SAFETY_READ, validate(val.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await care.counsellingSummary(req.user!, campusOf(req)), 'Counselling summary'));

r.get('/counselling/sessions', SAFETY_READ, validate(val.counsellingListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await care.listSessions(req, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Counselling sessions retrieved');
});

r.post('/counselling/sessions', SAFETY_MANAGE, validate(val.counsellingCreateSchema), async (req: Request, res: Response) =>
  created(res, await care.createSession(req, v(req)), 'Session booked'));

r.patch('/counselling/sessions/:id', SAFETY_MANAGE, validate(val.uuidParam, 'params'), validate(val.counsellingUpdateSchema),
  async (req: Request, res: Response) => ok(res, await care.updateSession(req, v(req, 'params').id, v(req)), 'Session updated'));

// ---------------------------------------------------------------------------
// Family (Parent 360): own children only; anything else is 404
// ---------------------------------------------------------------------------
r.get('/family/children/:studentId/safety', FAMILY, validate(val.childParams, 'params'), async (req: Request, res: Response) => {
  const id = await pickup.familyChild(req, v(req, 'params').studentId);
  const [gateToday, bus, pickupList] = await Promise.all([
    gate.familyGateToday(id),
    transport.familyBus(id),
    pickup.familyPickupList(id),
  ]);
  await audit(req, { action: 'view', module: 'safety', description: 'Parent viewed child safety and transport', entityType: 'student', entityId: id });
  return ok(res, { gateToday, bus, pickup: pickupList }, 'Child safety retrieved');
});

r.post('/family/children/:studentId/pickup', FAMILY, validate(val.childParams, 'params'), validate(val.familyPickupSchema),
  async (req: Request, res: Response) =>
    created(res, await pickup.familyCreate(req, v(req, 'params').studentId, v(req)), 'Pickup person added — the front office will verify them'));

r.post('/family/children/:studentId/pickup/:id/confirm', FAMILY, validate(val.childItemParams, 'params'), async (req: Request, res: Response) => {
  const p = v(req, 'params');
  return ok(res, await pickup.familyConfirm(req, p.studentId, p.id), 'Pickup person confirmed');
});

r.post('/family/children/:studentId/pickup/:id/revoke', FAMILY, validate(val.childItemParams, 'params'), async (req: Request, res: Response) => {
  const p = v(req, 'params');
  return ok(res, await pickup.familyRevoke(req, p.studentId, p.id), 'Pickup person removed');
});

export default r;
