/**
 * Cambridge IGCSE grading for the web app — the single place the UI turns a
 * percentage into a letter (A* to G, U below G) and picks a grade's colour.
 *
 * The active scale comes from GET /grading/scale (editable boundaries); the
 * defaults below mirror backend/src/services/grading-shared.ts and are only
 * used until the scale has loaded or if it cannot be fetched.
 */
import { useApiQuery } from '@/hooks/useApi';

export type Tier = 'Core' | 'Extended';

export interface GradeBoundary {
  grade: string;
  minPercent: number;
  points: number;
  description: string | null;
  tone: string | null;
  sortOrder: number;
}

export interface GradeScale {
  id: string | null;
  key: string;
  name: string;
  description: string | null;
  boundaries: GradeBoundary[];
  tierRules: Record<Tier, { highest: string; lowest: string }>;
  tiers?: { tier: Tier; highest: string; lowest: string; summary: string }[];
  note?: string;
  updatedAt: string | null;
  updatedBy: string | null;
  isFallback?: boolean;
}

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

export const DEFAULT_SCALE: GradeScale = {
  id: null,
  key: 'cambridge_igcse_a_star_g',
  name: 'Cambridge IGCSE (A* to G)',
  description: 'Classic Cambridge IGCSE letter grades A* to G, with U below G.',
  boundaries: DEFAULT_BOUNDARIES,
  tierRules: { Core: { highest: 'C', lowest: 'G' }, Extended: { highest: 'A*', lowest: 'E' } },
  updatedAt: null,
  updatedBy: null,
  isFallback: true,
};

/** Grade letters best → worst. */
export const GRADE_ORDER = DEFAULT_BOUNDARIES.map((b) => b.grade);

export function orderedBoundaries(scale: Pick<GradeScale, 'boundaries'> = DEFAULT_SCALE) {
  return [...scale.boundaries].sort((a, b) => a.sortOrder - b.sortOrder || b.minPercent - a.minPercent);
}

/**
 * Letter for a percentage. With a tier, Cambridge tier rules apply:
 * Extended → A*–E (below E is U); Core → C–G, capped at C (below G is U).
 */
export function gradeFor(percent: number, opts: { tier?: Tier | null; scale?: GradeScale } = {}): string {
  const scale = opts.scale ?? DEFAULT_SCALE;
  const list = orderedBoundaries(scale);
  if (!list.length) return 'U';
  const pct = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  let idx = list.findIndex((b) => pct + 1e-9 >= Number(b.minPercent));
  if (idx < 0) idx = list.length - 1;
  const rule = opts.tier ? scale.tierRules?.[opts.tier] : undefined;
  if (rule) {
    const hi = list.findIndex((b) => b.grade === rule.highest);
    const lo = list.findIndex((b) => b.grade === rule.lowest);
    if (hi >= 0 && idx < hi) idx = hi;
    if (lo >= 0 && idx > lo) return list[list.length - 1].grade;
  }
  return list[idx].grade;
}

const TONE: Record<string, string> = { 'A*': 'success', A: 'success', B: 'info', C: 'info', D: 'neutral', E: 'warning', F: 'warning', G: 'critical', U: 'critical' };
const COLOR: Record<string, string> = {
  'A*': 'var(--teal)', A: 'var(--teal)', B: 'var(--navy)', C: 'var(--navy)', D: 'var(--viz-3)',
  E: 'var(--amber)', F: 'var(--amber)', G: 'var(--critical)', U: 'var(--critical)',
};

/** Badge tone for a grade letter (unknown / legacy letters → neutral). */
export function gradeTone(grade?: string | null, scale?: GradeScale) {
  if (!grade) return 'neutral';
  return scale?.boundaries.find((b) => b.grade === grade)?.tone ?? TONE[grade] ?? 'neutral';
}

/** Chart colour for a grade letter. */
export function gradeColor(grade?: string | null) {
  return COLOR[grade ?? ''] ?? 'var(--viz-6)';
}

/** Meter tone (teal / default / amber / critical) for a grade letter. */
export function gradeMeterTone(grade?: string | null) {
  const t = gradeTone(grade);
  return t === 'success' ? 'teal' : t === 'info' ? 'info' : t === 'critical' ? 'critical' : 'amber';
}

/** The active grade scale, with the defaults while it loads. */
export function useGradeScale() {
  const q = useApiQuery<GradeScale>('/grading/scale', undefined, { staleTime: 5 * 60_000 });
  return { scale: q.data ?? DEFAULT_SCALE, query: q };
}
