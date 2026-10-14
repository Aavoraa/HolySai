import { useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useSchool } from '@/layouts/SchoolContext';
import {
  Badge, Button, Card, Chart, charts, DataTable, Empty, ErrorState, FilterSelect, Grid, InlineError, Kpi, Modal, Page, PageHead,
  Pagination, SearchInput, SelectField, Skeleton, TextField, Toolbar, useConfirm, useToast,
} from '@/components/ui';
import { fmt, todayKey } from '@/lib/format';
import { EmpLink, ListCount, TodayBadge, fieldErrors, useEmployeeModal } from './shared';
import type { AttendanceRow, AttendanceSummary } from './types';

const STATUSES = ['Present', 'Late', 'Half Day', 'Absent', 'On Leave'];
const tone = (p: number) => (p < 90 ? 'var(--critical)' : p < 95 ? 'var(--amber)' : 'var(--teal)');

export default function StaffAttendancePage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { campusParam } = useSchool();
  const list = useListParams({ sort: 'name', pageSize: 50 }, ['date', 'status', 'employeeType']);
  const date = list.filters.date || todayKey();
  const summary = useApiQuery<AttendanceSummary>('/workforce/attendance/summary', { ...campusParam, date });
  const q = usePagedQuery<AttendanceRow>('/workforce/attendance', { ...list.query, ...campusParam, date });
  const [openEmployee, employeeModal] = useEmployeeModal();
  const [marking, setMarking] = useState<AttendanceRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const flag = useApiMutation<string>('post', (id) => `/workforce/roster/${id}/flag-cover`, {
    invalidate: ['/workforce'], body: () => ({ reason: 'Absent today' }), success: 'Cover request raised — see Shifts & Rosters',
  });
  const s = summary.data;
  const c = s?.counts;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows: AttendanceRow[] = [];
      for (let page = 1; page < 50; page++) {
        const r = await api.getPaged<AttendanceRow>('/workforce/attendance', { ...list.query, ...campusParam, date, page, pageSize: 200 });
        rows.push(...r.rows);
        if (page >= r.meta.totalPages) break;
      }
      const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [['Employee ID', 'Name', 'Department', 'Shift', 'Status', 'Check in', 'Check out', 'Source'].map(cell).join(','),
        ...rows.map((r) => [r.code, r.fullName, r.department, r.shift, r.status, r.checkIn, r.checkOut, r.source].map(cell).join(','))].join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `staff-attendance-${date}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Staff attendance exported (${rows.length} rows)`, 'success');
    } catch (err) {
      toast((err as Error).message, 'critical');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Page>
      <PageHead title="Staff Attendance" sub="Biometric and app-based, by shift. Feeds payroll directly."
        actions={<Button icon="download" loading={exporting} onClick={exportCsv}>Export</Button>} />
      <div className="filterbar">
        <span className="t-sm t-muted">Date</span>
        <input className="input fw-date" type="date" aria-label="Attendance date" value={date} max={todayKey()}
          onChange={(e) => list.setFilter('date', e.target.value && e.target.value !== todayKey() ? e.target.value : '')} />
        {date !== todayKey() && <><Badge tone="info">Viewing {fmt.date(date)}</Badge><Button size="sm" variant="quiet" onClick={() => list.setFilter('date', '')}>Back to today</Button></>}
      </div>
      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : (
        <>
          <Grid cols="g-4col">
            <Kpi loading={summary.isLoading} icon="checkSquare" label="Present" value={fmt.n((c?.present ?? 0) + (c?.halfDay ?? 0))} tone="teal"
              unit={c?.total ? fmt.pct(((c.present + c.halfDay + c.late) / c.total) * 100) + ' in' : undefined} onClick={() => list.setFilter('status', 'Present')} />
            <Kpi loading={summary.isLoading} icon="alert" label="Absent" value={fmt.n(c?.absent)} tone="critical" onClick={() => list.setFilter('status', 'Absent')} />
            <Kpi loading={summary.isLoading} icon="calendar" label="On leave" value={fmt.n(c?.leave)} tone="info" onClick={() => list.setFilter('status', 'On Leave')} />
            <Kpi loading={summary.isLoading} icon="clock" label="Late" value={fmt.n(c?.late)} tone="amber" onClick={() => list.setFilter('status', 'Late')}
              foot={c?.notMarked ? `${c.notMarked} not marked` : undefined} />
          </Grid>
          <div className="grid g-2col g-4 mt-4">
            <Card icon="checkSquare" title="Attendance by department" sub="Present %, last 30 days (leave excluded)">
              {s && s.byDepartment.length ? (
                <Chart svg={charts.bar({
                  labels: s.byDepartment.map((d) => d.label.length > 11 ? d.label.slice(0, 10) + '.' : d.label),
                  series: [{ name: 'Present %', values: s.byDepartment.map((d) => d.value ?? 0), colors: s.byDepartment.map((d) => tone(d.value ?? 0)) }],
                  yMax: 100, height: 230,
                })} />
              ) : summary.isLoading ? <Skeleton height={230} /> : <Empty title="No attendance marked yet" icon="checkSquare" sub="Department figures appear once the register is marked." />}
            </Card>
            <Card title={date === todayKey() ? 'Today by shift' : `${fmt.date(date)} by shift`} flush>
              <DataTable compact stack={false} rows={s?.byShift} loading={summary.isLoading} rowKey={(r) => r.shift} emptyText="No shifts."
                columns={[
                  { key: 'shift', label: 'Shift' },
                  { key: 'expected', label: 'Expected', className: 'num' },
                  { key: 'present', label: 'Present', className: 'num' },
                  { key: 'gap', label: 'Cover needed', render: (r) => {
                    const gap = r.uncovered || r.absent;
                    return gap ? <Badge tone="critical">{gap} uncovered</Badge> : <Badge tone="success" icon="check">Full</Badge>;
                  } },
                ]} />
            </Card>
          </div>
          <div className="mt-4">
            <Card icon="checkSquare" title="Attendance trend" sub={s?.months.length ? `Monthly: ${s.months.map((m) => `${m.label} ${m.value}%`).join(' · ')}` : 'Daily present % over the last 30 days'}>
              {s && s.trend.length > 1 ? (
                <Chart svg={charts.line({
                  labels: s.trend.map((t) => fmt.dateShort(t.date)),
                  series: [{ name: 'Present %', values: s.trend.map((t) => t.present), color: 'var(--teal)', fill: true }],
                  height: 200, yMin: 70, yMax: 100, unit: '%',
                })} />
              ) : summary.isLoading ? <Skeleton height={200} /> : <Empty title="Not enough history yet" icon="activity" sub="The trend needs at least two days of marked attendance." />}
            </Card>
          </div>
        </>
      )}

      <Card title={date === todayKey() ? "Today's register" : `Register — ${fmt.date(date)}`} flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search name or ID" />
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={[...STATUSES, 'Not marked']} />
          <FilterSelect label="Category" value={list.filters.employeeType} onChange={(v) => list.setFilter('employeeType', v)}
            options={[{ value: 'teaching', label: 'Teaching' }, { value: 'non_teaching', label: 'Non-Teaching' }]} />
          {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
          <div className="spacer" />
          {c?.notMarked ? <Button size="sm" onClick={() => list.setFilter('status', 'Not marked')}>{c.notMarked} not marked</Button> : null}
          <ListCount total={q.data?.meta.total} noun="employees" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            emptyText={list.hasFilters ? 'No employees match these filters.' : 'No employees on this campus yet.'}
            columns={[
              { key: 'name', label: 'Employee', render: (r) => <EmpLink name={r.fullName} meta={r.designation} onOpen={() => openEmployee(r.id)} /> },
              { key: 'shift', label: 'Shift', render: (r) => <span className="t-xs">{r.shift ?? '—'}{r.post && <div className="t-micro t-muted">{r.post}</div>}</span> },
              { key: 'checkIn', label: 'Clock in', render: (r) => (r.checkIn ? <span className="t-num">{r.checkIn}</span> : <span className="t-faint">—</span>) },
              { key: 'out', label: 'Clock out', sortable: false, render: (r) => (r.checkOut ? <span className="t-num">{r.checkOut}</span> : <span className="t-faint">—</span>) },
              { key: 'status', label: 'Status', render: (r) => <><TodayBadge status={r.status} />{r.source === 'manual' && <span className="t-micro t-muted"> · manual</span>}</> },
              { key: 'a', label: '', sortable: false, className: 'num', render: (r) => (
                <div className="row g-2 end wrap">
                  {r.rosterStatus === 'Cover needed' && <Badge tone="warning">Cover needed</Badge>}
                  {r.rosterStatus === 'Covered' && <Badge tone="success" icon="check">Covered{r.coveredBy ? ` · ${r.coveredBy}` : ''}</Badge>}
                  {can('hr.manage') && ['Absent', 'On Leave'].includes(r.status) && r.rosterId && r.rosterStatus === 'Scheduled' && (
                    <Button size="sm" variant="primary" loading={flag.isPending && flag.variables === r.rosterId} onClick={async () => {
                      if (await confirm({ title: 'Arrange cover?', body: `${r.post} will be flagged "Cover needed" so a colleague can be assigned.`, confirmLabel: 'Request cover' })) flag.mutate(r.rosterId!);
                    }}>Arrange cover</Button>
                  )}
                  {can('hr.manage') && <Button size="sm" onClick={() => setMarking(r)}>{r.status === 'Not marked' ? 'Mark' : 'Correct'}</Button>}
                </div>
              ) },
            ]} />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      {marking && <MarkModal row={marking} date={date} onClose={() => setMarking(null)} />}
      {employeeModal}
    </Page>
  );
}

