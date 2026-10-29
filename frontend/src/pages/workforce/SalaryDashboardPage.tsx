import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { useSchool } from '@/layouts/SchoolContext';
import {
  Banner, Button, Card, CardLink, DataTable, Empty, ErrorState, FilterSelect, Page, PageHead, PageSkeleton,
  SearchInput, Status, Toolbar,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { monthLabel } from './shared';
import { SetSalaryModal } from './SetSalaryModal';
import { useAuth } from '@/auth/AuthContext';

interface Month { month: string; gross: number; deductions: number; net: number; overtime: number; employees: number; final: boolean }
interface SalaryDashboard {
  latest: (Month & { averageGross: number }) | null;
  previous: Month | null;
  months: Month[];
  yearToDate: { from: string; gross: number; deductions: number; net: number; months: number } | null;
  runs: { id: string; campus: string | null; status: string; employees: number; gross: number; net: number }[];
  departments: { label: string; employees: number; gross: number; net: number; average: number }[];
  categories: { label: string; employees: number; gross: number }[];
  earnings: { label: string; amount: number }[];
  deductions: { label: string; amount: number }[];
  bands: { label: string; employees: number }[];
  pending: { runsAwaitingApproval: number; claimsToPay: number; claimsToPayValue: number } | null;
}


/** HR & Workforce → Salary Dashboard: the pay bill at a glance, for whoever can see payroll. */
export default function SalaryDashboardPage() {
  const { campusParam, campus, scope } = useSchool();
  const q = useApiQuery<SalaryDashboard>('/payroll/salary-dashboard', campusParam);
  const d = q.data;
  const where = scope === 'group' ? 'all campuses' : campus?.name ?? 'this campus';

  if (q.isLoading) return <Page><PageSkeleton /></Page>;
  if (q.error || !d) return <Page><PageHead title="Salary Dashboard" /><ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;
  if (!d.latest) {
    return (
      <Page>
        <PageHead title="Salary Dashboard" sub={`The pay bill for ${where}.`} />
        <Card><Empty icon="wallet" title="No payroll yet" sub="The dashboard fills in once the first payroll run is calculated." /></Card>
      </Page>
    );
  }

  const L = d.latest;

  return (
    <Page>
      <PageHead title="Salary Dashboard"
        sub={`Pay for ${where} — ${monthLabel(L.month)} payroll${L.final ? '' : ' (not yet approved)'}.`}
        actions={<>
          <Button icon="receipt" to="/payslips">Payslips</Button>
          <Button variant="primary" icon="wallet" to="/payroll">Open payroll</Button>
        </>} />

      <Card icon="wallet" title={`${monthLabel(L.month)} payroll by campus`} flush actions={<CardLink to="/payroll">Open payroll</CardLink>}>
        <DataTable rows={d.runs} rowKey={(r) => r.id}
          columns={[
            { key: 'campus', label: 'Campus', render: (r) => <span className="t-bold">{r.campus ?? 'All campuses'}</span> },
            { key: 'employees', label: 'Employees', className: 'num', render: (r) => r.employees },
            { key: 'gross', label: 'Gross', className: 'num', render: (r) => fmt.money(r.gross) },
            { key: 'net', label: 'Net', className: 'num', render: (r) => fmt.money(r.net) },
            { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
          ]} />
        {d.pending && d.pending.claimsToPay > 0 && (
          <div className="card__body">
            <Banner tone="neutral" icon="receipt">
              {d.pending.claimsToPay} approved reimbursement claim{d.pending.claimsToPay === 1 ? '' : 's'} ({fmt.money(d.pending.claimsToPayValue)}) will be paid with the next payroll run.{' '}
              <CardLink to="/reimbursements?status=Approved">View claims</CardLink>
            </Banner>
          </div>
        )}
      </Card>

      <EmployeeSalaries months={d.months.map((m) => m.month)} latest={L.month} />
    </Page>
  );
}

interface EmployeeSalary {
  payslipId: string; employeeId: string; code: string; name: string; designation: string; department: string; campus: string | null;
  gross: number; deductions: number; net: number; daysWorked: number | null; payslipStatus: string; runStatus: string;
}

/** Every employee's pay for a chosen month, with search, a department filter and the payslip to open. */
function EmployeeSalaries({ months, latest }: { months: string[]; latest: string }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canSet = can('payroll.manage');
  // undefined = closed; '' = pick an employee first; otherwise that employee.
  const [setting, setSetting] = useState<string | undefined>(undefined);
  const { campusParam } = useSchool();
  const [month, setMonth] = useState(latest);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const list = useApiQuery<{ month: string | null; rows: EmployeeSalary[] }>('/payroll/salary-dashboard/employees', { ...campusParam, month });
  const all = list.data?.rows ?? [];
  const departments = useMemo(() => [...new Set(all.map((r) => r.department))].sort(), [all]);
  const term = q.trim().toLowerCase();
  const rows = all.filter((r) => (!dept || r.department === dept)
    && (!term || `${r.name} ${r.code} ${r.designation}`.toLowerCase().includes(term)));
  const totals = rows.reduce((a, r) => ({ gross: a.gross + r.gross, deductions: a.deductions + r.deductions, net: a.net + r.net }), { gross: 0, deductions: 0, net: 0 });

  return (
    <Card icon="users" title="Employee salaries" sub={`Each employee's pay for ${monthLabel(month)} — open a payslip for the full breakdown`} className="mt-4" flush>
      <Toolbar>
        <SearchInput value={q} onSearch={setQ} placeholder="Search name, code or designation" />
        <FilterSelect label="Department" value={dept} onChange={setDept} options={departments} />
        <FilterSelect label="Month" allLabel={null} value={month} onChange={(v) => setMonth(v || latest)}
          options={[...months].reverse().map((m) => ({ value: m, label: monthLabel(m) }))} />
        <div className="spacer" />
        <span className="t-sm t-muted">{rows.length} employee{rows.length === 1 ? '' : 's'} · net {fmt.money(totals.net)}</span>
        {canSet && <Button size="sm" variant="primary" icon="wallet" onClick={() => setSetting('')}>Set salary</Button>}
      </Toolbar>
      {list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : (
        <DataTable rows={rows} loading={list.isLoading} rowKey={(r) => r.payslipId}
          onRowClick={(r) => navigate(`/payslips/${r.payslipId}`)}
          emptyText={all.length ? 'No employee matches this search or department.' : 'No payslips for this month.'}
          columns={[
            { key: 'name', label: 'Employee', render: (r) => <><span className="t-bold">{r.name}</span><div className="t-micro t-muted">{r.code} · {r.designation}</div></> },
            { key: 'department', label: 'Department', render: (r) => <>{r.department}{r.campus && <div className="t-micro t-muted">{r.campus}</div>}</> },
            { key: 'gross', label: 'Gross', className: 'num', render: (r) => fmt.money(r.gross) },
            { key: 'deductions', label: 'Deductions', className: 'num', render: (r) => <span className="t-muted">{fmt.money(r.deductions)}</span> },
            { key: 'net', label: 'Net pay', className: 'num', render: (r) => <span className="t-bold">{fmt.money(r.net)}</span> },
            { key: 'status', label: 'Payslip', render: (r) => <Status value={r.payslipStatus === 'Released' ? 'Released' : r.runStatus} /> },
            {
              key: 'open', label: '', className: 'num', render: (r) => (
                <div className="row g-2 end">
                  {canSet && <Button size="sm" icon="edit" onClick={(e) => { e.stopPropagation(); setSetting(r.employeeId); }}>Set salary</Button>}
                  <Button size="sm" icon="receipt" onClick={(e) => { e.stopPropagation(); navigate(`/payslips/${r.payslipId}`); }}>View payslip</Button>
                </div>
              ),
            },
          ]} />
      )}
      {rows.length > 0 && (
        <div className="card__body row g-5 wrap t-sm">
          <span>Gross <strong>{fmt.money(totals.gross)}</strong></span>
          <span>Deductions <strong>{fmt.money(totals.deductions)}</strong></span>
          <span>Net pay <strong>{fmt.money(totals.net)}</strong></span>
        </div>
      )}
      {setting !== undefined && <SetSalaryModal employeeId={setting || undefined} onClose={() => setSetting(undefined)} />}
    </Card>
  );
}
