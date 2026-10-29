import { useEffect, useMemo, useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useApiQuery, useInvalidate } from '@/hooks/useApi';
import { useSchool } from '@/layouts/SchoolContext';
import { Badge, Banner, Button, IconButton, InlineError, Modal, SelectField, Skeleton, TextField, useToast } from '@/components/ui';
import { fmt } from '@/lib/format';
import { monthLabel } from './shared';

interface SalaryData {
  employee: { id: string; name: string; code: string; designation: string; department: string; campus: string | null; basic: number };
  basic: number;
  allowances: { id: string; type: string; amount: number; status: 'Approved' | 'Submitted'; effectiveMonth: string }[];
}
interface Attendance {
  month: string; workingDays: number; present: number; late: number; onLeave: number; halfDay: number; absent: number; unmarked: number; unpaidDays: number;
}
interface Preview {
  earnings: { label: string; amount: number }[]; deductions: { label: string; amount: number }[]; gross: number; totalDeductions: number; net: number;
  attendance: Attendance | null;
}
interface Row { type: string; amount: string; pending?: number }

/** Allowance names already used in the school, offered first. */
const COMMON = ['House rent allowance', 'Conveyance', 'Special allowance', 'Transport duty', 'Uniform allowance', 'CPD allowance'];
const thisMonth = () => new Date().toISOString().slice(0, 7) + '-01';
const lastMonths = (n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
  return d.toISOString().slice(0, 7) + '-01';
});
const nextMonths = (n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + i);
  return d.toISOString().slice(0, 7) + '-01';
});

/**
 * Set an employee's salary: basic pay and monthly allowances, with a live payslip preview.
 * Opened with an employee, or with none to pick one first (e.g. new staff without a payslip yet).
 */
