/**
 * Building blocks shared by the workforce screens: employee link + profile
 * modal (the full journey), employee form, leave application, payslip view.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import { useSchool } from '@/layouts/SchoolContext';
import {
  Avatar, Badge, Banner, Button, Card, Checkbox, DataTable, Dl, Empty, ErrorState, Flow, Grid, Icon, InlineError, Meter, Modal, Person,
  SelectField, Skeleton, Status, Tabs, TextArea, TextField, useConfirm,
} from '@/components/ui';
import { fmt, todayKey } from '@/lib/format';
import type { EmployeeDetail, EmployeeProfile, LeaveBalance, LeaveType, Payslip, Shift } from './types';

export { ListCount, TotalsBar } from '../finance/shared';

export const TYPE_LABEL: Record<string, string> = { teaching: 'Teaching', non_teaching: 'Non-Teaching' };
export const CATEGORIES = ['Leadership', 'Teachers', 'Reception & Admin', 'Security', 'Drivers & Attendants', 'Housekeeping', 'Lab Staff', 'Library Staff'];
export const COVER_OPTIONS = ['Team rota', 'Named colleague', 'Substitute teacher', 'Not required'];

export function TypeBadge({ type }: { type: string }) {
  return <Badge tone={type === 'teaching' ? 'info' : 'neutral'}>{TYPE_LABEL[type] ?? type}</Badge>;
}

export function TodayBadge({ status }: { status: string }) {
  return <Status value={status} dot />;
}

export function EmpLink({ name, meta, onOpen }: { name: string; meta?: ReactNode; onOpen: () => void }) {
  return <Person name={name} meta={meta} onClick={onOpen} />;
}

/** Field errors from an API validation response. */
export function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiError ? err.fieldErrors : {};
}

export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const monthLabel = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
export const dayName = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long' });
export const dayShort = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit' });

// ---------------------------------------------------------------------------
// Employee profile modal
// ---------------------------------------------------------------------------
/** `const [openEmployee, employeeModal] = useEmployeeModal();` — render `employeeModal` once per page. */
export function useEmployeeModal(): [(id: string) => void, ReactNode] {
  const [id, setId] = useState<string | null>(null);
  const node = id ? <EmployeeProfileModal id={id} onClose={() => setId(null)} /> : null;
  return [setId, node];
}

function EmployeeProfileModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const q = useApiQuery<EmployeeProfile>(`/workforce/employees/${id}`);
  const [tab, setTab] = useState<'leave' | 'overtime' | 'cpd' | 'roster' | 'pay'>('leave');
  const [editing, setEditing] = useState(false);
  const archive = useApiMutation<void>('delete', `/workforce/employees/${id}`, {
    invalidate: ['/workforce'], success: 'Employee archived', onSuccess: onClose,
  });
  const d = q.data;
  const e = d?.employee;

  if (editing && e) return <EmployeeFormModal employee={e} onClose={() => setEditing(false)} />;

  return (
    <Modal
      open
      onClose={onClose}
      size="full"
      title={e?.fullName ?? 'Employee'}
      sub={e ? `${e.code} · ${e.designation} · ${e.department}` : undefined}
      foot={
        <>
          <Button onClick={onClose}>Close</Button>
          {can('hr.manage') && e && (
            <Button variant="danger" icon="trash" loading={archive.isPending} onClick={async () => {
              if (await confirm({ title: `Archive ${e.fullName}?`, body: 'The employee is marked as exited, removed from future rosters and hidden from lists. Payroll history is kept.', confirmLabel: 'Archive employee', danger: true })) archive.mutate();
            }}>Archive</Button>
          )}
          {can('payroll.read') && !!d?.payslips.length && (
            <Button icon="receipt" onClick={() => navigate(`/payslips/${d.payslips[0].id}`)}>View payslip</Button>
          )}
          {can('hr.manage') && e && <Button variant="primary" icon="edit" onClick={() => setEditing(true)}>Edit profile</Button>}
        </>
      }
    >
      {q.isLoading ? (
        <div className="col g-3"><Skeleton height={60} /><Grid cols="g-3col"><Skeleton height={220} /><Skeleton height={220} /><Skeleton height={220} /></Grid></div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : d && e ? (
        <>
          <section className="card profilehead fw-profile" aria-label="Employee summary">
            <div className="profilehead__main">
              <Avatar name={e.fullName} size="xl" />
              <div className="profilehead__id">
                <div className="row g-2 wrap">
                  <h2 className="profilehead__name">{e.fullName}</h2>
                  <TypeBadge type={e.employeeType} />
                  <TodayBadge status={e.today} />
                  {e.employmentStatus && e.employmentStatus !== 'active' && <Status value={e.employmentStatus === 'on_notice' ? 'Due Soon' : 'Closed'} label={e.employmentStatus === 'on_notice' ? 'On notice' : 'Exited'} />}
                </div>
                <p className="profilehead__meta"><span className="t-strong t-semi">{e.code}</span> · {e.designation} · {e.department}</p>
                <div className="profilehead__facts">
                  <span title="Campus"><Icon name="building" size={14} />{e.campusFullName}</span>
                  <span title="Shift"><Icon name="clock" size={14} />{e.shift ?? 'No fixed shift'}</span>
                  <span title="Joined"><Icon name="calendar" size={14} />Joined {fmt.date(e.joinDate)}</span>
                </div>
              </div>
            </div>
            <dl className="profilehead__stats">
              <div><dt>Attendance</dt><dd className={d.attendance.pct != null && d.attendance.pct < 90 ? 't-critical' : undefined}>{d.attendance.pct != null ? `${d.attendance.pct}%` : '—'}</dd><span>this month</span></div>
              <div><dt>Leave balance</dt><dd>{e.leaveBalance} d</dd><span>of {e.leaveEntitled} days</span></div>
              <div><dt>Overtime</dt><dd className={e.overtime > 15 ? 't-critical' : undefined}>{e.overtime} h</dd><span>this month</span></div>
              <div><dt>CPD</dt><dd>{e.cpd} h</dd><span>this year</span></div>
            </dl>
          </section>
          <Card icon="briefcase" title="Employee journey" tight><Flow steps={d.journey} /></Card>
          <div className="grid g-3col g-4 mt-4">
            <Card icon="grid" title="Employment" tight>
              <Dl items={[
                ['Category', TYPE_LABEL[e.employeeType]],
                ['Staff group', e.category],
                ['Department', e.department],
                ['Designation', e.designation],
                ['Campus', e.campusFullName],
                ['Shift', e.shift ?? '—'],
                ['Joined', fmt.date(e.joinDate)],
                ['Status today', <TodayBadge key="t" status={e.today} />],
                ...(e.employeeType === 'teaching'
                  ? [['Qualification', e.qualification ?? '—'] as [string, ReactNode]]
                  : e.licenceNoMasked ? [['Licence', `${e.licenceNoMasked} · expires ${fmt.date(e.licenceExpiry)}`] as [string, ReactNode]] : []),
                ...(e.basicSalary != null ? [['Basic salary', fmt.money(e.basicSalary)] as [string, ReactNode], ['Bank account', e.bankAccount ?? '—'] as [string, ReactNode]] : []),
              ]} />
            </Card>
            <Card icon="calendar" title="Time and leave" tight>
              <div className="col g-3">
                <Meter label="Attendance this month" value={d.attendance.pct ?? 0} right={d.attendance.pct != null ? `${d.attendance.pct}%` : 'No marks'} tone={(d.attendance.pct ?? 100) < 90 ? 'critical' : 'teal'} />
                <Meter label="Leave used" value={e.leaveEntitled ? ((e.leaveEntitled - e.leaveBalance) / e.leaveEntitled) * 100 : 0}
                  right={`${e.leaveEntitled - e.leaveBalance} of ${e.leaveEntitled} days`} tone="info" />
                <Meter label="Overtime this month" value={Math.min(100, e.overtime * 4)} right={`${e.overtime} hours`} tone={e.overtime > 15 ? 'critical' : 'amber'} />
                {e.employeeType === 'teaching' && e.workload > 0 && (
                  <Meter label="Teaching load" value={(e.workload / (e.maxPeriodsWeek || 30)) * 100}
                    right={`${e.workload} of ${e.maxPeriodsWeek ?? 30} periods`} tone={e.workload > (e.maxPeriodsWeek ?? 30) ? 'critical' : 'teal'} />
                )}
                <Meter label="CPD hours" value={Math.min(100, (e.cpd / (e.employeeType === 'teaching' ? 24 : 12)) * 100)} right={`${e.cpd} hours`} tone="teal" />
              </div>
            </Card>
            <Card icon="folder" title="Documents" tight flush>
              <DataTable compact stack={false} rows={d.documents} rowKey={(r) => r.id} emptyText="No documents on file."
                columns={[
                  { key: 'name', label: 'Document' },
                  { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
                ]} />
            </Card>
          </div>
          <div className="card mt-4">
            <div className="fw-tabs">
              <Tabs active={tab} onChange={setTab} items={[
                { id: 'leave', label: 'Leave', count: d.leaveRequests.length },
                { id: 'overtime', label: 'Overtime', count: d.overtime.length },
                { id: 'cpd', label: 'CPD', count: d.cpd.length },
                { id: 'roster', label: 'Roster', count: d.roster.length },
                ...(can('payroll.read') ? [{ id: 'pay' as const, label: 'Payslips', count: d.payslips.length }] : []),
              ]} />
            </div>
            {tab === 'leave' && (
              <>
                <div className="row g-2 wrap fw-tabpad">
                  {d.leaveBalances.map((b) => <Badge key={b.leaveTypeId} tone={b.balance > 0 ? 'info' : 'warning'}>{b.type}: {b.balance} of {b.entitled}</Badge>)}
                </div>
                <DataTable compact rows={d.leaveRequests} rowKey={(r) => r.id} emptyText="No leave requests."
                  columns={[
                    { key: 'code', label: 'Reference' }, { key: 'type', label: 'Type' },
                    { key: 'from', label: 'Dates', render: (r) => `${fmt.dateShort(r.fromDate)}${r.toDate !== r.fromDate ? ` – ${fmt.dateShort(r.toDate)}` : ''}` },
                    { key: 'days', label: 'Days', className: 'num' },
                    { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
                  ]} />
              </>
            )}
            {tab === 'overtime' && (
              <DataTable compact rows={d.overtime} rowKey={(r) => r.id} emptyText="No overtime claims."
                columns={[
                  { key: 'date', label: 'Date', render: (r) => fmt.date(r.workDate) },
                  { key: 'hours', label: 'Hours', className: 'num', render: (r) => `${r.hours} h` },
                  { key: 'reason', label: 'Reason', render: (r) => <span className="t-xs t-muted">{r.reason}</span> },
                  { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
                ]} />
            )}
            {tab === 'cpd' && (
              <DataTable compact rows={d.cpd} rowKey={(r) => r.id} emptyText="No CPD recorded."
                columns={[
                  { key: 'programme', label: 'Programme', render: (r) => <><span className="t-bold">{r.programme}</span><div className="t-micro t-muted">{r.provider}</div></> },
                  { key: 'hours', label: 'Hours', className: 'num' },
                  { key: 'completed', label: 'Completed', render: (r) => fmt.date(r.completedOn) },
                  { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
                ]} />
            )}
            {tab === 'roster' && (
              <DataTable compact rows={d.roster} rowKey={(r) => r.id} emptyText="Not on the roster this fortnight."
                columns={[
                  { key: 'date', label: 'Day', render: (r) => dayShort(r.date) },
                  { key: 'post', label: 'Post' }, { key: 'shift', label: 'Shift' },
                  { key: 'status', label: 'Status', render: (r) => <><Status value={r.status} />{r.coveredBy && <span className="t-micro t-muted"> by {r.coveredBy}</span>}</> },
                ]} />
            )}
            {tab === 'pay' && (
              <DataTable compact rows={d.payslips} rowKey={(r) => r.id} emptyText="No payslips yet." onRowClick={(r) => navigate(`/payslips/${r.id}`)}
                columns={[
                  { key: 'month', label: 'Month', render: (r) => monthLabel(r.payMonth) },
                  { key: 'gross', label: 'Gross', className: 'num', render: (r) => fmt.money(r.gross) },
                  { key: 'net', label: 'Net', className: 'num', render: (r) => fmt.money(r.net) },
                  { key: 'status', label: 'Payslip', render: (r) => <Status value={r.status === 'Released' ? 'Released' : 'Pending'} /> },
                ]} />
            )}
          </div>
        </>
      ) : null}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Create / edit employee
// ---------------------------------------------------------------------------
interface EmpForm {
  fullName: string; gender: string; phone: string; email: string; campusId: string; department: string; designation: string;
  employeeType: string; category: string; shiftName: string; joinDate: string; employmentStatus: string; basicSalary: string;
  bankAccountMasked: string; workloadPeriods: string; backgroundVerified: boolean; qualification: string; specialisation: string;
  maxPeriodsWeek: string; licenceNoMasked: string; licenceExpiry: string;
}

export function EmployeeFormModal({ employee, onClose }: { employee?: EmployeeDetail; onClose: () => void }) {
  const { lookups } = useLookups();
  const { campusId } = useSchool();
  const { can } = useAuth();
  const shifts = useApiQuery<Shift[]>('/workforce/shifts');
  const e = employee;
  const [f, setF] = useState<EmpForm>({
    fullName: e?.fullName ?? '', gender: e?.gender ?? '', phone: e?.phone ?? '', email: e?.email ?? '',
    campusId: e?.campusId ?? campusId ?? '', department: e?.department ?? '', designation: e?.designation ?? '',
    employeeType: e?.employeeType ?? 'teaching', category: e?.category ?? 'Teachers', shiftName: e?.shift ?? '',
    joinDate: e?.joinDate ?? todayKey(), employmentStatus: e?.employmentStatus ?? 'active',
    basicSalary: e?.basicSalary != null ? String(e.basicSalary) : '', bankAccountMasked: e?.bankAccount ?? '',
    workloadPeriods: String(e?.workload ?? 0), backgroundVerified: e?.backgroundVerified ?? false,
    qualification: e?.qualification ?? '', specialisation: e?.specialisation ?? '', maxPeriodsWeek: String(e?.maxPeriodsWeek ?? 27),
    licenceNoMasked: e?.licenceNoMasked ?? '', licenceExpiry: e?.licenceExpiry ?? '',
  });
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof EmpForm>(k: K, v: EmpForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const showSalary = !e || e.basicSalary !== undefined || can('payroll.read');

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    if (f.fullName.trim().length < 2) out.fullName = 'Enter the full name';
    if (!f.campusId) out.campusId = 'Choose a campus';
    if (!f.department.trim()) out.department = 'Enter the department';
    if (!f.designation.trim()) out.designation = 'Enter the designation';
    if (showSalary && (f.basicSalary === '' || Number.isNaN(Number(f.basicSalary)) || Number(f.basicSalary) < 0)) out.basicSalary = 'Enter the monthly basic salary';
    if (f.phone && !/^\+?[0-9 ]{8,16}$/.test(f.phone)) out.phone = 'Enter a valid phone number';
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) out.email = 'Enter a valid email';
    if (f.bankAccountMasked && !/^[X0-9 ]{4,24}$/.test(f.bankAccountMasked)) out.bankAccountMasked = 'Masked number only, e.g. XXXXXX4417';
    if (f.employeeType === 'teaching' && (Number(f.maxPeriodsWeek) < 1 || Number(f.maxPeriodsWeek) > 60)) out.maxPeriodsWeek = 'Between 1 and 60';
    return out;
  }, [f, showSalary]);

  const body = () => {
    const b: Record<string, unknown> = {
      fullName: f.fullName.trim(), gender: f.gender || null, phone: f.phone || null, email: f.email || null, campusId: f.campusId,
      department: f.department.trim(), designation: f.designation.trim(), employeeType: f.employeeType, category: f.category,
      shiftName: f.shiftName || null, joinDate: f.joinDate || null, employmentStatus: f.employmentStatus,
      bankAccountMasked: f.bankAccountMasked || null, workloadPeriods: Number(f.workloadPeriods) || 0, backgroundVerified: f.backgroundVerified,
    };
    if (showSalary) b.basicSalary = Number(f.basicSalary);
    if (f.employeeType === 'teaching') Object.assign(b, { qualification: f.qualification || null, specialisation: f.specialisation || null, maxPeriodsWeek: Number(f.maxPeriodsWeek) });
    else Object.assign(b, { licenceNoMasked: f.licenceNoMasked || null, licenceExpiry: f.licenceExpiry || null });
    return b;
  };
  const save = useApiMutation<void, { code?: string }>(e ? 'put' : 'post', e ? `/workforce/employees/${e.id}` : '/workforce/employees', {
    invalidate: ['/workforce'], body,
    success: (r) => (e ? 'Employee updated' : `Employee ${r.data?.code ?? ''} created`),
    onSuccess: onClose,
  });
  const server = fieldErrors(save.error);
  const err = (k: string) => (touched ? errors[k] : undefined) ?? server[k];

  return (
    <Modal open onClose={onClose} busy={save.isPending} size="wide"
      title={e ? `Edit ${e.fullName}` : 'Add employee'} sub={e ? `${e.code} · changes are audited` : 'Teaching or non-teaching — one record from recruitment to payslip'}
      foot={<>
        <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button variant="primary" icon="check" loading={save.isPending} onClick={() => { setTouched(true); if (!Object.keys(errors).length) save.mutate(); }}>
          {e ? 'Save changes' : 'Create employee'}
        </Button>
      </>}>
      {save.error && !Object.keys(server).length && <div className="mb-3"><InlineError error={save.error} /></div>}
      <div className="formsection">
        <div className="formsection__title">Personal details</div>
        <div className="form-grid">
        <TextField label="Full name" required value={f.fullName} onChange={(v) => set('fullName', v)} error={err('fullName')} maxLength={120} />
        <SelectField label="Gender" value={f.gender} onChange={(v) => set('gender', v)} placeholder="Not stated" options={[{ value: 'F', label: 'Female' }, { value: 'M', label: 'Male' }, { value: 'O', label: 'Other' }]} />
        <TextField label="Phone" value={f.phone} onChange={(v) => set('phone', v)} error={err('phone')} placeholder="+91…" />
        <TextField label="Work email" type="email" value={f.email} onChange={(v) => set('email', v)} error={err('email')} />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Employment</div>
        <div className="form-grid">
        <SelectField label="Category" required value={f.employeeType} onChange={(v) => { set('employeeType', v); set('category', v === 'teaching' ? 'Teachers' : 'Reception & Admin'); }}
          options={[{ value: 'teaching', label: 'Teaching' }, { value: 'non_teaching', label: 'Non-Teaching' }]} />
        <SelectField label="Staff group" required value={f.category} onChange={(v) => set('category', v)} options={CATEGORIES} />
        <SelectField label="Campus" required value={f.campusId} onChange={(v) => set('campusId', v)} placeholder="Choose campus" error={err('campusId')}
          options={(lookups?.campuses ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <SelectField label="Shift" value={f.shiftName} onChange={(v) => set('shiftName', v)} placeholder="No fixed shift"
          options={(shifts.data ?? []).map((s) => s.name)} />
        <TextField label="Department" required value={f.department} onChange={(v) => set('department', v)} error={err('department')} maxLength={60} />
        <TextField label="Designation" required value={f.designation} onChange={(v) => set('designation', v)} error={err('designation')} maxLength={80} />
        <TextField label="Join date" type="date" value={f.joinDate} onChange={(v) => set('joinDate', v)} />
        <SelectField label="Employment status" value={f.employmentStatus} onChange={(v) => set('employmentStatus', v)}
          options={[{ value: 'active', label: 'Active' }, { value: 'on_notice', label: 'On notice' }, { value: 'exited', label: 'Exited' }]} />
        </div>
      </div>
      {showSalary && (
        <div className="formsection">
          <div className="formsection__title">Pay</div>
          <div className="form-grid">
        <TextField label="Basic salary (₹ / month)" required type="number" min={0} value={f.basicSalary} onChange={(v) => set('basicSalary', v)} error={err('basicSalary')} />
        <TextField label="Bank account (masked)" value={f.bankAccountMasked} onChange={(v) => set('bankAccountMasked', v)} error={err('bankAccountMasked')} placeholder="XXXXXX4417" hint="Never enter a full account number" />
          </div>
        </div>
      )}
      <div className="formsection">
        <div className="formsection__title">{f.employeeType === 'teaching' ? 'Teaching' : 'Role requirements'}</div>
        <div className="form-grid">
        {f.employeeType === 'teaching' ? (
          <>
            <TextField label="Qualification" value={f.qualification} onChange={(v) => set('qualification', v)} />
            <TextField label="Specialisation" value={f.specialisation} onChange={(v) => set('specialisation', v)} />
            <TextField label="Recorded periods / week" type="number" min={0} max={60} value={f.workloadPeriods} onChange={(v) => set('workloadPeriods', v)} />
            <TextField label="Maximum periods / week" type="number" min={1} max={60} value={f.maxPeriodsWeek} onChange={(v) => set('maxPeriodsWeek', v)} error={err('maxPeriodsWeek')} />
          </>
        ) : (
          <>
            <TextField label="Driving licence (masked)" value={f.licenceNoMasked} onChange={(v) => set('licenceNoMasked', v)} hint="Drivers only" />
            <TextField label="Licence expiry" type="date" value={f.licenceExpiry} onChange={(v) => set('licenceExpiry', v)} />
          </>
        )}
        <div className="field span-2"><Checkbox checked={f.backgroundVerified} onChange={(v) => set('backgroundVerified', v)} label="Background verification completed" /></div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Leave application (self-service or HR on behalf of an employee)
// ---------------------------------------------------------------------------
export function LeaveApplyModal({ mode, onClose }: { mode: 'self' | 'hr'; onClose: () => void }) {
  const self = mode === 'self';
  const { lookups } = useLookups();
  const balances = useApiQuery<LeaveBalance[]>(self ? '/me/leave-balances' : null);
  const types = useApiQuery<LeaveType[]>(self ? null : '/workforce/leave-types');
  const start = todayKey();
  const [f, setF] = useState({ employeeId: '', leaveTypeId: '', cover: 'Team rota', coverName: '', fromDate: start, toDate: start, halfDay: false, reason: '' });
  const [touched, setTouched] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const typeOptions = self
    ? (balances.data ?? []).map((b) => ({ value: b.leaveTypeId, label: `${b.type} — ${b.balance} of ${b.entitled} days left` }))
    : (types.data ?? []).map((t) => ({ value: t.id, label: t.name }));
  const errors: Record<string, string> = {};
  if (!self && !f.employeeId) errors.employeeId = 'Choose the employee';
  if (!f.leaveTypeId) errors.leaveTypeId = 'Choose a leave type';
  if (!f.fromDate) errors.fromDate = 'Required';
  if (!f.toDate) errors.toDate = 'Required';
  if (f.fromDate && f.toDate && f.toDate < f.fromDate) errors.toDate = 'End date must be on or after the start date';
  if (f.halfDay && f.fromDate !== f.toDate) errors.halfDay = 'A half day starts and ends on the same date';
  if (f.reason.trim().length < 3) errors.reason = 'Give a short reason';
  if (f.cover === 'Named colleague' && !f.coverName.trim()) errors.coverName = 'Name the colleague';
  const selected = balances.data?.find((b) => b.leaveTypeId === f.leaveTypeId);

  const submit = useApiMutation<void, { code: string }>('post', self ? '/me/leave-requests' : '/workforce/leave-requests', {
    invalidate: self ? ['/me'] : ['/workforce'],
    body: () => ({
      ...(self ? {} : { employeeId: f.employeeId }),
      leaveTypeId: f.leaveTypeId, fromDate: f.fromDate, toDate: f.toDate, halfDay: f.halfDay || undefined, reason: f.reason.trim(),
      coverArrangement: f.cover === 'Named colleague' ? f.coverName.trim() : f.cover === 'Not required' ? null : f.cover,
    }),
    onSuccess: onClose,
  });
  const server = fieldErrors(submit.error);
  const err = (k: string) => (touched ? errors[k] : undefined) ?? server[k];

  return (
    <Modal open onClose={onClose} busy={submit.isPending} title="Apply for leave"
      sub={self ? 'Your request goes to HR for review' : 'Recorded on behalf of an employee'}
      foot={<>
        <Button onClick={onClose} disabled={submit.isPending}>Cancel</Button>
        <Button variant="primary" icon="send" loading={submit.isPending} onClick={() => { setTouched(true); if (!Object.keys(errors).length) submit.mutate(); }}>Submit request</Button>
      </>}>
      {submit.error && !Object.keys(server).length && <div className="mb-3"><InlineError error={submit.error} /></div>}
      <div className="grid g-2col g-3">
        {!self && (
          <SelectField label="Employee" required value={f.employeeId} onChange={(v) => set('employeeId', v)} placeholder="Choose employee" error={err('employeeId')}
            options={(lookups?.staff ?? []).map((s) => ({ value: s.id, label: `${s.fullName} — ${s.designation}` }))} className="span-2" />
        )}
        <SelectField label="Leave type" required value={f.leaveTypeId} onChange={(v) => set('leaveTypeId', v)} placeholder="Choose type" error={err('leaveTypeId')} options={typeOptions} />
        <SelectField label="Cover arrangement" value={f.cover} onChange={(v) => set('cover', v)} options={COVER_OPTIONS} />
        <TextField label="From" type="date" required value={f.fromDate} onChange={(v) => set('fromDate', v)} error={err('fromDate')} />
        <TextField label="To" type="date" required value={f.toDate} min={f.fromDate} onChange={(v) => set('toDate', v)} error={err('toDate')} />
        {f.cover === 'Named colleague' && <TextField label="Colleague covering" required value={f.coverName} onChange={(v) => set('coverName', v)} error={err('coverName')} />}
      </div>
      <div className="mt-3">
        <Checkbox checked={f.halfDay} onChange={(v) => set('halfDay', v)} label="Half day" />
        {err('halfDay') && <div className="hint hint--error" role="alert">{err('halfDay')}</div>}
      </div>
      <div className="mt-3"><TextArea label="Reason" required rows={3} value={f.reason} onChange={(v) => set('reason', v)} error={err('reason')} maxLength={500} /></div>
      {selected && selected.balance <= 0 && <div className="mt-3"><Banner tone="warning" icon="alert">No {selected.type.toLowerCase()} left this year.</Banner></div>}
      <div className="mt-3"><Flow steps={[{ label: 'Draft', state: 'active' }, { label: 'Submitted' }, { label: 'Under Review' }, { label: 'Approved / Rejected' }]} /></div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Payslip
// ---------------------------------------------------------------------------
function MoneyLine({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="payslip__line">
      <span className="t-sm">{label}</span>
      <span className="t-num">{fmt.money(amount)}</span>
    </div>
  );
}

export function PayslipDocument({ slip }: { slip: Payslip }) {
  return (
    <div className="payslip">
      <div className="grid g-2col g-5">
        <div>
          <div className="eyebrow mb-3">Earnings</div>
          {slip.earnings.map((e) => <MoneyLine key={e.label} {...e} />)}
          <div className="payslip__subtotal"><span className="t-bold">Gross</span><span className="t-bold t-num">{fmt.money(slip.gross)}</span></div>
        </div>
        <div>
          <div className="eyebrow mb-3">Deductions</div>
          {slip.deductions.map((e) => <MoneyLine key={e.label} {...e} />)}
          <div className="payslip__subtotal"><span className="t-bold">Total deductions</span><span className="t-bold t-num">{fmt.money(slip.totalDeductions)}</span></div>
        </div>
      </div>
      <div className="card card--tint mt-5 payslip__net">
        <span className="t-bold">Net pay</span>
        <span className="payslip__net-value">{fmt.money(slip.net)}</span>
      </div>
      <div className="mt-4">
        <Dl items={[
          ['Days worked', `${slip.daysWorked} of ${slip.workingDays}`],
          ['Leave taken', `${slip.leaveDays} day${slip.leaveDays === 1 ? '' : 's'}`],
          ['Overtime', `${slip.overtimeHours} hours`],
          ['Payment date', slip.paymentDate ? fmt.date(slip.paymentDate) : `Scheduled ${fmt.date(slip.monthEnd)}`],
          ['Bank account', slip.bankAccount ?? '—'],
          ['Payslip status', <Status key="s" value={slip.status === 'Released' ? 'Released' : 'Pending'} />],
        ]} />
      </div>
    </div>
  );
}

export function PayslipModal({ id, self, onClose }: { id: string; self?: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const q = useApiQuery<Payslip>(self ? `/me/payslips/${id}` : `/payslips/${id}`);
  const s = q.data;
  return (
    <Modal open onClose={onClose} size="wide"
      title={s ? `Payslip — ${s.monthLabel}` : 'Payslip'}
      sub={s ? `${s.employeeName} · ${s.employeeCode} · ${s.designation}` : undefined}
      foot={<>
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" icon="printer" disabled={!s} onClick={() => navigate(self ? `/staff-self/payslips/${id}` : `/payslips/${id}`)}>Printable payslip</Button>
      </>}>
      {q.isLoading ? <Skeleton height={320} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : s ? (
        <>
          {s.status !== 'Released' && <div className="mb-4"><Banner tone="warning" icon="alert">Not yet released — figures may change until the run is approved.</Banner></div>}
          <PayslipDocument slip={s} />
        </>
      ) : <Empty icon="receipt" title="Payslip not found" sub="It may belong to a run that was recalculated." />}
    </Modal>
  );
}
