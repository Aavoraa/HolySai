import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import {
  Badge, Banner, Button, Card, Chart, charts, Checkbox, DataTable, Empty, ErrorState, FilterSelect, Grid, InlineError, Kpi,
  Meter, Modal, Page, PageHead, Pagination, SearchInput, SelectField, Skeleton, Status, TextField, useConfirm, Toolbar,
} from '@/components/ui';
import { fmt, todayKey } from '@/lib/format';
import { serverFieldErrors, useSections } from './shared';

interface AssessmentRow {
  id: string; code: string; name: string; assessmentType: string; status: string; heldOn: string; maxMarks: number;
  classId: string; sectionId: string | null; grade: string; subject: string; subjectId: string; of: number; entered: number; averagePct: number | null;
}
interface Summary {
  active: number; scheduled: number; inProgress: number; marksPending: number; marksPendingFoot: string | null;
  awaitingModeration: number; moderationFoot: string | null; completedThisTerm: number;
  distribution: { assessment: string; labels: string[]; values: number[] } | null;
  markers: { assessment: string; status: string; cohortMean: number; rows: { marker: string; mean: number; scripts: number; deviation: number; flagged: boolean }[] } | null;
}
interface AssessmentDetail {
  id: string; code: string; name: string; status: string; heldOn: string; maxMarks: number; grade: string; subject: string;
  locked: boolean; canEnter: boolean; lockReason: string | null; entered: number; of: number;
  students: { id: string; admissionNo: string; fullName: string; section: string; roll: number | null; marks: number | null; isAbsent: boolean; grade: string | null; enteredBy: string | null }[];
}

const TYPES = [
  { value: 'test', label: 'Term assessment' }, { value: 'exam', label: 'Examination' }, { value: 'unit_test', label: 'Unit test' },
  { value: 'quiz', label: 'Quiz (formative)' }, { value: 'mock', label: 'Mock examination' }, { value: 'project', label: 'Project' },
];
const GRADE_TONE: Record<string, string> = { 'A*': 'success', 'A+': 'success', A: 'success', 'B+': 'info', B: 'info', C: 'neutral', D: 'warning', E: 'critical' };
const DIST_COLOR: Record<string, string> = { 'A*': 'var(--teal)', 'A+': 'var(--teal)', A: 'var(--teal)', 'B+': 'var(--navy)', B: 'var(--navy)', C: 'var(--amber)', D: 'var(--critical)', E: 'var(--critical)' };

/** Inline check while typing (the same rules are enforced again on save). */
function liveError(en: { marks: string; isAbsent: boolean }, max: number) {
  if (en.isAbsent || en.marks.trim() === '') return '';
  const v = Number(en.marks);
  if (!Number.isFinite(v)) return 'Enter a number';
  if (v < 0) return 'Cannot be negative';
  if (v > max) return `Max is ${max}`;
  return '';
}

/** Enter / ↓ moves to the next student's mark, ↑ to the previous one. */
function moveFocus(e: React.KeyboardEvent<HTMLInputElement>, row: number) {
  const step = e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const table = e.currentTarget.closest('table');
  for (let i = row + step; table && i >= 0; i += step) {
    const next = table.querySelector<HTMLInputElement>(`input[data-mark-row="${i}"]`);
    if (!next) break;
    if (!next.disabled) { next.focus(); next.select(); break; }
  }
}

function gradeFor(pct: number) {
  return pct >= 90 ? 'A*' : pct >= 85 ? 'A+' : pct >= 78 ? 'A' : pct >= 72 ? 'B+' : pct >= 65 ? 'B' : pct >= 55 ? 'C' : pct >= 45 ? 'D' : 'E';
}

