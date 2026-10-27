import { z } from 'zod';
import { paginationSchema } from '../utils/pagination.js';

const uuid = z.uuid();
const isoDate = z.iso.date();
const dateTime = z.iso.datetime({ offset: true });
const phone = z.string().trim().regex(/^\+?[0-9 ]{8,16}$/, 'Enter a valid phone number');
const optText = (max: number) => z.string().trim().max(max).optional();

export const STAGES = ['New Lead', 'Contacted', 'Qualified', 'Visit Scheduled', 'Visit Completed', 'Application', 'Assessment', 'Offer', 'Enrolled'] as const;
export const ALL_STAGES = [...STAGES, 'Lost'] as const;
export const SOURCES = ['WhatsApp', 'Website', 'Meta Ads', 'Referral', 'Google', 'Walk-in', 'Instagram', 'Phone'] as const;
export const FOLLOW_UP_TYPES = ['Call', 'WhatsApp', 'Email', 'SMS', 'Campus Visit', 'Meeting', 'Note'] as const;
export const APP_STATUSES = ['Draft', 'Submitted', 'Under Review', 'Assessment Scheduled', 'Offer Made', 'Accepted', 'Enrolled', 'Rejected', 'Withdrawn'] as const;
export const CHANNELS = ['WhatsApp', 'Email', 'SMS', 'Call', 'Note'] as const;

export const idParam = z.object({ id: uuid });
/** Lead id: uuid or business code (LD-4412). */
export const leadParam = z.object({ id: z.string().regex(/^([0-9a-f-]{36}|LD-\d{3,6})$/i, 'Invalid lead reference') });
export const docParam = z.object({ id: uuid, docId: uuid });
export const campusQuery = z.object({ campusId: uuid.optional() });

const csvStages = z.string().max(300).optional()
  .transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined))
  .refine((a) => !a || a.every((x) => (ALL_STAGES as readonly string[]).includes(x)), { message: 'Unknown stage' });

