import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useSchool } from '@/layouts/SchoolContext';
import {
  Badge, Button, Card, DataTable, Empty, ErrorState, FilterSelect, Grid, Kpi, Page, PageHead, Pagination, SearchInput, Toolbar,
  useConfirm,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { EmpLink, ListCount, PayslipModal, TypeBadge, useEmployeeModal } from './shared';
import type { PayslipRow, RunStatus } from './types';

interface Summary {
  kpis: { releasedThisYear: number; releasedTotal: number };
  runs: { id: string; payMonth: string; monthLabel: string; status: RunStatus; campusName: string | null; employeeCount: number; net: number }[];
}

const slipBadge = (status: string | null) => (status === 'Released'
  ? <Badge tone="success" icon="check">Released</Badge>
  : status ? <Badge tone="warning">Pending</Badge> : <span className="t-faint">—</span>);

export default function PayslipsPage() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const { campusParam, scope } = useSchool();
  const list = useListParams({ sort: 'name' }, ['run', 'employeeType', 'status']);
  const summary = useApiQuery<Summary>('/payslips/summary', campusParam);
  const runs = summary.data?.runs ?? [];
  const run = runs.find((r) => r.id === list.filters.run) ?? runs[0];
  const { run: _r, ...rest } = list.query as Record<string, unknown>;
  const q = usePagedQuery<PayslipRow>('/payslips', { ...(rest as Record<string, string>), ...campusParam, runId: run?.id }, { enabled: !!run });
  const [openEmployee, employeeModal] = useEmployeeModal();
  const [slip, setSlip] = useState<string | null>(null);
  const month = run?.monthLabel.split(' ')[0];
  const release = useApiMutation<void>('post', `/payroll/runs/${run?.id}/release`, { invalidate: ['/payslips', '/payroll'], body: () => ({}) });
  const canRelease = run?.status === 'Approved' && (can('payroll.approve') || can('payroll.manage'));

  return (
    <Page>
      <PageHead title="Payslips" sub="Released to every employee through the staff app, teaching and non-teaching alike."
        actions={canRelease && run && (
          <Button variant="primary" icon="send" loading={release.isPending} onClick={async () => {
            if (await confirm({ title: `Release ${run.monthLabel} payslips?`, body: `${run.employeeCount} employees can see their payslip in the staff app and are notified.`, confirmLabel: 'Release' })) release.mutate();
          }}>Release {month}</Button>
        )} />
      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : (
        <Grid cols="g-4col">
          <Kpi loading={summary.isLoading} icon="receipt" label="Released this year" value={fmt.n(summary.data?.kpis.releasedThisYear)} tone="teal" />
          <Kpi loading={summary.isLoading} icon="send" label={`${month ?? 'Current'} status`} value={run ? (run.status === 'Released' || run.status === 'Paid' ? 'Released' : 'Pending') : '—'}
            tone={run && ['Released', 'Paid'].includes(run.status) ? 'teal' : 'amber'}
            foot={run ? (['Released', 'Paid'].includes(run.status) ? `Run ${run.status.toLowerCase()}` : run.status === 'Approved' ? 'Approved — ready to release' : `Awaiting payroll approval (${run.status})`) : undefined}
            to="/payroll" />
          <Kpi loading={summary.isLoading} icon="users" label="Employees in run" value={fmt.n(run?.employeeCount ?? 0)} foot={scope === 'group' ? run?.campusName ?? undefined : undefined} />
          <Kpi loading={summary.isLoading} icon="wallet" label="Net pay" value={fmt.money(run?.net ?? 0, { compact: true })} tone="info" />
        </Grid>
      )}
      <Card flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search employee" />
          <FilterSelect label="Month" allLabel={null} value={run?.id ?? ''} onChange={(v) => list.setFilter('run', v)}
            options={runs.map((r) => ({ value: r.id, label: `${r.monthLabel}${scope === 'group' && r.campusName ? ` · ${r.campusName}` : ''} (${r.status})` }))} />
          <FilterSelect label="Category" value={list.filters.employeeType} onChange={(v) => list.setFilter('employeeType', v)}
            options={[{ value: 'teaching', label: 'Teaching' }, { value: 'non_teaching', label: 'Non-Teaching' }]} />
          <FilterSelect label="Payslip" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={[{ value: 'Released', label: 'Released' }, { value: 'Draft', label: 'Pending' }]} />
          {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
          <div className="spacer" />
          <ListCount total={q.data?.meta.total} noun="payslips" />
        </Toolbar>
        {!summary.isLoading && !runs.length ? (
          <Empty icon="receipt" title="No payroll runs yet" sub="Payslips appear here once a payroll run is calculated."
            action={can('payroll.read') ? <Button icon="wallet" to="/payroll">Open payroll</Button> : undefined} />
        ) : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable rows={q.data?.rows} loading={q.isLoading || summary.isLoading} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            onRowClick={(r) => setSlip(r.id)} emptyText="No payslips match these filters."
            columns={[
              { key: 'name', label: 'Employee', render: (r) => <EmpLink name={r.employeeName} meta={`${r.employeeCode} · ${r.designation}`} onOpen={() => openEmployee(r.employeeId)} /> },
              { key: 'category', label: 'Category', render: (r) => <TypeBadge type={r.employeeType} /> },
              { key: 'prev', label: 'Previous month', sortable: false, render: (r) => slipBadge(r.previousStatus) },
              { key: 'status', label: month ?? 'This month', render: (r) => slipBadge(r.status) },
              { key: 'net', label: 'Net pay', className: 'num', render: (r) => <span className="t-num t-bold">{fmt.money(r.net)}</span> },
              { key: 'a', label: '', sortable: false, className: 'num', render: (r) => <Button size="sm" icon="receipt" onClick={(e) => { e.stopPropagation(); setSlip(r.id); }}>View</Button> },
            ]} />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      {slip && <PayslipModal id={slip} onClose={() => setSlip(null)} />}
      {employeeModal}
    </Page>
  );
}
