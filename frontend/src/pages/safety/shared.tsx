import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import { useSchool } from '@/layouts/SchoolContext';
import {
  Avatar, Badge, Banner, Button, Checkbox, Icon, InlineError, Modal, SelectField, TextArea, TextField, useConfirm,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import type { Tone } from '@/lib/tones';
import { GATES, INCIDENT_TYPES, SEVERITIES, type StudentOption } from './types';

export const PHONE_RE = /^\+?[0-9 ]{8,16}$/;
export const POLL_MS = 30_000;

/** Every cached safety/transport query, for invalidation after a write. */
export const SAFETY_KEYS = ['/gate', '/pickup', '/visitors', '/incidents', '/emergency', '/infirmary', '/counselling', '/safety'];
export const TRANSPORT_KEYS = ['/transport', '/gate'];

export const runTone = (s?: string | null): Tone =>
  s === 'Delayed' ? 'warning' : s === 'Maintenance' ? 'critical' : s === 'At campus' || s === 'Completed' ? 'success' : s === 'En route' ? 'info' : 'neutral';

export const severityTone = (s?: string | null): Tone => (s === 'Critical' ? 'critical' : s === 'Attention' ? 'warning' : 'info');

/** Incident severity: Critical carries an alert icon so it reads without colour; routine levels stay quiet. */
export function SeverityBadge({ value }: { value: string }) {
  return <Badge tone={severityTone(value)} icon={value === 'Critical' ? 'alert' : undefined} dot={value !== 'Critical'}>{value}</Badge>;
}

/** Highlights open critical incidents in tables (left critical stripe). */
export const incidentRowClass = (r: { severity: string; status: string }) => (r.severity === 'Critical' && r.status !== 'Closed' ? 'st-row--critical' : undefined);

export const gradeOf = (g?: string | null, s?: string | null) => (g ? `${g}${s ?? ''}` : '');

/** YYYY-MM-DD for today in the school timezone. */
export function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/** datetime-local value (browser time) n minutes from now. */
export function localInputIn(minutes: number) {
  const d = new Date(Date.now() + minutes * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const localToIso = (v: string) => new Date(v).toISOString();

export function TimeCell({ value, empty = '—' }: { value?: string | null; empty?: string }) {
  if (!value) return <span className="t-faint">{empty}</span>;
  return <span className="t-num">{fmt.time(value)}</span>;
}

export function LiveBadge({ at }: { at?: string }) {
  return <Badge tone="critical" dot title={at ? `Updated ${fmt.time(at)}` : undefined}>Live</Badge>;
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------
export function useFieldErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  return {
    errors,
    setErrors,
    clear: (k: string) => setErrors((e) => (e[k] ? { ...e, [k]: '' } : e)),
    fromServer: (err: unknown) => {
      if (err instanceof ApiError) setErrors((e) => ({ ...e, ...err.fieldErrors }));
    },
  };
}

/** Modal with a form body: validated submit, busy state and server errors. */
export function FormModal({ title, sub, open = true, onClose, busy, error, fieldErrors = {}, submitLabel, submitIcon = 'check', danger, children, size, onSubmit }: {
  title: string; sub?: ReactNode; open?: boolean; onClose: () => void; busy: boolean; error: unknown; fieldErrors?: Record<string, string>;
  submitLabel: string; submitIcon?: string; danger?: boolean; children: ReactNode; size?: 'wide' | 'full'; onSubmit: () => void;
}) {
  const formId = useId();
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean);
  const showGeneral = !!error && !(error instanceof ApiError && Object.keys(error.fieldErrors).length && hasFieldErrors);
  return (
    <Modal open={open} onClose={onClose} busy={busy} title={title} sub={sub} size={size}
      foot={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} icon={submitIcon} type="submit" form={formId} loading={busy}>{submitLabel}</Button>
        </>
      }>
      <form id={formId} noValidate onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(); }}>
        {showGeneral ? <div className="mb-4"><InlineError error={error} /></div> : null}
        {children}
      </form>
    </Modal>
  );
}

