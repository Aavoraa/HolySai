import type { Request } from 'express';
import { many, one, query, tx, type Queryable } from '../config/db.js';
import { badRequest } from '../utils/errors.js';
import { audit } from './audit.service.js';
import {
  DEFAULT_SCALE, DEFAULT_SCALE_KEY, DEFAULT_TIER_RULES, gradeFromScale, minPercentFor, ordered,
  type GradeBoundary, type GradeScale, type Tier, type TierRule,
} from './grading-shared.js';

/**
 * The single grading service. Loads the active (default) Cambridge IGCSE grade
 * scale from the database, caches it, and grades percentages with it. Every
 * backend path that turns a mark into a letter goes through here; the
 * sync DEFAULT_SCALE is used only when the database scale is unavailable.
 */

export type { GradeScale, Tier } from './grading-shared.js';

const TTL_MS = 60_000; // short TTL so other API instances pick up edits too
let cache: { at: number; scale: GradeScale } | null = null;

export function invalidateGradeScale() {
  cache = null;
}

async function loadScale(db?: Queryable): Promise<GradeScale | null> {
  const s = await one<{ id: string; key: string; name: string; description: string | null; tier_rules: Record<string, TierRule> | null; updated_at: Date; updated_by: string | null }>(
    `SELECT gs.id, gs.key, gs.name, gs.description, gs.tier_rules, gs.updated_at, u.full_name AS updated_by
       FROM grade_scales gs LEFT JOIN users u ON u.id = gs.updated_by
      ORDER BY gs.is_default DESC, (gs.key = $1) DESC, gs.created_at LIMIT 1`,
    [DEFAULT_SCALE_KEY], db,
  );
  if (!s) return null;
  const rows = await many<GradeBoundary>(
    `SELECT grade, min_percent::float AS "minPercent", points, description, tone, sort_order AS "sortOrder"
       FROM grade_boundaries WHERE scale_id = $1 ORDER BY sort_order, min_percent DESC`,
    [s.id], db,
  );
  if (!rows.length) return null;
  const rules = s.tier_rules ?? {};
  return {
    id: s.id, key: s.key, name: s.name, description: s.description, boundaries: rows,
    tierRules: {
      Core: rules.Core ?? DEFAULT_TIER_RULES.Core,
      Extended: rules.Extended ?? DEFAULT_TIER_RULES.Extended,
    },
    updatedAt: s.updated_at ? new Date(s.updated_at).toISOString() : null,
    updatedBy: s.updated_by,
  };
}

/** The active grade scale (cached). Falls back to the built-in defaults. */
export async function getActiveScale(): Promise<GradeScale> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.scale;
  let scale: GradeScale = DEFAULT_SCALE;
  try {
    scale = (await loadScale()) ?? DEFAULT_SCALE;
  } catch {
    scale = DEFAULT_SCALE; // e.g. migration 115 not applied yet
  }
  cache = { at: Date.now(), scale };
  return scale;
}

/** Letter grade for a percentage on the active scale, with optional Core/Extended tier rules. */
export async function gradeFor(percent: number, opts: { tier?: Tier | null } = {}) {
  return gradeFromScale(await getActiveScale(), percent, opts.tier);
}

/** Grade letters best → worst on the active scale. */
export async function gradeOrder() {
  return ordered(await getActiveScale()).map((b) => b.grade);
}

/**
 * Expectation bands for academic performance, derived from the scale:
 * above expectation = grade B or better, at expectation = grade C,
 * below expectation = under C.
 */
export async function expectationBands() {
  const s = await getActiveScale();
  return {
    above: minPercentFor(s, 'B') ?? 70,
    at: minPercentFor(s, 'C') ?? 60,
    aboveGrade: 'B',
    atGrade: 'C',
  };
}

