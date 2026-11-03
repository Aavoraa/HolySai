import { z } from 'zod';
import { paginationSchema } from '../utils/pagination.js';

const uuid = z.uuid();
const isoDate = z.iso.date();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const phone = z.string().trim().regex(/^\+?[0-9 ]{8,16}$/, 'Enter a valid phone number');
const name = z.string().trim().min(2, 'At least 2 characters').max(120);
const studentRef = z.string().trim().min(1).max(64); // uuid or admission number

export const uuidParam = z.object({ id: uuid });
export const childParams = z.object({ studentId: studentRef });
export const childItemParams = z.object({ studentId: studentRef, id: uuid });
export const campusQuery = z.object({ campusId: uuid.optional() });

export const GATES = ['Main Gate', 'Rear Gate', 'Visitor Gate', 'Bus Bay'] as const;

// ---- Gate ------------------------------------------------------------------
export const gateEventSchema = z.object({
  studentId: studentRef,
  direction: z.enum(['in', 'out']),
  gate: z.enum(GATES).default('Main Gate'),
  method: z.enum(['RFID', 'Face', 'QR', 'Manual']).default('Manual'),
});

export const gateLogQuery = paginationSchema.extend({
  campusId: uuid.optional(),
  date: isoDate.optional(),
  classId: uuid.optional(),
  sectionId: uuid.optional(),
  status: z.enum(['Inside', 'Exited', 'Not arrived']).optional(),
});

export const gateEventsQuery = paginationSchema.extend({
  campusId: uuid.optional(),
  date: isoDate.optional(),
  direction: z.enum(['in', 'out']).optional(),
  gate: z.enum(GATES).optional(),
  method: z.enum(['RFID', 'Face', 'QR', 'Manual']).optional(),
});

// ---- Pickup ----------------------------------------------------------------
export const PICKUP_METHODS = ['QR', 'QR + Face', 'Face', 'OTP', 'OTP + ID'] as const;

export const pickupCreateSchema = z.object({
  studentId: studentRef,
  personName: name,
  relation: z.string().trim().min(2).max(40),
  phone: phone.optional(),
  method: z.enum(PICKUP_METHODS),
});

export const familyPickupSchema = pickupCreateSchema.omit({ studentId: true }).extend({ phone });

export const pickupListQuery = paginationSchema.extend({
  campusId: uuid.optional(),
  studentId: studentRef.optional(),
  status: z.enum(['Pending', 'Verified', 'Revoked']).optional(),
});

export const otpVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

export const collectionSchema = z.object({
  gate: z.enum(GATES).default('Main Gate'),
  notes: z.string().trim().max(500).optional(),
});

export const unauthorisedSchema = z.object({
  studentId: studentRef,
  personName: name,
  gate: z.enum(GATES).default('Main Gate'),
  notes: z.string().trim().max(1000).optional(),
});

// ---- Visitors --------------------------------------------------------------
export const VISIT_PURPOSES = ['Parent meeting', 'Admission enquiry', 'Vendor / contractor', 'Audit or inspection', 'Other'] as const;

export const visitorCreateSchema = z.object({
  fullName: name,
  phone: phone.optional(),
  purpose: z.string().trim().min(3).max(160),
  hostEmployeeId: uuid,
  campusId: uuid.optional(),
  /** When set, the visit is pre-approved for this time instead of checked in now. */
  expectedAt: z.iso.datetime({ offset: true }).optional(),
  /** RFID visitor card handed over at the desk (card number as the reader types it). */
  rfidTag: z.string().trim().max(40).optional().or(z.literal('').transform(() => undefined)),
});
export const rfidTagSchema = z.object({ tag: z.string().trim().min(4).max(40), campusId: uuid.optional() });

export const visitorListQuery = paginationSchema.extend({
  campusId: uuid.optional(),
  date: isoDate.optional(),
  status: z.enum(['Expected', 'Inside', 'Completed', 'Denied']).optional(),
});

// ---- Transport -------------------------------------------------------------
export const RUN_STATUS = ['Scheduled', 'En route', 'Delayed', 'At campus', 'Completed', 'Maintenance'] as const;

export const routeListQuery = z.object({ campusId: uuid.optional(), q: z.string().trim().max(100).optional() });

export const routeSchema = z.object({
  code: z.string().trim().regex(/^[A-Z]{1,3}\d{1,3}$/, 'Code like R12 or V01'),
  name: z.string().trim().min(2).max(80),
  area: z.string().trim().min(2).max(120),
  campusId: uuid,
  vehicleId: uuid.nullable().optional(),
  driverId: uuid.nullable().optional(),
  attendantId: uuid.nullable().optional(),
});
export const routeUpdateSchema = routeSchema.partial().refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const runStatusSchema = z.object({
  runStatus: z.enum(RUN_STATUS),
  delayMinutes: z.number().int().min(0).max(240).default(0),
  etaText: z.string().trim().max(40).optional(),
  reason: z.string().trim().max(200).optional(),
  notifyParents: z.boolean().default(true),
});

export const routeNotifySchema = z.object({ message: z.string().trim().min(5).max(500) });