export function SetSalaryModal({ employeeId, onClose }: { employeeId?: string; onClose: () => void }) {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [picked, setPicked] = useState(employeeId ?? '');
  const staff = useApiQuery<{ id: string; code: string; fullName: string; designation: string }[]>(
    employeeId ? null : '/workforce/employees', { ...campusParam, employmentStatus: 'active', pageSize: 200, sort: 'name' });
  const q = useApiQuery<SalaryData>(picked ? `/payroll/salary/${picked}` : null);
  const [basic, setBasic] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [month, setMonth] = useState(thisMonth());
  // The month whose attendance the preview deducts loss of pay for.
  const [attMonth, setAttMonth] = useState(thisMonth());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const approver = can('approvals.decide');

  // Load the current salary: approved amounts, with any pending proposal shown alongside.
  useEffect(() => {
    if (!q.data) return;
    setBasic(String(q.data.basic));
    const byType = new Map<string, Row>();
    for (const a of q.data.allowances) {
      const r = byType.get(a.type) ?? { type: a.type, amount: '' };
      if (a.status === 'Approved') r.amount = String(a.amount); else r.pending = a.amount;
      if (!r.amount && a.status === 'Submitted') r.amount = String(a.amount);
      byType.set(a.type, r);
    }
    setRows([...byType.values()]);
    setError(null);
  }, [q.data]);

  const clean = useMemo(() => rows.filter((r) => r.type.trim()).map((r) => ({ type: r.type.trim(), amount: Number(r.amount) || 0 })), [rows]);
  const basicNum = Number(basic);
  const problems = {
    basic: !(basicNum >= 0) || basic.trim() === '' ? 'Enter the basic monthly pay' : undefined,
    duplicate: new Set(clean.map((r) => r.type.toLowerCase())).size !== clean.length ? 'Each allowance can be listed once' : undefined,
    short: rows.some((r) => r.amount && r.type.trim().length < 2) ? 'Give each allowance a name' : undefined,
  };

  // Live preview of the month's regular pay, using the same calculation as payroll.
  useEffect(() => {
    if (!q.data || problems.basic) return;
    const t = setTimeout(() => {
      api.post<Preview>('/payroll/salary-preview', { basicSalary: basicNum, allowances: clean, employeeId: picked, month: attMonth })
        .then((r) => setPreview(r.data)).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [basicNum, clean, q.data, problems.basic, picked, attMonth]);

  const save = async () => {
    if (problems.basic || problems.duplicate || problems.short) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api.put<unknown>(`/payroll/salary/${picked}`, { basicSalary: basicNum, allowances: clean, effectiveMonth: month });
      toast(r.message || 'Salary saved', 'success');
      await invalidate('/payroll', '/payslips', '/finance/allowances', '/workforce');
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  const e = q.data?.employee;
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const unused = COMMON.filter((c) => !rows.some((r) => r.type.toLowerCase() === c.toLowerCase()));

  return (
    <Modal open onClose={onClose} size="wide" busy={saving} title={e ? `Set salary — ${e.name}` : 'Set salary'}
      sub={e ? `${e.code} · ${e.designation} · ${e.department}${e.campus ? ` · ${e.campus}` : ''}` : 'Choose the employee, then their basic pay and monthly allowances.'}
      foot={<>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" icon="check" loading={saving} disabled={!q.data} onClick={save}>Save salary</Button>
      </>}>
      {!employeeId && (
        <div className="mb-4">
          <SelectField label="Employee" required value={picked} onChange={setPicked} placeholder={staff.isLoading ? 'Loading…' : 'Choose…'}
            options={(staff.data ?? []).map((s) => ({ value: s.id, label: `${s.fullName} · ${s.code} · ${s.designation}` }))} />
        </div>
      )}
      {!picked ? null : q.isLoading ? <Skeleton height={260} /> : q.error ? <InlineError error={q.error} /> : (
        <div className="grid g-2col g-4" style={{ alignItems: 'start' }}>
          <div className="col g-4">
            {error ? <InlineError error={error} /> : null}
            <TextField label="Basic pay (₹ per month)" required type="number" min="0" step="100" value={basic} onChange={setBasic} error={problems.basic}
              hint="Applies from the next payroll calculation." />
            <div className="field">
              <span className="label">Monthly allowances</span>
              <div className="col g-2">
                {rows.map((r, i) => (
                  <div key={i} className="row g-2 wrap" style={{ alignItems: 'flex-start' }}>
                    <div className="grow" style={{ minWidth: 0 }}><TextField label="Allowance" value={r.type} onChange={(v) => set(i, { type: v })} maxLength={60} placeholder="e.g. House rent allowance" /></div>
                    <div style={{ width: 130 }}><TextField label="₹ per month" type="number" min="0" step="50" value={r.amount} onChange={(v) => set(i, { amount: v })} /></div>
                    <div style={{ paddingTop: 26 }}><IconButton icon="trash" label={`Remove ${r.type || 'allowance'}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} /></div>
                    {r.pending != null && <div className="t-micro" style={{ flexBasis: '100%' }}><Badge tone="warning">Awaiting approval: {fmt.money(r.pending)}</Badge></div>}
                  </div>
                ))}
                {!rows.length && <span className="t-sm t-muted">No monthly allowances yet.</span>}
                <div className="row g-2 wrap">
                  <Button size="sm" icon="plus" onClick={() => setRows((rs) => [...rs, { type: unused[0] ?? '', amount: '' }])}>Add allowance</Button>
                </div>
                {(problems.duplicate || problems.short) && <span className="field__error" role="alert">{problems.duplicate ?? problems.short}</span>}
              </div>
            </div>
            <SelectField label="Allowance changes take effect from" value={month} onChange={setMonth}
              options={nextMonths(4).map((m) => ({ value: m, label: monthLabel(m) }))} />
            <Banner tone={approver ? 'neutral' : 'warning'} icon={approver ? 'check' : 'clock'}>
              {approver
                ? 'Your allowance changes apply as soon as you save.'
                : 'New or changed allowances go to the Super Admin for approval; the current amounts are paid until then. Removing an allowance stops it straight away.'}
            </Banner>
          </div>

          <div className="card card--tint" style={{ padding: 16 }}>
            <div className="row between g-2 wrap mb-2" style={{ alignItems: 'center' }}>
              <span className="t-bold">Monthly payslip preview</span>
              <select className="select" style={{ width: 'auto', padding: '4px 28px 4px 10px', fontSize: 13 }} aria-label="Attendance month"
                value={attMonth} onChange={(ev) => setAttMonth(ev.target.value)}>
                {lastMonths(3).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>
            <div className="t-micro t-muted mb-3">Regular pay less loss of pay for that month's attendance — overtime and claims are added in each payroll run.</div>
            {preview?.attendance && <AttendanceLine a={preview.attendance} />}
            {preview ? (
              <div className="col g-1 t-sm">
                {preview.earnings.map((x) => <div key={x.label} className="row between"><span>{x.label}</span><span className="t-num">{fmt.money(x.amount)}</span></div>)}
                <div className="row between t-bold mt-1" style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}><span>Gross pay</span><span className="t-num">{fmt.money(preview.gross)}</span></div>
                {preview.deductions.map((x) => <div key={x.label} className="row between t-muted"><span>{x.label}</span><span className="t-num">− {fmt.money(x.amount)}</span></div>)}
                <div className="row between t-bold mt-1" style={{ borderTop: '1px solid var(--border)', paddingTop: 6, fontSize: 16 }}>
                  <span>Net pay</span><span className="t-num t-success">{fmt.money(preview.net)}</span>
                </div>
                {e && preview.gross !== undefined && (
                  <div className="t-micro t-muted mt-2">Annual gross {fmt.money(preview.gross * 12)}</div>
                )}
              </div>
            ) : <Skeleton height={180} />}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** The month's attendance and the unpaid days loss of pay is based on. */
function AttendanceLine({ a }: { a: Attendance }) {
  const parts: [string, number, string?][] = [
    ['Present', a.present + a.late], ['On leave', a.onLeave], ['Half day', a.halfDay, 'var(--caution)'], ['Absent', a.absent, 'var(--critical)'],
  ];
  return (
    <div className="mb-3" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="row between t-sm"><span className="t-bold">Attendance</span><span className="t-muted">{a.workingDays} working days</span></div>
      <div className="row g-3 wrap t-micro mt-1">
        {parts.map(([label, n, color]) => (
          <span key={label} style={{ color: n && color ? color : undefined }}>{label} <strong>{n}</strong></span>
        ))}
        {a.unmarked > 0 && <span className="t-muted">Not marked <strong>{a.unmarked}</strong></span>}
      </div>
      <div className={`t-micro mt-1 ${a.unpaidDays ? 't-critical' : 't-success'}`}>
        {a.unpaidDays ? `${a.unpaidDays} unpaid day${a.unpaidDays === 1 ? '' : 's'} — deducted as loss of pay` : 'No unpaid days — full pay'}
        {a.unmarked > 0 ? ' · days not marked are not deducted' : ''}
      </div>
    </div>
  );
}
