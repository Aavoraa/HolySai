import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge, Banner, Button, Card, DataTable, Dl, Empty, ErrorState, FilterSelect, Grid, Kpi, Modal, Page, PageHead, Pagination, Person,
  SearchInput, SelectField, Skeleton, Status, Tabs, TextArea, TextField, Timeline, Toolbar, useConfirm,
} from '@/components/ui';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { cx, fmt } from '@/lib/format';
import { CRITICAL_ROW, FormError, FormGrid, req, todayIso, useForm } from '../operations/shared';
import {
  CATEGORIES, FINAL, NEEDS_NOTE, PRIORITIES, PriorityBadge, STATUSES, actionLabel, hoursLabel, useDepartments,
  type JobCard, type JobCardDetail, type JobCardSummary, type Member,
} from './shared';

type Direction = 'in' | 'out' | 'mine' | 'all';
const INVALIDATE = ['/job-cards', '/departments'];

export default function JobCardsPage() {
  const list = useListParams({ sort: '', dir: 'asc' }, ['direction', 'status', 'priority', 'category', 'departmentId', 'overdue']);
  const [sp, setSp] = useSearchParams();
  const { campusParam } = useSchool();
  const { can } = useAuth();
  const manage = can('jobcards.manage');
  const direction = (list.filters.direction || (manage ? 'all' : 'in')) as Direction;
  const params = { ...list.query, direction, sort: list.query.sort || undefined, ...campusParam };
  const q = usePagedQuery<JobCard>('/job-cards', params);
  const sum = useApiQuery<JobCardSummary>('/job-cards/summary', campusParam);
  const depts = useDepartments();
  const [raise, setRaise] = useState(false);
  const openId = sp.get('card');
  const openCard = (id: string | null) => setSp((prev) => {
    const next = new URLSearchParams(prev);
    if (id) next.set('card', id); else next.delete('card');
    return next;
  }, { replace: true });
  const s = sum.data;
  const hasDept = !!s?.myDepartmentIds.length;
  const canRaise = hasDept || manage;
  const deptOptions = (depts.data ?? []).map((d) => ({ value: d.id, label: d.name }));
  const tabs = [
    { id: 'in' as Direction, label: 'Inbox', count: s?.inbox },
    { id: 'out' as Direction, label: 'Raised by us', count: s?.raised },
    { id: 'mine' as Direction, label: 'Assigned to me', count: s?.assigned },
    ...(manage ? [{ id: 'all' as Direction, label: 'All departments', count: s?.active }] : []),
  ];
  const emptyAll = !q.isLoading && !q.error && !!q.data && !q.data.rows.length && !list.hasFilters;
  const emptyText = direction === 'in' ? 'No job cards have been sent to your department yet.'
    : direction === 'out' ? 'Your department has not raised any job cards yet.'
      : direction === 'mine' ? 'Nothing is assigned to you right now.' : 'No job cards have been raised yet.';

  return (
    <Page>
      <PageHead title="Job Cards" sub="Assign work across departments — raise a card, the receiving department assigns and completes it, you close it."
        actions={<Button variant="primary" icon="plus" disabled={!canRaise} onClick={() => setRaise(true)}>New job card</Button>} />
      {sum.data && !hasDept && !manage && (
        <div className="mb-4"><Banner tone="warning" icon="alertCircle">Your staff record is not linked to a department, so you can only see cards you raised or that are assigned to you. Ask the school administrator to check your department.</Banner></div>
      )}
      {!!s?.inboxUnassigned && direction !== 'in' && (
        <div className="mb-4">
          <Banner tone="warning" icon="clipboard">
            <div className="row between wrap g-2">
              <span><strong>{s.inboxUnassigned} card{s.inboxUnassigned === 1 ? '' : 's'} sent to your department {s.inboxUnassigned === 1 ? 'is' : 'are'} waiting to be assigned.</strong></span>
              <Button size="sm" onClick={() => { list.setFilter('direction', 'in'); }}>Open inbox</Button>
            </div>
          </Banner>
        </div>
      )}
      <Grid cols="g-4col" className="mb-4">
        <Kpi label="Open" icon="clipboard" tone="amber" value={fmt.n(s?.open)} loading={sum.isLoading}
          foot={s ? `${s.onHold} on hold` : undefined} onClick={() => list.setFilter('status', 'active')} />
        <Kpi label="In progress" icon="activity" tone="info" value={fmt.n(s?.inProgress)} loading={sum.isLoading} onClick={() => list.setFilter('status', 'In Progress')} />
        <Kpi label="Overdue" icon="alertCircle" tone="critical" value={fmt.n(s?.overdue)} loading={sum.isLoading}
          foot="Past due date, not completed" onClick={() => list.setFilter('overdue', 'true')} />
        <Kpi label="Completed this month" icon="checkSquare" tone="teal" value={fmt.n(s?.completedThisMonth)} loading={sum.isLoading}
          foot={s ? `Avg. turnaround ${hoursLabel(s.avgCompletionHours)}` : undefined} />
      </Grid>
      <div className="grid g-main g-4">
        <Card flush>
          <div style={{ padding: '12px 16px 0' }}>
            <Tabs items={tabs} active={direction} onChange={(id) => list.setFilter('direction', id)} />
          </div>
          <Toolbar>
            <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search title, code or location" />
            <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)}
              options={[{ value: 'active', label: 'All active' }, ...STATUSES]} />
            <FilterSelect label="Priority" value={list.filters.priority} onChange={(v) => list.setFilter('priority', v)} options={PRIORITIES} />
            <FilterSelect label="Category" value={list.filters.category} onChange={(v) => list.setFilter('category', v)} options={CATEGORIES} />
            <FilterSelect label="Department" value={list.filters.departmentId} onChange={(v) => list.setFilter('departmentId', v)} options={deptOptions} />
            <FilterSelect label="Due" allLabel="Any" value={list.filters.overdue} onChange={(v) => list.setFilter('overdue', v)} options={[{ value: 'true', label: 'Overdue' }]} />
            {list.hasFilters && <Button variant="quiet" size="sm" icon="x" onClick={list.clear}>Clear</Button>}
          </Toolbar>
          {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : emptyAll ? (
            <Empty icon="clipboard" title="No job cards here" sub={emptyText}
              action={canRaise && direction !== 'mine' ? <Button variant="primary" icon="plus" onClick={() => setRaise(true)}>New job card</Button> : undefined} />
          ) : (
            <DataTable<JobCard>
              rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} sort={list.sort.key ? list.sort : undefined} onSort={list.setSort}
              onRowClick={(r) => openCard(r.id)} rowClassName={(r) => (r.overdue ? CRITICAL_ROW : undefined)}
              emptyText="No job cards match the current filters."
              columns={[
                { key: 'code', label: 'Card', render: (r) => <>
                  <span className="t-num t-bold">{r.code}</span>
                  <div className="t-micro t-muted">{fmt.date(r.createdAt)}</div></> },
                { key: 'title', label: 'Work', render: (r) => <>
                  <button type="button" className="t-bold" style={{ textAlign: 'left', background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); openCard(r.id); }}>{r.title}</button>
                  <div className="t-micro t-muted">{[r.category, r.location, r.commentCount ? `${r.commentCount} comment${r.commentCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}</div></> },
                { key: 'from', label: 'From → To', render: (r) => <>
                  <span className="t-sm">{r.fromDepartment}</span> <span className="t-muted">→</span> <span className="t-sm t-bold">{r.toDepartment}</span>
                  {r.raisedBy && <div className="t-micro t-muted">by {r.raisedBy}</div>}</> },
                { key: 'assignee', label: 'Assigned to', render: (r) => r.assignedTo ? <Person name={r.assignedTo} meta={r.assignedToDesignation ?? undefined} />
                  : <span className="t-faint">Unassigned</span> },
                { key: 'priority', label: 'Priority', render: (r) => <PriorityBadge value={r.priority} /> },
                { key: 'due', label: 'Due', render: (r) => r.dueOn ? <>
                  <span className="t-num">{fmt.date(r.dueOn)}</span>
                  {r.overdue ? <div className="mt-1"><Badge tone="critical" dot>{Math.abs(r.dueInDays ?? 0)} day{Math.abs(r.dueInDays ?? 0) === 1 ? '' : 's'} overdue</Badge></div>
                    : !FINAL.includes(r.status) && r.dueInDays != null && r.dueInDays <= 2
                      ? <div className="t-micro t-warning">{r.dueInDays === 0 ? 'Due today' : `in ${r.dueInDays} day${r.dueInDays === 1 ? '' : 's'}`}</div> : null}</>
                  : <span className="t-faint">—</span> },
                { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
              ]}
            />
          )}
          <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
        </Card>
        <DepartmentBoard summary={s} loading={sum.isLoading} active={list.filters.departmentId} onPick={(id) => list.setFilter('departmentId', id === list.filters.departmentId ? '' : id)} />
      </div>
      {raise && <RaiseModal myDepartmentIds={s?.myDepartmentIds ?? []} manage={manage} onClose={() => setRaise(false)} onCreated={(id) => { setRaise(false); openCard(id); }} />}
      {openId && <CardModal id={openId} onClose={() => openCard(null)} />}
    </Page>
  );
}

function DepartmentBoard({ summary, loading, active, onPick }: { summary?: JobCardSummary; loading: boolean; active: string; onPick: (id: string) => void }) {
  const rows = summary?.perDepartment ?? [];
  const max = Math.max(1, ...rows.map((r) => r.openIn));
  return (
    <Card title="By department" sub="Open cards received and raised" icon="building">
      {loading ? <div className="col g-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={28} />)}</div> : !rows.length ? (
        <p className="t-sm t-muted">No department activity yet.</p>
      ) : (
        <div className="col g-2">
          {rows.map((d) => (
            <button key={d.id} type="button" onClick={() => onPick(d.id)} aria-pressed={active === d.id}
              className={cx('card card--link', active === d.id && 'card--tint')} style={{ padding: '8px 10px', textAlign: 'left' }}>
              <div className="row between g-2">
                <span className="t-sm t-bold t-clip">{d.name}</span>
                <span className="t-micro t-muted none">{d.openIn} in · {d.openOut} out</span>
              </div>
              <div className="bar mt-1"><div className={cx('bar__fill', d.overdueIn ? 'bar__fill--critical' : 'bar__fill--teal')} style={{ width: `${(d.openIn / max) * 100}%` }} /></div>
              <div className="t-micro t-muted mt-1">
                {d.overdueIn ? <span className="t-critical">{d.overdueIn} overdue · </span> : null}
                {d.completed30d} completed in 30 days{d.avgCompletionHours != null ? ` · avg ${hoursLabel(d.avgCompletionHours)}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function RaiseModal({ myDepartmentIds, manage, onClose, onCreated }: { myDepartmentIds: string[]; manage: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const depts = useDepartments();
  const all = depts.data ?? [];
  const fromOptions = all.filter((d) => manage || myDepartmentIds.includes(d.id)).map((d) => ({ value: d.id, label: d.name }));
  const f = useForm({
    fromDepartmentId: myDepartmentIds[0] ?? '', toDepartmentId: '', title: '', description: '', category: 'Other', priority: 'Medium', dueOn: '', location: '',
  });
  const v = f.values;
  const toOptions = all.filter((d) => d.id !== v.fromDepartmentId).map((d) => ({ value: d.id, label: d.headName ? `${d.name} — ${d.headName}` : d.name }));
  const save = useApiMutation<Record<string, unknown>, { id: string; code: string }>('post', '/job-cards', { invalidate: INVALIDATE, success: (r) => `Job card ${r.data.code} raised` });
  const submit = async () => {
    if (!f.validate({
      fromDepartmentId: req(v.fromDepartmentId, 'Raising department'),
      toDepartmentId: req(v.toDepartmentId, 'Receiving department') ?? (v.toDepartmentId === v.fromDepartmentId ? 'Choose a different department' : null),
      title: req(v.title, 'Title') ?? (v.title.trim().length < 3 ? 'Use at least 3 characters' : null),
      dueOn: v.dueOn && v.dueOn < todayIso() ? 'The due date cannot be in the past' : null,
    })) return;
    try {
      const r = await save.mutateAsync({
        ...v, title: v.title.trim(), description: v.description.trim() || null, location: v.location.trim() || null, dueOn: v.dueOn || null,
      });
      onCreated(r.data.id);
    } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title="New job card" sub="The receiving department's head is notified and assigns the work." busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Raise job card</Button></>}>
      <FormGrid>
        <SelectField label="From department" required value={v.fromDepartmentId} onChange={(x) => f.set('fromDepartmentId', x)} options={fromOptions}
          placeholder={fromOptions.length ? undefined : 'No department'} error={f.errors.fromDepartmentId} disabled={!manage && fromOptions.length <= 1} />
        <SelectField label="To department" required value={v.toDepartmentId} onChange={(x) => f.set('toDepartmentId', x)} options={toOptions}
          placeholder="Choose a department" error={f.errors.toDepartmentId} />
      </FormGrid>
      <div className="mt-3">
        <TextField label="Title" required maxLength={160} value={v.title} onChange={(x) => f.set('title', x)} error={f.errors.title} placeholder="What needs doing?" />
      </div>
      <div className="mt-3">
        <TextArea label="Details" rows={3} maxLength={2000} value={v.description} onChange={(x) => f.set('description', x)} error={f.errors.description} />
      </div>
      <div className="mt-3">
        <FormGrid>
          <SelectField label="Category" value={v.category} onChange={(x) => f.set('category', x)} options={CATEGORIES} />
          <SelectField label="Priority" value={v.priority} onChange={(x) => f.set('priority', x)} options={PRIORITIES} />
          <TextField label="Due date" type="date" min={todayIso()} value={v.dueOn} onChange={(x) => f.set('dueOn', x)} error={f.errors.dueOn} />
          <TextField label="Location" maxLength={160} value={v.location} onChange={(x) => f.set('location', x)} placeholder="Room, block or route" error={f.errors.location} />
        </FormGrid>
      </div>
      <FormError error={save.error} />
    </Modal>
  );
}

function timelineTitle(u: JobCardDetail['updates'][number]) {
  const who = u.userName ?? 'System';
  switch (u.kind) {
    case 'created': return `${who} raised the card`;
    case 'comment': return `${who} commented`;
    case 'assignment': return `${who} assigned the card`;
    case 'edit': return `${who} edited the card`;
    case 'status': return `${who} moved it to ${u.toStatus}`;
    default: return who;
  }
}
const timelineTone = (u: JobCardDetail['updates'][number]) =>
  u.kind === 'comment' ? 'muted' : u.toStatus === 'Completed' || u.toStatus === 'Closed' ? 'teal'
    : u.toStatus === 'Cancelled' || u.toStatus === 'Reopened' ? 'critical' : u.toStatus === 'On Hold' ? 'amber' : 'neutral';

function CardModal({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useApiQuery<JobCardDetail>(`/job-cards/${id}`);
  const c = q.data;
  const confirm = useConfirm();
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [hours, setHours] = useState('');
  const [noteErr, setNoteErr] = useState('');
  const [comment, setComment] = useState('');
  const [assignee, setAssignee] = useState('');
  const members = useApiQuery<Member[]>(c?.permissions.canAssign ? `/departments/${c.toDepartmentId}/members` : null);
  const status = useApiMutation<{ status: string; note: string | null; actualHours: number | null }>('patch', `/job-cards/${id}/status`, { invalidate: INVALIDATE });
  const assign = useApiMutation<{ employeeId: string; note?: string | null }>('post', `/job-cards/${id}/assign`, { invalidate: INVALIDATE, success: 'Job card assigned' });
  const post = useApiMutation<{ body: string }>('post', `/job-cards/${id}/comments`, { invalidate: [`/job-cards/${id}`], success: 'Comment added' });
  const memberOptions = useMemo(() => (members.data ?? []).filter((m) => m.id !== c?.assignedToId)
    .map((m) => ({ value: m.id, label: `${m.fullName} — ${m.designation}${m.isHead ? ' (head)' : ''}` })), [members.data, c?.assignedToId]);

  const begin = (to: string) => { setPending(to); setNote(''); setHours(c?.actualHours != null ? String(c.actualHours) : ''); setNoteErr(''); };
  const submitStatus = async () => {
    if (!pending || !c) return;
    if (NEEDS_NOTE.includes(pending) && !note.trim()) { setNoteErr('A reason is required'); return; }
    if (hours && !(Number(hours) >= 0)) { setNoteErr('Enter valid hours'); return; }
    if (pending === 'Cancelled' && !(await confirm({ title: `Cancel ${c.code}?`, body: 'The receiving department will stop work on it. This cannot be undone.', confirmLabel: 'Cancel card', danger: true }))) return;
    try {
      await status.mutateAsync({ status: pending, note: note.trim() || null, actualHours: pending === 'Completed' && hours ? Number(hours) : null });
      setPending(null);
    } catch { /* toast shown */ }
  };
  const submitComment = async () => {
    if (!comment.trim()) return;
    try { await post.mutateAsync({ body: comment.trim() }); setComment(''); } catch { /* toast shown */ }
  };

  return (
    <Modal open onClose={onClose} size="wide" busy={status.isPending || assign.isPending}
      title={c ? <span><span className="t-num t-muted">{c.code}</span> · {c.title}</span> : 'Job card'}
      sub={c ? <span className="row g-2 wrap"><Status value={c.status} /><PriorityBadge value={c.priority} />{c.overdue && <Badge tone="critical" dot>Overdue</Badge>}<span className="t-muted">{c.category}</span></span> : undefined}
      foot={<Button onClick={onClose}>Close</Button>}>
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !c ? (
        <div className="col g-2"><Skeleton height={20} /><Skeleton height={80} /><Skeleton height={120} /></div>
      ) : (
        <div className="grid g-2col g-4">
          <div className="col g-3">
            {c.description && <p className="t-sm" style={{ whiteSpace: 'pre-wrap' }}>{c.description}</p>}
            <Dl items={[
              ['From', <>{c.fromDepartment}{c.raisedBy ? <span className="t-muted"> · {c.raisedBy}</span> : null}</>],
              ['To', <>{c.toDepartment}{c.toHead ? <span className="t-muted"> · head {c.toHead}</span> : null}</>],
              ['Assigned to', c.assignedTo ? `${c.assignedTo}${c.assignedToDesignation ? ` — ${c.assignedToDesignation}` : ''}` : 'Unassigned'],
              ['Due', c.dueOn ? <span className={cx(c.overdue && 't-critical t-bold')}>{fmt.date(c.dueOn)}</span> : '—'],
              ['Location', c.location ?? '—'],
              ['Campus', c.campusName ?? '—'],
              ['Hours', `${c.estimatedHours ?? '—'} est. · ${c.actualHours ?? '—'} actual`],
              ['Raised', `${fmt.date(c.createdAt)} ${fmt.time(c.createdAt)}`],
              ...(c.completedAt ? [['Completed', `${fmt.date(c.completedAt)} ${fmt.time(c.completedAt)}`] as [string, string]] : []),
            ]} />
            {c.permissions.canAssign && (
              <Card tight title={c.assignedTo ? 'Reassign' : 'Assign'} sub={`Choose someone from ${c.toDepartment}`}>
                <div className="row g-2 wrap" style={{ alignItems: 'flex-end' }}>
                  <SelectField className="grow" label="Employee" value={assignee} onChange={setAssignee} options={memberOptions}
                    placeholder={members.isLoading ? 'Loading…' : memberOptions.length ? 'Choose a person' : 'No other members'} />
                  <Button variant="primary" icon="userCheck" disabled={!assignee} loading={assign.isPending}
                    onClick={async () => { try { await assign.mutateAsync({ employeeId: assignee }); setAssignee(''); } catch { /* toast */ } }}>Assign</Button>
                </div>
              </Card>
            )}
            {c.permissions.statuses.length > 0 && (
              <Card tight title="Update status">
                <div className="row g-2 wrap">
                  {c.permissions.statuses.map((to) => (
                    <Button key={to} size="sm" variant={pending === to ? 'primary' : to === 'Cancelled' || to === 'Reopened' ? 'danger' : undefined}
                      onClick={() => begin(to)}>{actionLabel(to, c.status)}</Button>
                  ))}
                </div>
                {pending && (
                  <div className="mt-3 col g-2">
                    <TextArea label={NEEDS_NOTE.includes(pending) ? 'Reason' : 'Note (optional)'} required={NEEDS_NOTE.includes(pending)} rows={2} maxLength={1000}
                      value={note} onChange={(x) => { setNote(x); setNoteErr(''); }} error={noteErr} />
                    {pending === 'Completed' && <TextField label="Actual hours" type="number" min={0} step={0.5} value={hours} onChange={setHours} />}
                    <div className="row g-2">
                      <Button variant={pending === 'Cancelled' ? 'danger' : 'primary'} loading={status.isPending} onClick={submitStatus}>
                        Move to {pending}</Button>
                      <Button variant="quiet" onClick={() => setPending(null)}>Back</Button>
                    </div>
                  </div>
                )}
              </Card>
            )}
          </div>
          <div className="col g-3">
            <div className="h3">Activity</div>
            {c.updates.length ? (
              <Timeline items={c.updates.map((u) => ({
                time: `${fmt.date(u.createdAt)} ${fmt.time(u.createdAt)}`,
                title: timelineTitle(u),
                body: u.body ?? undefined,
                tone: timelineTone(u),
              }))} />
            ) : <p className="t-sm t-muted">No activity yet.</p>}
            {c.permissions.canComment && (
              <div className="col g-2">
                <TextArea label="Add a comment" rows={2} maxLength={2000} value={comment} onChange={setComment} placeholder="Share an update or ask a question" />
                <div><Button icon="send" disabled={!comment.trim()} loading={post.isPending} onClick={submitComment}>Post comment</Button></div>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