/** Scoped student search for safety forms (works for gate/transport staff without student-register access). */
export function StudentPicker({ value, onChange, label = 'Student', required, error, routeId, hint }: {
  value: StudentOption | null; onChange: (s: StudentOption | null) => void; label?: string; required?: boolean; error?: string; routeId?: string; hint?: ReactNode;
}) {
  const id = useId();
  const { campusParam } = useSchool();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const res = useApiQuery<StudentOption[]>(value ? null : '/safety/students', { q: q || undefined, routeId, limit: 8, ...campusParam }, { staleTime: 30_000 });
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}{required && <span className="req"> *</span>}</label>
      {value ? (
        <div className="st-picked">
          <Avatar name={value.fullName} size="sm" />
          <span className="col grow" style={{ minWidth: 0 }}>
            <span className="t-sm t-bold t-clip">{value.fullName}</span>
            <span className="t-micro t-muted">{[value.admissionNo, gradeOf(value.grade, value.section), value.routeCode].filter(Boolean).join(' · ')}</span>
          </span>
          <Button size="sm" variant="quiet" onClick={() => { onChange(null); setText(''); }}>Change</Button>
        </div>
      ) : (
        <>
          <div className="input-icon">
            <Icon name="search" size={15} />
            <input id={id} className="input" type="search" placeholder="Search by name or admission number" value={text}
              aria-invalid={!!error || undefined} onChange={(e) => setText(e.target.value)} autoComplete="off" />
          </div>
          <div className="st-results" role="listbox" aria-label="Matching students">
            {res.isLoading ? <div className="st-results__msg">Searching…</div>
              : res.error ? <div className="st-results__msg t-critical">Could not search students</div>
              : !res.data?.length ? <div className="st-results__msg">No students match “{q}”.</div>
              : res.data.map((s) => (
                <button key={s.id} type="button" role="option" aria-selected={false} className="person person--link st-results__opt"
                  onClick={() => onChange(s)}>
                  <Avatar name={s.fullName} size="xs" />
                  <span className="col">
                    <span className="person__name t-clip">{s.fullName}</span>
                    <span className="person__meta t-clip">{[s.admissionNo, gradeOf(s.grade, s.section), s.routeCode && `Route ${s.routeCode}`].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              ))}
          </div>
        </>
      )}
      <FieldError error={error} hint={hint} />
    </div>
  );
}

/** Field-level error (or hint) in the kit's style, for custom fields such as pickers and checkbox groups. */
export function FieldError({ error, hint }: { error?: string; hint?: ReactNode }) {
  if (error) return <span className="hint hint--error" role="alert"><Icon name="alertCircle" size={13} />{error}</span>;
  return hint ? <span className="hint">{hint}</span> : null;
}

// ---------------------------------------------------------------------------
// Shared modals
// ---------------------------------------------------------------------------
export function GateEventModal({ onClose, initialDirection = 'in' }: { onClose: () => void; initialDirection?: 'in' | 'out' }) {
  const [student, setStudent] = useState<StudentOption | null>(null);
  const [direction, setDirection] = useState<'in' | 'out'>(initialDirection);
  const [gate, setGate] = useState('Main Gate');
  const fe = useFieldErrors();
  const save = useApiMutation<{ studentId: string; direction: string; gate: string; method: string }>('post', '/gate/events', {
    invalidate: ['/gate'], onSuccess: onClose,
  });
  const submit = () => {
    if (!student) return fe.setErrors({ studentId: 'Choose a student' });
    save.mutate({ studentId: student.id, direction, gate, method: 'Manual' }, { onError: fe.fromServer });
  };
  return (
    <FormModal title="Record entry / exit" sub="Manual scan when a card or face reader is unavailable. Parents hear about the first arrival and departure each day."
      onClose={onClose} busy={save.isPending} error={save.error} fieldErrors={fe.errors} onSubmit={submit}
      submitLabel={direction === 'in' ? 'Record entry' : 'Record exit'} submitIcon={direction === 'in' ? 'door' : 'logout'}>
      <div className="col g-4">
        <StudentPicker value={student} onChange={(s) => { setStudent(s); fe.clear('studentId'); }} required error={fe.errors.studentId} />
        <div className="form-grid">
          <SelectField label="Direction" required value={direction} onChange={(v) => setDirection(v as 'in' | 'out')}
            options={[{ value: 'in', label: 'Entry (arrived)' }, { value: 'out', label: 'Exit (left campus)' }]} />
          <SelectField label="Gate" required value={gate} onChange={setGate} options={GATES} />
        </div>
      </div>
    </FormModal>
  );
}

