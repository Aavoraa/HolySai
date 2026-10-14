import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { ApiError } from '@/api/client';
import type { StudentRow } from '@/api/types';
import { fmt, todayKey } from '@/lib/format';
import {
  Badge, Banner, Button, Card, Chart, charts, DataTable, Empty, ErrorState, FilterSelect, Grid, Kpi, Legend, Modal, Page,
  Icon, PageHead, PageSkeleton, Pagination, SearchInput, SelectField, Status, StudentLink, Switch, Tabs, TextArea, TextField, Toolbar,
} from '@/components/ui';
import { StudentPicker } from './shared';

interface Overview {
  termStart: string;
  positive: { value: number; delta: number | null };
  concerns: { value: number; delta: number | null };
  counselling: { sessions: number; students: number; upcoming: number };
  safeguarding: { total: number; closed: number; open: number };
  byGrade: { label: string; positive: number; concern: number }[];
  moods: { label: string; value: number }[];
  moodScope: string;
  infirmary: { id: string; visitedAt: string; reason: string; status: string; studentId: string; student: string; grade: string }[] | null;
  canViewSensitive: boolean;
}
interface NoteRow { id: string; date: string; type: string; note: string; by: string | null; studentId: string; studentName: string; admissionNo: string; grade: string }
interface CheckinRow { id: string; date: string; mood: string; notes: string | null; confidential: boolean; by: string | null; studentId: string; studentName: string; admissionNo: string; grade: string }

const TYPES = ['Positive', 'Note', 'Concern', 'Incident'];
const MOODS = ['Positive', 'Settled', 'Unsettled', 'Anxious', 'Low'];
const MOOD_COLORS: Record<string, string> = { Positive: 'var(--teal)', Settled: 'var(--navy)', Unsettled: 'var(--amber)', Anxious: 'var(--viz-4)', Low: 'var(--critical)' };
const typeTone = (t: string) => (t === 'Positive' ? 'success' : t === 'Concern' ? 'warning' : t === 'Incident' ? 'critical' : 'neutral');

