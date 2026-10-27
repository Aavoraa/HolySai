import { z } from 'zod';
import { paginationSchema } from '../utils/pagination.js';

const uuid = z.uuid();
const optUuid = z.uuid().optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date');
const text = (max: number) => z.string().trim().min(1, 'Required').max(max);
const optText = (max: number) => z.string().trim().max(max).optional().nullable();

export const idParam = z.object({ id: uuid });
export const campusQuery = z.object({ campusId: optUuid });

// ---- Attendance ---------------------------------------------------------------
export const attendanceSectionsQuery = z.object({ campusId: optUuid, date: isoDate.optional() });
export const registerQuery = z.object({ sectionId: uuid, date: isoDate.optional() });
export const ATTENDANCE_STATUS = ['present', 'late', 'absent', 'leave'] as const;
export const registerSave = z.object({
  sectionId: uuid,
  date: isoDate,
  marks: z.array(z.object({
    studentId: uuid,
    status: z.enum(ATTENDANCE_STATUS),
    arrivalTime: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM').optional().nullable(),
    remarks: optText(300),
  })).min(1, 'Mark at least one student').max(200),
});
export const attendanceSummaryQuery = z.object({ campusId: optUuid, date: isoDate.optional() });

// ---- Classes / subjects / curriculum -----------------------------------------------
export const classesQuery = paginationSchema.extend({ campusId: optUuid, grade: z.coerce.number().int().min(1).max(12).optional(), register: z.enum(['Marked', 'Partial', 'Not marked']).optional() });
export const sectionUpdate = z.object({
  classTeacherId: z.uuid().nullable().optional(),
  room: z.string().trim().max(40).nullable().optional(),
}).refine((b) => b.classTeacherId !== undefined || b.room !== undefined, 'Nothing to update');
export const objectivesQuery = paginationSchema.extend({ subjectId: optUuid, stage: z.string().max(40).optional() });
export const objectiveCreate = z.object({
  code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9.\-]+$/, 'Letters, numbers, dots and dashes only'),
  description: text(300),
  subjectId: uuid,
  stageLabel: text(40),
  coveragePct: z.coerce.number().int().min(0).max(100).default(0),
  masteryPct: z.coerce.number().int().min(0).max(100).default(0),
});
export const objectiveUpdate = z.object({
  description: text(300).optional(),
  stageLabel: text(40).optional(),
  coveragePct: z.coerce.number().int().min(0).max(100).optional(),
  masteryPct: z.coerce.number().int().min(0).max(100).optional(),
}).refine((b) => Object.values(b).some((x) => x !== undefined), 'Nothing to update');
export const objectiveImport = z.object({ rows: z.array(objectiveCreate).min(1).max(200) });

// ---- Timetable ---------------------------------------------------------------------
export const timetableQuery = z.object({ sectionId: optUuid, employeeId: optUuid, campusId: optUuid });
export const substituteAssign = z.object({ substituteId: uuid, note: optText(200) });
export const timetableEntryUpdate = z.object({
  subjectId: z.uuid().nullable().optional(),
  activity: z.string().trim().max(40).nullable().optional(),
  employeeId: z.uuid().nullable().optional(),
  room: z.string().trim().max(40).nullable().optional(),
  needsSubstitute: z.boolean().optional(),
});
export const timetablePublish = z.object({ sectionId: uuid, note: optText(300) });

// ---- Assessments -------------------------------------------------------------------
export const ASSESSMENT_TYPES = ['test', 'exam', 'mock', 'quiz', 'project', 'unit_test'] as const;
export const ASSESSMENT_STATUS = ['Scheduled', 'In Progress', 'Moderation', 'Completed'] as const;
export const assessmentsQuery = paginationSchema.extend({
  campusId: optUuid, status: z.enum(ASSESSMENT_STATUS).optional(), subjectId: optUuid, classId: optUuid,
});
export const assessmentCreate = z.object({
  name: text(160),
  classId: uuid,
  sectionId: z.uuid().nullable().optional(),
  subjectId: uuid,
  assessmentType: z.enum(ASSESSMENT_TYPES).default('test'),
  heldOn: isoDate,
  maxMarks: z.coerce.number().positive('Must be above 0').max(1000),
  /** Optional Cambridge IGCSE paper this assessment mirrors (grading then applies Core/Extended tier rules). */
  syllabusComponentId: z.uuid().nullable().optional(),
});
export const marksSave = z.object({
  marks: z.array(z.object({
    studentId: uuid,
    marks: z.number().min(0).nullable(),
    isAbsent: z.boolean().default(false),
    remarks: optText(200),
  })).max(500),
  action: z.enum(['save', 'moderation', 'complete']).default('save'),
});

