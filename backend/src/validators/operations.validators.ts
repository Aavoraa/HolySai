import { z } from 'zod';
import { paginationSchema } from '../utils/pagination.js';

const uuid = z.uuid();
const isoDate = z.iso.date();
const hhmm = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use HH:MM (24-hour)');
const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const optText = (max: number) => z.string().trim().max(max).optional().nullable();

export const idParam = z.object({ id: uuid });
export const campusQuery = z.object({ campusId: uuid.optional() });

// ---- Assets -----------------------------------------------------------------
export const ASSET_CATEGORIES = ['IT', 'Lab', 'Vehicle', 'Facilities', 'Furniture', 'Sports', 'Library'] as const;
export const ASSET_STATUSES = ['Active', 'Maintenance due', 'In maintenance', 'Retired'] as const;

export const assetListQuery = paginationSchema.extend({
  campusId: uuid.optional(),
  category: z.enum(ASSET_CATEGORIES).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  serviceDue: z.coerce.number().int().min(1).max(365).optional(),   // due within N days
});

export const assetCreate = z.object({
  campusId: uuid,
  name: text(160, 2),
  category: z.enum(ASSET_CATEGORIES),
  location: optText(120),
  facilityId: uuid.optional().nullable(),
  assignedTo: uuid.optional().nullable(),
  purchasedOn: isoDate.optional().nullable(),
  purchaseValue: z.coerce.number().min(0).max(1e10).optional().nullable(),
  nextServiceOn: isoDate.optional().nullable(),
  status: z.enum(ASSET_STATUSES).default('Active'),
});
// Zod applies .default() inside .partial(), so defaulted fields are re-declared
// without a default; otherwise every partial update would reset them.
export const assetUpdate = assetCreate.partial().extend({ status: z.enum(ASSET_STATUSES).optional() });
export const assetService = z.object({
  servicedOn: isoDate,
  nextServiceOn: isoDate,
  note: optText(300),
}).refine((b) => b.nextServiceOn > b.servicedOn, { message: 'Next service must be after the service date', path: ['nextServiceOn'] });

// ---- Facilities ---------------------------------------------------------------
export const FACILITY_TYPES = ['Classroom', 'Lab', 'Hall', 'Field', 'Library', 'Studio', 'Other'] as const;
export const facilityCreate = z.object({
  campusId: uuid,
  name: text(120, 2),
  facilityType: z.enum(FACILITY_TYPES),
  capacity: z.coerce.number().int().min(1).max(5000).optional().nullable(),
  status: z.enum(['Available', 'In use', 'Maintenance', 'Closed']).default('Available'),
});
export const facilityUpdate = facilityCreate.partial().extend({ status: z.enum(['Available', 'In use', 'Maintenance', 'Closed']).optional() });
export const bookingQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });
export const bookingCreate = z.object({
  bookedOn: isoDate,
  startsAt: hhmm,
  endsAt: hhmm,
  purpose: text(160, 3),
}).refine((b) => b.endsAt > b.startsAt, { message: 'End time must be after the start time', path: ['endsAt'] });

// ---- Maintenance -------------------------------------------------------------
export const MR_STATUSES = ['Submitted', 'Under Review', 'Approved', 'In Progress', 'Completed', 'Rejected'] as const;
export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;
export const maintenanceListQuery = paginationSchema.extend({
  campusId: uuid.optional(),
  status: z.enum([...MR_STATUSES, 'open']).optional(),
  priority: z.enum(PRIORITIES).optional(),
  mine: z.stringbool().optional(),
});
export const maintenanceCreate = z.object({
  campusId: uuid.optional(),
  description: text(300, 5),
  priority: z.enum(PRIORITIES).default('Medium'),
  assetId: uuid.optional().nullable(),
  facilityId: uuid.optional().nullable(),
});
export const maintenanceStatus = z.object({
  status: z.enum(MR_STATUSES),
  assignedTo: uuid.optional().nullable(),
  cost: z.coerce.number().min(0).max(1e8).optional().nullable(),
  note: optText(300),
});

