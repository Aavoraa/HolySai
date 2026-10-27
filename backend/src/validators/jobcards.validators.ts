import { z } from 'zod';
import { paginationSchema } from '../utils/pagination.js';

const uuid = z.uuid();
const isoDate = z.iso.date();
const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const hours = z.coerce.number().min(0).max(9999).optional().nullable();

export const JC_CATEGORIES = ['Maintenance', 'IT', 'Event support', 'Academic', 'Administrative', 'Transport', 'Housekeeping', 'Procurement', 'HR', 'Other'] as const;
export const JC_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;
export const JC_STATUSES = ['Open', 'Assigned', 'In Progress', 'On Hold', 'Completed', 'Closed', 'Cancelled', 'Reopened'] as const;

export const idParam = z.object({ id: uuid });

export const jobCardListQuery = paginationSchema.extend({
  status: z.enum([...JC_STATUSES, 'active']).optional(),            // active = not Completed / Closed / Cancelled
  priority: z.enum(JC_PRIORITIES).optional(),
  category: z.enum(JC_CATEGORIES).optional(),
  direction: z.enum(['in', 'out', 'mine', 'all']).optional(),
  departmentId: uuid.optional(),
  overdue: z.stringbool().optional(),
  campusId: uuid.optional(),
});

export const jobCardSummaryQuery = z.object({ campusId: uuid.optional() });

export const jobCardCreate = z.object({
  fromDepartmentId: uuid.optional(),
  toDepartmentId: uuid,
  title: text(160, 3),
  description: optText(2000),
  category: z.enum(JC_CATEGORIES).default('Other'),
  priority: z.enum(JC_PRIORITIES).default('Medium'),
  dueOn: isoDate.optional().nullable(),
  location: optText(160),
  campusId: uuid.optional().nullable(),
  estimatedHours: hours,
});

export const jobCardUpdate = z.object({
  title: text(160, 3).optional(),
  description: optText(2000),
  category: z.enum(JC_CATEGORIES).optional(),
  priority: z.enum(JC_PRIORITIES).optional(),
  dueOn: isoDate.optional().nullable(),
  location: optText(160),
  estimatedHours: hours,
  actualHours: hours,
}).refine((b) => Object.values(b).some((x) => x !== undefined), { message: 'Nothing to update' });

export const jobCardStatus = z.object({
  status: z.enum(JC_STATUSES),
  note: optText(1000),
  actualHours: hours,
});

export const jobCardAssign = z.object({
  employeeId: uuid,
  note: optText(1000),
});

export const jobCardComment = z.object({ body: text(2000, 1) });

export const departmentListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  includeInactive: z.stringbool().optional(),
});

export const departmentCreate = z.object({
  name: text(80, 2),
  code: z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, - and _ only'),
  description: optText(300),
  headEmployeeId: uuid.optional().nullable(),
  campusId: uuid.optional().nullable(),
  isActive: z.boolean().default(true),
});

export const departmentUpdate = z.object({
  name: text(80, 2).optional(),
  code: z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, - and _ only').optional(),
  description: optText(300),
  headEmployeeId: uuid.optional().nullable(),
  campusId: uuid.optional().nullable(),
  isActive: z.boolean().optional(),
}).refine((b) => Object.values(b).some((x) => x !== undefined), { message: 'Nothing to update' });
