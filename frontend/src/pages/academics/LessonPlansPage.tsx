import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import {
  AiNotice, Badge, Banner, Button, Card, Checkbox, DataTable, Empty, ErrorState, FilterSelect, Grid, Icon, IconButton, InlineError,
  Kpi, Modal, Page, PageHead, Pagination, SearchInput, Segment, SelectField, Skeleton, Status, Stepper, TextArea, TextField, useConfirm, Toolbar,
} from '@/components/ui';
import { fmt, todayKey } from '@/lib/format';
import { serverFieldErrors, useSections } from './shared';
import type { ObjectiveRow } from './objectiveForms';

interface PlanRow {
  id: string; title: string; status: string; plannedFor: string | null; aiGenerated: boolean; sectionId: string | null; sectionLabel: string | null;
  subjectId: string; subject: string; objectiveId: string | null; objectiveCode: string | null; objectiveText: string | null;
  authorId: string; teacher: string; approvedAt: string | null; approvedBy: string | null; reviewNote: string | null;
}
interface PlanContent {
  objective?: string; plan?: { time: string; step: string; detail: string }[]; activities?: string[];
  differentiation?: { level: string; detail: string }[]; homework?: string; reviewNote?: string;
}
interface PlanDetail extends PlanRow { content: PlanContent }
interface Summary { thisWeek: number; approved: number; awaitingReview: number; drafts: number; aiAssistedPct: number | null; weekStart: string; weekEnd: string }

const STAGES = ['Draft', 'Submitted', 'Under Review', 'Approved'];
const stageIndex = (s: string) => (s === 'Rejected' ? 3 : Math.max(0, STAGES.indexOf(s)));