function MarkModal({ row, date, onClose }: { row: AttendanceRow; date: string; onClose: () => void }) {
  const [status, setStatus] = useState(row.status === 'Not marked' ? 'Present' : row.status);
  const [checkIn, setCheckIn] = useState(row.checkIn ?? '');
  const [checkOut, setCheckOut] = useState(row.checkOut ?? '');
  const [touched, setTouched] = useState(false);
  const needsTime = ['Present', 'Late', 'Half Day'].includes(status);
  const errors: Record<string, string> = {};
  if (needsTime && !checkIn) errors.checkIn = 'Check-in time is required';
  if (needsTime && checkIn && checkOut && checkOut < checkIn) errors.checkOut = 'Check-out is before check-in';
  const save = useApiMutation('put', '/workforce/attendance', {
    invalidate: ['/workforce'], success: `Attendance saved for ${row.fullName}`, onSuccess: onClose,
    body: () => ({ employeeId: row.id, date, status, checkIn: needsTime ? checkIn : null, checkOut: needsTime && checkOut ? checkOut : null }),
  });
  const server = fieldErrors(save.error);
  const err = (k: string) => (touched ? errors[k] : undefined) ?? server[k];
  return (
    <Modal open onClose={onClose} busy={save.isPending}
      title={row.status === 'Not marked' ? 'Mark attendance' : 'Correct attendance'} sub={`${row.fullName} · ${fmt.date(date)} · ${row.shift ?? 'No shift'}`}
      foot={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={() => { setTouched(true); if (!Object.keys(errors).length) save.mutate(undefined); }}>Save</Button>
      </>}>
      {save.error && !Object.keys(server).length && <div className="mb-3"><InlineError error={save.error} /></div>}
      <div className="grid g-3col g-3">
        <SelectField label="Status" required value={status} onChange={setStatus} options={STATUSES} />
        <TextField label="Check in" type="time" value={checkIn} onChange={setCheckIn} disabled={!needsTime} error={err('checkIn')} required={needsTime} />
        <TextField label="Check out" type="time" value={checkOut} onChange={setCheckOut} disabled={!needsTime} error={err('checkOut')} />
      </div>
      <p className="t-xs t-muted mt-3">Corrections are recorded as manual entries and appear in the audit trail. Approved leave is applied automatically.</p>
    </Modal>
  );
}
