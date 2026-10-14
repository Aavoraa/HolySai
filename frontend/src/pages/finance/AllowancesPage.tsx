import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { fmt } from '@/lib/format';
import {
  Banner, Button, Card, DataTable, ErrorState, Modal, Page, PageHead, Pagination, Person, Segment, SelectField, Status,
  TextField, useConfirm,
} from '@/components/ui';
import type { AllowanceRow, AllowanceSummaryRow } from './types';
import { fieldErrors, Money, TotalsBar, useFinanceLookups } from './shared';

/** Serves both /allowances (Finance) and /staff-allowances (HR); the wireframe renders the same page with different copy. */
export default function AllowancesPage({ sub }: { sub: string }) {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const q = useApiQuery<AllowanceSummaryRow[]>('/finance/allowances/summary', campusParam);
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const canManage = can(['finance.manage', 'hr.manage']);
  const canApprove = can(['finance.approve', 'hr.approve']);
  const rows = q.data ?? [];
  const pending = rows.filter((r) => r.pendingCount > 0);
  const decide = useApiMutation<{ allowanceType: string; decision: string }>('post', '/finance/allowances/decide', {
    invalidate: ['/finance/allowances'], body: (v) => ({ ...v, ...campusParam }),
  });
  const ask = async (r: AllowanceSummaryRow, decision: 'Approved' | 'Rejected' | 'Stopped') => {
    const text = {
      Approved: [`Approve "${r.allowanceType}"?`, `${r.pendingCount} proposed allowance(s) worth ${fmt.money(r.pendingCost)} a month will be included from the next payroll run.`, 'Approve'],
      Rejected: [`Reject "${r.allowanceType}"?`, `${r.pendingCount} proposed allowance(s) will be rejected and not paid.`, 'Reject'],
      Stopped: [`Stop "${r.allowanceType}"?`, `The allowance stops for ${r.employees} employee(s) from the next payroll run.`, 'Stop allowance'],
    }[decision];
    if (await confirm({ title: text[0], body: text[1], confirmLabel: text[2], danger: decision !== 'Approved' })) {
      decide.mutate({ allowanceType: r.allowanceType, decision });
    }
  };

  return (
    <Page>
      <PageHead title="Allowances" sub={sub}
        actions={canManage && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Add allowance</Button>} />
      {pending.length > 0 && (
        <div className="mb-4"><Banner tone="warning" icon="clock">
          <strong>{pending.reduce((acc, r) => acc + r.pendingCount, 0)} proposed allowance(s) awaiting approval</strong> across {pending.length} type{pending.length === 1 ? '' : 's'} — {fmt.money(pending.reduce((acc, r) => acc + r.pendingCost, 0))} a month.{canApprove ? ' Approve or reject them below.' : ''}
        </Banner></div>
      )}
      <Card flush
        foot={rows.length ? <TotalsBar items={[
          { label: 'Employees', value: fmt.n(rows.reduce((acc, r) => acc + r.employees, 0)) },
          { label: 'Monthly cost', value: fmt.money(rows.reduce((acc, r) => acc + r.monthlyCost, 0)) },
          { label: 'Proposed', value: fmt.money(rows.reduce((acc, r) => acc + r.pendingCost, 0)) },
        ]} /> : undefined}>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable rows={q.data} loading={q.isLoading} rowKey={(r) => r.allowanceType} emptyText={canManage ? 'No allowances are configured. Add one to include it in the next payroll run.' : 'No allowances are configured.'}
            onRowClick={(r) => setOpen(r.allowanceType)}
            columns={[
              { key: 'name', label: 'Allowance', render: (r) => <span className="t-bold">{r.allowanceType}</span> },
              { key: 'applies', label: 'Applies to', render: (r) => <span className="t-sm">{r.appliesTo}</span> },
              {
                key: 'amount', label: 'Monthly value', className: 'num', render: (r) => (r.minAmount === r.maxAmount
                  ? <Money v={r.minAmount} />
                  : r.pctOfBasic ? <span>{r.pctOfBasic}% of basic</span> : <span className="t-num">{fmt.money(r.minAmount)}–{fmt.money(r.maxAmount)}</span>),
              },
              { key: 'employees', label: 'Employees', className: 'num' },
              { key: 'total', label: 'Monthly cost', className: 'num', render: (r) => <><Money v={r.monthlyCost} strong />{r.pendingCost > 0 && <div className="t-micro t-muted">+{fmt.money(r.pendingCost)} proposed</div>}</> },
              { key: 'status', label: 'Status', render: (r) => <><Status value={r.status} />{r.pendingCount > 0 && <div className="mt-1"><Status value="Pending" label={`${r.pendingCount} proposed`} /></div>}</> },
              {
                key: 'a', label: '', className: 'num', render: (r) => canApprove && (
                  <div className="row g-2 end" onClick={(e) => e.stopPropagation()}>
                    {r.pendingCount > 0 ? <>
                      <Button size="sm" variant="teal" icon="check" loading={decide.isPending && decide.variables?.allowanceType === r.allowanceType && decide.variables?.decision === 'Approved'} onClick={() => ask(r, 'Approved')}>Approve {r.pendingCount}</Button>
                      <Button size="sm" icon="x" loading={decide.isPending && decide.variables?.allowanceType === r.allowanceType && decide.variables?.decision === 'Rejected'} onClick={() => ask(r, 'Rejected')}>Reject</Button>
                    </> : r.status === 'Active' && <Button size="sm" variant="quiet" onClick={() => ask(r, 'Stopped')}>Stop</Button>}
                  </div>
                ),
              },
            ]} />
        )}
      </Card>
      <div className="mt-3"><Banner tone="neutral" icon="info">Approved monthly allowances are picked up automatically by the next payroll run. Select a row to see each employee.</Banner></div>
      <EmployeesModal type={open} onClose={() => setOpen(null)} />
      <AllowanceModal open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}