export const stopSchema = z.object({
  name: z.string().trim().min(2).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  pickupTime: hhmm,
  dropTime: hhmm.nullable().optional(),
});
export const stopUpdateSchema = stopSchema.partial().refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });
export const stopReorderSchema = z.object({ stopIds: z.array(uuid).min(1).max(100) });
export const stopParams = z.object({ id: uuid, stopId: uuid });

export const assignStudentSchema = z.object({
  studentId: studentRef,
  stopId: uuid.nullable().optional(),
  mode: z.enum(['both', 'pickup_only', 'drop_only']).default('both'),
});
export const routeStudentParams = z.object({ id: uuid, studentId: studentRef });

export const boardingSchema = z.object({
  studentId: studentRef,
  routeId: uuid,
  eventType: z.enum(['boarded', 'deboarded']),
  stopId: uuid.nullable().optional(),
  method: z.enum(['RFID', 'Manual', 'QR']).default('Manual'),
});

// ---- Emergency -------------------------------------------------------------
export const AUDIENCES = ['parents', 'teachers', 'staff', 'management'] as const;
export const CHANNEL_SETS = ['App + WhatsApp + SMS', 'App + WhatsApp', 'SMS only'] as const;

export const broadcastSchema = z.object({
  alertType: z.enum(['Emergency', 'Drill', 'Urgent operational notice', 'Lockdown', 'Evacuation', 'Weather', 'Transport']),
  message: z.string().trim().min(10, 'Say what is happening and what people should do').max(1000),
  audiences: z.array(z.enum(AUDIENCES)).min(1, 'Choose at least one audience').default([...AUDIENCES]),
  channels: z.enum(CHANNEL_SETS).default('App + WhatsApp + SMS'),
  campusId: uuid.optional(),
  confirm: z.literal(true, { error: 'Confirm the broadcast before sending' }),
});

export const broadcastListQuery = paginationSchema.extend({ campusId: uuid.optional() });

// ---- Incidents -------------------------------------------------------------
export const INCIDENT_TYPES = ['Safeguarding', 'Health', 'Transport', 'Facilities', 'Security', 'Emergency'] as const;
export const SEVERITIES = ['Critical', 'Attention', 'Information'] as const;
export const INCIDENT_STATUS = ['Open', 'Under Review', 'Escalated', 'Closed'] as const;

export const incidentListQuery = paginationSchema.extend({
  campusId: uuid.optional(),
  type: z.enum(INCIDENT_TYPES).optional(),
  status: z.enum(INCIDENT_STATUS).optional(),
  severity: z.enum(SEVERITIES).optional(),
  studentId: studentRef.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const incidentCreateSchema = z.object({
  incidentType: z.enum(INCIDENT_TYPES),
  summary: z.string().trim().min(5).max(200),
  details: z.string().trim().max(4000).optional(),
  severity: z.enum(SEVERITIES),
  studentId: studentRef.optional(),
  ownerId: uuid.optional(),
  occurredOn: isoDate.optional(),
  isConfidential: z.boolean().default(false),
  campusId: uuid.optional(),
});

export const incidentUpdateSchema = z.object({
  status: z.enum(INCIDENT_STATUS).optional(),
  severity: z.enum(SEVERITIES).optional(),
  ownerId: uuid.nullable().optional(),
  details: z.string().trim().max(4000).optional(),
}).refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

// ---- Infirmary -------------------------------------------------------------
export const OUTCOMES = ['Under observation', 'Returned to class', 'Awaiting pickup', 'Sent home', 'Referred to hospital'] as const;

export const infirmaryListQuery = paginationSchema.extend({
  campusId: uuid.optional(),
  date: isoDate.optional(),
  outcome: z.enum(OUTCOMES).optional(),
});

export const infirmaryCreateSchema = z.object({
  studentId: studentRef,
  reason: z.string().trim().min(2).max(200),
  actionTaken: z.string().trim().max(500).optional(),
  outcome: z.enum(OUTCOMES).default('Under observation'),
  parentInformed: z.boolean().default(false),
  visitedAt: z.iso.datetime({ offset: true }).optional(),
});

export const infirmaryUpdateSchema = z.object({
  outcome: z.enum(OUTCOMES).optional(),
  actionTaken: z.string().trim().max(500).optional(),
  parentInformed: z.boolean().optional(),
}).refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

// ---- Counselling -----------------------------------------------------------
export const SESSION_STATUS = ['Scheduled', 'Completed', 'Cancelled', 'Referred'] as const;

export const counsellingListQuery = paginationSchema.extend({
  campusId: uuid.optional(),
  status: z.enum(SESSION_STATUS).optional(),
  when: z.enum(['upcoming', 'past']).optional(),
});

export const counsellingCreateSchema = z.object({
  studentId: studentRef,
  counsellorId: uuid,
  sessionOn: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(3).max(200),
  status: z.enum(SESSION_STATUS).default('Scheduled'),
  notes: z.string().trim().max(4000).optional(),
});

export const counsellingUpdateSchema = z.object({
  status: z.enum(SESSION_STATUS).optional(),
  sessionOn: z.iso.datetime({ offset: true }).optional(),
  notes: z.string().trim().max(4000).optional(),
}).refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const studentSearchQuery = z.object({
  q: z.string().trim().max(80).optional(),
  campusId: uuid.optional(),
  routeId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
