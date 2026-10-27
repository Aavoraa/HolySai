/**
 * Cambridge IGCSE grading — pure helpers shared by the API, the seed and the
 * migration defaults (no database access here).
 *
 * The school reports every mark on the classic Cambridge IGCSE letter scale
 * A* to G, with U (ungraded) below G. Grades 9–10 follow IGCSE syllabuses;
 * lower grades follow Cambridge Primary / Lower Secondary, but their marks are
 * shown on the same letters so reports read consistently.
 *
 * Cambridge publishes component grade thresholds per exam series, so these
 * percentage boundaries are indicative school defaults. They live in the
 * database (grade_boundaries) and can be edited by grading.manage users; the
 * constants below are only the fallback when the database scale is unavailable.
 */

export type Tier = 'Core' | 'Extended';

export interface GradeBoundary {
  grade: string;
  minPercent: number;
  points: number;
  description: string | null;
  tone: string | null;
  sortOrder: number;
}

export interface TierRule {
  /** Best grade available on this tier (Core is capped at C). */
  highest: string;
  /** Lowest grade awarded on this tier; anything below is U. */
  lowest: string;
}

export interface GradeScale {
  id: string | null;
  key: string;
  name: string;
  description: string | null;
  boundaries: GradeBoundary[];
  tierRules: Record<Tier, TierRule>;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_SCALE_KEY = 'cambridge_igcse_a_star_g';

/** Defaults — must match the rows inserted by database/migrations/115_cambridge_igcse.sql. */
export const DEFAULT_BOUNDARIES: GradeBoundary[] = [
  { grade: 'A*', minPercent: 90, points: 8, description: 'Exceptional', tone: 'success', sortOrder: 1 },
  { grade: 'A', minPercent: 80, points: 7, description: 'Excellent', tone: 'success', sortOrder: 2 },
  { grade: 'B', minPercent: 70, points: 6, description: 'Very good', tone: 'info', sortOrder: 3 },
  { grade: 'C', minPercent: 60, points: 5, description: 'Good', tone: 'info', sortOrder: 4 },
  { grade: 'D', minPercent: 50, points: 4, description: 'Satisfactory', tone: 'neutral', sortOrder: 5 },
  { grade: 'E', minPercent: 40, points: 3, description: 'Pass', tone: 'warning', sortOrder: 6 },
  { grade: 'F', minPercent: 30, points: 2, description: 'Weak pass', tone: 'warning', sortOrder: 7 },
  { grade: 'G', minPercent: 20, points: 1, description: 'Minimal pass', tone: 'critical', sortOrder: 8 },
  { grade: 'U', minPercent: 0, points: 0, description: 'Ungraded', tone: 'critical', sortOrder: 9 },
];

export const DEFAULT_TIER_RULES: Record<Tier, TierRule> = {
  Core: { highest: 'C', lowest: 'G' },
  Extended: { highest: 'A*', lowest: 'E' },
};

export const DEFAULT_SCALE: GradeScale = {
  id: null,
  key: DEFAULT_SCALE_KEY,
  name: 'Cambridge IGCSE (A* to G)',
  description: 'Classic Cambridge IGCSE letter grades A* to G, with U below G. Indicative percentage boundaries — Cambridge sets component thresholds for each exam series.',
  boundaries: DEFAULT_BOUNDARIES,
  tierRules: DEFAULT_TIER_RULES,
  updatedAt: null,
  updatedBy: null,
};

/** Grade letters best → worst (A*, A, … G, U). */
export const GRADE_ORDER = DEFAULT_BOUNDARIES.map((b) => b.grade);

/** Boundaries best → worst. */
export function ordered(scale: Pick<GradeScale, 'boundaries'>) {
  return [...scale.boundaries].sort((a, b) => a.sortOrder - b.sortOrder || b.minPercent - a.minPercent);
}

/**
 * Letter grade for a percentage on a scale. With a tier, Cambridge tier rules
 * apply: Extended entries are graded A*–E (below E is U); Core entries are
 * graded C–G and capped at C (below G is U).
 */
export function gradeFromScale(scale: Pick<GradeScale, 'boundaries' | 'tierRules'>, percent: number, tier?: Tier | null): string {
  const list = ordered(scale);
  if (!list.length) return 'U';
  const ungraded = list[list.length - 1];
  const pct = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  // A tiny tolerance so 59.9999999 (float noise from marks/max) is not pushed down a grade.
  let idx = list.findIndex((b) => pct + 1e-9 >= Number(b.minPercent));
  if (idx < 0) idx = list.length - 1;
  const rule = tier ? scale.tierRules?.[tier] : undefined;
  if (rule) {
    const hi = list.findIndex((b) => b.grade === rule.highest);
    const lo = list.findIndex((b) => b.grade === rule.lowest);
    if (hi >= 0 && idx < hi) idx = hi;
    if (lo >= 0 && idx > lo) return ungraded.grade;
  }
  return list[idx].grade;
}

/** Sync grade on the default scale — the fallback used by the seed and pure helpers. */
export function defaultGradeFor(percent: number, tier?: Tier | null) {
  return gradeFromScale(DEFAULT_SCALE, percent, tier);
}

/** Minimum percent for a grade on a scale (null when the grade is not on it). */
export function minPercentFor(scale: Pick<GradeScale, 'boundaries'>, grade: string) {
  const b = scale.boundaries.find((x) => x.grade === grade);
  return b ? Number(b.minPercent) : null;
}