export default function LessonPlansPage() {
  const { can, user } = useAuth();
  const { campusParam } = useSchool();
  const { lookups } = useLookups();
  const list = useListParams({ sort: 'date', dir: 'desc', pageSize: 25 }, ['status', 'subjectId', 'mine']);
  const q = usePagedQuery<PlanRow>('/academics/lesson-plans', { ...list.query, ...campusParam });
  const summary = useApiQuery<Summary>('/academics/lesson-plans/summary', campusParam);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<PlanDetail | 'new' | null>(null);
  const s = summary.data;
  const canWrite = can('academics.manage') && !!user?.employeeId;

  return (
    <Page>
      <PageHead
        title="Lesson Plans"
        sub="Planned, approved and delivered. Drafts from the Co-Pilot arrive here for review."
        actions={<>
          {can('ai.use') && <Button variant="amber" icon="sparkle" to="/copilot">Draft with Co-Pilot</Button>}
          {canWrite && <Button variant="primary" icon="plus" onClick={() => setForm('new')}>New lesson plan</Button>}
        </>}
      />
      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : (
        <Grid cols="g-4col">
          <Kpi loading={!s} icon="calendar" label="Plans this week" value={s?.thisWeek ?? 0} foot={s ? `${fmt.dateShort(s.weekStart)} – ${fmt.dateShort(s.weekEnd)}` : undefined} />
          <Kpi loading={!s} icon="check" label="Approved" value={s?.approved ?? 0} unit={s && s.thisWeek ? `${Math.round((100 * s.approved) / s.thisWeek)}%` : undefined} tone="teal" onClick={() => list.setFilter('status', 'Approved')} />
          <Kpi loading={!s} icon="eye" label="Awaiting review" value={s?.awaitingReview ?? 0} tone="amber" foot="Submitted or under review" onClick={() => list.setFilter('status', 'Submitted')} />
          <Kpi loading={!s} icon="sparkle" label="AI-assisted" value={s?.aiAssistedPct != null ? `${s.aiAssistedPct}%` : '—'} tone="info" foot="All reviewed by a teacher" />
        </Grid>
      )}

      <div className="mt-4">
        <Card flush>
          <Toolbar>
            <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search lesson, objective or teacher" />
            <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={['Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected']} />
            <FilterSelect label="Subject" value={list.filters.subjectId} onChange={(v) => list.setFilter('subjectId', v)} options={(lookups?.subjects ?? []).map((x) => ({ value: x.id, label: x.name }))} />
            {user?.employeeId && <Segment items={[{ id: '', label: 'All plans' }, { id: 'true', label: 'My plans' }]} active={list.filters.mine} onChange={(v) => list.setFilter('mine', v)} />}
          </Toolbar>
          {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <DataTable
              rows={q.data?.rows}
              loading={q.isLoading}
              rowKey={(r) => r.id}
              sort={list.sort}
              onSort={list.setSort}
              onRowClick={(r) => setOpen(r.id)}
              emptyText={list.hasFilters ? 'No lesson plans match these filters.' : canWrite ? 'No lesson plans yet. Use “New lesson plan” or draft one with the Co-Pilot.' : 'No lesson plans yet.'}
              columns={[
                { key: 'title', label: 'Lesson', render: (r) => <><span className="t-bold">{r.title}</span><div className="t-micro t-muted">{r.objectiveCode ?? 'No objective linked'}</div></> },
                { key: 'cls', label: 'Class', render: (r) => r.sectionLabel ?? '—' },
                { key: 'teacher', label: 'Teacher', render: (r) => r.teacher },
                { key: 'date', label: 'Date', render: (r) => fmt.dateShort(r.plannedFor) },
                { key: 'origin', label: 'Origin', sortable: false, render: (r) => <Badge tone={r.aiGenerated ? 'warning' : 'neutral'} icon={r.aiGenerated ? 'sparkle' : undefined}>{r.aiGenerated ? 'AI draft' : 'Teacher'}</Badge> },
                { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
              ]}
            />
          )}
          <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
        </Card>
      </div>

      {open && <PlanModal id={open} onClose={() => setOpen(null)} onEdit={(p) => { setOpen(null); setForm(p); }} />}
      {form && <PlanForm plan={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
    </Page>
  );
}

// ---------------------------------------------------------------------------
function PlanModal({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (p: PlanDetail) => void }) {
  const { can, user } = useAuth();
  const confirm = useConfirm();
  const q = useApiQuery<PlanDetail>(`/academics/lesson-plans/${id}`);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const act = useApiMutation<{ action: string; note?: string }, { status: string }>('post', `/academics/lesson-plans/${id}/transition`, {
    invalidate: ['/academics/lesson-plans'],
  });
  const del = useApiMutation<void>('delete', `/academics/lesson-plans/${id}`, { invalidate: ['/academics/lesson-plans'], onSuccess: onClose });
  const p = q.data;
  const isAuthor = !!p && p.authorId === user?.employeeId;
  const reviewer = !!p && !isAuthor && can('academics.manage') && can('students.read') && user?.role.scope !== 'class';
  const busy = act.isPending || del.isPending;

  const decide = async (action: 'approve' | 'reject') => {
    if (action === 'reject' && note.trim().length < 3) { setNoteError('Give the author a reason'); return; }
    const ok = await confirm({
      title: action === 'approve' ? 'Approve this lesson plan?' : 'Return this plan to the author?',
      body: action === 'approve' ? 'Your name is recorded as the approver.' : 'The author is notified with your reason.',
      confirmLabel: action === 'approve' ? 'Approve' : 'Reject', danger: action === 'reject',
    });
    if (ok) act.mutate({ action, note: note.trim() || undefined });
  };

  return (
    <Modal open onClose={onClose} busy={busy} size="wide" title={p?.title ?? 'Lesson plan'}
      sub={p ? `${p.sectionLabel ?? ''} · ${p.subject} · ${p.teacher} · ${fmt.date(p.plannedFor)}` : undefined}
      foot={p && (
        <>
          <Button onClick={onClose}>Close</Button>
          {isAuthor && can('academics.manage') && p.status === 'Draft' && (
            <Button variant="danger" icon="trash" disabled={busy} onClick={async () => {
              if (await confirm({ title: 'Delete this draft?', body: 'The draft is removed permanently.', confirmLabel: 'Delete draft', danger: true })) del.mutate();
            }}>Delete</Button>
          )}
          {isAuthor && can('academics.manage') && (p.status === 'Draft' || p.status === 'Rejected') && <Button icon="edit" onClick={() => onEdit(p)}>Edit</Button>}
          {isAuthor && can('academics.manage') && p.status === 'Rejected' && <Button onClick={() => act.mutate({ action: 'reopen' })} loading={act.isPending}>Reopen as draft</Button>}
          {isAuthor && can('academics.manage') && (p.status === 'Draft' || p.status === 'Rejected') && (
            <Button variant="primary" icon="send" loading={act.isPending} onClick={() => act.mutate({ action: 'submit' })}>Submit for review</Button>
          )}
          {reviewer && p.status === 'Submitted' && <Button onClick={() => act.mutate({ action: 'review' })} loading={act.isPending}>Start review</Button>}
          {reviewer && (p.status === 'Submitted' || p.status === 'Under Review') && (
            <>
              <Button variant="danger" onClick={() => decide('reject')} disabled={busy}>Reject</Button>
              <Button variant="teal" icon="check" onClick={() => decide('approve')} disabled={busy}>Approve</Button>
            </>
          )}
        </>
      )}>
      {q.isLoading ? <Skeleton height={260} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : p && (
        <div className="col g-4">
          <div className="row between wrap g-3">
            <Stepper steps={['Draft', 'Submitted', 'Under Review', p.status === 'Rejected' ? 'Rejected' : 'Approved']} active={p.status === 'Approved' ? 4 : stageIndex(p.status)} />
            <span className="row g-2">
              {p.aiGenerated && <Badge tone="warning" icon="sparkle">AI draft</Badge>}
              <Status value={p.status} />
            </span>
          </div>
          {p.aiGenerated && <AiNotice>Drafted with the AI Co-Pilot. The teacher reviews and edits it; a named reviewer approves it before it is used.</AiNotice>}
          {p.status === 'Rejected' && p.reviewNote && <Banner tone="critical" icon="alert"><strong>Returned by {p.approvedBy ?? 'the reviewer'}:</strong> {p.reviewNote}</Banner>}
          {p.status === 'Approved' && <Banner tone="success" icon="check">Approved by {p.approvedBy} · {fmt.dateTime(p.approvedAt)}{p.reviewNote ? ` — ${p.reviewNote}` : ''}</Banner>}
          {act.error && <InlineError error={act.error} />}
          <div>
            <div className="eyebrow mb-2">Learning objective</div>
            <p className="t-sm">{p.content.objective || p.objectiveText || '—'}{p.objectiveCode ? ` (Cambridge ${p.objectiveCode})` : ''}</p>
          </div>
          <div>
            <div className="eyebrow mb-2">Lesson plan</div>
            {p.content.plan?.length ? (
              <DataTable compact rows={p.content.plan} rowKey={(r) => `${r.time}${r.step}`} columns={[
                { key: 'time', label: 'Time', width: '92px' },
                { key: 'step', label: 'Step', render: (r) => <span className="t-bold">{r.step}</span> },
                { key: 'detail', label: 'Detail' },
              ]} />
            ) : <p className="t-sm t-muted">No steps written yet.</p>}
          </div>
          {(p.content.activities?.length || p.content.differentiation?.length) ? (
            <div className="grid g-2col g-5">
              <div>
                <div className="eyebrow mb-2">Activities</div>
                <ul className="col g-2">{(p.content.activities ?? []).map((a) => <li key={a} className="row g-2 t-sm"><Icon name="check" size={14} className="t-success" />{a}</li>)}</ul>
              </div>
              <div>
                <div className="eyebrow mb-2">Differentiated exercises</div>
                <div className="col g-2">{(p.content.differentiation ?? []).map((d) => (
                  <div key={d.level} className="row-top g-3"><Badge tone={d.level === 'Foundation' ? 'info' : d.level === 'Core' ? 'neutral' : 'success'}>{d.level}</Badge><span className="t-sm grow">{d.detail}</span></div>
                ))}</div>
              </div>
            </div>
          ) : null}
          {p.content.homework && <div><div className="eyebrow mb-2">Homework</div><p className="t-sm">{p.content.homework}</p></div>}
          {reviewer && (p.status === 'Submitted' || p.status === 'Under Review') && (
            <TextArea label="Review note" rows={2} value={note} onChange={(v) => { setNote(v); setNoteError(''); }} error={noteError} maxLength={500}
              placeholder="Required when rejecting; optional when approving." />
          )}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
type Step = { time: string; step: string; detail: string };

function PlanForm({ plan, onClose }: { plan?: PlanDetail; onClose: () => void }) {
  const { lookups } = useLookups();
  const sections = useSections();
  const editing = !!plan;
  const [f, setF] = useState({
    title: plan?.title ?? '', sectionId: plan?.sectionId ?? '', subjectId: plan?.subjectId ?? '', objectiveId: plan?.objectiveId ?? '',
    plannedFor: plan?.plannedFor ?? todayKey(), objective: plan?.content.objective ?? '', activities: (plan?.content.activities ?? []).join('\n'),
    homework: plan?.content.homework ?? '', aiGenerated: plan?.aiGenerated ?? false,
  });
  const [steps, setSteps] = useState<Step[]>(plan?.content.plan?.length ? plan.content.plan : [{ time: '0–10 min', step: 'Starter', detail: '' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string | boolean) => { setF((x) => ({ ...x, [k]: v, ...(k === 'subjectId' ? { objectiveId: '' } : {}) })); setErrors((e) => ({ ...e, [k]: '' })); };

  const section = (sections.data ?? []).find((s) => s.id === f.sectionId);
  const subjectOptions = useMemo(() => {
    const all = (lookups?.subjects ?? []).map((x) => ({ value: x.id, label: x.name }));
    if (!section || section.isClassTeacher || !section.mySubjects.length) return all;
    return all.filter((o) => section.mySubjects.includes(o.label));
  }, [lookups, section]);
  const objectives = useApiQuery<ObjectiveRow[]>(f.subjectId ? '/academics/objectives' : null, { subjectId: f.subjectId, pageSize: 200, sort: 'code' });

  const create = useApiMutation<Record<string, unknown>>('post', '/academics/lesson-plans', { invalidate: ['/academics/lesson-plans'], onSuccess: onClose, error: false });
  const update = useApiMutation<Record<string, unknown>>('put', `/academics/lesson-plans/${plan?.id}`, { invalidate: ['/academics/lesson-plans'], success: 'Lesson plan updated', onSuccess: onClose, error: false });
  const mut = editing ? update : create;
  useEffect(() => { if (mut.error) setErrors(serverFieldErrors(mut.error)); }, [mut.error]);

  const submit = (submitForReview: boolean) => {
    const e: Record<string, string> = {};
    if (f.title.trim().length < 3) e.title = 'Give the lesson a title';
    if (!editing && !f.sectionId) e.sectionId = 'Choose a class';
    if (!editing && !f.subjectId) e.subjectId = 'Choose a subject';
    if (!f.plannedFor) e.plannedFor = 'Choose a date';
    const cleanSteps = steps.filter((s) => s.step.trim() || s.detail.trim());
    if (submitForReview && !cleanSteps.length) e.steps = 'Add at least one lesson step before submitting';
    if (cleanSteps.some((s) => !s.step.trim())) e.steps = 'Every step needs a name';
    setErrors(e);
    if (Object.keys(e).length) return;
    const content = {
      objective: f.objective.trim(),
      plan: cleanSteps.map((s) => ({ time: s.time.trim(), step: s.step.trim(), detail: s.detail.trim() })),
      activities: f.activities.split('\n').map((a) => a.trim()).filter(Boolean),
      differentiation: plan?.content.differentiation ?? [],
      homework: f.homework.trim(),
    };
    if (editing) update.mutate({ title: f.title.trim(), objectiveId: f.objectiveId || null, plannedFor: f.plannedFor, content });
    else create.mutate({ title: f.title.trim(), sectionId: f.sectionId, subjectId: f.subjectId, objectiveId: f.objectiveId || null, plannedFor: f.plannedFor, content, aiGenerated: f.aiGenerated, submit: submitForReview });
  };

  return (
    <Modal open onClose={onClose} busy={mut.isPending} size="wide" title={editing ? `Edit “${plan!.title}”` : 'New lesson plan'}
      sub={editing ? `${plan!.sectionLabel} · ${plan!.subject} · saving returns the plan to Draft` : 'Save as a draft, or submit it for review.'}
      foot={<>
        <Button onClick={onClose} disabled={mut.isPending}>Cancel</Button>
        <Button icon="save" onClick={() => submit(false)} loading={mut.isPending}>{editing ? 'Save changes' : 'Save draft'}</Button>
        {!editing && <Button variant="primary" icon="send" onClick={() => submit(true)} disabled={mut.isPending}>Save and submit</Button>}
      </>}>
      {mut.error && !Object.keys(serverFieldErrors(mut.error)).length && <div className="mb-3"><InlineError error={mut.error} /></div>}
      <div className="formsection">
      <div className="formsection__title">Lesson</div>
      <div className="grid g-2col g-3">
        <TextField label="Lesson title" required value={f.title} onChange={set('title')} error={errors.title} maxLength={160} />
        <TextField label="Date" type="date" required value={f.plannedFor} onChange={set('plannedFor')} error={errors.plannedFor} />
        {!editing && (
          <SelectField label="Class" required value={f.sectionId} onChange={set('sectionId')} placeholder="Choose a class" error={errors.sectionId}
            options={(sections.data ?? []).map((s) => ({ value: s.id, label: s.label }))} />
        )}
        {!editing && <SelectField label="Subject" required value={f.subjectId} onChange={set('subjectId')} placeholder="Choose a subject" error={errors.subjectId} options={subjectOptions} />}
        <SelectField label="Cambridge objective" value={f.objectiveId} onChange={set('objectiveId')} placeholder={f.subjectId ? 'No objective' : 'Choose a subject first'}
          disabled={!f.subjectId} error={errors.objectiveId}
          options={(objectives.data ?? []).map((o) => ({ value: o.id, label: `${o.code} — ${o.text}`.slice(0, 90) }))} />
        {!editing && <div className="field" style={{ justifyContent: 'flex-end' }}><Checkbox checked={f.aiGenerated} onChange={set('aiGenerated')} label="Drafted with the AI Co-Pilot" /></div>}
      </div>
      <div className="mt-3"><TextArea label="Learning objective (in your words)" rows={2} value={f.objective} onChange={set('objective')} maxLength={1000} /></div>
      </div>
      <div className="formsection">
        <div className="row between mb-2 ac-sectionhead">
          <span className="formsection__title">Lesson steps</span>
          <Button size="sm" icon="plus" onClick={() => setSteps((x) => [...x, { time: '', step: '', detail: '' }])} disabled={steps.length >= 20}>Add step</Button>
        </div>
        <div className="lp-steps">
          {steps.map((s, i) => (
            <div key={i} className="lp-step">
              <span className="lp-step__n" aria-hidden="true">{i + 1}</span>
              <input className="input" aria-label={`Step ${i + 1} time`} placeholder="0–5 min" value={s.time} maxLength={40}
                onChange={(e) => setSteps((x) => x.map((y, j) => (j === i ? { ...y, time: e.target.value } : y)))} />
              <input className="input" aria-label={`Step ${i + 1} name`} placeholder="Step" value={s.step} maxLength={120}
                aria-invalid={!!errors.steps && !s.step.trim() && !!s.detail.trim() || undefined}
                onChange={(e) => setSteps((x) => x.map((y, j) => (j === i ? { ...y, step: e.target.value } : y)))} />
              <input className="input lp-step__detail" aria-label={`Step ${i + 1} detail`} placeholder="What happens" value={s.detail} maxLength={600}
                onChange={(e) => setSteps((x) => x.map((y, j) => (j === i ? { ...y, detail: e.target.value } : y)))} />
              <span className="lp-step__remove"><IconButton icon="trash" label={`Remove step ${i + 1}`} onClick={() => setSteps((x) => x.filter((_, j) => j !== i))} /></span>
            </div>
          ))}
          {!steps.length && <Empty icon="list" title="No steps yet" sub="Add the starter, main activity and plenary." />}
          {errors.steps && <span className="hint hint--error" role="alert"><Icon name="alertCircle" size={13} />{errors.steps}</span>}
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Activities and homework</div>
        <div className="grid g-2col g-3">
          <TextArea label="Activities (one per line)" rows={3} value={f.activities} onChange={set('activities')} />
          <TextArea label="Homework" rows={3} value={f.homework} onChange={set('homework')} maxLength={600} />
        </div>
      </div>
    </Modal>
  );
}
