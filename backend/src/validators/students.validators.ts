import { z } from 'zod';
import { paginationSchema } from '../utils/pagination.js';

const uuid = z.uuid();
const isoDate = z.iso.date();

export const studentListQuery = paginationSchema.extend({
  campusId: uuid.optional(),
  classId: uuid.optional(),
  sectionId: uuid.optional(),
  grade: z.string().max(20).optional(),          // "Grade 5"
  risk: z.enum(['On Track', 'Watch', 'Developing Risk', 'At Risk']).optional(),
  status: z.enum(['active', 'alumni', 'transferred', 'withdrawn']).optional(),
  feeStatus: z.enum(['Paid', 'Partial', 'Overdue', 'Pending']).optional(),
  today: z.enum(['present', 'absent', 'late', 'leave', 'unmarked']).optional(),
  house: z.string().max(30).optional(),
});

const guardianInput = z.object({
  parentId: uuid.optional(),
  fullName: z.string().min(2).max(120).optional(),
  phone: z.string().regex(/^\+?[0-9 ]{8,16}$/, 'Enter a valid phone number').optional(),
  email: z.email().optional(),
  relationship: z.string().min(2).max(30),
  isPrimary: z.boolean().default(false),
}).refine((g) => g.parentId || (g.fullName && g.phone), { message: 'Provide an existing parentId, or a name and phone for a new parent' });

export const studentCreateSchema = z.object({
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  dateOfBirth: isoDate,
  gender: z.enum(['M', 'F', 'O']),
  bloodGroup: z.string().max(4).optional(),
  campusId: uuid,
  sectionId: uuid,
  house: z.string().max(30).optional(),
  address: z.string().max(300).optional(),
  city: z.string().max(60).optional(),
  pincode: z.string().regex(/^[0-9]{6}$/, 'PIN code must be 6 digits').optional(),
  email: z.email().optional(),
  phone: z.string().regex(/^\+?[0-9 ]{8,16}$/).optional(),
  admittedOn: isoDate.optional(),
  medicalNotes: z.string().max(1000).optional(),
  photoUrl: z.url().max(500).optional(),
  admissionNo: z.string().regex(/^HS-\d{4}-\d{4}$/, 'Format: HS-YYYY-NNNN').optional(),
  guardians: z.array(guardianInput).max(4).default([]),
  transport: z.object({ routeId: uuid, stopId: uuid.optional() }).optional(),
  enableTracking: z.boolean().default(false),
});

export const studentUpdateSchema = studentCreateSchema
  .omit({ guardians: true, admissionNo: true, enableTracking: true, transport: true })
  .partial()
  .extend({
    status: z.enum(['active', 'alumni', 'transferred', 'withdrawn']).optional(),
    riskLevel: z.enum(['On Track', 'Watch', 'Developing Risk', 'At Risk']).optional(),
    counsellorId: uuid.nullable().optional(),
    // Bus route and pickup stop, or null to switch to own transport.
    transport: z.object({ routeId: uuid, stopId: uuid.optional() }).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const idParam = z.object({ id: z.string().min(1).max(64) });

export const behaviourSchema = z.object({
  recordType: z.enum(['Positive', 'Note', 'Concern', 'Incident']),
  note: z.string().min(3).max(1000),
  recordedOn: isoDate.optional(),
});

export const achievementSchema = z.object({
  title: z.string().min(3).max(200),
  achievementType: z.enum(['Competition', 'Academic', 'Co-curricular', 'Attendance', 'Sports', 'Service']),
  level: z.enum(['School', 'District', 'State', 'National', 'International']).optional(),
  achievedOn: isoDate,
});

export const observationSchema = z.object({
  observation: z.string().min(3).max(2000),
});
