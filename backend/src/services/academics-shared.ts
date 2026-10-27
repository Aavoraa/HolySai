/**
 * Pure academic helpers shared by the API and the seed (no database access).
 */

import { GRADE_ORDER, defaultGradeFor, type Tier } from './grading-shared.js';

/**
 * Cambridge IGCSE letter grade (A*–G, U) for a percentage on the DEFAULT
 * boundaries. Sync fallback for the seed and pure helpers; the API grades with
 * the editable database scale through services/grading.service.ts.
 */
export function gradeFor(pct: number, tier?: Tier | null) {
  return defaultGradeFor(pct, tier);
}

/** Grade letters in report order: A*, A, B, C, D, E, F, G, U. */
export const GRADE_BANDS = GRADE_ORDER;

/** Report-card workflow stages (report_card_batches.stage 0–5). */
export const REPORT_CARD_STAGES = ['Marks entry', 'Moderation', 'AI draft comments', 'Teacher review', 'Approval', 'Parent release'] as const;
export const REPORT_CARD_STATUS = ['Marks entry', 'Moderation', 'AI draft comments', 'Teacher review', 'Approval', 'Released to parents'] as const;

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export interface SubjectResult {
  subject: string;
  score: number;
  trend: number;
}

/**
 * Drafts a report-card comment from a student's current results. This is a
 * deterministic, template-based draft: it is always stored as ai_drafted and
 * must be reviewed and approved by a named teacher before release.
 */
export function draftReportComment(firstName: string, subjects: SubjectResult[], extras: { attendance?: number | null; observations?: number } = {}) {
  if (!subjects.length) {
    return `${firstName} has settled into the term. Assessment results are not yet complete, so this comment should be written once marks are entered.`;
  }
  const sorted = [...subjects].sort((a, b) => b.score - a.score);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];
  const avg = Math.round(subjects.reduce((a, s) => a + s.score, 0) / subjects.length);
  const riser = [...subjects].sort((a, b) => b.trend - a.trend)[0];
  const faller = [...subjects].sort((a, b) => a.trend - b.trend)[0];
  const opening = avg >= 80 ? `${firstName} has had a strong term` : avg >= 68 ? `${firstName} has had a steady term` : `${firstName} has found parts of this term challenging`;
  const parts = [`${opening}, with an average of ${avg} across ${subjects.length} subjects.`];
  parts.push(`${strongest.subject} remains the strongest subject at ${strongest.score}.`);
  if (riser && riser.trend >= 3) parts.push(`${riser.subject} improved by ${riser.trend} marks, which reflects real effort.`);
  if (faller && faller.trend <= -3) {
    parts.push(`${faller.subject} has slipped by ${Math.abs(faller.trend)} marks; targeted support next term is recommended.`);
  } else if (weakest.subject !== strongest.subject) {
    parts.push(`${weakest.subject} (${weakest.score}) is the area to focus on next term.`);
  }
  if (extras.attendance != null) {
    parts.push(extras.attendance >= 92 ? 'Attendance has been excellent.' : extras.attendance < 85 ? `Attendance at ${extras.attendance}% needs to improve so that learning is not interrupted.` : 'Attendance has been regular.');
  }
  return parts.join(' ');
}
