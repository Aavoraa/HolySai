import { useState } from 'react';
import {
  Badge, Banner, Button, Card, DataTable, Empty, ErrorState, FilterSelect, Flow, Grid, Kpi, Modal, Page, PageHead, Pagination, Person, SearchInput,
  SelectField, Status, TextArea, TextField, Toolbar,
} from '@/components/ui';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { cx, fmt } from '@/lib/format';
import { CRITICAL_ROW, FormError, FormGrid, req, useCampusOptions, useForm, useStaffOptions } from './shared';

interface Request {
  id: string; code: string; description: string; priority: string; status: string; raisedOn: string; completedAt: string | null; cost: number | null;
  campusName: string; raisedBy: string | null; raisedById: string | null; assignedTo: string | null; assignedToId: string | null;
  assetId: string | null; assetCode: string | null; assetName: string | null; facilityName: string | null; ageDays: number;
}
interface Summary { open: number; highPriority: number; awaitingDecision: number; closedThisMonth: number; medianDaysToClose: number | null; costThisMonth: number }

const STATUSES = ['Submitted', 'Under Review', 'Approved', 'In Progress', 'Completed', 'Rejected'];
const NEXT: Record<string, string[]> = {
  Submitted: ['Under Review', 'Approved', 'Rejected'], 'Under Review': ['Approved', 'Rejected'],
  Approved: ['In Progress', 'Rejected'], 'In Progress': ['Completed'], Completed: [], Rejected: [],
};
const priTone = (p: string) => (p === 'High' || p === 'Urgent' ? 'critical' : p === 'Medium' ? 'warning' : 'neutral');
const isOpen = (status: string) => status !== 'Completed' && status !== 'Rejected';
/** Open High / Urgent requests are flagged in the list. */
const isUrgent = (r: Request) => isOpen(r.status) && (r.priority === 'High' || r.priority === 'Urgent');