export default function AssessmentsPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const { lookups } = useLookups();
  const list = useListParams({ sort: 'date', dir: 'desc', pageSize: 10 }, ['status', 'subjectId']);
  const q = usePagedQuery<AssessmentRow>('/academics/assessments', { ...list.query, ...campusParam });
  const summary = useApiQuery<Summary>('/academics/assessments/summary', campusParam);
  const [creating, setCreating] = useState(false);
  const [marksFor, setMarksFor] = useState<string | null>(null);
  const s = summary.data;

  return (
    <Page>
      <PageHead
        title="Assessments"
        sub="Creation, marks entry, moderation, grade calculation, predicted grades and performance trends."
        actions={<>
          <Button icon="helpCircle" to="/question-bank">Question bank</Button>
          {can('assessments.manage') && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Create assessment</Button>}
        </>}
      />
      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : (
        <Grid cols="g-4col">
          <Kpi loading={!s} icon="clipboard" label="Active assessments" value={s?.active ?? 0} tone="amber" foot={s ? `${s.scheduled} scheduled, ${s.inProgress} in progress` : undefined} onClick={() => list.setFilter('status', 'In Progress')} />
          <Kpi loading={!s} icon="edit" label="Marks pending entry" value={s?.marksPending ?? 0} tone={s?.marksPending ? 'critical' : 'teal'} foot={s?.marksPendingFoot ?? 'Nothing waiting'} />
          <Kpi loading={!s} icon="users" label="Awaiting moderation" value={s?.awaitingModeration ?? 0} tone="amber" foot={s?.moderationFoot ?? 'None'} onClick={() => list.setFilter('status', 'Moderation')} />
          <Kpi loading={!s} icon="check" label="Completed this term" value={s?.completedThisTerm ?? 0} tone="teal" foot="Last 90 days" onClick={() => list.setFilter('status', 'Completed')} />
        </Grid>
      )}

      <div className="mt-4">
        <Card icon="checkSquare" title="Assessment register" flush>
          <Toolbar>
            <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search by name or code" />
            <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={['Scheduled', 'In Progress', 'Moderation', 'Completed']} />
            <FilterSelect label="Subject" value={list.filters.subjectId} onChange={(v) => list.setFilter('subjectId', v)} options={(lookups?.subjects ?? []).map((x) => ({ value: x.id, label: x.name }))} />
          </Toolbar>
          {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <DataTable
              rows={q.data?.rows}
              loading={q.isLoading}
              rowKey={(r) => r.id}
              sort={list.sort}
              onSort={list.setSort}
              emptyText={list.hasFilters ? 'No assessments match these filters.' : 'No assessments yet this year.'}
              columns={[
                { key: 'name', label: 'Assessment', render: (r) => <><span className="t-bold">{r.name}</span><div className="t-micro t-muted">{r.code} · {r.subject}</div></> },
                { key: 'grade', label: 'Grade', render: (r) => r.grade },
                { key: 'date', label: 'Date', render: (r) => fmt.date(r.heldOn) },
                { key: 'max', label: 'Max', className: 'num', render: (r) => <span className="t-num">{r.maxMarks}</span> },
                {
                  key: 'entered', label: 'Marks entered', sortable: false, render: (r) => (
                    <Meter label="" value={r.of ? (100 * r.entered) / r.of : 0} right={`${r.entered}/${r.of}`}
                      tone={r.of && r.entered >= r.of ? 'teal' : r.entered ? 'amber' : 'critical'} />
                  ),
                },
                { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
                {
                  key: 'a', label: '', sortable: false, className: 'num', render: (r) => {
                    const canEnter = can('assessments.manage') && (r.status === 'Scheduled' || r.status === 'In Progress') && r.heldOn <= todayKey();
                    return <Button size="sm" variant={canEnter ? 'primary' : 'ghost'} onClick={() => setMarksFor(r.id)}>{canEnter ? 'Enter marks' : 'View'}</Button>;
                  },
                },
              ]}
            />
          )}
          <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
        </Card>
      </div>

      <div className="grid g-2col g-4 mt-4">
        <Card icon="trending" title="Grade distribution" sub={s?.distribution?.assessment ?? 'Latest completed assessment'}>
          {!s ? <Skeleton height={220} /> : s.distribution && s.distribution.values.some((v) => v > 0) ? (
            <Chart svg={charts.bar({ labels: s.distribution.labels, series: [{ name: 'Students', values: s.distribution.values, colors: s.distribution.labels.map((l) => DIST_COLOR[l]) }], height: 220 })} />
          ) : <Empty icon="barChart" title="No completed assessment yet" />}
        </Card>
        <Card icon="grid" title="Moderation" sub={s?.markers ? `Marker consistency — ${s.markers.assessment}` : 'Marker consistency check'}>
          {!s ? <Skeleton height={220} /> : !s.markers || s.markers.rows.length === 0 ? (
            <Empty icon="users" title="Nothing to moderate" sub="Marker comparisons appear once marks are entered." />
          ) : (
            <>
              <div className="col g-4">
                {s.markers.rows.map((m) => (
                  <Meter key={m.marker} label={`${m.marker} · ${m.scripts} scripts`} value={m.mean} right={`mean ${m.mean.toFixed(1)}%`} tone={m.flagged ? 'amber' : 'teal'} />
                ))}
              </div>
              <div className="mt-4">
                {s.markers.rows.some((m) => m.flagged) ? (
                  <Banner tone="warning" icon="alert">
                    {s.markers.rows.filter((m) => m.flagged).map((m) => `${m.marker} is ${Math.abs(m.deviation)} points ${m.deviation < 0 ? 'below' : 'above'} the cohort mean of ${s.markers!.cohortMean}%`).join('; ')}. Pull a sample of scripts for a second read before grades are finalised.
                  </Banner>
                ) : (
                  <Banner tone="success" icon="check">Markers are within 4 points of the cohort mean ({s.markers.cohortMean}%).</Banner>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      {creating && <CreateAssessmentModal onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setMarksFor(id); }} />}
      {marksFor && <MarksModal id={marksFor} onClose={() => setMarksFor(null)} />}
    </Page>
  );
}

