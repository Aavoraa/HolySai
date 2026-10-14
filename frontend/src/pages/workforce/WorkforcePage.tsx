import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useSchool } from '@/layouts/SchoolContext';
import {
  Avatar, Button, Card, CardLink, Chart, charts, DataTable, Empty, ErrorState, FilterSelect, Flow, Grid, Kpi, Legend, Meter, Page, CampusBanner,
  Pagination, SearchInput, Skeleton, Toolbar, DashLayout, DashRail, DonutCard, TrendCard } from '@/components/ui';
import { fmt } from '@/lib/format';
import { SERIES } from '@/lib/tones';
import { EmpLink, EmployeeFormModal, ListCount, TodayBadge, TypeBadge, monthLabel, useEmployeeModal } from './shared';
import type { AttendanceSummary, EmployeeRow, Workload, WorkforceSummary } from './types';

const CATEGORY_COLORS: Record<string, string> = {
  Teachers: 'var(--navy)', Leadership: 'var(--viz-2)', 'Reception & Admin': 'var(--viz-4)', Security: 'var(--viz-5)',
  'Drivers & Attendants': 'var(--amber)', Housekeeping: 'var(--viz-7)', 'Lab Staff': 'var(--teal)', 'Library Staff': 'var(--viz-8)',
};

const LOAD_TONE: Record<string, string> = { over: 'var(--critical)', near: 'var(--accent)', ok: 'var(--brand)' };

/**
 * Command Center style picture for HR, from staff data only: daily staff attendance
 * (last school days), today's attendance split, and the heaviest teaching loads.
 */