export function UnauthorisedModal({ onClose, student: initial }: { onClose: () => void; student?: StudentOption | null }) {
  const confirm = useConfirm();
  const [student, setStudent] = useState<StudentOption | null>(initial ?? null);
  const [personName, setPersonName] = useState('');
  const [gate, setGate] = useState('Main Gate');
  const [notes, setNotes] = useState('');
  const fe = useFieldErrors();
  const save = useApiMutation<Record<string, string>, { incidentCode: string }>('post', '/pickup/unauthorised', {
    invalidate: [...SAFETY_KEYS], onSuccess: onClose,
  });
  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!student) errs.studentId = 'Choose the child';
    if (personName.trim().length < 2) errs.personName = 'Enter the name the person gave';
    fe.setErrors(errs);
    if (Object.keys(errs).length) return;
    const ok = await confirm({
      title: 'Hold this collection?', danger: true, icon: 'alert', confirmLabel: 'Hold and alert',
      body: `${student!.fullName} will not be released. An incident is logged, and the principal, front office and the child's parents are alerted immediately.`,
    });
    if (!ok) return;
    save.mutate({ studentId: student!.id, personName: personName.trim(), gate, ...(notes.trim() ? { notes: notes.trim() } : {}) }, { onError: fe.fromServer });
  };
  return (
    <FormModal title="Unauthorised pickup attempt" sub="Use when someone who is not on the authorised list asks to collect a child."
      onClose={onClose} busy={save.isPending} error={save.error} fieldErrors={fe.errors} onSubmit={submit}
      submitLabel="Hold collection" submitIcon="alert" danger>
      <Banner tone="critical" icon="alert"><strong>Do not release the child.</strong> Keep them with a member of staff until a parent confirms by phone or OTP.</Banner>
      <div className="col g-4 mt-4">
        <StudentPicker value={student} onChange={(s) => { setStudent(s); fe.clear('studentId'); }} required error={fe.errors.studentId} />
        <div className="form-grid">
          <TextField label="Person asking to collect" required value={personName} maxLength={120}
            onChange={(v) => { setPersonName(v); fe.clear('personName'); }} error={fe.errors.personName} />
          <SelectField label="Gate" required value={gate} onChange={setGate} options={GATES} />
        </div>
        <TextArea label="What happened" rows={3} value={notes} onChange={setNotes} maxLength={1000} placeholder="ID shown, vehicle, what they said…" />
      </div>
    </FormModal>
  );
}

export function IncidentModal({ onClose, defaultType = 'Safeguarding' }: { onClose: () => void; defaultType?: string }) {
  const { lookups } = useLookups();
  const [f, setF] = useState({ incidentType: defaultType, summary: '', details: '', severity: 'Attention', ownerId: '', occurredOn: todayIso(), isConfidential: defaultType === 'Safeguarding' });
  const [student, setStudent] = useState<StudentOption | null>(null);
  const fe = useFieldErrors();
  const set = (k: keyof typeof f) => (v: string | boolean) => { setF((x) => ({ ...x, [k]: v })); fe.clear(k); };
  const save = useApiMutation<Record<string, unknown>>('post', '/incidents', { invalidate: ['/incidents', '/gate'], onSuccess: onClose });
  const submit = () => {
    const errs: Record<string, string> = {};
    if (f.summary.trim().length < 5) errs.summary = 'Describe the incident in at least 5 characters';
    if (!f.occurredOn) errs.occurredOn = 'Choose the date';
    else if (f.occurredOn > todayIso()) errs.occurredOn = 'Cannot be in the future';
    fe.setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate({
      incidentType: f.incidentType, summary: f.summary.trim(), severity: f.severity, occurredOn: f.occurredOn, isConfidential: f.isConfidential,
      ...(f.details.trim() ? { details: f.details.trim() } : {}),
      ...(f.ownerId ? { ownerId: f.ownerId } : {}),
      ...(student ? { studentId: student.id } : {}),
    }, { onError: fe.fromServer });
  };
  return (
    <FormModal title={f.incidentType === 'Safeguarding' ? 'Log a concern' : 'Log an incident'} size="wide"
      sub="Logged the same day, in the system — not on paper. The Designated Safeguarding Lead is notified."
      onClose={onClose} busy={save.isPending} error={save.error} fieldErrors={fe.errors} onSubmit={submit} submitLabel="Log incident" submitIcon="shield">
      {f.severity === 'Critical' && (
        <div className="mb-4"><Banner tone="critical" icon="alert">Critical incidents alert the Designated Safeguarding Lead and the Principal immediately. Make sure the child is safe first.</Banner></div>
      )}
      <div className="formsection">
        <div className="formsection__title">What happened</div>
        <div className="form-grid">
          <SelectField label="Type" required value={f.incidentType} onChange={set('incidentType')} options={INCIDENT_TYPES} />
          <SelectField label="Severity" required value={f.severity} onChange={set('severity')} options={SEVERITIES} />
          <TextField className="span-2" label="Summary" required value={f.summary} onChange={set('summary')} maxLength={200} error={fe.errors.summary} />
          <TextArea className="span-2" label="Details" rows={4} value={f.details} onChange={set('details')} maxLength={4000}
            placeholder="What was observed, by whom, and what was done immediately." />
          <TextField label="Date" type="date" required value={f.occurredOn} max={todayIso()} onChange={set('occurredOn')} error={fe.errors.occurredOn} />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">People</div>
        <div className="form-grid">
          <div className="span-2"><StudentPicker label="Student involved (optional)" value={student} onChange={setStudent} /></div>
          <SelectField label="Owner" value={f.ownerId} onChange={set('ownerId')} placeholder="Me"
            options={(lookups?.staff ?? []).map((s) => ({ value: s.id, label: `${s.fullName} — ${s.designation}` }))} />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Access</div>
        <Checkbox checked={f.isConfidential} onChange={set('isConfidential')}
          label="Confidential — only the Designated Safeguarding Lead, the Principal and the counsellor can open it" />
      </div>
    </FormModal>
  );
}