/** Public shape for GET /grading/scale. */
export async function scaleForApi() {
  const s = await getActiveScale();
  return {
    ...s,
    boundaries: ordered(s),
    isFallback: s.id == null,
    tiers: [
      { tier: 'Extended', ...s.tierRules.Extended, summary: `Extended entries are graded ${s.tierRules.Extended.highest}–${s.tierRules.Extended.lowest}; below ${s.tierRules.Extended.lowest} is U.` },
      { tier: 'Core', ...s.tierRules.Core, summary: `Core entries are graded ${s.tierRules.Core.highest}–${s.tierRules.Core.lowest} (capped at ${s.tierRules.Core.highest}); below ${s.tierRules.Core.lowest} is U.` },
    ],
    note: 'Indicative school boundaries. Cambridge International publishes component grade thresholds for each exam series; update these boundaries to match the thresholds for the series you are preparing for.',
  };
}

/**
 * SQL for the tier that applies to a mark: a Core/Extended paper fixes the tier;
 * an "All" component of a tiered syllabus uses the student's entry tier.
 * Expects aliases a (assessments) and m (assessment_marks).
 */
export const EFFECTIVE_TIER_JOINS = `
  LEFT JOIN syllabus_components scx ON scx.id = a.syllabus_component_id
  LEFT JOIN syllabuses syx ON syx.id = scx.syllabus_id
  LEFT JOIN student_syllabus_entries sex ON sex.syllabus_id = syx.id AND sex.student_id = m.student_id`;
export const EFFECTIVE_TIER_SQL = `CASE WHEN scx.tier IN ('Core', 'Extended') THEN scx.tier WHEN syx.tiered THEN sex.tier END`;

/** Re-grades this academic year's stored marks and term results with a scale. */
async function regradeCurrentYear(scale: GradeScale, db: Queryable) {
  const marks = await many<{ id: string; pct: number; tier: Tier | null; grade: string | null }>(
    `SELECT m.id, (100.0 * m.marks / a.max_marks)::float AS pct, ${EFFECTIVE_TIER_SQL} AS tier, m.grade
       FROM assessment_marks m JOIN assessments a ON a.id = m.assessment_id ${EFFECTIVE_TIER_JOINS}
      WHERE m.marks IS NOT NULL AND a.academic_year_id = (SELECT id FROM academic_years WHERE is_current)`,
    [], db,
  );
  const mChanged = marks.map((m) => ({ id: m.id, g: gradeFromScale(scale, m.pct, m.tier) })).filter((x, i) => x.g !== marks[i].grade);
  if (mChanged.length) {
    await query(`UPDATE assessment_marks m SET grade = x.g FROM unnest($1::uuid[], $2::text[]) AS x(id, g) WHERE m.id = x.id`,
      [mChanged.map((x) => x.id), mChanged.map((x) => x.g)], db);
  }
  const recs = await many<{ id: string; score: number; grade: string | null }>(
    `SELECT id, score::float AS score, grade FROM student_academic_records WHERE academic_year_id = (SELECT id FROM academic_years WHERE is_current)`,
    [], db,
  );
  const rChanged = recs.map((r) => ({ id: r.id, g: gradeFromScale(scale, r.score) })).filter((x, i) => x.g !== recs[i].grade);
  if (rChanged.length) {
    await query(`UPDATE student_academic_records r SET grade = x.g FROM unnest($1::uuid[], $2::text[]) AS x(id, g) WHERE r.id = x.id`,
      [rChanged.map((x) => x.id), rChanged.map((x) => x.g)], db);
  }
  return { marks: mChanged.length, records: rChanged.length };
}

export interface BoundaryInput { grade: string; minPercent: number; description?: string | null }