// ---------------------------------------------------------------------------
function CreateAssessmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { can } = useAuth();
  const { campusParam, campusId } = useSchool();
  const { lookups } = useLookups();
  const sections = useSections(can('students.read') ? campusId : undefined);
  const restricted = !can('students.read');
  const [f, setF] = useState({ name: '', subjectId: '', classId: '', sectionId: '', heldOn: '', maxMarks: '50', assessmentType: 'test' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v, ...(k === 'classId' ? { sectionId: '' } : {}) })); setErrors((e) => ({ ...e, [k]: '' })); };

  const classOptions = useMemo(() => {
    if (restricted) {
      const seen = new Map<string, string>();
      for (const s of sections.data ?? []) seen.set(s.classId, s.className);
      return [...seen].map(([value, label]) => ({ value, label }));
    }
    return (lookups?.classes ?? []).filter((c) => !campusParam.campusId || c.campusId === campusParam.campusId).map((c) => ({ value: c.id, label: c.name }));
  }, [restricted, sections.data, lookups, campusParam.campusId]);
  const sectionOptions = useMemo(() => {
    const own = (sections.data ?? []).filter((s) => s.classId === f.classId);
    return own.map((s) => ({ value: s.id, label: `Section ${s.name}` }));
  }, [sections.data, f.classId]);
  const subjectOptions = useMemo(() => {
    const all = (lookups?.subjects ?? []).map((x) => ({ value: x.id, label: x.name }));
    if (!restricted) return all;
    const mine = new Set((sections.data ?? []).filter((s) => s.classId === f.classId && (!f.sectionId || s.id === f.sectionId)).flatMap((s) => s.mySubjects));
    return all.filter((o) => mine.has(o.label));
  }, [restricted, lookups, sections.data, f.classId, f.sectionId]);

  const create = useApiMutation<Record<string, unknown>, { id: string; code: string }>('post', '/academics/assessments', {
    invalidate: ['/academics/assessments', '/academics/teacher-dashboard'],
    success: (r) => `Assessment ${r.data.code} created`,
    onSuccess: (r) => onCreated(r.data.id),
    error: false,
  });
  useEffect(() => { if (create.error) setErrors(serverFieldErrors(create.error)); }, [create.error]);

  const submit = () => {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 3) e.name = 'Enter a name (at least 3 characters)';
    if (!f.subjectId) e.subjectId = 'Choose a subject';
    if (!f.classId) e.classId = 'Choose a grade';
    if (restricted && !f.sectionId) e.sectionId = 'Choose one of your sections';
    if (!f.heldOn) e.heldOn = 'Choose a date';
    const max = Number(f.maxMarks);
    if (!Number.isFinite(max) || max <= 0 || max > 1000) e.maxMarks = 'Enter a number between 1 and 1000';
    setErrors(e);
    if (Object.keys(e).length) return;
    create.mutate({ name: f.name.trim(), subjectId: f.subjectId, classId: f.classId, sectionId: f.sectionId || null, heldOn: f.heldOn, maxMarks: max, assessmentType: f.assessmentType });
  };

  return (
    <Modal open onClose={onClose} title="Create assessment" size="wide" busy={create.isPending}
      foot={<><Button onClick={onClose} disabled={create.isPending}>Cancel</Button><Button variant="primary" onClick={submit} loading={create.isPending}>Create</Button></>}>
      {create.error && !Object.keys(serverFieldErrors(create.error)).length && <div className="mb-4"><InlineError error={create.error} /></div>}
      <div className="formsection">
        <div className="formsection__title">Assessment</div>
        <div className="grid g-2col g-3">
          <TextField label="Assessment name" required value={f.name} onChange={set('name')} error={errors.name} placeholder="Term 3 Mathematics — Fractions" maxLength={160} />
          <SelectField label="Assessment type" value={f.assessmentType} onChange={set('assessmentType')} options={TYPES} />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Who sits it</div>
        <div className="grid g-2col g-3">
          <SelectField label="Grade" required value={f.classId} onChange={set('classId')} options={classOptions} placeholder="Choose a grade" error={errors.classId} />
          <SelectField label="Section" required={restricted} value={f.sectionId} onChange={set('sectionId')} options={sectionOptions}
            placeholder={restricted ? 'Choose a section' : 'Whole grade'} error={errors.sectionId} disabled={!f.classId}
            hint={!f.classId ? 'Choose a grade first.' : restricted ? 'Only your sections are listed.' : 'Leave as whole grade to include every section.'} />
          <SelectField label="Subject" required value={f.subjectId} onChange={set('subjectId')} options={subjectOptions} placeholder="Choose a subject" error={errors.subjectId} />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Date and marking</div>
        <div className="grid g-2col g-3">
          <TextField label="Date" type="date" required value={f.heldOn} onChange={set('heldOn')} error={errors.heldOn} hint="Marks can be entered from this date." />
          <TextField label="Maximum marks" type="number" min={1} max={1000} required value={f.maxMarks} onChange={set('maxMarks')} error={errors.maxMarks} hint="Grades are calculated from the percentage of this." />
        </div>
      </div>
      <div className="mt-4">
        <Banner tone="neutral" icon="sparkle">Questions can be drawn from the approved question bank, or drafted by the AI Co-Pilot and reviewed before use.</Banner>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
type Entry = { marks: string; isAbsent: boolean };

function MarksModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { can, user } = useAuth();
  const confirm = useConfirm();
  const q = useApiQuery<AssessmentDetail>(`/academics/assessments/${id}`);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const a = q.data;
  useEffect(() => {
    if (!a) return;
    setEntries(Object.fromEntries(a.students.map((s) => [s.id, { marks: s.marks == null ? '' : String(s.marks), isAbsent: s.isAbsent }])));
  }, [a]);

  const save = useApiMutation<{ marks: unknown[]; action: string }, { status: string; entered: number; of: number }>('put', `/academics/assessments/${id}/marks`, {
    invalidate: ['/academics/assessments', '/academics/teacher-dashboard'],
    onSuccess: (r, v) => { if (v.action !== 'save') onClose(); else setErrors({}); void r; },
  });
  const editable = !!a && a.canEnter && can('assessments.manage');
  const schoolLevel = user?.role.scope !== 'class' && can('students.read');

  const validate = () => {
    if (!a) return null;
    const e: Record<string, string> = {};
    const changed: { studentId: string; marks: number | null; isAbsent: boolean }[] = [];
    for (const s of a.students) {
      const en = entries[s.id];
      if (!en) continue;
      const val = en.marks.trim() === '' ? null : Number(en.marks);
      if (val != null && (!Number.isFinite(val) || val < 0 || val > a.maxMarks)) e[s.id] = `0–${a.maxMarks}`;
      if (val != null && en.isAbsent) e[s.id] = 'Absent students have no mark';
      if (val !== s.marks || en.isAbsent !== s.isAbsent) changed.push({ studentId: s.id, marks: en.isAbsent ? null : val, isAbsent: en.isAbsent });
    }
    setErrors(e);
    return Object.keys(e).length ? null : changed;
  };
  const filled = a ? a.students.filter((s) => entries[s.id] && (entries[s.id].isAbsent || entries[s.id].marks.trim() !== '')).length : 0;
  const unsaved = editable && !!a && a.students.some((s) => {
    const en = entries[s.id];
    if (!en) return false;
    const val = en.marks.trim() === '' ? null : Number(en.marks);
    return val !== s.marks || en.isAbsent !== s.isAbsent;
  });
  const requestClose = async () => {
    if (unsaved && !(await confirm({ title: 'Discard unsaved marks?', body: 'Marks you typed since the last save will be lost.', confirmLabel: 'Discard marks', danger: true }))) return;
    onClose();
  };

  const run = async (action: 'save' | 'moderation' | 'complete') => {
    const changed = validate();
    if (!changed) return;
    if (action !== 'save') {
      const ok = await confirm({
        title: action === 'moderation' ? 'Send for moderation?' : 'Complete this assessment?',
        body: action === 'moderation'
          ? 'Marks are locked once moderation begins. Make sure every mark is correct.'
          : 'Grades become final and marks can no longer be changed.',
        confirmLabel: action === 'moderation' ? 'Send for moderation' : 'Complete assessment',
      });
      if (!ok) return;
    } else if (!changed.length) {
      setErrors({});
      return;
    }
    save.mutate({ marks: editable ? changed : [], action });
  };

  return (
    <Modal open onClose={requestClose} busy={save.isPending} size="wide"
      title={a ? (editable ? 'Marks entry' : 'Assessment marks') : 'Marks entry'}
      sub={a ? `${a.code} · ${a.name} · ${a.grade} ${a.subject} · out of ${a.maxMarks}` : undefined}
      foot={a && (
        <>
          {unsaved && <span className="t-xs t-warning">Unsaved changes</span>}
          <Button onClick={requestClose} disabled={save.isPending}>Close</Button>
          {editable && <Button onClick={() => run('save')} loading={save.isPending && save.variables?.action === 'save'} icon="save">Save marks</Button>}
          {editable && <Button onClick={() => run('complete')} disabled={filled < a.students.length || save.isPending} variant="teal" icon="check">Complete</Button>}
          {editable && <Button variant="primary" onClick={() => run('moderation')} disabled={filled < a.students.length || save.isPending}>Save and send for moderation</Button>}
          {a.status === 'Moderation' && can('assessments.manage') && schoolLevel && (
            <Button variant="primary" icon="check" onClick={() => run('complete')} loading={save.isPending}>Moderation complete — finalise grades</Button>
          )}
        </>
      )}>
      {q.isLoading ? <div className="col g-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={34} />)}</div>
        : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : a && (
          <>
            <div className="marks-progress mb-3">
              <span className="row g-2"><Status value={a.status} /><span className="t-xs t-muted">Held {fmt.date(a.heldOn)}</span></span>
              <Meter label={editable ? 'Enter moves to the next student' : 'Marks entered'} value={a.students.length ? (100 * filled) / a.students.length : 0}
                right={`${filled}/${a.students.length} entered`} tone={filled >= a.students.length ? 'teal' : 'amber'} />
            </div>
            {a.lockReason && <div className="mb-3"><Banner tone="neutral" icon="lock">{a.lockReason}</Banner></div>}
            {save.error && <div className="mb-3"><InlineError error={save.error} /></div>}
            {a.students.length === 0 ? <Empty icon="users" title="No students on this roster" /> : (
              <DataTable
                compact
                stack={false}
                rows={a.students}
                rowKey={(r) => r.id}
                columns={[
                  { key: 'roll', label: 'Roll', width: '60px', render: (r) => <span className="t-num">{r.roll ?? '—'}</span> },
                  { key: 'name', label: 'Student', render: (r) => <><span className="t-sm">{r.fullName}</span><div className="t-micro t-muted">{r.section} · {r.admissionNo}</div></> },
                  {
                    key: 'mark', label: `Mark (out of ${a.maxMarks})`, className: 'num', render: (r, i) => {
                      const en = entries[r.id] ?? { marks: '', isAbsent: false };
                      if (!editable) return <span className="t-num">{r.isAbsent ? 'Absent' : r.marks ?? '—'}</span>;
                      const err = errors[r.id] || liveError(en, a.maxMarks);
                      const errId = `mark-err-${r.id}`;
                      return (
                        <span className="marks-cell">
                          <span className="marks-field">
                            <input className="input marks-input" data-mark-row={i}
                              type="number" inputMode="decimal" min={0} max={a.maxMarks} step="0.5" value={en.marks} disabled={en.isAbsent}
                              aria-label={`Mark for ${r.fullName}, out of ${a.maxMarks}`} aria-invalid={!!err || undefined} aria-describedby={err ? errId : undefined}
                              onKeyDown={(e) => moveFocus(e, i)}
                              onChange={(e) => {
                                const v = e.target.value;
                                setEntries((x) => ({ ...x, [r.id]: { ...en, marks: v } }));
                                if (errors[r.id]) setErrors((x) => { const n = { ...x }; delete n[r.id]; return n; });
                              }} />
                            <span className="marks-max" aria-hidden="true">/ {a.maxMarks}</span>
                          </span>
                          {err && <span id={errId} className="ac-err" role="alert">{err}</span>}
                        </span>
                      );
                    },
                  },
                  {
                    key: 'absent', label: 'Absent', render: (r) => {
                      const en = entries[r.id] ?? { marks: '', isAbsent: false };
                      return editable
                        ? <Checkbox checked={en.isAbsent} label={<span className="sr-only">Absent</span>} onChange={(v) => setEntries((x) => ({ ...x, [r.id]: { marks: v ? '' : en.marks, isAbsent: v } }))} />
                        : (r.isAbsent ? <Badge tone="warning">Absent</Badge> : null);
                    },
                  },
                  {
                    key: 'grade', label: 'Grade', render: (r) => {
                      const en = entries[r.id];
                      const val = en && en.marks.trim() !== '' && !en.isAbsent ? Number(en.marks) : null;
                      if (val == null || !Number.isFinite(val) || val > a.maxMarks) return <span className="t-faint">—</span>;
                      const g = gradeFor((100 * val) / a.maxMarks);
                      return <Badge tone={GRADE_TONE[g]}>{g}</Badge>;
                    },
                  },
                ]}
              />
            )}
            <div className="mt-3">
              <Banner tone="neutral" icon="save">Grades are calculated from the percentage of maximum marks. Marks are locked once moderation begins.</Banner>
            </div>
          </>
        )}
    </Modal>
  );
}
