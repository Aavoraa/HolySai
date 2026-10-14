import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useSchool } from '@/layouts/SchoolContext';
import {
  Badge, Banner, Button, Card, Chart, charts, DataTable, Dl, Empty, ErrorState, FilterSelect, Flow, InlineError, Legend, Modal,
  Page, PageHead, Pagination, SearchInput, SelectField, Skeleton, Status, TextArea, TextField, Toolbar,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { COVER_OPTIONS, EmpLink, LeaveApplyModal, TYPE_LABEL, useEmployeeModal } from './shared';
import type { LeaveRow, LeaveSummary } from './types';

const TYPE_COLORS = ['var(--navy)', 'var(--amber)', 'var(--teal)', 'var(--viz-4)', 'var(--viz-5)'];
type Decision = { row: LeaveRow; kind: 'approve' | 'reject' | 'cover' };

export default function LeavePage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const list = useListParams({ sort: 'code', dir: 'desc' }, ['status', 'leaveTypeId', 'employeeType']);
  const summary = useApiQuery<LeaveSummary>('/workforce/leave-requests/summary', campusParam);
  const q = usePagedQuery<LeaveRow>('/workforce/leave-requests', { ...list.query, ...campusParam });
  const [openEmployee, employeeModal] = useEmployeeModal();
  const [applying, setApplying] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const review = useApiMutation<string>('post', (id) => `/workforce/leave-requests/${id}/review`, { invalidate: ['/workforce'], body: () => ({}) });
  const s = summary.data;
  const awaiting = (s?.counts.submitted ?? 0) + (s?.counts.underReview ?? 0);
  const mix = (s?.typeMix ?? []).map((t, i) => ({ ...t, color: TYPE_COLORS[i % TYPE_COLORS.length] }));

  return (
    <Page>
      <PageHead title="Leave" sub="Requests, approvals and the cover arrangement for each one."
        actions={can('hr.manage') && <Button variant="primary" icon="plus" onClick={() => setApplying(true)}>Apply for leave</Button>} />
      <Card>
        {s ? (
          <Flow steps={[
            { label: 'Draft', meta: 'Written by the employee', state: 'done' },
            { label: 'Submitted', meta: `${s.counts.submitted} waiting`, state: 'done' },
            { label: 'Under Review', meta: `${s.counts.underReview} with a line manager`, state: 'active' },
            { label: 'Approved', meta: `${s.counts.approvedThisWeek} this week` },
            { label: 'Rejected', meta: 'Returned with a reason' },
          ]} />
        ) : summary.error ? <InlineError error={summary.error} /> : <Skeleton height={56} />}
      </Card>

      <Card flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search employee or reference" />
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)}
            options={[{ value: 'open', label: 'Awaiting decision' }, 'Submitted', 'Under Review', 'Approved', 'Rejected', 'Cancelled']} />
          <FilterSelect label="Type" value={list.filters.leaveTypeId} onChange={(v) => list.setFilter('leaveTypeId', v)}
            options={(s?.types ?? []).map((t) => ({ value: t.id, label: t.name }))} />
          <FilterSelect label="Category" value={list.filters.employeeType} onChange={(v) => list.setFilter('employeeType', v)}
            options={[{ value: 'teaching', label: 'Teaching' }, { value: 'non_teaching', label: 'Non-Teaching' }]} />
          {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
          <div className="spacer" />
          {awaiting > 0 && list.filters.status !== 'open' && (
            <Button size="sm" icon="clock" onClick={() => list.setFilter('status', 'open')}>Awaiting decision <Badge tone="warning">{awaiting}</Badge></Button>
          )}
          {s && s.counts.noCover > 0 && <Badge tone="critical">{s.counts.noCover} open request{s.counts.noCover === 1 ? '' : 's'} without cover</Badge>}
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            emptyText={list.hasFilters ? 'No leave requests match these filters.' : 'No leave requests yet.'}
            columns={[
              { key: 'code', label: 'Reference', render: (r) => <><span className="t-bold t-num">{r.code}</span><div className="t-micro t-muted">{r.leaveType}</div></> },
              { key: 'name', label: 'Employee', render: (r) => <EmpLink name={r.employeeName} meta={TYPE_LABEL[r.employeeType]} onOpen={() => openEmployee(r.employeeId)} /> },
              { key: 'from', label: 'From', render: (r) => fmt.dateShort(r.fromDate) },
              { key: 'to', label: 'To', render: (r) => fmt.dateShort(r.toDate) },
              { key: 'days', label: 'Days', className: 'num' },
              { key: 'cover', label: 'Cover', sortable: false, render: (r) => {
                const body = r.coverArrangement ? <span>{r.coverArrangement}</span> : <Badge tone="critical">Not assigned</Badge>;
                return can('hr.manage') && !['Rejected', 'Cancelled'].includes(r.status)
                  ? <button type="button" className="fw-linkbtn" title="Change cover"
                      onClick={() => setDecision({ row: r, kind: 'cover' })}>{body}</button>
                  : body;
              } },
              { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
              { key: 'a', label: '', sortable: false, className: 'num', render: (r) => can('hr.approve') && ['Submitted', 'Under Review'].includes(r.status) ? (
                <div className="row g-2 end wrap">
                  {r.status === 'Submitted' && <Button size="sm" variant="quiet" loading={review.isPending && review.variables === r.id} onClick={() => review.mutate(r.id)}>Review</Button>}
                  <Button size="sm" variant="teal" icon="check" onClick={() => setDecision({ row: r, kind: 'approve' })}>Approve</Button>
                  <Button size="sm" icon="x" onClick={() => setDecision({ row: r, kind: 'reject' })}>Reject</Button>
                </div>
              ) : r.decidedBy ? <span className="t-micro t-muted">{r.decidedBy}</span> : null },
            ]} />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>

      <div className="grid g-2col g-4 mt-4">
        <Card icon="calendar" title="Leave taken by month" sub="Approved days, by start month">
          {s ? (s.byMonth.some((m) => m.value) ? (
            <Chart svg={charts.bar({ labels: s.byMonth.map((m) => m.label), series: [{ name: 'Days', values: s.byMonth.map((m) => m.value), color: 'var(--navy)' }], height: 210 })} />
          ) : <Empty title="No approved leave in the last six months" icon="calendar" />) : <Skeleton height={210} />}
        </Card>
        <Card icon="calendar" title="Leave type mix" sub="Approved days this academic year">
          {s ? (mix.length ? (
            <>
              <Chart svg={charts.donut({ size: 170, thickness: 24, center: fmt.n(s.totalDays), centerSub: 'days this year', data: mix })} />
              <div className="mt-4"><Legend items={mix.map((m) => ({ label: `${m.label.replace(' leave', '')} (${m.value})`, color: m.color }))} /></div>
            </>
          ) : <Empty title="No leave taken this year" icon="calendar" />) : <Skeleton height={210} />}
        </Card>
      </div>
      {applying && <LeaveApplyModal mode="hr" onClose={() => setApplying(false)} />}
      {decision && <DecisionModal {...decision} onClose={() => setDecision(null)} />}
      {employeeModal}
    </Page>
  );
}