/** Replaces the percentages (and descriptions) of the active scale's boundaries. */
export async function updateBoundaries(req: Request, input: { boundaries: BoundaryInput[]; tierRules?: Partial<Record<Tier, TierRule>>; regrade?: boolean }) {
  const result = await tx(async (db) => {
    const scale = await loadScale(db);
    if (!scale?.id) throw badRequest('No grade scale is configured — run the database migrations first', 'NO_GRADE_SCALE');
    await query('SELECT 1 FROM grade_scales WHERE id = $1 FOR UPDATE', [scale.id], db);
    const current = ordered(scale);
    const byGrade = new Map(input.boundaries.map((b) => [b.grade, b]));
    const errors: { field: string; message: string }[] = [];
    if (byGrade.size !== input.boundaries.length) errors.push({ field: 'boundaries', message: 'Each grade can appear only once' });
    for (const g of byGrade.keys()) {
      if (!current.some((c) => c.grade === g)) errors.push({ field: 'boundaries', message: `Grade ${g} is not on the ${scale.name} scale` });
    }
    const next = current.map((c) => {
      const b = byGrade.get(c.grade);
      return { ...c, minPercent: b ? Number(b.minPercent) : c.minPercent, description: b && b.description !== undefined ? b.description : c.description };
    });
    // Monotonic: every grade needs a strictly lower minimum than the grade above it; the last grade (U) starts at 0.
    next.forEach((b, i) => {
      const field = `boundaries.${input.boundaries.findIndex((x) => x.grade === b.grade)}.minPercent`;
      if (b.minPercent < 0 || b.minPercent > 100) errors.push({ field, message: `${b.grade}: must be between 0 and 100` });
      if (i > 0 && b.minPercent >= next[i - 1].minPercent) errors.push({ field, message: `${b.grade} must start below ${next[i - 1].grade} (${next[i - 1].minPercent}%)` });
    });
    const last = next[next.length - 1];
    if (last && last.minPercent !== 0) errors.push({ field: 'boundaries', message: `${last.grade} is the ungraded band and must start at 0%` });

    const rules: Record<Tier, TierRule> = { ...scale.tierRules, ...(input.tierRules ?? {}) } as Record<Tier, TierRule>;
    for (const t of ['Core', 'Extended'] as Tier[]) {
      const r = rules[t];
      const hi = next.findIndex((b) => b.grade === r.highest);
      const lo = next.findIndex((b) => b.grade === r.lowest);
      if (hi < 0 || lo < 0) errors.push({ field: `tierRules.${t}`, message: `${t}: choose grades from the scale` });
      else if (hi > lo) errors.push({ field: `tierRules.${t}`, message: `${t}: the highest grade must be above the lowest grade` });
      else if (lo === next.length - 1) errors.push({ field: `tierRules.${t}`, message: `${t}: the lowest awarded grade cannot be the ungraded band` });
    }
    if (errors.length) throw badRequest('The grade boundaries are not valid', 'VALIDATION_ERROR', errors);

    for (const b of next) {
      await query(
        `UPDATE grade_boundaries SET min_percent = $3, description = $4 WHERE scale_id = $1 AND grade = $2`,
        [scale.id, b.grade, b.minPercent, b.description ?? null], db,
      );
    }
    await query('UPDATE grade_scales SET tier_rules = $2, updated_by = $3 WHERE id = $1', [scale.id, JSON.stringify(rules), req.user!.id], db);
    const changed = next.filter((b, i) => b.minPercent !== current[i].minPercent).map((b) => `${b.grade} ${current.find((c) => c.grade === b.grade)!.minPercent}→${b.minPercent}%`);
    const regraded = input.regrade ? await regradeCurrentYear({ ...scale, boundaries: next, tierRules: rules }, db) : null;
    await audit(req, {
      action: 'update', module: 'grading',
      description: `Updated ${scale.name} grade boundaries${changed.length ? ` (${changed.join(', ')})` : ''}${regraded ? `; re-graded ${regraded.marks} mark(s) and ${regraded.records} term result(s)` : ''}`,
      entityType: 'grade_scale', entityId: scale.id,
      metadata: { before: current.map((b) => [b.grade, b.minPercent]), after: next.map((b) => [b.grade, b.minPercent]), tierRules: rules, regraded },
    }, db);
    return { id: scale.id, changed: changed.length, regraded };
  });
  invalidateGradeScale();
  return { ...result, scale: await scaleForApi() };
}