export default function WellbeingPage() {
  const { can } = useAuth();
  const sensitive = can('students.sensitive');
  const { campusParam } = useSchool();
  const q = useApiQuery<Overview>('/wellbeing/overview', campusParam);
  const list = useListParams({ sort: 'date', dir: 'desc', pageSize: 10 }, ['type', 'mood', 'tab']);
  const tab = (list.filters.tab || 'notes') as 'notes' | 'checkins';
  const listParams = { page: list.page, pageSize: list.pageSize, q: list.q || undefined, ...campusParam };
  const notes = usePagedQuery<NoteRow>(tab === 'notes' ? '/wellbeing/behaviour' : null, { ...listParams, type: list.filters.type || undefined });
  const checkins = usePagedQuery<CheckinRow>(tab === 'checkins' ? '/wellbeing/checkins' : null, { ...listParams, mood: list.filters.mood || undefined });
  const [modal, setModal] = useState<'note' | 'checkin' | null>(null);

  const head = (
    <PageHead
      title="Behaviour & Wellbeing"
      sub="School-wide view. Individual records stay inside the restricted tab on each Student 360 profile."
      actions={<>
        <Button icon="heart" onClick={() => setModal('checkin')}>Record check-in</Button>
        <Button variant="primary" icon="plus" onClick={() => setModal('note')}>Record behaviour note</Button>
      </>}
    />
  );
  if (q.isLoading) return <Page>{head}<PageSkeleton /></Page>;
  if (q.error || !q.data) return <Page>{head}<ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;
  const d = q.data;
  const moodTotal = d.moods.reduce((a, m) => a + m.value, 0);

  return (
    <Page>
      {head}
      <Grid cols="g-4col">
        <Kpi label="Positive notes this term" icon="star" value={fmt.n(d.positive.value)} tone="teal" delta={d.positive.delta} foot={`Since ${fmt.date(d.termStart)}`} />
        <Kpi label="Concerns logged" icon="flag" value={fmt.n(d.concerns.value)} tone="amber" delta={d.concerns.delta} inverse foot="Concerns and incidents"
          onClick={() => list.setFilter('type', 'Concern')} />
        <Kpi label="Counselling sessions" icon="message" value={d.counselling.sessions} tone="info" foot={`${d.counselling.students} students · ${d.counselling.upcoming} upcoming`} />
        <Kpi label="Safeguarding concerns" icon="shield" value={d.safeguarding.total} tone="critical"
          foot={d.safeguarding.total ? `${d.safeguarding.closed} closed · ${d.safeguarding.open} open` : 'None this term'} />
      </Grid>

      <div className="grid g-main mt-4">
        <Card icon="grid" title="Positive notes against concerns" sub="By grade, this term">
          {d.byGrade.length ? <>
            <Chart svg={charts.stacked({
              labels: d.byGrade.map((g) => g.label),
              series: [
                { name: 'Positive', values: d.byGrade.map((g) => g.positive), color: 'var(--teal)' },
                { name: 'Concern', values: d.byGrade.map((g) => g.concern), color: 'var(--amber)' },
              ],
              height: 240,
            })} />
            <div className="mt-3"><Legend items={[{ label: 'Positive', color: 'var(--teal)' }, { label: 'Concern', color: 'var(--amber)' }]} /></div>
          </> : <Empty icon="heart" title="No behaviour notes this term" sub="Positive notes and concerns appear here, grouped by grade, as staff record them." />}
        </Card>
        <div className="col g-4">
          {d.infirmary !== null && (
            <Card icon="grid" title="Infirmary today" sub={`${d.infirmary.length} visit${d.infirmary.length === 1 ? '' : 's'}`} flush>
              <DataTable compact rows={d.infirmary} rowKey={(r) => r.id} emptyText="No infirmary visits today."
                columns={[
                  { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.student} meta={`${r.grade} · ${fmt.time(r.visitedAt)}`} /> },
                  { key: 'reason', label: 'Reason' },
                  { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'Awaiting pickup' ? 'warning' : 'success'}>{r.status}</Badge> },
                ]} />
            </Card>
          )}
          <Card icon="grid" title="Latest check-in mood" sub={`One per student · ${d.moodScope}`}>
            {moodTotal ? <>
              <Chart svg={charts.donut({ size: 170, thickness: 24, center: String(moodTotal), centerSub: 'students', data: d.moods.map((m) => ({ ...m, color: MOOD_COLORS[m.label] ?? 'var(--viz-6)' })) })} />
              <div className="mt-3"><Legend items={d.moods.map((m) => ({ label: `${m.label} ${m.value}`, color: MOOD_COLORS[m.label] ?? 'var(--viz-6)' }))} /></div>
            </> : <Empty icon="heart" title="No check-ins recorded" sub="Each student’s latest mood appears here once a check-in is recorded." />}
          </Card>
        </div>
      </div>

      {!sensitive && <div className="mt-4"><Banner tone="neutral" icon="lock">Confidential check-ins and counselling notes are hidden for your role. They are visible to the counsellor and the Principal.</Banner></div>}

      <div className="mt-4">
      <Card icon="grid" flush title="Records" sub={tab === 'notes' ? 'Behaviour notes recorded by staff, newest first' : 'Wellbeing check-ins, newest first'}>
        <Toolbar>
        <Tabs pills items={[{ id: 'notes', label: 'Behaviour notes' }, { id: 'checkins', label: 'Wellbeing check-ins' }]} active={tab}
          onChange={(t) => list.setFilter('tab', t === 'notes' ? '' : t)} />
        {tab === 'notes'
          ? <FilterSelect label="Type" value={list.filters.type} onChange={(v) => list.setFilter('type', v)} options={TYPES} />
          : <FilterSelect label="Mood" value={list.filters.mood} onChange={(v) => list.setFilter('mood', v)} options={MOODS} />}
        <SearchInput value={list.q} onSearch={list.setQ} placeholder={tab === 'notes' ? 'Search student or note' : 'Search student'} maxWidth={260} />
        </Toolbar>
        {tab === 'notes' ? (
          notes.error ? <ErrorState error={notes.error} onRetry={() => notes.refetch()} /> : <>
            <DataTable<NoteRow> rows={notes.data?.rows} loading={notes.isLoading} rowKey={(r) => r.id} emptyText={list.q || list.filters.type ? "No behaviour notes match these filters." : "No behaviour notes yet. Use “Record behaviour note” to add the first one."}
              columns={[
                { key: 'date', label: 'Date', width: '110px', render: (r) => fmt.date(r.date) },
                { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={`${r.grade} · ${r.admissionNo}`} /> },
                { key: 'type', label: 'Type', render: (r) => <Badge tone={typeTone(r.type)}>{r.type}</Badge> },
                { key: 'note', label: 'Note' },
                { key: 'by', label: 'Recorded by', render: (r) => r.by ?? '—' },
              ]} />
            <Pagination meta={notes.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
          </>
        ) : (
          checkins.error ? <ErrorState error={checkins.error} onRetry={() => checkins.refetch()} /> : <>
            <DataTable<CheckinRow> rows={checkins.data?.rows} loading={checkins.isLoading} rowKey={(r) => r.id} emptyText={list.q || list.filters.mood ? "No check-ins match these filters." : "No check-ins yet. Use “Record check-in” to add the first one."}
              columns={[
                { key: 'date', label: 'Date', width: '110px', render: (r) => fmt.date(r.date) },
                { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={`${r.grade} · ${r.admissionNo}`} /> },
                { key: 'mood', label: 'Mood', render: (r) => <Status value={r.mood} label={r.mood} /> },
                { key: 'notes', label: 'Notes', render: (r) => <>{r.confidential && <Badge tone="critical" icon="lock">Confidential</Badge>} {r.notes ?? <span className="t-faint">—</span>}</> },
                { key: 'by', label: 'Recorded by', render: (r) => r.by ?? '—' },
              ]} />
            <Pagination meta={checkins.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
          </>
        )}
      </Card>
      </div>

      {modal === 'note' && <BehaviourModal onClose={() => setModal(null)} />}
      {modal === 'checkin' && <CheckinModal sensitive={sensitive} onClose={() => setModal(null)} />}
    </Page>
  );
}

