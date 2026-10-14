import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import { useSchool } from '@/layouts/SchoolContext';
import {
  Badge, Button, Card, Checkbox, DataTable, ErrorState, FilterSelect, Grid, InlineError, Kpi, Meter, Modal, Page, PageHead,
  Pagination, SearchInput, SelectField, Status, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import { fmt, todayKey } from '@/lib/format';
import { EmpLink, ListCount, fieldErrors, useEmployeeModal } from './shared';
import type { CpdRow, CpdSummary } from './types';

export default function CpdPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const list = useListParams({ sort: 'name' }, ['employeeType', 'band']);
  const summary = useApiQuery<CpdSummary>('/workforce/cpd/summary', campusParam);
  const q = usePagedQuery<CpdRow>('/workforce/cpd', { ...list.query, ...campusParam });
  const [openEmployee, employeeModal] = useEmployeeModal();
  const [scheduling, setScheduling] = useState(false);
  const [recordsFor, setRecordsFor] = useState<CpdRow | null>(null);
  const k = summary.data?.kpis;
  const nextMandatory = summary.data?.upcoming.find((u) => /child protection/i.test(u.programme));

  return (
    <Page>
      <PageHead title="Continuing Professional Development" sub="Training completed, hours logged and what is still required this year."
        actions={can('hr.manage') && <Button variant="primary" icon="plus" onClick={() => setScheduling(true)}>Schedule training</Button>} />
      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : (
        <Grid cols="g-4col">
          <Kpi loading={summary.isLoading} icon="clock" label="Hours logged" value={fmt.n(k?.hoursLogged)} tone="teal" />
          <Kpi loading={summary.isLoading} icon="graduation" label="Average per teacher" value={k?.avgPerTeacher ?? '—'} unit="hours" foot={k && `Target ${k.targetTeaching} hours`} />
          <Kpi loading={summary.isLoading} icon="alertCircle" label="Below target" value={fmt.n(k?.belowTarget)} unit="staff" tone="amber"
            foot={k && `Non-teaching target ${k.targetNonTeaching} h`} onClick={() => list.setFilter('band', 'below')} />
          <Kpi loading={summary.isLoading} icon="shieldCheck" label="Mandatory training complete" value={k?.mandatoryPct != null ? `${k.mandatoryPct}%` : '—'} tone="teal"
            foot={k ? (k.mandatoryOutstanding ? `${k.mandatoryOutstanding} outstanding${nextMandatory ? ' · refresher scheduled' : ''}` : 'Everyone is up to date') : undefined} />
        </Grid>
      )}
      {summary.data && summary.data.upcoming.length > 0 && (
        <div className="row g-2 wrap mt-4">
          <span className="t-xs t-muted">Planned and in progress:</span>
          {summary.data.upcoming.map((u) => <Badge key={u.programme + u.status} tone={u.status === 'Planned' ? 'info' : 'warning'}>{u.programme} · {u.staff} staff</Badge>)}
        </div>
      )}

      <Card flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search name or ID" />
          <FilterSelect label="Category" value={list.filters.employeeType} onChange={(v) => list.setFilter('employeeType', v)}
            options={[{ value: 'teaching', label: 'Teaching' }, { value: 'non_teaching', label: 'Non-Teaching' }]} />
          <FilterSelect label="Against target" value={list.filters.band} onChange={(v) => list.setFilter('band', v)}
            options={[{ value: 'met', label: 'Target met' }, { value: 'near', label: 'Close (60%+)' }, { value: 'below', label: 'Below 60%' }]} />
          {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
          <div className="spacer" />
          <ListCount total={q.data?.meta.total} noun="employees" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            onRowClick={(r) => setRecordsFor(r)} emptyText={list.hasFilters ? 'No employees match these filters.' : 'No employees on this campus yet.'}
            columns={[
              { key: 'name', label: 'Employee', render: (r) => <EmpLink name={r.fullName} meta={r.designation} onOpen={() => openEmployee(r.id)} /> },
              { key: 'department', label: 'Department' },
              { key: 'hours', label: 'Hours', className: 'num' },
              { key: 'progress', label: 'Against target', render: (r) => (
                <Meter label="" value={Math.min(100, (r.hours / r.target) * 100)} right={`${r.hours} / ${r.target} h`}
                  tone={r.hours >= r.target ? 'teal' : r.hours >= r.target * 0.6 ? 'amber' : 'critical'} />
              ) },
              { key: 'mandatory', label: 'Mandatory', render: (r) => <Badge tone={r.mandatoryComplete ? 'success' : 'critical'}>{r.mandatoryComplete ? 'Complete' : 'Outstanding'}</Badge> },
              { key: 'planned', label: 'Planned', sortable: false, className: 'num', render: (r) => r.planned || '—' },
            ]} />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      {scheduling && <ScheduleModal onClose={() => setScheduling(false)} />}
      {recordsFor && <RecordsModal row={recordsFor} onClose={() => setRecordsFor(null)} />}
      {employeeModal}
    </Page>
  );
}

