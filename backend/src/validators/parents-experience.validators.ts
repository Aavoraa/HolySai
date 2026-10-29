import { z } from 'zod';
import { paginationSchema } from '../utils/pagination.js';

export const idParam = z.object({ id: z.uuid() });
export const attachmentParam = z.object({ id: z.uuid(), attachmentId: z.uuid() });
export const threadParam = z.object({ threadId: z.uuid() });
export const sessionParam = z.object({ sessionId: z.uuid() });
const studentRef = z.string().trim().min(1).max(64);
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const bool = z.stringbool();

// ---- Audience (circulars and events) --------------------------------------------
export const audienceSchema = z
  .object({
    kind: z.enum(['all', 'grades', 'transport', 'staff']),
    grades: z.array(z.number().int().min(1).max(12)).max(12).optional(),
  })
  .refine((a) => a.kind !== 'grades' || (a.grades && a.grades.length > 0), { message: 'Choose at least one grade', path: ['grades'] });
export type Audience = z.infer<typeof audienceSchema>;

// ---- Parent directory --------------------------------------------------------------
export const directoryQuery = paginationSchema.extend({
  campusId: z.uuid().optional(),
  engagement: z.enum(['high', 'medium', 'low']).optional(),
  ptm: z.enum(['booked', 'not_booked']).optional(),
  app: z.enum(['yes', 'no']).optional(),
  gradeLevel: z.coerce.number().int().min(1).max(12).optional(),
});

// ---- Communications ----------------------------------------------------------------
export const CHANNELS = ['WhatsApp', 'Email', 'SMS', 'Call', 'Note', 'In-app'] as const;

export const communicationsQuery = paginationSchema.extend({
  channel: z.enum(CHANNELS).optional(),
  direction: z.enum(['inbound', 'outbound', 'internal']).optional(),
  needsReply: bool.optional(),
  parentId: z.uuid().optional(),
  studentId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  campusId: z.uuid().optional(),
});

export const logCommunicationBody = z.object({
  channel: z.enum(['Call', 'Note']),
  parentId: z.uuid().optional(),
  studentId: z.uuid().optional(),
  counterpart: text(2, 120).optional(),
  subject: text(3, 160),
  body: z.string().trim().max(2000).optional(),
  status: z.enum(['Connected', 'No answer', 'Left voicemail', 'Internal']).optional(),
  direction: z.enum(['inbound', 'outbound', 'internal']).optional(),
  needsReply: z.boolean().default(false),
}).refine((b) => b.channel === 'Note' || b.parentId, { message: 'Choose the parent you called', path: ['parentId'] })
  .refine((b) => b.parentId || b.counterpart, { message: 'Choose a parent or name the contact', path: ['counterpart'] });

export const sendMessageBody = z.object({
  parentId: z.uuid(),
  studentId: z.uuid().optional(),
  channel: z.enum(['WhatsApp', 'Email', 'SMS', 'In-app']),
  subject: text(3, 160),
  body: text(2, 2000),
  replyTo: z.uuid().optional(),
});

// ---- Threads -----------------------------------------------------------------------
export const threadsQuery = paginationSchema.extend({
  status: z.enum(['Open', 'Closed']).optional(),
  unread: bool.optional(),
});
export const startThreadBody = z.object({
  parentId: z.uuid(),
  studentId: z.uuid(),
  subject: text(3, 160),
  body: text(1, 2000),
});
export const replyBody = z.object({ body: text(1, 2000) });
export const familyMessageBody = z.object({ studentId: studentRef, subject: text(3, 160), body: text(1, 2000) });

// ---- PTM ---------------------------------------------------------------------------
export const ptmQuery = paginationSchema.extend({
  when: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
  campusId: z.uuid().optional(),
  employeeId: z.uuid().optional(),
});
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
export const ptmSessionBody = z.object({
  employeeId: z.uuid(),
  sectionId: z.uuid(),
  subjectLabel: text(3, 120),
  sessionDate: z.iso.date(),
  startsAt: hhmm.default('09:00'),
  slotMinutes: z.number().int().min(5).max(60).default(10),
  totalSlots: z.number().int().min(1).max(60),
  venue: z.string().trim().max(120).optional(),
});
export const ptmSessionPatch = z.object({
  totalSlots: z.number().int().min(1).max(60).optional(),
  venue: z.string().trim().max(120).optional(),
  startsAt: hhmm.optional(),
  sessionDate: z.iso.date().optional(),
});
export const bookingStatusBody = z.object({ status: z.enum(['Booked', 'Attended', 'Cancelled', 'No-show']) });
export const familyPtmQuery = z.object({ studentId: studentRef.optional() });
export const familyBookBody = z.object({ studentId: studentRef, slotNo: z.number().int().min(1).max(60) });

// ---- Circulars ---------------------------------------------------------------------
export const circularsQuery = paginationSchema.extend({
  status: z.enum(['Draft', 'Under Review', 'Released', 'Withdrawn']).optional(),
  campusId: z.uuid().optional(),
});
export const circularBody = z.object({
  title: text(3, 160),
  body: text(10, 5000),
  audience: audienceSchema,
  campusId: z.uuid().nullable().optional(),
  requiresAck: z.boolean().default(true),
  channels: z.array(z.enum(['whatsapp', 'sms', 'email', 'push'])).max(4).default(['whatsapp', 'push']),
});
export const circularPatch = z.object({
  title: text(3, 160).optional(),
  body: text(10, 5000).optional(),
  audience: audienceSchema.optional(),
  campusId: z.uuid().nullable().optional(),
  requiresAck: z.boolean().optional(),
  channels: z.array(z.enum(['whatsapp', 'sms', 'email', 'push'])).max(4).optional(),
});
export const ackListQuery = paginationSchema.extend({ state: z.enum(['pending', 'acknowledged']).default('pending') });

// ---- Events ------------------------------------------------------------------------
export const EVENT_TYPES = ['School', 'Sports', 'Academic', 'PTM', 'Cultural', 'Holiday'] as const;
export const eventsQuery = paginationSchema.extend({
  when: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  status: z.enum(['Draft', 'Published', 'Cancelled']).optional(),
  type: z.enum(EVENT_TYPES).optional(),
  campusId: z.uuid().optional(),
});
export const eventBody = z.object({
  title: text(3, 160),
  description: z.string().trim().max(2000).optional(),
  eventType: z.enum(EVENT_TYPES).default('School'),
  startsOn: z.iso.date(),
  endsOn: z.iso.date().nullable().optional(),
  startsAt: hhmm.nullable().optional(),
  venue: z.string().trim().max(120).optional(),
  audience: audienceSchema.default({ kind: 'all' }),
  campusId: z.uuid().nullable().optional(),
  status: z.enum(['Draft', 'Published']).default('Published'),
}).refine((e) => !e.endsOn || e.endsOn >= e.startsOn, { message: 'End date must be on or after the start date', path: ['endsOn'] });
export const eventPatch = z.object({
  title: text(3, 160).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  eventType: z.enum(EVENT_TYPES).optional(),
  startsOn: z.iso.date().optional(),
  endsOn: z.iso.date().nullable().optional(),
  startsAt: hhmm.nullable().optional(),
  venue: z.string().trim().max(120).nullable().optional(),
  audience: audienceSchema.optional(),
  campusId: z.uuid().nullable().optional(),
  status: z.enum(['Draft', 'Published']).optional(),
});
