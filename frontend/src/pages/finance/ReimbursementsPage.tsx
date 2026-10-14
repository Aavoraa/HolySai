import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { fmt } from '@/lib/format';
import {
  Button, Card, DataTable, ErrorState, FilterSelect, Grid, Kpi, Modal, Page, PageHead, Pagination, Person, SearchInput,
  SelectField, Status, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import type { ReimbursementRow, ReimbursementSummary } from './types';
import { fieldErrors, isMoney, ListCount, Money, ReasonModal, todayIso, useFinanceLookups } from './shared';

const CLAIM_TYPES = ['Travel', 'Training', 'Supplies', 'Medical', 'Transport', 'Other'];

export default function ReimbursementsPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const list = useListParams({ sort: 'date', dir: 'desc' }, ['status', 'claimType']);
  const q = usePagedQuery<ReimbursementRow>('/finance/reimbursements', { ...list.query, ...campusParam });
  const s = useApiQuery<ReimbursementSummary>('/finance/reimbursements/summary', campusParam);
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [rejecting, setRejecting] = useState<ReimbursementRow | null>(null);
  const opts = { invalidate: ['/finance/reimbursements'], body: () => ({}) };
  const act = {
    review: useApiMutation<string>('post', (id) => `/finance/reimbursements/${id}/review`, opts),
    approve: useApiMutation<string>('post', (id) => `/finance/reimbursements/${id}/approve`, opts),
    pay: useApiMutation<string>('post', (id) => `/finance/reimbursements/${id}/pay`, opts),
  };
  const reject = useApiMutation<{ id: string; reason: string }>('post', (v) => `/finance/reimbursements/${v.id}/reject`, {
    invalidate: ['/finance/reimbursements'], body: (v) => ({ reason: v.reason }), onSuccess: () => setRejecting(null),
  });
  const busy = (k: keyof typeof act, id: string) => act[k].isPending && act[k].variables === id;
  const d = s.data;

  return (
    <Page>
      <PageHead title="Reimbursements" sub="Staff claims for money already spent, on the same approval path as expenses."
        actions={can('finance.manage') && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Record a claim</Button>} />
      <Grid cols="g-4col">
        <Kpi icon="clock" label="Awaiting decision" value={d?.pending ?? '—'} tone="amber" loading={s.isLoading} foot={d ? fmt.money(d.pendingValue) : undefined}
          onClick={() => list.setFilter('status', 'Under Review')} />
        <Kpi icon="checkSquare" label="Approved, to be paid" value={fmt.money(d?.approvedUnpaid, { compact: true })} tone="info" loading={s.isLoading} foot="Paid with the next payroll run"
          onClick={() => list.setFilter('status', 'Approved')} />
        <Kpi icon="wallet" label="Paid this month" value={fmt.money(d?.paidThisMonth, { compact: true })} tone="teal" loading={s.isLoading} />
        <Kpi icon="x" label="Rejected" value={d?.rejected ?? '—'} tone="critical" loading={s.isLoading} onClick={() => list.setFilter('status', 'Rejected')} />
      </Grid>
      <Card flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search reference, claim or employee" />
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={['Submitted', 'Under Review', 'Approved', 'Rejected', 'Paid']} />
          <FilterSelect label="Type" value={list.filters.claimType} onChange={(v) => list.setFilter('claimType', v)} options={CLAIM_TYPES} />
          {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
          <div className="spacer" />
          <ListCount total={q.data?.meta.total} noun="claims" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable rows={q.data?.rows} loading={q.isLoading || q.isPlaceholderData} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            emptyText={list.hasFilters ? 'No claims match the current filters.' : 'No reimbursement claims yet.'}
            columns={[
              { key: 'code', label: 'Reference', render: (r) => <span className="t-num">{r.code}</span> },
              { key: 'employee', label: 'Employee', render: (r) => <Person name={r.employee} meta={r.department} /> },
              { key: 'what', label: 'Claim', sortable: false, render: (r) => <>{r.description}<div className="t-micro t-muted">{r.claimType}</div></> },
              { key: 'amount', label: 'Amount', className: 'num', render: (r) => <Money v={r.amount} strong /> },
              { key: 'date', label: 'Submitted', render: (r) => fmt.date(r.claimDate) },
              { key: 'status', label: 'Status', render: (r) => <><Status value={r.status} />{r.decidedBy && <div className="t-micro t-muted">{r.decidedBy}</div>}</> },
              {
                key: 'a', label: '', className: 'num', sortable: false, render: (r) => (
                  <div className="row g-2 end">
                    {r.status === 'Submitted' && can('finance.approve') && <Button size="sm" variant="quiet" loading={busy('review', r.id)} onClick={() => act.review.mutate(r.id)}>Review</Button>}
                    {['Submitted', 'Under Review'].includes(r.status) && can('finance.approve') && <>
                      <Button size="sm" variant="teal" icon="check" loading={busy('approve', r.id)} onClick={async () => {
                        if (await confirm({ title: `Approve ${r.code}?`, body: `${r.employee} will be reimbursed ${fmt.money(r.amount)} with the next payroll run.`, confirmLabel: 'Approve', icon: 'check' })) act.approve.mutate(r.id);
                      }}>Approve</Button>
                      <Button size="sm" icon="x" onClick={() => setRejecting(r)}>Reject</Button>
                    </>}
                    {r.status === 'Approved' && can('finance.manage') && (
                      <Button size="sm" loading={busy('pay', r.id)} onClick={async () => {
                        if (await confirm({ title: `Mark ${r.code} as paid?`, body: `Confirm ${fmt.money(r.amount)} has been paid to ${r.employee}.`, confirmLabel: 'Mark paid' })) act.pay.mutate(r.id);
                      }}>Mark paid</Button>
                    )}
                  </div>
                ),
              },
            ]} />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      <ReasonModal open={!!rejecting} title={`Reject ${rejecting?.code ?? ''}`} sub={rejecting ? `${rejecting.employee} · ${fmt.money(rejecting.amount)}` : ''}
        confirmLabel="Reject" danger busy={reject.isPending} onClose={() => setRejecting(null)}
        onSubmit={(reason) => rejecting && reject.mutate({ id: rejecting.id, reason })} />
      <ClaimModal open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}

function ClaimModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const lk = useFinanceLookups();
  const init = () => ({ employeeId: '', claimType: 'Travel', description: '', amount: '', claimDate: todayIso() });
  const [f, setF] = useState(init);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setF(init()); setTouched(false); } }, [open]);
  const save = useApiMutation<Record<string, unknown>, { code: string }>('post', '/finance/reimbursements', {
    invalidate: ['/finance/reimbursements'], onSuccess: onClose, success: (r) => `Claim ${r.data.code} recorded`,
  });
  const problems = {
    employeeId: !f.employeeId && 'Choose the employee.',
    description: f.description.trim().length < 3 && 'Describe what was paid for.',
    amount: !isMoney(f.amount) && 'Enter an amount greater than zero.',
    claimDate: (!f.claimDate || f.claimDate > todayIso()) && 'Choose a date that is not in the future.',
  };
  const errs: Record<string, string> = { ...fieldErrors(save.error) };
  if (touched) for (const [k, v] of Object.entries(problems)) if (v) errs[k] = v;
  const set = (k: keyof ReturnType<typeof init>) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal open={open} onClose={onClose} busy={save.isPending} title="Record a claim" sub="The claim is submitted for approval."
      foot={<>
        <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={() => {
          setTouched(true);
          if (Object.values(problems).some(Boolean)) return;
          save.mutate({ ...f, description: f.description.trim(), amount: Number(f.amount) });
        }}>Submit claim</Button>
      </>}>
      <div className="col g-3">
        <SelectField label="Employee" required value={f.employeeId} onChange={set('employeeId')} placeholder="Choose…" error={errs.employeeId}
          options={(lk.data?.employees ?? []).map((e) => ({ value: e.id, label: `${e.fullName} · ${e.department}` }))} />
        <SelectField label="Claim type" required value={f.claimType} onChange={set('claimType')} options={CLAIM_TYPES} />
        <TextField label="Description" required value={f.description} onChange={set('description')} maxLength={200} error={errs.description} />
        <div className="grid g-2col">
          <TextField label="Amount (₹)" required type="number" min="0" step="0.01" value={f.amount} onChange={set('amount')} error={errs.amount} />
          <TextField label="Date spent" required type="date" max={todayIso()} value={f.claimDate} onChange={set('claimDate')} error={errs.claimDate} />
        </div>
      </div>
    </Modal>
  );
}