export const leadListQuery = paginationSchema.extend({
  campusId: uuid.optional(),
  stage: z.enum(ALL_STAGES).optional(),
  stages: csvStages,
  source: z.enum(SOURCES).optional(),
  counsellorId: z.union([uuid, z.literal('unassigned')]).optional(),
  grade: z.string().max(20).optional(),
  open: z.stringbool().optional(),
  overdue: z.stringbool().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const leadCreateSchema = z.object({
  campusId: uuid,
  parentName: z.string().trim().min(2).max(120),
  phone,
  email: z.email().optional(),
  studentName: z.string().trim().min(2).max(120),
  studentDob: isoDate.optional(),
  gradeApplied: z.string().trim().regex(/^Grade (1[0-2]|[1-9])$/, 'Choose a grade'),
  curriculum: optText(60),
  source: z.enum(SOURCES),
  campaign: optText(80),
  leadScore: z.number().int().min(0).max(100).default(50),
  counsellorId: uuid.nullable().optional(),
  transportRequired: z.boolean().default(false),
  notes: optText(1000),
  referredByParentId: uuid.optional(),
});

export const leadUpdateSchema = leadCreateSchema
  .omit({ referredByParentId: true, counsellorId: true })
  .partial()
  .extend({
    leadScore: z.number().int().min(0).max(100).optional(),
    transportRequired: z.boolean().optional(),
    nextAction: optText(160),
    nextActionAt: dateTime.nullable().optional(),
    acquisitionCost: z.number().min(0).max(1_000_000).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const stageChangeSchema = z.object({
  stage: z.enum(ALL_STAGES),
  note: z.string().trim().min(3, 'Add a short note').max(500),
  lostReason: optText(200),
}).refine((o) => o.stage !== 'Lost' || !!o.lostReason, { message: 'Give a reason for closing the lead', path: ['lostReason'] });

export const assignSchema = z.object({ counsellorId: uuid.nullable() });

export const followUpCreateSchema = z.object({
  type: z.enum(FOLLOW_UP_TYPES),
  scheduledAt: dateTime,
  notes: z.string().trim().min(2).max(500),
  assignedTo: uuid.nullable().optional(),
});

export const followUpUpdateSchema = z.object({
  status: z.enum(['Scheduled', 'Completed', 'Missed', 'Cancelled']).optional(),
  outcome: optText(300),
  notes: optText(500),
  scheduledAt: dateTime.optional(),
  assignedTo: uuid.nullable().optional(),
}).refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const followUpListQuery = paginationSchema.extend({
  campusId: uuid.optional(),
  type: z.enum(FOLLOW_UP_TYPES).optional(),
  status: z.enum(['Scheduled', 'Completed', 'Missed', 'Cancelled']).optional(),
  due: z.enum(['overdue', 'today', 'upcoming']).optional(),
  assignedTo: uuid.optional(),
});

export const communicationSchema = z.object({
  channel: z.enum(CHANNELS),
  subject: z.string().trim().min(2).max(200),
  body: optText(2000),
  direction: z.enum(['inbound', 'outbound', 'internal']).optional(),
  status: optText(40),
});

// ---- Visits ----------------------------------------------------------------------
export const visitListQuery = paginationSchema.extend({
  campusId: uuid.optional(),
  range: z.enum(['week', 'upcoming', 'past', 'all']).default('week'),
  status: z.enum(['Scheduled', 'Completed', 'Missed', 'Cancelled']).optional(),
  unhosted: z.stringbool().optional(),
});

export const visitCreateSchema = z.object({
  enquiryId: uuid,
  scheduledAt: dateTime,
  hostId: uuid.nullable().optional(),
  notes: optText(500),
});

// ---- Applications ----------------------------------------------------------------
export const applicationListQuery = paginationSchema.extend({
  campusId: uuid.optional(),
  status: z.enum([...APP_STATUSES, 'live']).optional(),
  grade: z.string().max(20).optional(),
  documents: z.enum(['complete', 'incomplete']).optional(),
  form: z.enum(['none', 'manual', 'upload', 'both', 'received']).optional(),
});

// ---- Admission form (the filled paper / PDF form behind an application) -----------
/** Today in school time (Asia/Kolkata), so a form received this morning is never "in the future". */
export const schoolToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
export const pastDate = isoDate.refine((d) => d <= schoolToday(), { message: 'Date cannot be in the future' });
const formText = (max: number) => z.string().trim().max(max).optional().transform((s) => (s === '' ? undefined : s));
const formPhone = z.string().trim().optional().transform((s) => (s === '' ? undefined : s))
  .refine((s) => !s || /^\+?[0-9 ]{8,16}$/.test(s), { message: 'Enter a valid phone number' });
const formEmail = z.string().trim().optional().transform((s) => (s === '' ? undefined : s))
  .refine((s) => !s || z.email().safeParse(s).success, { message: 'Enter a valid email' });
export const FORM_SOURCES = ['Manual', 'Upload', 'Online'] as const;
export const PRIMARY_CONTACTS = ['Father', 'Mother', 'Guardian'] as const;
export const GRADE_RE = /^Grade (1[0-2]|[1-9])$/;

/** Every field on the school's admission form. All optional — completeness is checked on submit. */
export const admissionFormFields = z.object({
  // Student details
  studentFirstName: formText(60),
  studentLastName: formText(60),
  dateOfBirth: pastDate.optional(),
  gender: z.enum(['M', 'F', 'O']).optional(),
  gradeApplied: z.string().trim().regex(GRADE_RE, 'Choose a grade').optional(),
  placeOfBirth: formText(80),
  nationality: formText(60),
  religion: formText(60),
  motherTongue: formText(60),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  // Parents / guardian
  fatherName: formText(120),
  fatherOccupation: formText(120),
  fatherPhone: formPhone,
  fatherEmail: formEmail,
  motherName: formText(120),
  motherOccupation: formText(120),
  motherPhone: formPhone,
  motherEmail: formEmail,
  guardianName: formText(120),
  guardianRelationship: formText(60),
  guardianPhone: formPhone,
  guardianEmail: formEmail,
  primaryContact: z.enum(PRIMARY_CONTACTS).optional(),
  // Address & contact
  address: formText(300),
  city: formText(60),
  state: formText(60),
  pincode: z.string().trim().optional().transform((s) => (s === '' ? undefined : s))
    .refine((s) => !s || /^[0-9]{6}$/.test(s), { message: 'PIN code must be 6 digits' }),
  emergencyContactName: formText(120),
  emergencyContactPhone: formPhone,
  // Previous schooling
  previousSchool: formText(160),
  previousBoard: formText(60),
  previousGrade: formText(30),
  reasonForLeaving: formText(300),
  // Health & other
  siblingsInSchool: z.boolean().optional(),
  siblingDetails: formText(300),
  medicalNotes: formText(500),
  allergies: formText(300),
  specialNeeds: formText(300),
  transportRequired: z.boolean().optional(),
  // Declaration
  declarationSignedBy: formText(120),
  declarationDate: pastDate.optional(),
});
export type AdmissionForm = z.infer<typeof admissionFormFields>;

/** Fields a submitted (complete) form must carry; the primary contact's name and phone are checked separately. */
export const REQUIRED_FORM_FIELDS: [keyof AdmissionForm, string][] = [
  ['studentFirstName', 'Enter the student’s first name'],
  ['studentLastName', 'Enter the student’s last name'],
  ['dateOfBirth', 'Enter the date of birth'],
  ['gender', 'Select a gender'],
  ['primaryContact', 'Choose the primary contact'],
  ['address', 'Enter the address'],
  ['city', 'Enter the city'],
  ['declarationSignedBy', 'Enter who signed the declaration'],
];

export const applicationFormSchema = z.object({
  form: admissionFormFields.prefault({}),
  receivedOn: pastDate.optional(),
  /** true = the form is complete: every required field is checked and a Draft application is submitted. */
  submit: z.boolean().default(false),
});

const walkInSchema = z.object({
  campusId: uuid,
  parentName: z.string().trim().min(2).max(120),
  phone,
  email: z.email().optional(),
  studentName: z.string().trim().min(2).max(120),
  gradeApplied: z.string().trim().regex(GRADE_RE, 'Choose a grade'),
  curriculum: optText(60),
  source: z.enum(SOURCES).default('Walk-in'),
  counsellorId: uuid.nullable().optional(),
});

/**
 * Open an application either for an existing lead ({ enquiryId }) or for a
 * family with no lead yet ({ walkIn }) — the lead is then created at the
 * Application stage. The admission form may be entered in the same call.
 */
export const applicationCreateSchema = z.object({
  enquiryId: uuid.optional(),
  walkIn: walkInSchema.optional(),
  dateOfBirth: isoDate.optional(),
  gender: z.enum(['M', 'F', 'O']).optional(),
  previousSchool: optText(160),
  form: admissionFormFields.optional(),
  formSource: z.enum(FORM_SOURCES).optional(),
  receivedOn: pastDate.optional(),
  submit: z.boolean().default(false),
}).refine((o) => !!o.enquiryId !== !!o.walkIn, { message: 'Choose an existing lead or enter the new family', path: ['enquiryId'] });

/** One row of the bulk import CSV (column headers = these keys). */
export const importRowSchema = admissionFormFields.extend({
  parentName: z.string().trim().min(2, 'Parent name is required').max(120),
  phone,
  email: formEmail,
  studentName: z.string().trim().min(2, 'Student name is required').max(120),
  gradeApplied: z.string().trim().regex(GRADE_RE, 'Grade must look like "Grade 4"'),
  source: z.enum(SOURCES).default('Walk-in'),
  receivedOn: pastDate.optional(),
});

/** Multipart fields sent with the import file. */
export const applicationImportSchema = z.object({
  campusId: uuid,
  dryRun: z.stringbool().default(false),
});

export const applicationUpdateSchema = z.object({
  studentName: z.string().trim().min(2).max(120).optional(),
  dateOfBirth: isoDate.nullable().optional(),
  gender: z.enum(['M', 'F', 'O']).nullable().optional(),
  previousSchool: optText(160),
  assessmentAt: dateTime.nullable().optional(),
  assessmentScore: z.number().min(0).max(100).nullable().optional(),
  offerExpiresOn: isoDate.nullable().optional(),
  feePaid: z.boolean().optional(),
}).refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const applicationStatusSchema = z.object({
  status: z.enum(['Submitted', 'Under Review', 'Assessment Scheduled', 'Offer Made', 'Accepted', 'Rejected', 'Withdrawn']),
  note: z.string().trim().min(3, 'Add a short note').max(500),
  assessmentAt: dateTime.optional(),
  assessmentScore: z.number().min(0).max(100).optional(),
  offerExpiresOn: isoDate.optional(),
}).refine((o) => o.status !== 'Assessment Scheduled' || !!o.assessmentAt, { message: 'Choose the assessment date and time', path: ['assessmentAt'] });

export const documentStatusSchema = z.object({ status: z.enum(['Pending', 'Submitted', 'Verified', 'Rejected']) });

/** Student / guardian fields left out are filled from the admission form saved on the application. */
export const enrolSchema = z.object({
  sectionId: uuid,
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  dateOfBirth: isoDate.optional(),
  gender: z.enum(['M', 'F', 'O']).optional(),
  admittedOn: isoDate.optional(),
  house: optText(30),
  address: optText(300),
  city: optText(60),
  pincode: z.string().regex(/^[0-9]{6}$/, 'PIN code must be 6 digits').optional(),
  guardian: z.object({
    parentId: uuid.optional(),
    fullName: z.string().trim().min(2).max(120).optional(),
    phone: phone.optional(),
    email: z.email().optional(),
    relationship: z.enum(['Father', 'Mother', 'Guardian']).optional(),
  }).optional(),
  transport: z.object({ routeId: uuid, stopId: uuid.optional() }).optional(),
});

// ---- Referrals -----------------------------------------------------------------------
export const referralListQuery = paginationSchema.extend({
  status: z.enum(['Submitted', 'Contacted', 'Enrolled', 'Lost']).optional(),
  rewardStatus: z.enum(['Not eligible', 'Pending', 'Credited']).optional(),
  campusId: uuid.optional(),
});

export const referralCreateSchema = z.object({
  referrerParentId: uuid,
  referredName: z.string().trim().min(2).max(120),
  createLead: z.boolean().default(true),
  lead: z.object({
    campusId: uuid,
    parentName: z.string().trim().min(2).max(120),
    phone,
    gradeApplied: z.string().trim().regex(/^Grade (1[0-2]|[1-9])$/, 'Choose a grade'),
  }).optional(),
}).refine((o) => !o.createLead || !!o.lead, { message: 'Lead details are required', path: ['lead'] });

export const rewardSchema = z.object({ rewardStatus: z.enum(['Pending', 'Credited']) });
export const referrerQuery = z.object({ q: z.string().trim().min(2).max(60) });

// ---- CRM -----------------------------------------------------------------------------
export const alumniListQuery = paginationSchema.extend({
  engagement: z.enum(['High', 'Medium', 'Low']).optional(),
  batch: z.coerce.number().int().min(1990).max(2100).optional(),
});

export const alumniSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  batchYear: z.number().int().min(1990).max(2100),
  university: optText(120),
  career: optText(120),
  email: z.email().optional(),
  phone: phone.optional(),
  engagement: z.enum(['High', 'Medium', 'Low']).default('Low'),
  lastEngagement: optText(160),
});
export const alumniUpdateSchema = alumniSchema.partial().extend({ engagement: z.enum(['High', 'Medium', 'Low']).optional() }).refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const vendorListQuery = paginationSchema.extend({
  status: z.enum(['Active', 'Renewal due', 'Expired', 'Suspended']).optional(),
  category: z.string().max(60).optional(),
});

const vendorBase = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
  contactPerson: optText(120),
  phone: phone.optional(),
  email: z.email().optional(),
  contractStart: isoDate.optional(),
  contractEnd: isoDate.optional(),
  contractValue: z.number().min(0).max(1_000_000_000).default(0),
  status: z.enum(['Active', 'Renewal due', 'Expired', 'Suspended']).default('Active'),
});
const contractOrder = (o: { contractStart?: string; contractEnd?: string }) => !o.contractStart || !o.contractEnd || o.contractEnd >= o.contractStart;
export const vendorSchema = vendorBase.refine(contractOrder, { message: 'Contract end must be after the start', path: ['contractEnd'] });
export const vendorUpdateSchema = vendorBase.partial()
  .extend({ contractValue: z.number().min(0).max(1_000_000_000).optional(), status: z.enum(['Active', 'Renewal due', 'Expired', 'Suspended']).optional() })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' })
  .refine(contractOrder, { message: 'Contract end must be after the start', path: ['contractEnd'] });

export const partnerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  partnerType: z.string().trim().min(2).max(60),
  sinceYear: z.number().int().min(1950).max(2100).optional(),
  status: z.enum(['Active', 'Inactive']).default('Active'),
  note: optText(300),
});
export const partnerUpdateSchema = partnerSchema.partial().extend({ status: z.enum(['Active', 'Inactive']).optional() }).refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export const partnerListQuery = paginationSchema.extend({ status: z.enum(['Active', 'Inactive']).optional() });

export const commListQuery = paginationSchema.extend({
  channel: z.enum([...CHANNELS, 'In-app']).optional(),
});
