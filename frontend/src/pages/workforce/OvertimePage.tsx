import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import { useSchool } from '@/layouts/SchoolContext';
import {
  Button, Card, Chart, charts, DataTable, Empty, ErrorState, FilterSelect, Grid, InlineError, Kpi, Modal, Page, PageHead,
  Pagination, SearchInput, SelectField, Skeleton, Status, TextArea, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import { fmt, todayKey } from '@/lib/format';
import { EmpLink, ListCount, addDays, fieldErrors, useEmployeeModal } from './shared';
import type { OvertimeRow, OvertimeSummary, WorkforceSummary } from './types';

export default function OvertimePage() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const { campusParam } = useSchool();
  const list = useListParams({ sort: 'date', dir: 'desc' }, ['status', 'month', 'department']);
  const summary = useApiQuery<OvertimeSummary>('/workforce/overtime/summary', campusParam);
  const depts = useApiQuery<WorkforceSummary['departments']>('/workforce/departments', campusParam);
  const q = usePagedQuery<OvertimeRow>('/workforce/overtime', { ...list.query, ...campusParam });
  const [openEmployee, employeeModal] = useEmployeeModal();
  const [adding, setAdding] = useState(false);
  const [rejecting, setRejecting] = useState<OvertimeRow | null>(null);
  const approve = useApiMutation<string>('post', (id) => `/workforce/overtime/${id}/approve`, { invalidate: ['/workforce'], body: () => ({}) });
  const k = summary.data?.kpis;
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(`${todayKey().slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i);
    return { value: d.toISOString().slice(0, 7), label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
  });

  return (
    <Page>
      <PageHead title="Overtime" sub="Claimed, approved and passed to payroll. Mostly transport and security cover."
        actions={can('hr.manage') && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Record overtime</Button>} />
      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : (
        <Grid cols="g-4col">
          <Kpi loading={summary.isLoading} icon="clock" label="Hours this month" value={fmt.n(k?.hours)} tone="amber" foot={k ? `${k.employees} employees` : undefined} />
          <Kpi loading={summary.isLoading} icon="checkSquare" label="Approved" value={fmt.n(k?.approvedHours)} unit="hours" tone="teal" onClick={() => list.setFilter('status', 'Approved')} />
          <Kpi loading={summary.isLoading} icon="alertCircle" label="Pending approval" value={fmt.n(k?.pendingCount)} unit={k ? `claims · ${k.pendingHours} h` : undefined} tone="critical"
            onClick={() => list.setFilter('status', 'open')} />
          <Kpi loading={summary.isLoading} icon="wallet" label="Cost this month" value={fmt.money(k?.cost ?? 0, { compact: true })} to={can('payroll.read') ? '/payroll' : undefined} />
        </Grid>
      )}

      <Card flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search employee or reason" />
          <FilterSelect label="Approval" value={list.filters.status} onChange={(v) => list.setFilter('status', v)}
            options={[{ value: 'open', label: 'Awaiting approval' }, 'Submitted', 'Under Review', 'Approved', 'Paid', 'Rejected']} />
          <FilterSelect label="Month" value={list.filters.month} onChange={(v) => list.setFilter('month', v)} options={months} />
          <FilterSelect label="Department" value={list.filters.department} onChange={(v) => list.setFilter('department', v)} options={depts.data ?? []} />
          {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
          <div className="spacer" />
          <ListCount total={q.data?.meta.total} noun="claims" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            emptyText={list.hasFilters ? 'No overtime matches these filters.' : 'No overtime recorded yet.'}
            columns={[
              { key: 'name', label: 'Employee', render: (r) => <EmpLink name={r.employeeName} meta={r.designation} onOpen={() => openEmployee(r.employeeId)} /> },
              { key: 'department', label: 'Department' },
              { key: 'date', label: 'Date', render: (r) => fmt.dateShort(r.workDate) },
              { key: 'hours', label: 'Hours', className: 'num', render: (r) => <span className="t-num t-bold">{r.hours} h</span> },
              { key: 'reason', label: 'Reason', sortable: false, render: (r) => <span className="t-xs t-muted">{r.reason}</span> },
              { key: 'cost', label: 'Cost', className: 'num', render: (r) => <span className="t-num" title={`${r.hours} h × ${fmt.money(r.rate)}`}>{fmt.money(r.cost)}</span> },
              { key: 'status', label: 'Approval', render: (r) => <Status value={r.status} /> },
              { key: 'a', label: '', sortable: false, className: 'num', render: (r) => can('hr.approve') && ['Submitted', 'Under Review'].includes(r.status) ? (
                <div className="row g-2 end wrap">
                  <Button size="sm" variant="teal" icon="check" loading={approve.isPending && approve.variables === r.id} onClick={async () => {
                    if (await confirm({ title: `Approve ${r.hours} h for ${r.employeeName}?`, body: `${fmt.money(r.cost)} will be paid in the next payroll run.`, confirmLabel: 'Approve' })) approve.mutate(r.id);
                  }}>Approve</Button>
                  <Button size="sm" icon="x" onClick={() => setRejecting(r)}>Reject</Button>
                </div>
              ) : null },
            ]} />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>

      <div className="grid g-2col g-4 mt-4">
        <Card icon="grid" title="Hours by department" sub="This month">
          {summary.data?.byDepartment.length ? (
            <Chart svg={charts.hbar({ rows: summary.data.byDepartment.map((d) => ({ label: d.label, value: d.value, display: `${d.value} h` })), labelW: 140, rowH: 30 })} />
          ) : summary.isLoading ? <Skeleton height={160} /> : <Empty title="No overtime this month" icon="clock" sub="Approved and pending claims for this month appear here." />}
        </Card>
        <Card icon="clock" title="Overtime trend" sub="Hours claimed per month">
          {summary.data ? (
            <Chart svg={charts.bar({ labels: summary.data.trend.map((t) => t.label), series: [{ name: 'Hours', values: summary.data.trend.map((t) => t.value), color: 'var(--amber)' }], height: 180 })} />
          ) : <Skeleton height={180} />}
        </Card>
      </div>
      {adding && <OvertimeModal onClose={() => setAdding(false)} />}
      {rejecting && <RejectModal row={rejecting} onClose={() => setRejecting(null)} />}
      {employeeModal}
    </Page>
  );
}

function OvertimeModal({ onClose }: { onClose: () => void }) {
  const { lookups } = useLookups();
  const [f, setF] = useState({ employeeId: '', workDate: todayKey(), hours: '', reason: '', rate: '' });
  const [touched, setTouched] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const h = Number(f.hours);
  const errors: Record<string, string> = {};
  if (!f.employeeId) errors.employeeId = 'Choose the employee';
  if (!f.workDate || f.workDate > todayKey()) errors.workDate = 'Choose a date up to today';
  else if (f.workDate < addDays(todayKey(), -60)) errors.workDate = 'Claims older than 60 days need a manual adjustment';
  if (!(h > 0 && h <= 16 && Number.isInteger(h * 2))) errors.hours = 'Between 0.5 and 16, in half-hour steps';
  if (f.reason.trim().length < 3) errors.reason = 'Say what the overtime covered';
  if (f.rate && !(Number(f.rate) >= 0)) errors.rate = 'Enter a valid rate';
  const save = useApiMutation<void>('post', '/workforce/overtime', {
    invalidate: ['/workforce'], onSuccess: onClose,
    body: () => ({ employeeId: f.employeeId, workDate: f.workDate, hours: h, reason: f.reason.trim(), ratePerHour: f.rate ? Number(f.rate) : undefined }),
  });
  const server = fieldErrors(save.error);
  const err = (k: string) => (touched ? errors[k] : undefined) ?? server[k];
  return (
    <Modal open onClose={onClose} busy={save.isPending} title="Record overtime" sub="The claim goes to an approver before it reaches payroll"
      foot={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={() => { setTouched(true); if (!Object.keys(errors).length) save.mutate(); }}>Submit claim</Button>
      </>}>
      {save.error && !Object.keys(server).length && <div className="mb-3"><InlineError error={save.error} /></div>}
      <div className="grid g-2col g-3">
        <SelectField label="Employee" required value={f.employeeId} onChange={(v) => set('employeeId', v)} placeholder="Choose employee" error={err('employeeId')}
          options={(lookups?.staff ?? []).map((s) => ({ value: s.id, label: `${s.fullName} — ${s.designation}` }))} />
        <TextField label="Date worked" type="date" required max={todayKey()} value={f.workDate} onChange={(v) => set('workDate', v)} error={err('workDate')} />
        <TextField label="Hours" type="number" required min={0.5} max={16} step={0.5} value={f.hours} onChange={(v) => set('hours', v)} error={err('hours')} />
        <TextField label="Rate per hour (₹)" type="number" min={0} value={f.rate} onChange={(v) => set('rate', v)} error={err('rate')} hint="Blank = twice the hourly basic" />
      </div>
      <div className="mt-3"><TextArea label="Reason" required rows={2} value={f.reason} onChange={(v) => set('reason', v)} error={err('reason')} maxLength={300} /></div>
    </Modal>
  );
}

function RejectModal({ row, onClose }: { row: OvertimeRow; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const m = useApiMutation<void>('post', `/workforce/overtime/${row.id}/reject`, { invalidate: ['/workforce'], body: () => ({ note: note.trim() }), onSuccess: onClose });
  const error = note.trim().length < 3 ? 'Give the employee a reason' : undefined;
  return (
    <Modal open onClose={onClose} busy={m.isPending} title="Reject overtime claim?" sub={`${row.employeeName} · ${row.hours} h on ${fmt.date(row.workDate)}`}
      foot={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={m.isPending} onClick={() => { setTouched(true); if (!error) m.mutate(); }}>Reject claim</Button>
      </>}>
      <p className="t-sm mb-3">{row.reason}</p>
      <TextArea label="Reason" required rows={3} value={note} onChange={setNote} error={touched ? error : undefined} maxLength={500} />
      {m.error && <div className="mt-3"><InlineError error={m.error} /></div>}
    </Modal>
  );
}