// ---- Inventory ---------------------------------------------------------------
export const INVENTORY_CATEGORIES = ['Stationery', 'Lab', 'Health', 'Transport', 'Office', 'Housekeeping', 'Uniform', 'Sports'] as const;
export const inventoryListQuery = paginationSchema.extend({
  campusId: uuid.optional(),
  category: z.string().max(40).optional(),
  level: z.enum(['low', 'at_minimum', 'ok']).optional(),
});
export const inventoryCreate = z.object({
  campusId: uuid,
  sku: z.string().trim().regex(/^[A-Z0-9-]{3,30}$/, 'Use capitals, digits and dashes (3–30)').optional(),
  name: text(120, 2),
  category: z.enum(INVENTORY_CATEGORIES),
  unit: text(20),
  quantity: z.coerce.number().int().min(0).max(1e7).default(0),
  reorderLevel: z.coerce.number().int().min(0).max(1e7),
  unitCost: z.coerce.number().min(0).max(1e7).default(0),
});
export const inventoryUpdate = inventoryCreate.omit({ quantity: true, sku: true }).partial()
  .extend({ unitCost: z.coerce.number().min(0).max(1e7).optional() });
export const movementCreate = z.object({
  movementType: z.enum(['in', 'out', 'adjust']),
  quantity: z.coerce.number().int().min(0).max(1e7),
  note: optText(200),
}).refine((b) => b.movementType === 'adjust' || b.quantity > 0, { message: 'Quantity must be at least 1', path: ['quantity'] });
export const movementListQuery = paginationSchema.extend({ itemId: uuid.optional(), campusId: uuid.optional() });
export const purchaseRequest = z.object({ quantity: z.coerce.number().int().min(1).max(1e7), note: optText(300) });

// ---- Documents ---------------------------------------------------------------
export const schoolDocQuery = paginationSchema.extend({
  collection: z.string().max(80).optional(),
  status: z.enum(['Pending', 'Submitted', 'Verified', 'Rejected', 'Expired']).optional(),
});
export const pendingDocQuery = paginationSchema.extend({ campusId: uuid.optional(), status: z.enum(['Pending', 'Submitted']).optional() });

// ---- Certificates ------------------------------------------------------------
export const CERT_TYPES = ['Transfer certificate', 'Bonafide certificate', 'Conduct certificate', 'Study certificate', 'Achievement certificate'] as const;
export const CERT_STATUSES = ['Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected', 'Issued'] as const;
export const certListQuery = paginationSchema.extend({
  campusId: uuid.optional(),
  status: z.enum(CERT_STATUSES).optional(),
  type: z.enum(CERT_TYPES).optional(),
});
export const certCreate = z.object({
  certificateType: z.enum(CERT_TYPES),
  studentId: z.string().min(3).max(64),
  purpose: optText(200),
});
export const certDecision = z.object({
  action: z.enum(['review', 'approve', 'reject', 'issue']),
  note: optText(300),
});
export const certCode = z.object({ code: z.string().trim().regex(/^[A-Z]{2}-[0-9]{4}-[0-9]{3,6}$/, 'Invalid verification code') });
export const studentParam = z.object({ studentId: z.string().min(3).max(64) });

// ---- Compliance --------------------------------------------------------------
export const COMPLIANCE_STATUSES = ['Scheduled', 'In Progress', 'Due Soon', 'Overdue', 'Completed'] as const;
export const complianceListQuery = paginationSchema.extend({
  campusId: uuid.optional(),
  status: z.enum(COMPLIANCE_STATUSES).optional(),
  includeCompleted: z.stringbool().optional(),
});
export const complianceCreate = z.object({
  campusId: uuid,
  item: text(160, 3),
  authority: text(120, 2),
  dueOn: isoDate,
  ownerName: text(120, 2).optional(),
  ownerId: uuid.optional().nullable(),
  notes: optText(500),
}).refine((b) => b.ownerName || b.ownerId, { message: 'Choose an owner', path: ['ownerId'] });
export const complianceUpdate = z.object({
  item: text(160, 3).optional(),
  authority: text(120, 2).optional(),
  dueOn: isoDate.optional(),
  ownerName: text(120, 2).optional(),
  ownerId: uuid.optional().nullable(),
  status: z.enum(['Scheduled', 'In Progress']).optional(),
  notes: optText(500),
});
export const complianceComplete = z.object({ completedOn: isoDate, notes: optText(500), nextDueOn: isoDate.optional() });
