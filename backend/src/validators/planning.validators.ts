import { z } from 'zod';
import { paginationSchema } from '../utils/pagination.js';

/** Input schemas for Budget & Planning and the central Approvals inbox. */

const paise = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
const moneyOrZero = z.coerce.number().min(0).max(1_000_000_000).refine(paise, { message: 'At most two decimal places' });
const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const optText = (max: number) => z.string().trim().max(max).optional();
const dateStr = z.iso.date();

export const PLAN_STATUSES = ['Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected'] as const;

export const idParam = z.object({ id: z.uuid() });
export const campusQuery = z.object({ campusId: z.uuid().optional(), academicYearId: z.uuid().optional() });

export const planListQuery = paginationSchema.extend({
  campusId: z.uuid().optional(),
  academicYearId: z.uuid().optional(),
  status: z.enum([...PLAN_STATUSES, 'pending']).optional(),
  category: z.string().trim().max(60).optional(),
  department: z.string().trim().max(80).optional(),
});

const line = z.object({
  item: text(160),
  quantity: z.coerce.number().positive().max(1_000_000),
  unitCost: moneyOrZero,
  notes: optText(300),
});

const planBase = {
  title: text(160, 3),
  campusId: z.uuid(),
  academicYearId: z.uuid().optional(),
  department: text(80, 2),
  category: text(60, 2),
  periodStart: dateStr,
  periodEnd: dateStr,
  justification: optText(4000),
  /** Used only when no line items are given; otherwise the lines are summed. */
  amountRequested: moneyOrZero.optional(),
  lines: z.array(line).max(100).default([]),
};

const periodOk = (b: { periodStart?: string; periodEnd?: string }) => !b.periodStart || !b.periodEnd || b.periodEnd >= b.periodStart;
const hasAmount = (b: { lines?: unknown[]; amountRequested?: number }) => (b.lines?.length ?? 0) > 0 || (b.amountRequested ?? 0) > 0;

export const planCreate = z.object({ ...planBase, submit: z.boolean().default(false) })
  .refine(periodOk, { message: 'The period must end on or after it starts', path: ['periodEnd'] })
  .refine(hasAmount, { message: 'Add at least one line item or an amount', path: ['lines'] });

export const planUpdate = z.object(planBase)
  .refine(periodOk, { message: 'The period must end on or after it starts', path: ['periodEnd'] })
  .refine(hasAmount, { message: 'Add at least one line item or an amount', path: ['lines'] });

export const reasonBody = z.object({ reason: text(500, 3) });
export const noteBody = z.object({ note: optText(500) });
export const approveBody = z.object({
  /** Approve for less than requested; omitted = the full requested amount. */
  amountApproved: moneyOrZero.optional(),
  note: optText(500),
});

// ---- Approvals inbox ----------------------------------------------------------------
export const APPROVAL_MODULES = [
  'budget_plan', 'expense', 'reimbursement', 'concession', 'allowance', 'leave', 'overtime', 'payroll_run',
  'circular', 'lesson_plan', 'report_card', 'document', 'admission', 'maintenance', 'certificate', 'transfer',
  'idea', 'policy',
] as const;
export type ApprovalModule = (typeof APPROVAL_MODULES)[number];

export const pendingQuery = paginationSchema.extend({
  module: z.enum(APPROVAL_MODULES).optional(),
  campusId: z.uuid().optional(),
});

export const decideParams = z.object({
  module: z.enum(APPROVAL_MODULES),
  /** A record id; allowances are decided per type and campus ("<type>|<campusId>"). */
  id: z.string().trim().min(1).max(200),
});

export const decideBody = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: optText(500),
  amountApproved: moneyOrZero.optional(),
}).refine((b) => b.decision !== 'reject' || (b.reason && b.reason.length >= 3), { message: 'Give a reason for rejecting', path: ['reason'] });
