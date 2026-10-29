import { z } from 'zod';
import { paginationSchema } from '../utils/pagination.js';

const uuid = z.uuid();
const optUuid = z.uuid().optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date');
const text = (max: number) => z.string().trim().min(1, 'Required').max(max);
const optText = (max: number) => z.string().trim().max(max).optional().nullable();

export const TIERS = ['Core', 'Extended'] as const;
export const COMPONENT_TIERS = ['Core', 'Extended', 'All'] as const;
export const COMPONENT_TYPES = ['written', 'practical', 'coursework', 'oral', 'listening'] as const;
export const COVERAGE_STATUS = ['Not started', 'In progress', 'Covered'] as const;

export const idParam = z.object({ id: uuid });
export const componentParams = z.object({ id: uuid, componentId: uuid });
export const topicParams = z.object({ id: uuid, topicId: uuid });

// ---- Grading -------------------------------------------------------------------
const gradeLetter = z.string().trim().min(1).max(4);
const tierRule = z.object({ highest: gradeLetter, lowest: gradeLetter });
export const boundariesUpdate = z.object({
  boundaries: z.array(z.object({
    grade: gradeLetter,
    minPercent: z.coerce.number().min(0, 'Cannot be below 0').max(100, 'Cannot be above 100'),
    description: optText(80),
  })).min(1, 'Send at least one boundary').max(20),
  tierRules: z.object({ Core: tierRule.optional(), Extended: tierRule.optional() }).optional(),
  /** Re-grade this academic year's stored marks and term results with the new boundaries. */
  regrade: z.boolean().default(false),
});

// ---- Syllabuses ------------------------------------------------------------------
export const syllabusesQuery = z.object({
  stage: z.string().trim().max(40).optional(),
  subjectId: optUuid,
  q: z.string().trim().max(100).optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
});

/** Grades that take a syllabus: usually 9 and 10; some schools start IGCSE in Grade 8. */
const gradeLevels = z.array(z.number().int().min(8).max(10)).min(1, 'Choose at least one grade').max(3)
  .refine((g) => new Set(g).size === g.length, 'Each grade once')
  .transform((g) => [...g].sort((a, b) => a - b));

const syllabusFields = {
  subjectId: uuid,
  stage: text(40).default('IGCSE'),
  awardingBody: text(80).default('Cambridge International'),
  syllabusCode: z.string().trim().regex(/^[0-9A-Z]{3,6}$/, 'Use the 4-digit Cambridge code, e.g. 0580').nullable().optional(),
  title: text(160),
  examSeriesYears: optText(40),
  tiered: z.boolean().default(false),
  grading: text(20).default('A*-G'),
  notes: optText(2000),
  isActive: z.boolean().default(true),
  gradeLevels: gradeLevels.default([9, 10]),
};
export const syllabusCreate = z.object(syllabusFields);
export const catalogueQuery = z.object({
  q: z.string().trim().max(100).optional(),
  grading: z.enum(['A*-G', '9-1']).optional(),
});
export const catalogueAdd = z.object({
  code: z.string().trim().regex(/^[0-9]{4}$/, 'Use the 4-digit Cambridge code'),
  subjectId: uuid,
  gradeLevels,
  tiered: z.boolean().default(false),
});
export const syllabusUpdate = z.object({
  subjectId: uuid.optional(),
  stage: text(40).optional(),
  awardingBody: text(80).optional(),
  syllabusCode: syllabusFields.syllabusCode,
  title: text(160).optional(),
  examSeriesYears: optText(40),
  tiered: z.boolean().optional(),
  grading: text(20).optional(),
  notes: optText(2000),
  isActive: z.boolean().optional(),
  gradeLevels: gradeLevels.optional(),
}).refine((o) => Object.values(o).some((x) => x !== undefined), 'Nothing to update');

const componentFields = {
  paperNo: text(20),
  name: text(120),
  tier: z.enum(COMPONENT_TIERS).default('All'),
  durationMinutes: z.coerce.number().int().positive().max(600).nullable().optional(),
  maxMarks: z.coerce.number().positive().max(1000).nullable().optional(),
  weightingPercent: z.coerce.number().min(0).max(100).nullable().optional(),
  assessmentType: z.enum(COMPONENT_TYPES).default('written'),
  optionGroup: optText(60),
  notes: optText(1000),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
};
export const componentCreate = z.object(componentFields);
export const componentUpdate = z.object({
  paperNo: text(20).optional(),
  name: text(120).optional(),
  tier: z.enum(COMPONENT_TIERS).optional(),
  durationMinutes: componentFields.durationMinutes,
  maxMarks: componentFields.maxMarks,
  weightingPercent: componentFields.weightingPercent,
  assessmentType: z.enum(COMPONENT_TYPES).optional(),
  optionGroup: optText(60),
  notes: optText(1000),
  sortOrder: componentFields.sortOrder,
}).refine((o) => Object.values(o).some((x) => x !== undefined), 'Nothing to update');

const topicFields = {
  unitNo: z.coerce.number().int().min(0).max(99),
  code: z.string().trim().max(20).nullable().optional(),
  title: text(200),
  subtopics: optText(4000),
  tier: z.enum(COMPONENT_TIERS).default('All'),
  plannedHours: z.coerce.number().min(0).max(500).nullable().optional(),
  plannedWeeks: z.coerce.number().min(0).max(80).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
};
export const topicCreate = z.object(topicFields);
export const topicUpdate = z.object({
  unitNo: topicFields.unitNo.optional(),
  code: topicFields.code,
  title: text(200).optional(),
  subtopics: optText(4000),
  tier: z.enum(COMPONENT_TIERS).optional(),
  plannedHours: topicFields.plannedHours,
  plannedWeeks: topicFields.plannedWeeks,
  sortOrder: topicFields.sortOrder,
}).refine((o) => Object.values(o).some((x) => x !== undefined), 'Nothing to update');

export const coverageSave = z.object({
  sectionId: uuid,
  status: z.enum(COVERAGE_STATUS),
  coveredOn: isoDate.nullable().optional(),
  notes: optText(500),
});

export const entriesQuery = paginationSchema.extend({
  sectionId: optUuid,
  campusId: optUuid,
  tier: z.enum([...TIERS, 'None']).optional(),
});
export const entriesSave = z.object({
  entries: z.array(z.object({
    studentId: uuid,
    tier: z.enum(TIERS).nullable().optional(),
    examSeries: optText(40),
    /** true removes the student's entry for this syllabus. */
    remove: z.boolean().optional(),
  })).min(1, 'Send at least one entry').max(300),
});
