import { z } from 'zod';
import { paginationSchema } from '../utils/pagination.js';

export const CONTACT_KINDS = ['parent', 'teacher', 'staff', 'other'] as const;
export const TARGET_KINDS = ['principal', 'staff', 'office', 'class_teacher', 'management'] as const;
export const MANUAL_CHANNELS = ['Walk-in', 'Phone call', 'WhatsApp', 'Email', 'Message', 'Letter', 'Other'] as const;
/** Channels that appear in the unified log (manual + automatic sources). */
export const LOG_CHANNELS = [...MANUAL_CHANNELS, 'SMS', 'PTM meeting'] as const;
export const PURPOSES = ['Academic', 'Fees', 'Transport', 'Admission', 'Complaint', 'Behaviour', 'Health', 'Leave', 'Meeting request', 'General', 'Other'] as const;
export const OUTCOMES = ['Met', 'Spoke on call', 'Not available', 'Callback scheduled', 'Message left', 'Resolved', 'Escalated', 'Pending'] as const;
/** Outcomes produced by automatic sources, in addition to the manual ones. */
export const LOG_OUTCOMES = [...OUTCOMES, 'Responded', 'Received', 'Scheduled', 'No-show', 'In meeting'] as const;
export const SOURCES = ['manual', 'communication', 'message', 'ptm', 'visitor'] as const;
/** Outcomes that close a manual entry. */
export const CLOSING_OUTCOMES: readonly string[] = ['Met', 'Spoke on call', 'Resolved'];

const bool = z.stringbool();
const isoDate = z.iso.date();

const rangeShape = {
  from: isoDate.optional(),
  to: isoDate.optional(),
  campusId: z.uuid().optional(),
};

export const idParam = z.object({ id: z.uuid() });
export const parentParam = z.object({ parentId: z.uuid() });

export const listQuery = paginationSchema.extend({
  ...rangeShape,
  contactKind: z.enum(CONTACT_KINDS).optional(),
  parentId: z.uuid().optional(),
  target: z.enum(TARGET_KINDS).optional(),
  targetEmployeeId: z.uuid().optional(),
  channel: z.enum(LOG_CHANNELS).optional(),
  purpose: z.enum(PURPOSES).optional(),
  outcome: z.enum(LOG_OUTCOMES).optional(),
  source: z.enum(SOURCES).optional(),
  open: bool.optional(),
}).refine((f) => !f.from || !f.to || f.from <= f.to, { message: '"From" must be on or before "To"', path: ['from'] });
export type ListFilters = z.infer<typeof listQuery>;

export const summaryQuery = z.object(rangeShape)
  .refine((f) => !f.from || !f.to || f.from <= f.to, { message: '"From" must be on or before "To"', path: ['from'] });
export type SummaryFilters = z.infer<typeof summaryQuery>;

export const targetsQuery = z.object({ campusId: z.uuid().optional() });
export const parentSearchQuery = z.object({ q: z.string().trim().min(1).max(100), limit: z.coerce.number().int().min(1).max(20).default(8) });

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const createBody = z.object({
  contactKind: z.enum(CONTACT_KINDS),
  parentId: z.uuid().optional(),
  employeeId: z.uuid().optional(),
  contactName: text(2, 120).optional(),
  contactPhone: z.string().trim().max(30).regex(/^[0-9+()\-\s]*$/, 'Enter a valid phone number').optional(),
  studentId: z.uuid().optional(),
  targetKind: z.enum(TARGET_KINDS),
  targetEmployeeId: z.uuid().optional(),
  channel: z.enum(MANUAL_CHANNELS),
  purpose: z.enum(PURPOSES),
  summary: text(3, 1000),
  outcome: z.enum(OUTCOMES).default('Pending'),
  followUpOn: isoDate.optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  campusId: z.uuid().optional(),
})
  .refine((b) => b.contactKind !== 'parent' || b.parentId, { message: 'Choose the parent', path: ['parentId'] })
  .refine((b) => !['teacher', 'staff'].includes(b.contactKind) || b.employeeId, { message: 'Choose the staff member', path: ['employeeId'] })
  .refine((b) => b.contactKind !== 'other' || b.contactName, { message: 'Enter the visitor or caller name', path: ['contactName'] })
  .refine((b) => b.targetKind !== 'staff' || b.targetEmployeeId, { message: 'Choose the staff member they wanted to reach', path: ['targetEmployeeId'] })
  .refine((b) => !b.occurredAt || new Date(b.occurredAt).getTime() <= Date.now() + 5 * 60_000, { message: 'The contact time cannot be in the future', path: ['occurredAt'] });
export type CreateBody = z.infer<typeof createBody>;

export const patchBody = z.object({
  outcome: z.enum(OUTCOMES).optional(),
  resolved: z.boolean().optional(),
  followUpOn: isoDate.nullable().optional(),
  resolutionNote: z.string().trim().max(1000).nullable().optional(),
  summary: text(3, 1000).optional(),
  purpose: z.enum(PURPOSES).optional(),
}).refine((b) => Object.values(b).some((x) => x !== undefined), { message: 'Nothing to update' });
export type PatchBody = z.infer<typeof patchBody>;
