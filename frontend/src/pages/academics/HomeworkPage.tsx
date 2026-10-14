import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import {
  Badge, Button, Card, Checkbox, DataTable, Empty, ErrorState, FilterSelect, Grid, InlineError, Kpi, Meter, Modal, Page, PageHead,
  Pagination, SearchInput, SelectField, Skeleton, StudentLink, TextArea, TextField, useConfirm, Toolbar,
} from '@/components/ui';
import { fmt, todayKey } from '@/lib/format';
import { DueDate, meterTone, ratio, serverFieldErrors, useSections } from './shared';

interface HomeworkRow {
  id: string; title: string; instructions: string | null; status: string; displayStatus: string; assignedOn: string; dueOn: string;
  sectionId: string; sectionLabel: string; subjectId: string; subject: string; assignedBy: string | null; submitted: number; of: number;
}
interface Summary { open: number; averageSubmission: number | null; overdue: number; overdueSubjects: string[]; studentsBelow50: number }
interface Submissions {
  homework: HomeworkRow;
  students: { id: string; admissionNo: string; fullName: string; roll: number | null; status: string | null; submittedAt: string | null; feedback: string | null }[];
}

const STATUS_TONE: Record<string, string> = { Open: 'info', 'Closing today': 'warning', Overdue: 'critical', Closed: 'neutral', Draft: 'neutral' };

export default function HomeworkPage() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const { campusParam, campusId } = useSchool();
  const { lookups } = useLookups();
  const sections = useSections(can('students.read') ? campusId : undefined);
  const list = useListParams({ sort: 'due', dir: 'asc', pageSize: 25 }, ['status', 'sectionId', 'subjectId']);
  const q = usePagedQuery<HomeworkRow>('/academics/homework', { ...list.query, ...campusParam });
  const summary = useApiQuery<Summary>('/academics/homework/summary', campusParam);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const s = summary.data;
  const manage = can('academics.manage');

  const inv = ['/academics/homework', '/academics/teacher-dashboard'];
  const remind = useApiMutation<string, { students: number }>('post', (id) => `/academics/homework/${id}/remind`, { invalidate: ['/notifications'], body: () => ({}) });
  const close = useApiMutation<string>('post', (id) => `/academics/homework/${id}/close`, { invalidate: inv, body: () => ({}) });
  const publish = useApiMutation<string>('post', (id) => `/academics/homework/${id}/publish`, { invalidate: inv, body: () => ({}) });

  const doRemind = async (r: HomeworkRow) => {
    const pending = r.of - r.submitted;
    if (!pending) return;
    if (await confirm({ title: 'Send a reminder to parents?', body: `Parents of ${pending} student${pending === 1 ? '' : 's'} in ${r.sectionLabel} who have not submitted "${r.title}" will be reminded on WhatsApp and the parent app.`, confirmLabel: 'Send reminder', icon: 'message' })) {
      remind.mutate(r.id);
    }
  };
  const doClose = async (r: HomeworkRow) => {
    if (await confirm({ title: `Close "${r.title}"?`, body: `${r.submitted} of ${r.of} submitted. Closed homework cannot be reopened.`, confirmLabel: 'Close homework' })) close.mutate(r.id);
  };

  return (
    <Page>
      <PageHead title="Homework" sub="Set, tracked and visible to parents in the same place the child sees it."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Set homework</Button>} />
      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : (
        <Grid cols="g-4col">
          <Kpi loading={!s} icon="fileText" label="Open assignments" value={s?.open ?? 0} foot="Select to filter the list" onClick={() => list.setFilter('status', 'Open')} />
          <Kpi loading={!s} icon="checkSquare" label="Average submission" value={s?.averageSubmission != null ? `${s.averageSubmission}%` : '—'} tone="amber" foot="Across open assignments" />
          <Kpi loading={!s} icon="clock" label="Overdue" value={s?.overdue ?? 0} tone={s?.overdue ? 'critical' : 'teal'} foot={s?.overdueSubjects.length ? s.overdueSubjects.join(' and ') : 'Nothing overdue'} onClick={() => list.setFilter('status', 'Overdue')} />
          <Kpi loading={!s} icon="alert" label="Students below 50%" value={s?.studentsBelow50 ?? 0} tone="critical" foot="Submission rate this year" to={can('earlywarning.read') ? '/early-warning' : undefined} />
        </Grid>
      )}
      <div className="mt-4">
        <Card flush>
          <Toolbar>
            <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search homework" />
            <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={['Open', 'Overdue', 'Closed', 'Draft']} />
            <FilterSelect label="Class" value={list.filters.sectionId} onChange={(v) => list.setFilter('sectionId', v)} options={(sections.data ?? []).map((x) => ({ value: x.id, label: x.label }))} />
            <FilterSelect label="Subject" value={list.filters.subjectId} onChange={(v) => list.setFilter('subjectId', v)} options={(lookups?.subjects ?? []).map((x) => ({ value: x.id, label: x.name }))} />
          </Toolbar>
          {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <DataTable
              rows={q.data?.rows}
              loading={q.isLoading}
              rowKey={(r) => r.id}
              sort={list.sort}
              onSort={list.setSort}
              onRowClick={(r) => setViewing(r.id)}
              rowClassName={(r) => (r.displayStatus === 'Overdue' ? 'ac-row--overdue' : r.displayStatus === 'Closing today' ? 'ac-row--today' : undefined)}
              emptyText={list.hasFilters ? 'No homework matches these filters.' : manage ? 'No homework has been set yet. Use “Set homework” to assign the first one.' : 'No homework has been set yet.'}
              columns={[
                { key: 'title', label: 'Assignment', render: (r) => <><span className="t-bold">{r.title}</span><div className="t-micro t-muted">{r.subject} · {r.sectionLabel}{r.assignedBy ? ` · ${r.assignedBy}` : ''}</div></> },
                { key: 'due', label: 'Due', render: (r) => <DueDate date={r.dueOn} done={r.status === 'Closed' || r.status === 'Draft'} doneLabel={r.status === 'Closed' ? 'Closed' : 'Not published'} /> },
                { key: 'submitted', label: 'Submitted', render: (r) => <Meter label="" value={ratio(r.submitted, r.of)} right={`${r.submitted}/${r.of}`} tone={meterTone(ratio(r.submitted, r.of))} /> },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.displayStatus] ?? 'neutral'}>{r.displayStatus}</Badge> },
                {
                  key: 'a', label: '', sortable: false, className: 'num', render: (r) => manage && (
                    <span className="ac-links" onClick={(e) => e.stopPropagation()}>
                      {r.status === 'Open' && <Button size="sm" icon="message" onClick={() => doRemind(r)} disabled={r.submitted >= r.of || remind.isPending}>Remind</Button>}
                      {r.status === 'Open' && <Button size="sm" onClick={() => doClose(r)} disabled={close.isPending}>Close</Button>}
                      {r.status === 'Draft' && <Button size="sm" variant="primary" onClick={() => publish.mutate(r.id)} loading={publish.isPending && publish.variables === r.id}>Publish</Button>}
                    </span>
                  ),
                },
              ]}
            />
          )}
          <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
        </Card>
      </div>
      {creating && <HomeworkForm onClose={() => setCreating(false)} />}
      {viewing && <SubmissionsModal id={viewing} onClose={() => setViewing(null)} />}
    </Page>
  );
}