// ---- Question bank -----------------------------------------------------------------
export const QUESTION_TYPES = ['mcq', 'short', 'long', 'numeric'] as const;
export const DIFFICULTY = ['Foundation', 'Core', 'Higher'] as const;
export const questionsQuery = paginationSchema.extend({
  subjectId: optUuid, topic: z.string().max(120).optional(), difficulty: z.enum(DIFFICULTY).optional(),
  status: z.enum(['Draft', 'Approved', 'Retired']).optional(),
});
export const topicsQuery = z.object({ subjectId: optUuid, q: z.string().trim().max(100).optional() });
export const questionCreate = z.object({
  subjectId: uuid,
  topic: text(120),
  stageLabel: text(40),
  question: text(2000),
  questionType: z.enum(QUESTION_TYPES).default('short'),
  difficulty: z.enum(DIFFICULTY).default('Core'),
  marks: z.coerce.number().int().min(1).max(100).default(1),
  status: z.enum(['Draft', 'Approved']).default('Draft'),
});
export const questionUpdate = z.object({
  topic: text(120).optional(),
  stageLabel: text(40).optional(),
  question: text(2000).optional(),
  questionType: z.enum(QUESTION_TYPES).optional(),
  difficulty: z.enum(DIFFICULTY).optional(),
  marks: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(['Draft', 'Approved', 'Retired']).optional(),
}).refine((b) => Object.values(b).some((x) => x !== undefined), 'Nothing to update');

// ---- Lesson plans ------------------------------------------------------------------
export const LESSON_STATUS = ['Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected'] as const;
export const lessonPlansQuery = paginationSchema.extend({
  campusId: optUuid, status: z.enum(LESSON_STATUS).optional(), subjectId: optUuid, sectionId: optUuid,
  mine: z.enum(['true', 'false']).optional(),
});
const planContent = z.object({
  objective: z.string().max(1000).optional(),
  plan: z.array(z.object({ time: z.string().max(40), step: z.string().max(120), detail: z.string().max(600) })).max(20).optional(),
  activities: z.array(z.string().max(200)).max(20).optional(),
  differentiation: z.array(z.object({ level: z.string().max(40), detail: z.string().max(400) })).max(10).optional(),
  homework: z.string().max(600).optional(),
});
export const lessonPlanCreate = z.object({
  title: text(160),
  sectionId: uuid,
  subjectId: uuid,
  objectiveId: z.uuid().nullable().optional(),
  plannedFor: isoDate,
  content: planContent.default({}),
  aiGenerated: z.boolean().default(false),
  submit: z.boolean().default(false),
});
export const lessonPlanUpdate = z.object({
  title: text(160).optional(),
  objectiveId: z.uuid().nullable().optional(),
  plannedFor: isoDate.optional(),
  content: planContent.optional(),
});
export const lessonPlanTransition = z.object({
  action: z.enum(['submit', 'review', 'approve', 'reject', 'reopen']),
  note: optText(500),
}).refine((b) => b.action !== 'reject' || (b.note && b.note.length >= 3), { message: 'Give a reason for rejecting', path: ['note'] });

// ---- Homework ---------------------------------------------------------------------
export const homeworkQuery = paginationSchema.extend({
  campusId: optUuid, sectionId: optUuid, subjectId: optUuid, status: z.enum(['Open', 'Closed', 'Overdue', 'Draft']).optional(),
});
export const homeworkCreate = z.object({
  sectionId: uuid,
  subjectId: uuid,
  title: text(160),
  instructions: optText(2000),
  dueOn: isoDate,
  status: z.enum(['Draft', 'Open']).default('Open'),
});
export const submissionSave = z.object({
  studentId: uuid,
  status: z.enum(['Submitted', 'Late', 'Reviewed', 'Missing']),
  feedback: optText(500),
});

// ---- Report cards ------------------------------------------------------------------
export const reportCardsQuery = z.object({ campusId: optUuid, term: z.string().max(20).optional() });
export const batchStudentQuery = z.object({ studentId: optUuid });
export const batchAdvance = z.object({ toStage: z.coerce.number().int().min(1).max(5) });
export const commentReview = z.object({
  action: z.enum(['approve', 'reject', 'regenerate']),
  comment: z.string().trim().min(10, 'Write at least a sentence').max(2000).optional(),
});
export const releaseApproved = z.object({ campusId: optUuid });

// ---- Performance ---------------------------------------------------------------------
export const performanceQuery = z.object({ campusId: optUuid, grade: z.coerce.number().int().min(1).max(12).optional() });
export const performanceStudentsQuery = paginationSchema.extend({
  campusId: optUuid, grade: z.coerce.number().int().min(1).max(12).optional(),
  band: z.enum(['above', 'at', 'below']).optional(), subjectId: optUuid,
});