function PickedStudent({ student, onPick, error }: { student: StudentRow | null; onPick: (s: StudentRow | null) => void; error?: string }) {
  return (
    <div className="field">
      <span className="label">Student <span className="req">*</span></span>
      {student ? (
        <div className="row g-3 card card--tint" style={{ padding: '8px 12px' }}>
          <span className="grow t-sm"><strong>{student.fullName}</strong> · {student.grade}{student.section} · {student.admissionNo}</span>
          <Button size="sm" variant="quiet" onClick={() => onPick(null)}>Change</Button>
        </div>
      ) : <StudentPicker onPick={onPick} />}
      {error && <span className="hint hint--error" role="alert"><Icon name="alertCircle" size={13} />{error}</span>}
    </div>
  );
}

function BehaviourModal({ onClose }: { onClose: () => void }) {
  const [student, setStudent] = useState<StudentRow | null>(null);
  const [form, setForm] = useState({ recordType: 'Positive', note: '', recordedOn: todayKey() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useApiMutation<Record<string, string>>('post', '/wellbeing/behaviour', { invalidate: ['/wellbeing', '/students'], onSuccess: onClose, error: false });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!student) e.studentId = 'Choose a student';
    if (form.note.trim().length < 3) e.note = 'Write a short note (at least 3 characters)';
    if (form.recordedOn > todayKey()) e.recordedOn = 'The date cannot be in the future';
    setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({ studentId: student!.id, recordType: form.recordType, note: form.note.trim(), recordedOn: form.recordedOn },
      { onError: (err) => setErrors(err instanceof ApiError ? { ...err.fieldErrors, _: err.message } : { _: err.message }) });
  };
  return (
    <Modal open onClose={onClose} busy={save.isPending} title="Record behaviour note" sub="Notes appear on the student’s Student 360 profile"
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="check" loading={save.isPending} onClick={submit}>Save note</Button></>}>
      <div className="col g-3">
        <PickedStudent student={student} onPick={setStudent} error={errors.studentId} />
        <div className="grid g-2col g-3">
          <SelectField label="Type" required value={form.recordType} onChange={(v) => setForm({ ...form, recordType: v })} options={TYPES} />
          <TextField label="Date" required type="date" max={todayKey()} value={form.recordedOn} onChange={(v) => setForm({ ...form, recordedOn: v })} error={errors.recordedOn} />
        </div>
        <TextArea label="Note" required value={form.note} onChange={(v) => setForm({ ...form, note: v })} rows={4} maxLength={1000} error={errors.note}
          placeholder="What happened, factually and briefly." />
        {errors._ && <Banner tone="critical" icon="alert">{errors._}</Banner>}
      </div>
    </Modal>
  );
}

function CheckinModal({ sensitive, onClose }: { sensitive: boolean; onClose: () => void }) {
  const [student, setStudent] = useState<StudentRow | null>(null);
  const [form, setForm] = useState({ mood: 'Settled', notes: '', isConfidential: false, checkedOn: todayKey() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useApiMutation<Record<string, unknown>>('post', '/wellbeing/checkins', { invalidate: ['/wellbeing', '/students'], onSuccess: onClose, error: false });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!student) e.studentId = 'Choose a student';
    if (form.checkedOn > todayKey()) e.checkedOn = 'The date cannot be in the future';
    if (form.isConfidential && !form.notes.trim()) e.notes = 'Add a note for a confidential check-in';
    setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({ studentId: student!.id, mood: form.mood, notes: form.notes.trim() || undefined, isConfidential: form.isConfidential, checkedOn: form.checkedOn },
      { onError: (err) => setErrors(err instanceof ApiError ? { ...err.fieldErrors, _: err.message } : { _: err.message }) });
  };
  return (
    <Modal open onClose={onClose} busy={save.isPending} title="Record wellbeing check-in"
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="check" loading={save.isPending} onClick={submit}>Save check-in</Button></>}>
      <div className="col g-3">
        <PickedStudent student={student} onPick={setStudent} error={errors.studentId} />
        <div className="grid g-2col g-3">
          <SelectField label="Mood" required value={form.mood} onChange={(v) => setForm({ ...form, mood: v })} options={MOODS} />
          <TextField label="Date" required type="date" max={todayKey()} value={form.checkedOn} onChange={(v) => setForm({ ...form, checkedOn: v })} error={errors.checkedOn} />
        </div>
        <TextArea label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} rows={3} maxLength={1000} error={errors.notes} />
        {sensitive
          ? <Switch checked={form.isConfidential} onChange={(v) => setForm({ ...form, isConfidential: v })} label="Confidential — visible only to the counsellor and Principal" />
          : <p className="t-xs t-muted">Confidential check-ins can only be recorded by the counsellor or the Principal.</p>}
        {errors._ && <Banner tone="critical" icon="alert">{errors._}</Banner>}
      </div>
    </Modal>
  );
}
