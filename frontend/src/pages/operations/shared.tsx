/**
 * Helpers shared by the Operations, Innovation Lab and Group Management screens.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { useApiQuery } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import { useSchool } from '@/layouts/SchoolContext';
import { Badge, Button, Icon, InlineError, Person } from '@/components/ui';
import { cx, fmt } from '@/lib/format';

export type Errors = Record<string, string>;

/** Minimal form state with client + server validation errors. */
export function useForm<T extends Record<string, any>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Errors>({});
  return {
    values,
    errors,
    set: <K extends keyof T>(k: K, v: T[K]) => {
      setValues((s) => ({ ...s, [k]: v }));
      if (errors[k as string]) setErrors((e) => ({ ...e, [k as string]: '' }));
    },
    reset: (next: T = initial) => { setValues(next); setErrors({}); },
    setErrors,
    /** Runs the checks; returns true when there are no errors. */
    validate: (rules: Record<string, string | false | null | undefined>) => {
      const e: Errors = {};
      for (const [k, msg] of Object.entries(rules)) if (msg) e[k] = msg;
      setErrors(e);
      return Object.keys(e).length === 0;
    },
    /** Maps an ApiError's field errors onto the form. */
    fromError: (err: unknown) => {
      if (err instanceof ApiError && err.details?.length) setErrors(err.fieldErrors);
    },
  };
}

export const req = (v: unknown, label = 'This field') => (v === undefined || v === null || String(v).trim() === '' ? `${label} is required` : null);

export function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export function addDaysIso(n: number) {
  const d = new Date(`${todayIso()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Campus options for forms, defaulting to the header campus. */
export function useCampusOptions() {
  const { lookups } = useLookups();
  const { campusId } = useSchool();
  const options = useMemo(() => (lookups?.campuses ?? []).map((c) => ({ value: c.id, label: c.shortName })), [lookups]);
  return { options, defaultId: campusId ?? options[0]?.value ?? '' };
}

export function useStaffOptions(filter?: (s: { employeeType: string }) => boolean) {
  const { lookups } = useLookups();
  return useMemo(() => (lookups?.staff ?? []).filter((s) => !filter || filter(s)).map((s) => ({ value: s.id, label: `${s.fullName} — ${s.designation}` })),
    [lookups]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function daysLabel(days: number | null | undefined) {
  if (days == null) return '—';
  if (days === 0) return 'Today';
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? '' : 's'} overdue`;
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

export function bytes(n: number | null | undefined) {
  if (!n) return '—';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export interface StudentPick { id: string; fullName: string; admissionNo: string; grade?: string | null; section?: string | null; campusName?: string }

/** Type-ahead student picker over GET /students (scoped server-side). */
export function StudentPicker({ value, onChange, label = 'Student', error, required, campusId }: {
  value: StudentPick | null; onChange: (s: StudentPick | null) => void; label?: string; error?: string; required?: boolean; campusId?: string;
}) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const res = useApiQuery<StudentPick[]>(q.length >= 2 && !value ? '/students' : null, { q, pageSize: 8, campusId });
  return (
    <div className="field">
      <span className="label">{label}{required && <span className="req"> *</span>}</span>
      {value ? (
        <div className="row between g-2 card card--tint oi-ops-tile">
          <Person name={value.fullName} meta={`${value.admissionNo}${value.grade ? ` · ${value.grade}${value.section ?? ''}` : ''}`} />
          <Button size="sm" variant="quiet" onClick={() => onChange(null)}>Change</Button>
        </div>
      ) : (
        <>
          <div className="input-icon">
            <Icon name="search" size={15} />
            <input className="input" type="search" aria-label={label} placeholder="Type a name or admission number" value={text}
              aria-invalid={!!error || undefined}
              onChange={(e) => setText(e.target.value)} />
          </div>
          {q.length >= 2 && (
            <div className="col g-1 mt-2" role="listbox" aria-label="Matching students">
              {res.isLoading && <span className="t-xs t-muted">Searching…</span>}
              {res.error && <span className="t-xs t-critical">Could not search students.</span>}
              {res.data && !res.data.length && <span className="t-xs t-muted">No students match “{q}”.</span>}
              {res.data?.map((s) => (
                <button key={s.id} type="button" role="option" aria-selected={false} className="row between card card--link"
                  style={{ padding: '6px 10px', textAlign: 'left' }} onClick={() => { onChange(s); setText(''); }}>
                  <span className="t-sm t-bold">{s.fullName}</span>
                  <span className="t-micro t-muted">{s.admissionNo} · {s.grade}{s.section} · {s.campusName}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {error && <span className="hint t-critical" role="alert">{error}</span>}
    </div>
  );
}

/** Two-column form grid used in modals. */
export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 }) {
  return <div className={cx('grid g-3', cols === 2 ? 'g-2col' : '')}>{children}</div>;
}

export function MoneyText({ value }: { value: number | null | undefined }) {
  return <span className="t-num">{fmt.money(value)}</span>;
}

/** A titled group of fields inside a long form (`.formsection`). */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="formsection">
      <div className="formsection__title">{title}</div>
      {children}
    </div>
  );
}

/** Server error shown under a form (field errors are mapped onto the fields as well). */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="mt-3"><InlineError error={error} /></div>;
}

/** Row class that flags an overdue, expired or urgent record in a DataTable (module CSS). */
export const CRITICAL_ROW = 'oi-ops-row--critical';

/** Due-date figure with an overdue badge or a coloured "in N days" line. */
export function DueIn({ days, soon = 30 }: { days: number | null | undefined; soon?: number }) {
  if (days == null) return null;
  if (days < 0) return <div className="mt-1"><Badge tone="critical" dot>{daysLabel(days)}</Badge></div>;
  return <div className={cx('t-micro', days <= soon ? 't-warning' : 't-muted')}>{daysLabel(days)}</div>;
}