function ScheduleModal({ onClose }: { onClose: () => void }) {
  const { lookups } = useLookups();
  const [f, setF] = useState({ programme: '', provider: '', hours: '', status: 'Planned', completedOn: '' });
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [touched, setTouched] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const staff = (lookups?.staff ?? []).filter((s) => !filter || s.employeeType === filter);
  const errors: Record<string, string> = {};
  if (f.programme.trim().length < 3) errors.programme = 'Name the programme';
  if (!(Number(f.hours) >= 1 && Number(f.hours) <= 200 && Number.isInteger(Number(f.hours)))) errors.hours = 'Whole hours, 1–200';
  if (f.status === 'Completed' && !f.completedOn) errors.completedOn = 'Completion date is required';
  if (f.completedOn && f.completedOn > todayKey()) errors.completedOn = 'Cannot be in the future';
  if (!ids.size) errors.employeeIds = 'Choose at least one employee';
  const save = useApiMutation<void>('post', '/workforce/cpd', {
    invalidate: ['/workforce'], onSuccess: onClose,
    body: () => ({ employeeIds: [...ids], programme: f.programme.trim(), provider: f.provider.trim() || null, hours: Number(f.hours), status: f.status, completedOn: f.status === 'Completed' ? f.completedOn : null }),
  });
  const server = fieldErrors(save.error);
  const err = (k: string) => (touched ? errors[k] : undefined) ?? server[k];
  const toggle = (id: string) => setIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Modal open onClose={onClose} busy={save.isPending} size="wide" title="Schedule training" sub="Plan a programme or log training already completed"
      foot={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={() => { setTouched(true); if (!Object.keys(errors).length) save.mutate(); }}>
          Save for {ids.size} employee{ids.size === 1 ? '' : 's'}
        </Button>
      </>}>
      {save.error && !Object.keys(server).length && <div className="mb-3"><InlineError error={save.error} /></div>}
      <div className="grid g-2col g-3">
        <TextField label="Programme" required value={f.programme} onChange={(v) => set('programme', v)} error={err('programme')} maxLength={160} placeholder="Child protection refresher" />
        <TextField label="Provider" value={f.provider} onChange={(v) => set('provider', v)} maxLength={120} />
        <TextField label="Hours" type="number" required min={1} max={200} value={f.hours} onChange={(v) => set('hours', v)} error={err('hours')} />
        <SelectField label="Status" value={f.status} onChange={(v) => set('status', v)} options={['Planned', 'In Progress', 'Completed']} />
        {f.status === 'Completed' && <TextField label="Completed on" type="date" required max={todayKey()} value={f.completedOn} onChange={(v) => set('completedOn', v)} error={err('completedOn')} />}
      </div>
      <div className="row between wrap g-2 mt-4 mb-2">
        <span className="label">Employees <span className="req">*</span> <span className="t-muted">({ids.size} selected)</span></span>
        <div className="row g-2 wrap">
          <FilterSelect label="Category" value={filter} onChange={setFilter} options={[{ value: 'teaching', label: 'Teaching' }, { value: 'non_teaching', label: 'Non-Teaching' }]} />
          <Button size="sm" onClick={() => setIds(new Set(staff.map((s) => s.id)))}>Select all</Button>
          <Button size="sm" variant="quiet" onClick={() => setIds(new Set())}>None</Button>
        </div>
      </div>
      {err('employeeIds') && <div className="hint hint--error mb-2" role="alert">{err('employeeIds')}</div>}
      <div className="grid g-2col g-2 fw-checklist">
        {staff.map((s) => <Checkbox key={s.id} checked={ids.has(s.id)} onChange={() => toggle(s.id)} label={<span className="t-sm">{s.fullName} <span className="t-micro t-muted">{s.designation}</span></span>} />)}
      </div>
    </Modal>
  );
}

function RecordsModal({ row, onClose }: { row: CpdRow; onClose: () => void }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const q = useApiQuery<{ id: string; programme: string; provider: string | null; hours: number; completedOn: string | null; status: string }[]>(
    '/workforce/cpd/records', { employeeId: row.id });
  const complete = useApiMutation<string>('patch', (id) => `/workforce/cpd/${id}`, {
    invalidate: ['/workforce'], body: () => ({ status: 'Completed', completedOn: todayKey() }), success: 'Marked as completed',
  });
  return (
    <Modal open onClose={onClose} size="wide" title={`CPD — ${row.fullName}`} sub={`${row.hours} of ${row.target} hours this year`}
      foot={<Button onClick={onClose}>Close</Button>}>
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <DataTable compact rows={q.data} loading={q.isLoading} rowKey={(r) => r.id} emptyText="No training recorded yet. Use Schedule training to plan or log a programme."
          columns={[
            { key: 'programme', label: 'Programme', render: (r) => <><span className="t-bold">{r.programme}</span><div className="t-micro t-muted">{r.provider}</div></> },
            { key: 'hours', label: 'Hours', className: 'num' },
            { key: 'completedOn', label: 'Completed', render: (r) => fmt.date(r.completedOn) },
            { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
            { key: 'a', label: '', className: 'num', render: (r) => can('hr.manage') && r.status !== 'Completed' ? (
              <Button size="sm" variant="teal" loading={complete.isPending && complete.variables === r.id} onClick={async () => {
                if (await confirm({ title: 'Mark as completed today?', body: `${r.hours} hours are added to ${row.fullName}'s CPD total.`, confirmLabel: 'Mark completed' })) complete.mutate(r.id);
              }}>Mark completed</Button>
            ) : null },
          ]} />
      )}
    </Modal>
  );
}