function StaffPulse({ onOpen }: { onOpen: (id: string) => void }) {
  const { campusParam } = useSchool();
  const att = useApiQuery<AttendanceSummary>('/workforce/attendance/summary', campusParam);
  const load = useApiQuery<Workload>('/workforce/workload', campusParam);
  const a = att.data;
  const c = a?.counts;
  const points = (a?.trend ?? []).slice(-7).map((t) => ({ label: fmt.dateShort(t.date), value: t.present }));
  const presentToday = c ? c.present + c.late + c.halfDay : 0;
  const top = (load.data?.rows ?? []).slice(0, 5);

  return (
    <>
      <div className="grid dash__pair">
        {att.isLoading ? <Skeleton height={300} /> : (
          <TrendCard title="Staff Attendance" icon="checkSquare" series="Staff present" color="var(--teal)" points={points}
            actions={<CardLink to="/staff-attendance">View Details</CardLink>}
            empty={{ title: 'No staff attendance yet', sub: 'The trend appears once staff attendance is marked on two or more days.' }} />
        )}
        {att.isLoading ? <Skeleton height={300} /> : (
          <DonutCard title="Today's Staff Attendance" icon="users" link={{ to: '/staff-attendance' }}
            center={c?.total ? `${Math.round((presentToday / c.total) * 100)}%` : undefined} centerSub="Present today"
            bands={c ? [
              { label: 'Present', value: c.present, color: 'var(--success)', to: '/staff-attendance' },
              { label: 'Late', value: c.late, color: 'var(--accent)', to: '/staff-attendance' },
              { label: 'Half Day', value: c.halfDay, color: 'var(--caution)', to: '/staff-attendance' },
              { label: 'Absent', value: c.absent, color: 'var(--critical)', to: '/staff-attendance' },
              { label: 'On Leave', value: c.leave, color: 'var(--info)', to: '/leave' },
              { label: 'Not marked', value: c.notMarked, color: 'var(--border-strong)', to: '/staff-attendance' },
            ] : []}
            empty={{ title: 'No employees yet', sub: "Today's split appears once employees are added." }} />
        )}
      </div>
      <Card icon="barChart" title="Highest Workload" sub="Teaching periods per week against the agreed maximum" flush
        actions={<CardLink to="/workload">View All</CardLink>}>
        {load.isLoading ? (
          <div className="card__body col g-3">{[0, 1, 2].map((i) => <span key={i} className="skeleton" style={{ height: 32 }} />)}</div>
        ) : top.length ? (
          <div className="table-wrap">
            <table className="table table--compact">
              <thead><tr><th style={{ width: 70 }}>#</th><th>Employee</th><th>Department</th><th className="num">Periods / week</th></tr></thead>
              <tbody>
                {top.map((r, i) => (
                  <tr key={r.id} className="row--link" onClick={() => onOpen(r.id)}>
                    <td><span className="row g-3"><span className={`rank rank--${Math.min(i + 1, 5)}`} /><span className="t-muted">{i + 1}</span></span></td>
                    <td><span className="person"><Avatar name={r.fullName} size="sm" /><span className="person__name t-clip">{r.fullName}</span></span></td>
                    <td className="t-nowrap" style={{ color: 'var(--brand)' }}>{r.department}</td>
                    <td className="num t-bold" style={{ color: LOAD_TONE[r.band] }}>{r.periods} / {r.max}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="barChart" title="No teaching load recorded" sub="Teachers appear here once class assignments or timetables are set." />
        )}
      </Card>
    </>
  );
}

export default function WorkforcePage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const list = useListParams({ sort: 'name' }, ['employeeType', 'department', 'today']);
  const summary = useApiQuery<WorkforceSummary>('/workforce/summary', campusParam);
  const q = usePagedQuery<EmployeeRow>('/workforce/employees', { ...list.query, ...campusParam });
  const [openEmployee, employeeModal] = useEmployeeModal();
  const [adding, setAdding] = useState(false);
  const k = summary.data?.kpis;
  const j = summary.data?.journey;
  const loading = summary.isLoading;
  const cats = (summary.data?.categories ?? []).map((c, i) => ({ ...c, color: CATEGORY_COLORS[c.label] ?? SERIES[i % SERIES.length] }));

  return (
    <Page>
      <CampusBanner
        title="Workforce 360"
        sub="One ecosystem for teaching and non-teaching staff — reception, security, drivers, housekeeping, lab and library included."
        actions={<>
          {can('hr.manage') && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add employee</Button>}
          {can('payroll.read') && <Button icon="wallet" to="/payroll">Payroll</Button>}
        </>}
      />
      <DashLayout rail={<DashRail actions={[
        { label: 'Staff Attendance', icon: 'checkSquare', to: '/staff-attendance' },
        { label: 'Leave Requests', icon: 'calendar', to: '/leave' },
        { label: 'Shifts & Rosters', icon: 'clock', to: '/shifts' },
        { label: 'Payroll', icon: 'wallet', to: '/payroll', show: can('payroll.read') },
        { label: 'Payslips', icon: 'receipt', to: '/payslips', show: can('payroll.read') },
        { label: 'CPD & Training', icon: 'award', to: '/cpd' },
      ]} />}>
      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : (
        <>
          <Grid cols="g-4col">
            <Kpi loading={loading} size="hero" icon="users" label="Total employees" value={fmt.n(k?.total)} foot={k && `${k.teaching} teaching · ${k.nonTeaching} non-teaching`} />
            <Kpi loading={loading} size="hero" icon="checkSquare" label="Present" value={fmt.n((k?.present ?? 0) + (k?.halfDay ?? 0))} unit={k?.total ? fmt.pct(((k.present + k.halfDay) / k.total) * 100) : undefined} tone="teal"
              foot={k?.notMarked ? `${k.notMarked} not marked yet` : undefined} to="/staff-attendance" />
            <Kpi loading={loading} size="hero" icon="alert" label="Absent" value={fmt.n(k?.absent)} tone="critical"
              foot={k ? (k.uncoveredToday ? `${k.uncoveredToday} post${k.uncoveredToday === 1 ? '' : 's'} uncovered` : 'All posts covered') : undefined} to="/shifts" />
            <Kpi loading={loading} size="hero" icon="calendar" label="On leave" value={fmt.n(k?.leave)} tone="info"
              foot={k ? `${k.openLeave} request${k.openLeave === 1 ? '' : 's'} awaiting approval` : undefined} to="/leave" />
          </Grid>
          <div className="statgrid statgrid--card fw-fit mt-3" aria-label="More workforce figures">
            <Kpi loading={loading} size="compact" label="Late" value={fmt.n(k?.late)} tone="amber" to="/staff-attendance" />
            <Kpi loading={loading} size="compact" label="Overtime hours" value={fmt.n(k?.overtimeHours)} unit="this month" tone="amber" to="/overtime"
              foot={k ? `${k.overtimePending} h pending approval` : undefined} />
            <Kpi loading={loading} size="compact" label="Payroll inputs pending" value={fmt.n(k?.payrollPending)} tone="critical" to={can('payroll.read') ? '/payroll' : '/leave'} />
            <Kpi loading={loading} size="compact" label="CPD hours logged" value={fmt.n(k?.cpdHours)} tone="teal" to="/cpd" />
          </div>
          <StaffPulse onOpen={openEmployee} />

          <div className="grid g-main mt-5">
            <Card icon="briefcase" title="Employee journey" sub="One record from recruitment through to the payslip">
              {j ? (
                <Flow steps={[
                  { label: 'Recruitment', meta: `${j.joinedThisYear} joined this year`, state: 'done' },
                  { label: 'Employee profile', meta: `${fmt.n(j.active)} active`, state: 'done' },
                  { label: 'Attendance', meta: 'Daily, by shift', state: 'done' },
                  { label: 'Leave', meta: `${j.openLeave} request${j.openLeave === 1 ? '' : 's'} open`, state: 'done' },
                  { label: 'Overtime', meta: `${fmt.n(j.overtimeHours)} hours`, state: 'done' },
                  { label: 'Approval', meta: `${j.pendingApprovals} pending`, state: j.pendingApprovals ? 'active' : 'done' },
                  { label: 'Payroll', meta: j.currentRun ? `${monthLabel(j.currentRun.payMonth).split(' ')[0]} run · ${j.currentRun.status}` : 'No run yet',
                    state: j.currentRun && ['Released', 'Paid'].includes(j.currentRun.status) ? 'done' : j.pendingApprovals ? undefined : 'active' },
                  { label: 'Payslip', meta: 'Released to the staff app', state: j.currentRun && ['Released', 'Paid'].includes(j.currentRun.status) ? 'done' : undefined },
                ]} />
              ) : <Skeleton height={60} />}
            </Card>
            <Card icon="briefcase" title="Workforce composition">
              {cats.length ? (
                <>
                  <Chart svg={charts.donut({ size: 186, thickness: 26, center: String(k?.total ?? 0), centerSub: 'employees', data: cats })} />
                  <div className="mt-4"><Legend items={cats.map((c) => ({ label: `${c.label} (${c.value})`, color: c.color }))} /></div>
                </>
              ) : summary.isLoading ? <Skeleton height={186} /> : <Empty icon="users" title="No employees yet" sub="The composition chart appears once employees are added." />}
            </Card>
          </div>
        </>
      )}

      <Card flush className="mt-5">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search name, ID or role" />
          <FilterSelect label="Category" value={list.filters.employeeType} onChange={(v) => list.setFilter('employeeType', v)}
            options={[{ value: 'teaching', label: 'Teaching' }, { value: 'non_teaching', label: 'Non-Teaching' }]} />
          <FilterSelect label="Department" value={list.filters.department} onChange={(v) => list.setFilter('department', v)} options={summary.data?.departments ?? []} />
          <FilterSelect label="Today" value={list.filters.today} onChange={(v) => list.setFilter('today', v)} options={['Present', 'Late', 'Absent', 'On Leave', 'Half Day', 'Not marked']} />
          {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
          <div className="spacer" />
          <ListCount total={q.data?.meta.total} noun="employees" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable
            rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            onRowClick={(r) => openEmployee(r.id)}
            emptyText={list.hasFilters ? 'No employees match these filters.' : 'No employees on this campus yet. Use Add employee to create the first record.'}
            columns={[
              { key: 'name', label: 'Employee', render: (r) => <EmpLink name={r.fullName} meta={r.designation} onOpen={() => openEmployee(r.id)} /> },
              { key: 'code', label: 'ID', render: (r) => <span className="t-num t-muted">{r.code}</span> },
              { key: 'category', label: 'Category', render: (r) => <TypeBadge type={r.employeeType} /> },
              { key: 'department', label: 'Department' },
              { key: 'shift', label: 'Shift', render: (r) => <span className="t-xs t-muted">{r.shift ?? '—'}</span> },
              { key: 'today', label: 'Today', render: (r) => <TodayBadge status={r.today} /> },
              { key: 'leaveBalance', label: 'Leave', className: 'num', render: (r) => <span className="t-num">{r.leaveBalance} d</span> },
              { key: 'overtime', label: 'OT', className: 'num', render: (r) => (r.overtime ? <span className="t-num t-warning">{r.overtime} h</span> : <span className="t-faint">—</span>) },
              { key: 'workload', label: 'Workload', render: (r) => (r.workload
                ? <Meter label="" value={(r.workload / 30) * 100} right={`${r.workload} periods`} tone={r.workload > 27 ? 'critical' : 'teal'} />
                : <span className="t-faint">n/a</span>) },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      {employeeModal}
      {adding && <EmployeeFormModal onClose={() => setAdding(false)} />}
      </DashLayout>
    </Page>
  );
}