export default function MaintenancePage() {
  const list = useListParams({ sort: 'date', dir: 'desc' }, ['status', 'priority', 'mine']);
  const { campusParam } = useSchool();
  const { can, user } = useAuth();
  const manage = can('operations.manage');
  const q = usePagedQuery<Request>('/maintenance', { ...list.query, ...campusParam });
  const sum = useApiQuery<Summary>('/maintenance/summary', campusParam);
  const [raise, setRaise] = useState(false);
  const [update, setUpdate] = useState<Request | null>(null);
  const s = sum.data;
  const canRaise = !!user?.employeeId || manage;
  const emptyLog = !q.isLoading && !q.error && !!q.data && !q.data.rows.length && !list.hasFilters;
  return (
    <Page>
      <PageHead title="Maintenance" sub="Requests raised by staff, prioritised, approved and closed."
        actions={<Button variant="primary" icon="plus" disabled={!canRaise} onClick={() => setRaise(true)}>Raise a request</Button>} />
      {!!s?.highPriority && (
        <div className="mb-4">
          <Banner tone="critical" icon="alertCircle">
            <div className="row between wrap g-2">
              <span><strong>{s.highPriority} high-priority request{s.highPriority === 1 ? ' is' : 's are'} still open.</strong> They are flagged in the list below.</span>
              {list.filters.priority !== 'High' && <Button size="sm" onClick={() => list.setFilter('priority', 'High')}>Show high priority</Button>}
            </div>
          </Banner>
        </div>
      )}
      <Grid cols="g-4col" className="mb-4">
        <Kpi label="Open requests" icon="wrench" value={fmt.n(s?.open)} tone="amber" loading={sum.isLoading} onClick={() => list.setFilter('status', 'open')}
          foot={s ? `${s.awaitingDecision} awaiting a decision` : undefined} />
        <Kpi label="High priority" icon="alertCircle" value={fmt.n(s?.highPriority)} tone="critical" loading={sum.isLoading} onClick={() => list.setFilter('priority', 'High')} />
        <Kpi label="Closed this month" icon="checkSquare" value={fmt.n(s?.closedThisMonth)} tone="teal" loading={sum.isLoading}
          foot={s ? `${fmt.money(s.costThisMonth)} spent` : undefined} onClick={() => list.setFilter('status', 'Completed')} />
        <Kpi label="Median time to close" icon="clock" value={s?.medianDaysToClose ?? '—'} unit="days" loading={sum.isLoading} foot="Last 90 days" />
      </Grid>
      <Card className="mb-4">
        <Flow steps={['Submitted', 'Under Review', 'Approved', 'In Progress', 'Completed'].map((st) => ({ label: st, state: list.filters.status === st ? 'active' : undefined }))} />
      </Card>
      <Card flush>
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search request or reference" />
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)}
            options={[{ value: 'open', label: 'All open' }, ...STATUSES.map((x) => ({ value: x, label: x }))]} />
          <FilterSelect label="Priority" value={list.filters.priority} onChange={(v) => list.setFilter('priority', v)} options={['Urgent', 'High', 'Medium', 'Low']} />
          {user?.employeeId && <FilterSelect label="Raised by" allLabel="Anyone" value={list.filters.mine} onChange={(v) => list.setFilter('mine', v)} options={[{ value: 'true', label: 'Me' }]} />}
          {list.hasFilters && <Button variant="quiet" size="sm" icon="x" onClick={list.clear}>Clear</Button>}
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : emptyLog ? (
          <Empty icon="wrench" title="No maintenance requests yet"
            sub="Broken fittings, faulty equipment and repairs raised by staff appear here, from submission to closure."
            action={canRaise ? <Button variant="primary" icon="plus" onClick={() => setRaise(true)}>Raise a request</Button> : undefined} />
        ) : (
          <DataTable<Request>
            rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            emptyText="No maintenance requests match the current filters."
            rowClassName={(r) => (isUrgent(r) ? CRITICAL_ROW : undefined)}
            columns={[
              { key: 'code', label: 'Ref', render: (r) => <span className="t-num t-bold">{r.code}</span> },
              { key: 'item', label: 'Request', render: (r) => <><span className="t-bold">{r.description}</span>
                <div className="t-micro t-muted">{[r.assetCode && `${r.assetCode} ${r.assetName}`, r.facilityName, r.campusName].filter(Boolean).join(' · ')}</div></> },
              { key: 'raised', label: 'Raised by', render: (r) => r.raisedBy ? <Person name={r.raisedBy} /> : <span className="t-faint">—</span> },
              { key: 'date', label: 'Date', render: (r) => <><span className="t-num">{fmt.date(r.raisedOn)}</span>
                {isOpen(r.status) && <div className={cx('t-micro t-num', isUrgent(r) ? 't-critical' : 't-muted')}>{r.ageDays} day{r.ageDays === 1 ? '' : 's'} open</div>}</> },
              { key: 'priority', label: 'Priority', render: (r) => <Badge tone={priTone(r.priority)} dot={isUrgent(r)}>{r.priority}</Badge> },
              { key: 'status', label: 'Status', render: (r) => <><Status value={r.status} />
                {r.assignedTo && <div className="t-micro t-muted mt-1">{r.assignedTo}</div>}
                {r.status === 'Completed' && <div className="t-micro t-muted mt-1">{fmt.date(r.completedAt)} · {fmt.money(r.cost)}</div>}</> },
              { key: 'a', label: '', sortable: false, className: 'num', render: (r) => manage && NEXT[r.status].length
                ? <Button size="sm" icon="edit" onClick={() => setUpdate(r)}>Update</Button> : null },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      {raise && <RaiseModal onClose={() => setRaise(false)} />}
      {update && <UpdateModal request={update} onClose={() => setUpdate(null)} />}
    </Page>
  );
}

function RaiseModal({ onClose }: { onClose: () => void }) {
  const campuses = useCampusOptions();
  const f = useForm({ campusId: campuses.defaultId, description: '', priority: 'Medium', assetId: '', facilityId: '' });
  const v = f.values;
  const assets = useApiQuery<{ id: string; code: string; name: string }[]>(v.campusId ? '/assets' : null, { campusId: v.campusId, pageSize: 200 });
  const facilities = useApiQuery<{ id: string; name: string }[]>('/facilities', { campusId: v.campusId || undefined });
  const save = useApiMutation<Record<string, unknown>>('post', '/maintenance', { invalidate: ['/maintenance', '/facilities'], success: (r: any) => `Request ${r.data.code} raised` });
  const submit = async () => {
    if (!f.validate({ description: req(v.description, 'Description') ?? (v.description.trim().length < 5 ? 'Describe the problem in a few words' : null), campusId: req(v.campusId, 'Campus') })) return;
    try { await save.mutateAsync({ ...v, assetId: v.assetId || null, facilityId: v.facilityId || null }); onClose(); } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title="Raise a maintenance request" sub="Operations reviews every request; high priority requests alert the Principal." busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Submit request</Button></>}>
      <TextArea label="What needs fixing?" required rows={3} maxLength={300} value={v.description} onChange={(x) => f.set('description', x)} error={f.errors.description} />
      <div className="mt-3">
        <FormGrid>
          <SelectField label="Campus" required value={v.campusId} onChange={(x) => f.set('campusId', x)} options={campuses.options} error={f.errors.campusId} />
          <SelectField label="Priority" value={v.priority} onChange={(x) => f.set('priority', x)} options={['Low', 'Medium', 'High', 'Urgent']} />
          <SelectField label="Space" value={v.facilityId} onChange={(x) => f.set('facilityId', x)} placeholder="Not specific to a room"
            options={(facilities.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />
          <SelectField label="Asset" value={v.assetId} onChange={(x) => f.set('assetId', x)} placeholder="No specific asset"
            options={(assets.data ?? []).map((x) => ({ value: x.id, label: `${x.code} — ${x.name}` }))} />
        </FormGrid>
      </div>
      <FormError error={save.error} />
    </Modal>
  );
}

function UpdateModal({ request, onClose }: { request: Request; onClose: () => void }) {
  const staff = useStaffOptions((s) => s.employeeType === 'non_teaching');
  const next = NEXT[request.status];
  const f = useForm({ status: next[0], assignedTo: request.assignedToId ?? '', cost: '', note: '' });
  const v = f.values;
  const save = useApiMutation<Record<string, unknown>>('patch', `/maintenance/${request.id}/status`, { invalidate: ['/maintenance', '/assets'] });
  const submit = async () => {
    if (!f.validate({
      cost: v.status === 'Completed' ? (req(v.cost, 'Cost') ?? (!(Number(v.cost) >= 0) ? 'Enter a valid amount' : null)) : null,
      note: v.status === 'Rejected' ? req(v.note, 'A reason') : null,
    })) return;
    try {
      await save.mutateAsync({ status: v.status, assignedTo: v.assignedTo || null, cost: v.cost === '' ? null : Number(v.cost), note: v.note || null });
      onClose();
    } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title={`Update ${request.code}`} sub={request.description} busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant={v.status === 'Rejected' ? 'danger' : 'primary'} loading={save.isPending} onClick={submit}>
        {v.status === 'Rejected' ? 'Reject request' : `Move to ${v.status}`}</Button></>}>
      <p className="t-sm t-muted mb-3">Currently <Status value={request.status} /> · raised {fmt.date(request.raisedOn)} by {request.raisedBy ?? '—'}</p>
      <FormGrid>
        <SelectField label="New status" required value={v.status} onChange={(x) => f.set('status', x)} options={next} />
        <SelectField label="Assigned to" value={v.assignedTo} onChange={(x) => f.set('assignedTo', x)} options={staff} placeholder="Unassigned" />
        {v.status === 'Completed' && <TextField label="Cost (₹)" type="number" min={0} required value={v.cost} onChange={(x) => f.set('cost', x)} error={f.errors.cost} hint="Enter 0 if there was no cost" />}
      </FormGrid>
      <div className="mt-3"><TextArea label={v.status === 'Rejected' ? 'Reason' : 'Note'} required={v.status === 'Rejected'} rows={2} maxLength={300}
        value={v.note} onChange={(x) => f.set('note', x)} error={f.errors.note} /></div>
      <FormError error={save.error} />
    </Modal>
  );
}