function HomeworkForm({ onClose }: { onClose: () => void }) {
  const { lookups } = useLookups();
  const { can } = useAuth();
  const { campusId } = useSchool();
  const sections = useSections(can('students.read') ? campusId : undefined);
  const [f, setF] = useState({ sectionId: '', subjectId: '', title: '', instructions: '', dueOn: '', draft: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string | boolean) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); };
  const section = (sections.data ?? []).find((s) => s.id === f.sectionId);
  const subjects = useMemo(() => {
    const all = (lookups?.subjects ?? []).map((x) => ({ value: x.id, label: x.name }));
    if (!section || section.isClassTeacher || !section.mySubjects.length || can('students.read')) return all;
    return all.filter((o) => section.mySubjects.includes(o.label));
  }, [lookups, section, can]);
  const save = useApiMutation<Record<string, unknown>, { notified: number }>('post', '/academics/homework', {
    invalidate: ['/academics/homework', '/academics/teacher-dashboard'],
    success: (r, v) => (v.status === 'Draft' ? 'Homework saved as a draft' : `Homework set — ${r.data.notified} parent notification${r.data.notified === 1 ? '' : 's'} queued`),
    onSuccess: onClose, error: false,
  });
  useEffect(() => { if (save.error) setErrors(serverFieldErrors(save.error)); }, [save.error]);
  const submit = () => {
    const e: Record<string, string> = {};
    if (!f.sectionId) e.sectionId = 'Choose a class';
    if (!f.subjectId) e.subjectId = 'Choose a subject';
    if (f.title.trim().length < 3) e.title = 'Give the homework a title';
    if (!f.dueOn) e.dueOn = 'Choose a due date';
    else if (f.dueOn < todayKey()) e.dueOn = 'The due date cannot be in the past';
    setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({ sectionId: f.sectionId, subjectId: f.subjectId, title: f.title.trim(), instructions: f.instructions.trim() || null, dueOn: f.dueOn, status: f.draft ? 'Draft' : 'Open' });
  };
  return (
    <Modal open onClose={onClose} busy={save.isPending} title="Set homework" sub="Parents see it in the parent app as soon as it is published."
      foot={<><Button onClick={onClose} disabled={save.isPending}>Cancel</Button><Button variant="primary" onClick={submit} loading={save.isPending}>{f.draft ? 'Save draft' : 'Set homework'}</Button></>}>
      {save.error && !Object.keys(serverFieldErrors(save.error)).length && <div className="mb-3"><InlineError error={save.error} /></div>}
      <div className="formsection">
        <div className="formsection__title">Class</div>
        <div className="grid g-2col g-3">
          <SelectField label="Class" required value={f.sectionId} onChange={set('sectionId')} placeholder="Choose a class" error={errors.sectionId} options={(sections.data ?? []).map((s) => ({ value: s.id, label: s.label }))} />
          <SelectField label="Subject" required value={f.subjectId} onChange={set('subjectId')} placeholder="Choose a subject" error={errors.subjectId} options={subjects}
            hint={section && !section.isClassTeacher && section.mySubjects.length && !can('students.read') ? 'Only the subjects you teach in this class are listed.' : undefined} />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Assignment</div>
        <div className="grid g-2col g-3">
          <TextField label="Title" required value={f.title} onChange={set('title')} error={errors.title} maxLength={160} placeholder="Fractions worksheet 4" />
          <TextField label="Due date" type="date" required min={todayKey()} value={f.dueOn} onChange={set('dueOn')} error={errors.dueOn} />
        </div>
        <div className="mt-3"><TextArea label="Instructions" rows={3} value={f.instructions} onChange={set('instructions')} maxLength={2000} error={errors.instructions}
          hint="Parents and students see these instructions in their apps." /></div>
      </div>
      <div className="formsection">
        <Checkbox checked={f.draft} onChange={set('draft')} label="Save as a draft (parents are not notified yet)" />
      </div>
    </Modal>
  );
}

function SubmissionsModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const q = useApiQuery<Submissions>(`/academics/homework/${id}/submissions`);
  const save = useApiMutation<{ studentId: string; status: string }>('put', `/academics/homework/${id}/submissions`, {
    invalidate: ['/academics/homework'], success: false,
  });
  const d = q.data;
  const editable = can('academics.manage') && !!d && d.homework.status !== 'Draft';
  const done = d ? d.students.filter((s) => s.status).length : 0;
  return (
    <Modal open onClose={onClose} size="wide" title={d?.homework.title ?? 'Homework'}
      sub={d ? `${d.homework.subject} · ${d.homework.sectionLabel} · due ${fmt.date(d.homework.dueOn)} · ${done}/${d.students.length} submitted` : undefined}
      foot={<Button variant="primary" onClick={onClose}>Done</Button>}>
      {q.isLoading ? <Skeleton height={240} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : d && (
        <>
          <div className="row between wrap g-3 mb-3">
            <span className="reg-counts" aria-live="polite">
              {(['Submitted', 'Late', 'Reviewed'] as const).map((st) => (
                <span key={st} className="reg-count">{st}<strong>{d.students.filter((x) => x.status === st).length}</strong></span>
              ))}
              <span className={d.students.length - done ? 'reg-count reg-count--unmarked' : 'reg-count'}>Not submitted<strong>{d.students.length - done}</strong></span>
            </span>
            <DueDate date={d.homework.dueOn} done={d.homework.status !== 'Open'} doneLabel={d.homework.status} />
          </div>
          {d.homework.instructions && <p className="t-sm mb-3">{d.homework.instructions}</p>}
          {save.error && <div className="mb-3"><InlineError error={save.error} /></div>}
          {d.students.length === 0 ? <Empty icon="users" title="No students in this class" /> : (
            <DataTable compact stack={false} rows={d.students} rowKey={(r) => r.id} columns={[
              { key: 'roll', label: 'Roll', width: '56px', render: (r) => <span className="t-num">{r.roll ?? '—'}</span> },
              { key: 'name', label: 'Student', render: (r) => <StudentLink id={r.id} name={r.fullName} meta={r.admissionNo} /> },
              { key: 'at', label: 'Submitted', render: (r) => (r.submittedAt ? fmt.dateTime(r.submittedAt) : <span className="t-faint">—</span>) },
              {
                key: 'status', label: 'Status', render: (r) => editable ? (
                  <select className="select" aria-label={`Submission status for ${r.fullName}`} value={r.status ?? 'Missing'} style={{ width: 130 }}
                    disabled={save.isPending} onChange={(e) => save.mutate({ studentId: r.id, status: e.target.value })}>
                    {['Missing', 'Submitted', 'Late', 'Reviewed'].map((o) => <option key={o} value={o}>{o === 'Missing' ? 'Not submitted' : o}</option>)}
                  </select>
                ) : <Badge tone={r.status === 'Reviewed' ? 'success' : r.status === 'Late' ? 'warning' : r.status ? 'info' : 'critical'}>{r.status ?? 'Not submitted'}</Badge>,
              },
            ]} />
          )}
        </>
      )}
    </Modal>
  );
}
