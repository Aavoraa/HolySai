/** Shared types and helpers for the academics screens. */
import { useApiQuery } from '@/hooks/useApi';
import { ApiError } from '@/api/client';
import { fmt, todayKey } from '@/lib/format';

export interface SectionOption {
  id: string;
  label: string;
  name: string;
  classId: string;
  className: string;
  gradeLevel: number;
  campusId: string;
  campusName: string;
  room: string | null;
  students: number;
  mySubjects: string[];
  isClassTeacher: boolean;
}

/** Sections the signed-in user may work with (teachers: their own; staff: the header campus). */
export function useSections(campusId?: string) {
  return useApiQuery<SectionOption[]>('/academics/sections', { campusId }, { staleTime: 60_000 });
}

/** Field → message map from a failed mutation (server validation), keyed by the last path part. */
export function serverFieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(err.fieldErrors)) {
    out[k] = v;
    const last = k.split('.').pop()!;
    if (!out[last]) out[last] = v;
  }
  return out;
}

export const today = () => todayKey();

/** Meter tone used across the wireframe: teal ≥ hi, amber ≥ lo, otherwise critical. */
export function meterTone(value: number, hi = 80, lo = 50) {
  return value >= hi ? 'teal' : value >= lo ? 'amber' : 'critical';
}

export function ratio(n: number, of: number) {
  return of ? (100 * n) / of : 0;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export const SUBJECT_SHORT: Record<string, string> = {
  Mathematics: 'Maths', 'Social Studies': 'Social', 'Art and Design': 'Art',
};

/** Whole days from today to a YYYY-MM-DD key (negative = in the past). */
export function daysFromToday(key: string) {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = todayKey().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}

/**
 * Due-date cell: the date plus a relative hint ("Today", "In 3 days", "2 days overdue").
 * Pass `done` when the item is closed/released so it is never flagged as overdue.
 */
export function DueDate({ date, done, doneLabel }: { date: string | null | undefined; done?: boolean; doneLabel?: string }) {
  if (!date) return <span className="t-faint">—</span>;
  const n = daysFromToday(date);
  const state = done ? '' : n < 0 ? 'due--overdue' : n === 0 ? 'due--today' : '';
  const rel = done
    ? doneLabel ?? ''
    : n < 0 ? `${plural(-n, 'day')} overdue` : n === 0 ? 'Due today' : n === 1 ? 'Tomorrow' : n <= 14 ? `In ${n} days` : '';
  return (
    <span className={`due ${state}`}>
      <span className="due__date">{fmt.dateShort(date)}</span>
      {rel && <span className="due__rel">{rel}</span>}
    </span>
  );
}

/** Current time as HH:MM on the school clock (IST), for "now" highlights. */
export function schoolClock() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}