function EmployeesModal({ type, onClose }: { type: string | null; onClose: () => void }) {
  const { campusParam } = useSchool();
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [type]);
  const q = usePagedQuery<AllowanceRow>(type ? '/finance/allowances' : null, { allowanceType: type ?? '', page, pageSize: 10, ...campusParam });
  return (
    <Modal open={!!type} onClose={onClose} title={type ?? ''} sub="Employees receiving this allowance" size="wide">
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <DataTable compact rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id}
          columns={[
            { key: 'employee', label: 'Employee', render: (r) => <Person name={r.employee} meta={`${r.category} · ${r.department}`} /> },
            { key: 'amount', label: 'Amount', className: 'num', render: (r) => <Money v={r.amount} /> },
            { key: 'frequency', label: 'Frequency' },
            { key: 'effective', label: 'From', render: (r) => fmt.date(r.effectiveMonth) },
            { key: 'status', label: 'Status', render: (r) => <Status value={r.status === 'Submitted' ? 'Under Review' : r.status} /> },
          ]} />
      )}
      <Pagination meta={q.data?.meta} onPage={setPage} />
    </Modal>
  );
}

function AllowanceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const lk = useFinanceLookups();
  const { campusParam } = useSchool();
  const init = () => ({ allowanceType: '', target: 'category', category: '', employeeType: 'all', employeeId: '', mode: 'amount', value: '', frequency: 'Monthly', effectiveMonth: '' });
  const [f, setF] = useState(init);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setF(init()); setTouched(false); } }, [open]);
  const save = useApiMutation<Record<string, unknown>>('post', '/finance/allowances', { invalidate: ['/finance/allowances'], onSuccess: onClose });
  const num = Number(f.value);
  const problems = {
    allowanceType: f.allowanceType.trim().length < 3 && 'Name the allowance.',
    category: f.target === 'category' && !f.category && 'Choose an employee category.',
    employeeIds: f.target === 'employee' && !f.employeeId && 'Choose an employee.',
    amount: (!/^\d+(\.\d{1,2})?$/.test(f.value) || num <= 0 || (f.mode === 'percent' && num > 100)) && (f.mode === 'percent' ? 'Enter a percentage between 0 and 100.' : 'Enter a monthly amount.'),
    effectiveMonth: !f.effectiveMonth && 'Choose the first month.',
  };
  const errs: Record<string, string> = { ...fieldErrors(save.error) };
  if (touched) for (const [k, v] of Object.entries(problems)) if (v) errs[k] = v;
  const set = (k: keyof ReturnType<typeof init>) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal open={open} onClose={onClose} busy={save.isPending} size="wide" title="Add allowance" sub="Proposed allowances are approved before they reach payroll."
      foot={<>
        <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={() => {
          setTouched(true);
          if (Object.values(problems).some(Boolean)) return;
          save.mutate({
            allowanceType: f.allowanceType.trim(), frequency: f.frequency, effectiveMonth: `${f.effectiveMonth}-01`, ...campusParam,
            ...(f.target === 'category' ? { category: f.category } : f.target === 'type' ? { employeeType: f.employeeType } : { employeeIds: [f.employeeId] }),
            ...(f.mode === 'percent' ? { percentOfBasic: num } : { amount: num }),
          });
        }}>Propose allowance</Button>
      </>}>
      <div className="grid g-2col">
        <TextField label="Allowance name" required value={f.allowanceType} onChange={set('allowanceType')} maxLength={60} error={errs.allowanceType} placeholder="e.g. Night shift allowance" />
        <SelectField label="Frequency" value={f.frequency} onChange={set('frequency')} options={['Monthly', 'One-time']} />
        <div className="field span-2">
          <span className="label">Applies to<span className="req"> *</span></span>
          <Segment items={[{ id: 'category', label: 'Employee category' }, { id: 'type', label: 'Staff type' }, { id: 'employee', label: 'One employee' }]}
            active={f.target} onChange={(v) => setF((x) => ({ ...x, target: v }))} />
        </div>
        {f.target === 'category' && (
          <SelectField label="Category" required value={f.category} onChange={set('category')} placeholder="Choose…" error={errs.category} options={lk.data?.employeeCategories ?? []} />
        )}
        {f.target === 'type' && (
          <SelectField label="Staff type" required value={f.employeeType} onChange={set('employeeType')}
            options={[{ value: 'all', label: 'All staff' }, { value: 'teaching', label: 'Teaching staff' }, { value: 'non_teaching', label: 'Non-teaching staff' }]} />
        )}
        {f.target === 'employee' && (
          <SelectField label="Employee" required value={f.employeeId} onChange={set('employeeId')} placeholder="Choose…" error={errs.employeeIds}
            options={(lk.data?.employees ?? []).map((e) => ({ value: e.id, label: `${e.fullName} · ${e.category}` }))} />
        )}
        <TextField label="First month" required type="month" value={f.effectiveMonth} onChange={set('effectiveMonth')} error={errs.effectiveMonth} />
        <div className="field">
          <span className="label">Value<span className="req"> *</span></span>
          <div className="row g-3">
            <Segment items={[{ id: 'amount', label: '₹ / month' }, { id: 'percent', label: '% of basic' }]} active={f.mode} onChange={(v) => setF((x) => ({ ...x, mode: v }))} />
            <TextField type="number" min="0" step="0.01" value={f.value} onChange={set('value')} error={errs.amount ?? errs.percentOfBasic} className="grow" />
          </div>
        </div>
      </div>
    </Modal>
  );
}