function DecisionModal({ row, kind, onClose }: Decision & { onClose: () => void }) {
  const [note, setNote] = useState('');
  const [cover, setCover] = useState(COVER_OPTIONS.includes(row.coverArrangement ?? '') ? row.coverArrangement! : row.coverArrangement ? 'Named colleague' : 'Team rota');
  const [coverName, setCoverName] = useState(COVER_OPTIONS.includes(row.coverArrangement ?? '') ? '' : row.coverArrangement ?? '');
  const [touched, setTouched] = useState(false);
  const path = kind === 'cover' ? `/workforce/leave-requests/${row.id}` : `/workforce/leave-requests/${row.id}/${kind}`;
  const m = useApiMutation<void>(kind === 'cover' ? 'patch' : 'post', path, {
    invalidate: ['/workforce'], onSuccess: onClose,
    body: () => (kind === 'cover'
      ? { coverArrangement: cover === 'Named colleague' ? coverName.trim() : cover === 'Not required' ? null : cover }
      : { note: note.trim() || undefined }),
  });
  const noteError = kind === 'reject' && note.trim().length < 3 ? 'Give the employee a reason' : undefined;
  const coverError = kind === 'cover' && cover === 'Named colleague' && !coverName.trim() ? 'Name the colleague' : undefined;
  const invalid = !!(noteError || coverError);
  const title = kind === 'approve' ? `Approve ${row.code}?` : kind === 'reject' ? `Reject ${row.code}?` : `Cover for ${row.code}`;
  return (
    <Modal open onClose={onClose} busy={m.isPending} title={title} sub={`${row.employeeName} · ${row.leaveType}`}
      foot={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant={kind === 'reject' ? 'danger' : kind === 'approve' ? 'teal' : 'primary'} loading={m.isPending}
          onClick={() => { setTouched(true); if (!invalid) m.mutate(); }}>
          {kind === 'approve' ? 'Approve' : kind === 'reject' ? 'Reject request' : 'Save cover'}
        </Button>
      </>}>
      <Dl items={[
        ['Dates', `${fmt.date(row.fromDate)}${row.toDate !== row.fromDate ? ` to ${fmt.date(row.toDate)}` : ''}`],
        ['Days', row.days],
        ['Reason', row.reason ?? '—'],
        ['Balance', `${row.balance} day${row.balance === 1 ? '' : 's'} of ${row.leaveType.toLowerCase()} left`],
        ['Cover', row.coverArrangement ?? <Badge key="c" tone="critical">Not assigned</Badge>],
      ]} />
      {kind === 'approve' && (
        <>
          {row.balance < row.days && <div className="mt-3"><Banner tone="critical" icon="alert">Balance is lower than the days requested — approval will be refused.</Banner></div>}
          <p className="t-xs t-muted mt-3">Approving deducts {row.days} day(s) from the balance, marks attendance as On Leave for those dates, flags any roster lines for cover and notifies {row.employeeName.split(' ')[0]}.</p>
          <div className="mt-3"><TextArea label="Note to the employee (optional)" rows={2} value={note} onChange={setNote} maxLength={500} /></div>
        </>
      )}
      {kind === 'reject' && (
        <div className="mt-3"><TextArea label="Reason" required rows={3} value={note} onChange={setNote} error={touched ? noteError : undefined} maxLength={500} /></div>
      )}
      {kind === 'cover' && (
        <div className="grid g-2col g-3 mt-3">
          <SelectField label="Cover arrangement" value={cover} onChange={setCover} options={COVER_OPTIONS} />
          {cover === 'Named colleague' && <TextField label="Colleague" required value={coverName} onChange={setCoverName} error={touched ? coverError : undefined} maxLength={120} />}
        </div>
      )}
      {m.error && <div className="mt-3"><InlineError error={m.error} /></div>}
    </Modal>
  );
}
