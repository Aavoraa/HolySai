import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import { fmt } from '@/lib/format';
import {
  Button, Card, Chart, charts, DataTable, Empty, ErrorState, FilterSelect, Flow, Modal, Page, PageHead, Pagination, SearchInput,
  SelectField, Status, Switch, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import { SERIES } from '@/lib/tones';
import type { ExpenseRow, ExpenseSummary } from './types';
import { fieldErrors, isMoney, ListCount, Money, ReasonModal, todayIso, useFinanceLookups } from './shared';

export default function ExpensesPage() {
  const { can, user } = useAuth();
  const { campusParam } = useSchool();
  const list = useListParams({ sort: 'date', dir: 'desc' }, ['status', 'category']);
  const q = usePagedQuery<ExpenseRow>('/finance/expenses', { ...list.query, ...campusParam });
  const s = useApiQuery<ExpenseSummary>('/finance/expenses/summary', campusParam);
  const lk = useFinanceLookups();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [rejecting, setRejecting] = useState<ExpenseRow | null>(null);
  const opts = { invalidate: ['/finance/expenses', '/finance/budgets'], body: () => ({}) };
  const act = {
    submit: useApiMutation<string>('post', (id) => `/finance/expenses/${id}/submit`, opts),
    review: useApiMutation<string>('post', (id) => `/finance/expenses/${id}/review`, opts),
    approve: useApiMutation<string>('post', (id) => `/finance/expenses/${id}/approve`, opts),
    pay: useApiMutation<string>('post', (id) => `/finance/expenses/${id}/pay`, opts),
  };
  const reject = useApiMutation<{ id: string; reason: string }>('post', (v) => `/finance/expenses/${v.id}/reject`, {
    invalidate: ['/finance/expenses'], body: (v) => ({ reason: v.reason }), onSuccess: () => setRejecting(null),
  });
  const busy = (k: keyof typeof act, id: string) => act[k].isPending && act[k].variables === id;
  const f = s.data?.flow;
  const cats = s.data?.byCategory ?? [];

  return (
    <Page>
      <PageHead title="Expenses" sub="Raised by staff, approved by a budget owner, then by Finance."
        actions={can('finance.manage') && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Raise an expense</Button>} />
      <Card>
        <Flow steps={[
          { label: 'Draft', meta: f ? `${f.draft} raised by staff` : 'Raised by staff', state: 'done' },
          { label: 'Submitted', meta: f ? `${f.submitted} waiting` : '…', state: 'done' },
          { label: 'Under Review', meta: f ? `${f.underReview} with a budget owner` : '…', state: 'active' },
          { label: 'Approved', meta: f ? `${f.approvedThisWeek} this week` : '…' },
          { label: 'Rejected', meta: f ? `${f.rejected30d} in 30 days — returned with a reason` : '…' },
        ]} />
      </Card>
      <Card flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search reference or description" />
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={['Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected', 'Paid']} />
          <FilterSelect label="Category" value={list.filters.category} onChange={(v) => list.setFilter('category', v)} options={lk.data?.expenseCategories ?? []} />
          {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
          <div className="spacer" />
          {f && f.pendingValue > 0 && <span className="fw-count">Awaiting decision <strong>{fmt.money(f.pendingValue)}</strong></span>}
          <ListCount total={q.data?.meta.total} noun="expenses" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable rows={q.data?.rows} loading={q.isLoading || q.isPlaceholderData} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            emptyText={list.hasFilters ? 'No expenses match the current filters.' : 'No expenses raised yet.'}
            columns={[
              { key: 'code', label: 'Reference', render: (r) => <span className="t-num">{r.code}</span> },
              { key: 'category', label: 'Expense', render: (r) => <><span className="t-bold">{r.description}</span><div className="t-micro t-muted">{r.category} · {r.campus}{r.vendor ? ` · ${r.vendor}` : ''}</div></> },
              { key: 'amount', label: 'Amount', className: 'num', render: (r) => <Money v={r.amount} strong /> },
              { key: 'by', label: 'Raised by', sortable: false, render: (r) => r.raisedBy ?? '—' },
              { key: 'date', label: 'Date', render: (r) => fmt.date(r.expenseDate) },
              {
                key: 'status', label: 'Status', render: (r) => <>
                  <Status value={r.status} />
                  {r.rejectionReason && <div className="t-micro t-muted fw-note">{r.rejectionReason}</div>}
                  {r.decidedBy && !r.rejectionReason && <div className="t-micro t-muted">{r.decidedBy}</div>}
                </>,
              },
              {
                key: 'a', label: '', className: 'num', sortable: false, render: (r) => (
                  <div className="row g-2 end">
                    {r.status === 'Draft' && can('finance.manage') && <Button size="sm" loading={busy('submit', r.id)} onClick={() => act.submit.mutate(r.id)}>Submit</Button>}
                    {r.status === 'Submitted' && can('finance.approve') && <Button size="sm" variant="quiet" loading={busy('review', r.id)} onClick={() => act.review.mutate(r.id)}>Review</Button>}
                    {['Submitted', 'Under Review'].includes(r.status) && can('finance.approve') && <>
                      <Button size="sm" variant="teal" icon="check" loading={busy('approve', r.id)} onClick={async () => {
                        if (await confirm({ title: `Approve ${r.code}?`, body: `${r.description} — ${fmt.money(r.amount)} will count against the ${r.category} budget.`, confirmLabel: 'Approve', icon: 'check' })) act.approve.mutate(r.id);
                      }}>Approve</Button>
                      <Button size="sm" icon="x" onClick={() => setRejecting(r)}>Reject</Button>
                    </>}
                    {r.status === 'Approved' && can('finance.manage') && (
                      <Button size="sm" loading={busy('pay', r.id)} onClick={async () => {
                        if (await confirm({ title: `Mark ${r.code} as paid?`, body: `Confirm ${fmt.money(r.amount)} has been paid${r.vendor ? ` to ${r.vendor}` : ''}.`, confirmLabel: 'Mark paid' })) act.pay.mutate(r.id);
                      }}>Mark paid</Button>
                    )}
                  </div>
                ),
              },
            ]} />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      <div className="mt-4">
        <Card icon="wallet" title="Expense by category" sub="Approved and paid, this academic year">
          {s.error ? <ErrorState error={s.error} onRetry={() => s.refetch()} /> : cats.length ? (
            <Chart svg={charts.hbar({
              rows: cats.map((c, i) => ({ label: c.label, value: c.value, color: SERIES[i % SERIES.length], display: fmt.money(c.value, { compact: true }) })),
              labelW: 160, rowH: 32,
            })} />
          ) : <Empty icon="pieChart" title={s.isLoading ? 'Loading…' : 'No approved expenses yet'} sub={s.isLoading ? undefined : 'Spend by category appears once expenses are approved.'} />}
        </Card>
      </div>
      <ReasonModal open={!!rejecting} title={`Reject ${rejecting?.code ?? ''}`} sub={rejecting ? `${rejecting.description} — ${fmt.money(rejecting.amount)}` : ''}
        label="Reason (returned to the person who raised it)" confirmLabel="Reject" danger busy={reject.isPending}
        onClose={() => setRejecting(null)} onSubmit={(reason) => rejecting && reject.mutate({ id: rejecting.id, reason })} />
      <ExpenseModal open={creating} onClose={() => setCreating(false)} defaultSubmitter={user?.employeeId ?? ''} />
    </Page>
  );
}

function ExpenseModal({ open, onClose, defaultSubmitter }: { open: boolean; onClose: () => void; defaultSubmitter: string }) {
  const { campusId } = useSchool();
  const { lookups } = useLookups();
  const lk = useFinanceLookups();
  const init = () => ({ campusId: campusId ?? '', category: '', description: '', amount: '', expenseDate: todayIso(), vendorId: '', submittedBy: defaultSubmitter, submit: true });
  const [f, setF] = useState(init);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setF(init()); setTouched(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useApiMutation<Record<string, unknown>, { code: string; status: string }>('post', '/finance/expenses', {
    invalidate: ['/finance/expenses'], onSuccess: onClose, success: (r) => `${r.data.code} ${r.data.status === 'Draft' ? 'saved as draft' : 'submitted for approval'}`,
  });
  const errs: Record<string, string> = { ...fieldErrors(save.error) };
  const problems = {
    campusId: !f.campusId && 'Choose a campus.',
    category: !f.category && 'Choose a category.',
    description: f.description.trim().length < 3 && 'Describe the expense.',
    amount: !isMoney(f.amount) && 'Enter an amount greater than zero.',
    expenseDate: (!f.expenseDate || f.expenseDate > todayIso()) && 'Choose a date that is not in the future.',
    submittedBy: !f.submittedBy && 'Choose who raised this expense.',
  };
  if (touched) for (const [k, v] of Object.entries(problems)) if (v) errs[k] = v;
  const set = (k: keyof ReturnType<typeof init>) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal open={open} onClose={onClose} busy={save.isPending} size="wide" title="Raise an expense"
      foot={<>
        <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={() => {
          setTouched(true);
          if (Object.values(problems).some(Boolean)) return;
          save.mutate({ ...f, description: f.description.trim(), amount: Number(f.amount), vendorId: f.vendorId || undefined });
        }}>{f.submit ? 'Submit for approval' : 'Save draft'}</Button>
      </>}>
      <div className="formsection">
        <div className="formsection__title">What was spent</div>
        <div className="form-grid">
        <SelectField label="Campus" required value={f.campusId} onChange={set('campusId')} placeholder="Choose…" error={errs.campusId}
          options={(lookups?.campuses ?? []).map((c) => ({ value: c.id, label: c.shortName }))} />
        <SelectField label="Category (budget line)" required value={f.category} onChange={set('category')} placeholder="Choose…" error={errs.category}
          options={lk.data?.expenseCategories ?? []} />
        <TextField label="Description" required value={f.description} onChange={set('description')} maxLength={200} error={errs.description} className="span-2" />
        <TextField label="Amount (₹)" required type="number" min="0" step="0.01" value={f.amount} onChange={set('amount')} error={errs.amount} />
        <TextField label="Expense date" required type="date" max={todayIso()} value={f.expenseDate} onChange={set('expenseDate')} error={errs.expenseDate} />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Who and where</div>
        <div className="form-grid">
        <SelectField label="Raised by" required value={f.submittedBy} onChange={set('submittedBy')} placeholder="Choose…" error={errs.submittedBy}
          options={(lk.data?.employees ?? []).map((e) => ({ value: e.id, label: `${e.fullName} · ${e.department}` }))} />
        <SelectField label="Vendor" value={f.vendorId} onChange={set('vendorId')} placeholder="None / not listed"
          options={(lk.data?.vendors ?? []).map((v) => ({ value: v.id, label: v.name }))} />
        <div className="field span-2"><Switch checked={f.submit} onChange={(v) => setF((x) => ({ ...x, submit: v }))} label="Submit for approval now" /></div>
        </div>
      </div>
    </Modal>
  );
}
