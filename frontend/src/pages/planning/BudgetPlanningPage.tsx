import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import { fmt } from '@/lib/format';
import {
  Banner, Button, Card, DataTable, Dl, Empty, ErrorState, FilterSelect, Grid, IconButton, Kpi, Meter, Modal, Page, PageHead,
  Pagination, SearchInput, SelectField, Skeleton, Status, Switch, TextArea, TextField, Timeline, Toolbar, useConfirm,
} from '@/components/ui';
import { fieldErrors, ListCount, Money, ReasonModal } from '../finance/shared';
import type { PlanDetail, PlanLookups, PlanRow, PlanSummary } from './types';
import { AwaitingSuperAdmin } from './AwaitingSuperAdmin';

const PENDING = ['Submitted', 'Under Review'];
const STATUS_OPTIONS = [
  { value: 'pending', label: 'Awaiting Super Admin' }, 'Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected',
];

function usePlanLookups() {
  return useApiQuery<PlanLookups>('/planning/lookups', undefined, { staleTime: 5 * 60_000 });
}

export default function BudgetPlanningPage() {
  const { can } = useAuth();
  const { campusParam, campus } = useSchool();
  const [sp, setSp] = useSearchParams();
  const list = useListParams({ sort: 'updated', dir: 'desc' }, ['status', 'category', 'department']);
  const q = usePagedQuery<PlanRow>('/planning/plans', { ...list.query, ...campusParam });
  const s = useApiQuery<PlanSummary>('/planning/summary', campusParam);
  const lk = usePlanLookups();
  const [editing, setEditing] = useState<PlanDetail | 'new' | null>(null);
  const openId = sp.get('plan');
  const open = (id: string | null) => setSp((prev) => {
    const next = new URLSearchParams(prev);
    if (id) next.set('plan', id); else next.delete('plan');
    return next;
  }, { replace: true });
  const k = s.data?.kpis;
  const canManage = can('planning.manage');
  const decider = can('approvals.decide');
  const cats = s.data?.byCategory ?? [];

  return (
    <Page>
      <PageHead title="Budget & Planning" sub="Departments prepare budget plans and submit them; the Super Admin alone approves or rejects. Approved amounts flow into Budgets."
        actions={canManage && <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>New budget plan</Button>} />
      {!decider && (
        <Banner tone="neutral" icon="shieldCheck">
          Plans you submit go to the <strong>Super Admin</strong>, who alone approves (in full or for a lower amount) or rejects with a reason. You are notified of the decision.
        </Banner>
      )}
      <Grid cols="g-4col" className={decider ? undefined : 'mt-4'}>
        <Kpi icon="fileText" label="Requested this year" value={fmt.money(k?.requested, { compact: true })} loading={s.isLoading}
          foot={campus ? campus.shortName : 'All campuses'} />
        <Kpi icon="check" label="Approved" tone="teal" value={fmt.money(k?.approved, { compact: true })} loading={s.isLoading}
          foot={k ? `${k.approvedCount} plan(s)${k.approvedRequested ? ` · ${Math.round((k.approved / k.approvedRequested) * 100)}% of what they asked` : ''}` : undefined} />
        <Kpi icon="clock" label="Awaiting Super Admin" tone="amber" value={k ? fmt.n(k.pending) : '—'} loading={s.isLoading}
          foot={k ? `${fmt.money(k.pendingValue, { compact: true })}${k.oldestPendingAt ? ` · oldest ${fmt.relative(k.oldestPendingAt)}` : ''}` : undefined}
          onClick={() => list.setFilter('status', 'pending')} />
        <Kpi icon="x" label="Rejected" tone="critical" value={k ? fmt.n(k.rejected) : '—'} loading={s.isLoading}
          foot={k ? `${k.drafts} draft(s) in preparation` : undefined} onClick={() => list.setFilter('status', 'Rejected')} />
      </Grid>

      <Card flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search code, title, department" />
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={STATUS_OPTIONS} />
          <FilterSelect label="Category" value={list.filters.category} onChange={(v) => list.setFilter('category', v)} options={lk.data?.categories ?? []} />
          <FilterSelect label="Department" value={list.filters.department} onChange={(v) => list.setFilter('department', v)} options={lk.data?.departments ?? []} />
          {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
          <div className="spacer" />
          <ListCount total={q.data?.meta.total} noun="plans" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable rows={q.data?.rows} loading={q.isLoading || q.isPlaceholderData} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            onRowClick={(r) => open(r.id)}
            emptyText={list.hasFilters ? 'No budget plans match the current filters.' : canManage ? 'No budget plans yet. Start one with “New budget plan”.' : 'No budget plans yet.'}
            columns={[
              { key: 'code', label: 'Plan', render: (r) => <span className="t-num">{r.code}</span> },
              { key: 'title', label: 'Title', render: (r) => <><span className="t-bold">{r.title}</span><div className="t-micro t-muted">{r.department} · {r.category} · {r.campus}</div></> },
              { key: 'period', label: 'Period', render: (r) => <span className="t-sm">{fmt.date(r.periodStart)} – {fmt.date(r.periodEnd)}</span> },
              { key: 'amount', label: 'Requested', className: 'num', render: (r) => <Money v={r.amountRequested} strong /> },
              { key: 'approved', label: 'Approved', className: 'num', render: (r) => (r.amountApproved != null ? <Money v={r.amountApproved} tone="teal" /> : <span className="t-faint">—</span>) },
              {
                key: 'status', label: 'Status', render: (r) => <>
                  <Status value={r.status} />
                  {PENDING.includes(r.status) && !decider && <div className="t-micro t-muted">With the Super Admin</div>}
                  {r.decidedBy && <div className="t-micro t-muted">{r.decidedBy} · {fmt.date(r.decidedAt)}</div>}
                </>,
              },
              { key: 'updated', label: 'Updated', render: (r) => <span className="t-sm t-muted">{fmt.relative(r.updatedAt)}</span> },
              { key: 'a', label: '', className: 'num', sortable: false, render: (r) => <Button size="sm" variant="quiet" iconRight="chevronRight" onClick={(e) => { e.stopPropagation(); open(r.id); }}>Open</Button> },
            ]} />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>

      <div className="mt-4">
        <Card icon="pieChart" title="Requested and approved by category" sub="This academic year; drafts excluded">
          {s.error ? <ErrorState error={s.error} onRetry={() => s.refetch()} /> : s.isLoading ? <Skeleton height={120} /> : cats.length ? (
            <div className="col g-3">
              {cats.map((c) => (
                <Meter key={c.label} label={c.label} value={c.requested ? Math.round((c.approved / c.requested) * 100) : 0} tone="teal"
                  right={<span className="t-sm"><strong>{fmt.money(c.approved, { compact: true })}</strong> <span className="t-muted">of {fmt.money(c.requested, { compact: true })}</span></span>} />
              ))}
            </div>
          ) : <Empty icon="pieChart" title="No submitted plans yet" sub="Category totals appear once plans are submitted." />}
        </Card>
      </div>

      <PlanDrawer id={openId} onClose={() => open(null)} onEdit={(p) => { open(null); setEditing(p); }} />
      <PlanForm plan={editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); open(id); }} />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Detail with history and the workflow actions
// ---------------------------------------------------------------------------
const EVENT_LABEL: Record<string, string> = {
  created: 'Prepared', updated: 'Edited', submitted: 'Submitted for approval', review: 'Taken under review by the Super Admin',
  approved: 'Approved by the Super Admin', rejected: 'Rejected by the Super Admin', reopened: 'Reopened for revision',
};
const EVENT_TONE: Record<string, string> = { approved: 'teal', rejected: 'critical', submitted: 'amber', review: 'amber' };

function PlanDrawer({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (p: PlanDetail) => void }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const q = useApiQuery<PlanDetail>(id ? `/planning/plans/${id}` : null);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const inv = { invalidate: ['/planning'], body: () => ({}) };
  const submit = useApiMutation<void>('post', `/planning/plans/${id}/submit`, inv);
  const reopen = useApiMutation<void>('post', `/planning/plans/${id}/reopen`, inv);
  const review = useApiMutation<void>('post', `/planning/plans/${id}/review`, inv);
  const del = useApiMutation<void>('delete', `/planning/plans/${id}`, { invalidate: ['/planning'], onSuccess: onClose });
  const reject = useApiMutation<string>('post', `/planning/plans/${id}/reject`, {
    invalidate: ['/planning'], body: (reason) => ({ reason }), onSuccess: () => setRejecting(false),
  });
  const p = q.data;
  const canManage = can('planning.manage');
  const decider = can('approvals.decide');
  const pending = !!p && PENDING.includes(p.status);
  const busy = submit.isPending || reopen.isPending || review.isPending || del.isPending;

  const foot = p && (
    <>
      {p.status === 'Draft' && canManage && <>
        <Button icon="trash" variant="quiet" loading={del.isPending} onClick={async () => {
          if (await confirm({ title: `Delete ${p.code}?`, body: 'The draft and its line items are removed. This cannot be undone.', confirmLabel: 'Delete', danger: true })) del.mutate();
        }}>Delete draft</Button>
        <div className="spacer" />
        <Button icon="edit" onClick={() => onEdit(p)}>Edit</Button>
        <Button variant="primary" icon="send" loading={submit.isPending} disabled={busy} onClick={async () => {
          if (await confirm({ title: `Submit ${p.code}?`, body: `${fmt.money(p.amountRequested)} goes to the Super Admin for approval. You cannot edit it while it is with them.`, confirmLabel: 'Submit' })) submit.mutate();
        }}>Submit for approval</Button>
      </>}
      {p.status === 'Rejected' && canManage && <>
        <div className="spacer" />
        <Button icon="refresh" loading={reopen.isPending} onClick={() => reopen.mutate()}>Reopen to revise</Button>
      </>}
      {pending && decider && <>
        {p.status === 'Submitted' && <Button variant="quiet" loading={review.isPending} onClick={() => review.mutate()}>Mark under review</Button>}
        <div className="spacer" />
        <Button icon="x" onClick={() => setRejecting(true)}>Reject</Button>
        <Button variant="teal" icon="check" onClick={() => setApproving(true)}>Approve</Button>
      </>}
      {pending && !decider && <><div className="spacer" /><AwaitingSuperAdmin /></>}
    </>
  );

  return (
    <>
      <Modal open={!!id} onClose={onClose} size="wide" busy={busy}
        title={p ? <>{p.code} · {p.title}</> : 'Budget plan'} sub={p ? <span className="row g-2"><Status value={p.status} />{p.department} · {p.category} · {p.campus}</span> : undefined}
        foot={foot}>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !p ? <Skeleton height={260} /> : (
          <div className="col g-4">
            {p.status === 'Rejected' && p.decisionNote && <Banner tone="critical" icon="x"><strong>Rejected by {p.decidedBy}:</strong> {p.decisionNote}</Banner>}
            {p.status === 'Approved' && (
              <Banner tone="success" icon="check">
                Approved by {p.decidedBy} on {fmt.date(p.decidedAt)} for <strong>{fmt.money(p.amountApproved)}</strong>
                {p.amountApproved != null && p.amountApproved < p.amountRequested && <> of {fmt.money(p.amountRequested)} requested</>}
                {' '}— added to the {p.category} budget{p.budgetAllocated != null && <> (now {fmt.money(p.budgetAllocated)})</>}.
                {p.decisionNote && <div className="t-sm mt-1">{p.decisionNote}</div>}
              </Banner>
            )}
            <Dl items={[
              ['Academic year', p.academicYear],
              ['Period', `${fmt.date(p.periodStart)} – ${fmt.date(p.periodEnd)}`],
              ['Requested', <strong key="r">{fmt.money(p.amountRequested)}</strong>],
              ['Approved', p.amountApproved != null ? fmt.money(p.amountApproved) : '—'],
              ['Prepared by', p.createdBy],
              ['Submitted', p.submittedAt ? `${p.submittedBy ?? ''} · ${fmt.date(p.submittedAt)}` : '—'],
              ['Current budget line', p.currentBudget ? `${fmt.money(p.currentBudget.allocated)}${p.currentBudget.owner ? ` · ${p.currentBudget.owner}` : ''}` : 'None yet — created on approval'],
            ]} />
            {p.justification && <div><div className="t-xs t-muted mb-1">Justification</div><p className="t-sm" style={{ whiteSpace: 'pre-wrap' }}>{p.justification}</p></div>}
            <Card title="Line items" flush tight>
              <DataTable rows={p.lines} rowKey={(l) => l.id ?? l.item} compact emptyText="No line items — a single amount was requested."
                columns={[
                  { key: 'item', label: 'Item', render: (l) => <><span className="t-bold">{l.item}</span>{l.notes && <div className="t-micro t-muted">{l.notes}</div>}</> },
                  { key: 'q', label: 'Qty', className: 'num', render: (l) => fmt.n(l.quantity) },
                  { key: 'u', label: 'Unit cost', className: 'num', render: (l) => <Money v={l.unitCost} /> },
                  { key: 'a', label: 'Amount', className: 'num', render: (l) => <Money v={l.amount} strong /> },
                ]} />
              <div className="row between" style={{ padding: '10px 16px' }}><span className="t-muted">Total requested</span><strong className="t-num">{fmt.money(p.amountRequested)}</strong></div>
            </Card>
            <div>
              <div className="h3 mb-2">History</div>
              <Timeline items={p.history.map((h) => ({
                time: `${fmt.date(h.at)} ${fmt.time(h.at)}`,
                title: `${EVENT_LABEL[h.action] ?? h.action} — ${h.actor}`,
                body: [h.amount != null && fmt.money(h.amount), h.note].filter(Boolean).join(' · ') || undefined,
                tone: EVENT_TONE[h.action],
              }))} />
            </div>
          </div>
        )}
      </Modal>
      {p && <ApproveModal open={approving} plan={p} onClose={() => setApproving(false)} />}
      <ReasonModal open={rejecting} title={`Reject ${p?.code ?? ''}`} sub={p ? `${p.title} — ${fmt.money(p.amountRequested)}` : ''}
        label="Reason (sent to the person who prepared it)" confirmLabel="Reject" danger busy={reject.isPending}
        onClose={() => setRejecting(false)} onSubmit={(reason) => reject.mutate(reason)} />
    </>
  );
}

function ApproveModal({ open, plan, onClose }: { open: boolean; plan: PlanDetail; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setAmount(String(plan.amountRequested)); setNote(''); setTouched(false); } }, [open, plan.amountRequested]);
  const approve = useApiMutation<{ amountApproved: number; note?: string }>('post', `/planning/plans/${plan.id}/approve`, {
    invalidate: ['/planning', '/finance/budgets'], onSuccess: onClose,
  });
  const n = Number(amount);
  const err = !/^\d+(\.\d{1,2})?$/.test(amount.trim()) || n <= 0 ? 'Enter the amount to approve.'
    : n > plan.amountRequested ? `Cannot exceed the ${fmt.money(plan.amountRequested)} requested.` : undefined;
  const errs = fieldErrors(approve.error);
  return (
    <Modal open={open} onClose={onClose} busy={approve.isPending} title={`Approve ${plan.code}`} sub={plan.title}
      foot={<>
        <Button onClick={onClose} disabled={approve.isPending}>Cancel</Button>
        <Button variant="teal" icon="check" loading={approve.isPending} onClick={() => {
          setTouched(true);
          if (!err) approve.mutate({ amountApproved: n, note: note.trim() || undefined });
        }}>Approve {n > 0 && !err ? fmt.money(n) : ''}</Button>
      </>}>
      <div className="col g-3">
        <TextField label="Approved amount (₹)" required type="number" min="0" step="1" value={amount} onChange={setAmount}
          error={(touched && err) || errs.amountApproved}
          hint={`Requested ${fmt.money(plan.amountRequested)}. Approve less to fund part of the plan. The approved amount is added to the ${plan.category} budget for ${plan.campus}.`} />
        <TextArea label="Note to the preparer" value={note} onChange={setNote} rows={3} maxLength={500} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Create / edit with line items (total sums automatically)
// ---------------------------------------------------------------------------
type LineDraft = { item: string; quantity: string; unitCost: string; notes: string };
const blankLine = (): LineDraft => ({ item: '', quantity: '1', unitCost: '', notes: '' });
const lineTotal = (l: LineDraft) => {
  const v = Number(l.quantity) * Number(l.unitCost);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
};

function PlanForm({ plan, onClose, onSaved }: { plan: PlanDetail | 'new' | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { campusId } = useSchool();
  const { lookups } = useLookups();
  const lk = usePlanLookups();
  const isNew = plan === 'new';
  const init = () => (plan && plan !== 'new'
    ? {
      title: plan.title, campusId: plan.campusId, academicYearId: plan.academicYearId, department: plan.department, category: plan.category,
      periodStart: plan.periodStart, periodEnd: plan.periodEnd, justification: plan.justification ?? '', submit: false,
    }
    : { title: '', campusId: campusId ?? '', academicYearId: '', department: '', category: '', periodStart: '', periodEnd: '', justification: '', submit: false });
  const [f, setF] = useState(init);
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!plan) return;
    setF(init());
    setTouched(false);
    setLines(plan !== 'new' && plan.lines.length
      ? plan.lines.map((l) => ({ item: l.item, quantity: String(l.quantity), unitCost: String(l.unitCost), notes: l.notes ?? '' }))
      : [blankLine()]);
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps

  const opts = {
    invalidate: ['/planning'],
    onSuccess: (r: { data: { id: string } }) => onSaved(r.data.id),
  };
  const create = useApiMutation<Record<string, unknown>, { id: string; code: string; status: string }>('post', '/planning/plans', opts);
  const update = useApiMutation<Record<string, unknown>, { id: string }>('put', `/planning/plans/${plan && plan !== 'new' ? plan.id : ''}`, opts);
  const m = isNew ? create : update;
  const used = lines.filter((l) => l.item.trim() || l.unitCost.trim());
  const total = used.reduce((a, l) => a + lineTotal(l), 0);
  const lineProblems = used.map((l) => ({
    item: l.item.trim().length < 1 ? 'Describe the item.' : undefined,
    quantity: !(Number(l.quantity) > 0) ? 'Qty > 0' : undefined,
    unitCost: !/^\d+(\.\d{1,2})?$/.test(l.unitCost.trim()) ? 'Enter a cost' : undefined,
  }));
  const problems = {
    title: f.title.trim().length < 3 && 'Give the plan a title.',
    campusId: !f.campusId && 'Choose a campus.',
    department: f.department.trim().length < 2 && 'Choose a department.',
    category: f.category.trim().length < 2 && 'Choose a budget category.',
    periodStart: !f.periodStart && 'Choose the start date.',
    periodEnd: (!f.periodEnd && 'Choose the end date.') || (f.periodStart && f.periodEnd < f.periodStart && 'Must be on or after the start.'),
    lines: (!used.length && 'Add at least one line item.') || (lineProblems.some((p) => p.item || p.quantity || p.unitCost) && 'Complete every line item.'),
  };
  const errs: Record<string, string> = { ...fieldErrors(m.error) };
  if (touched) for (const [k, v] of Object.entries(problems)) if (v) errs[k] = v;
  const set = (k: keyof ReturnType<typeof init>) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const setLine = (i: number, k: keyof LineDraft, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const withCurrent = (list: string[], v: string) => (v && !list.includes(v) ? [v, ...list] : list);

  return (
    <Modal open={!!plan} onClose={onClose} busy={m.isPending} size="wide" title={isNew ? 'New budget plan' : `Edit ${typeof plan === 'object' && plan ? plan.code : ''}`}
      sub="Prepared here, approved or rejected only by the Super Admin."
      foot={<>
        <span className="t-sm grow">Total requested <strong className="t-num">{fmt.money(total)}</strong></span>
        <Button onClick={onClose} disabled={m.isPending}>Cancel</Button>
        <Button variant="primary" loading={m.isPending} onClick={() => {
          setTouched(true);
          if (Object.values(problems).some(Boolean)) return;
          m.mutate({
            title: f.title.trim(), campusId: f.campusId, academicYearId: f.academicYearId || undefined, department: f.department.trim(), category: f.category.trim(),
            periodStart: f.periodStart, periodEnd: f.periodEnd, justification: f.justification.trim() || undefined,
            lines: used.map((l) => ({ item: l.item.trim(), quantity: Number(l.quantity), unitCost: Number(l.unitCost), notes: l.notes.trim() || undefined })),
            ...(isNew ? { submit: f.submit } : {}),
          });
        }}>{isNew ? (f.submit ? 'Submit for approval' : 'Save draft') : 'Save changes'}</Button>
      </>}>
      <div className="formsection">
        <div className="formsection__title">The plan</div>
        <div className="form-grid">
          <TextField label="Title" required value={f.title} onChange={set('title')} maxLength={160} error={errs.title} className="span-2" />
          <SelectField label="Campus" required value={f.campusId} onChange={set('campusId')} placeholder="Choose…" error={errs.campusId}
            options={(lookups?.campuses ?? []).map((c) => ({ value: c.id, label: c.shortName }))} />
          <SelectField label="Academic year" value={f.academicYearId} onChange={set('academicYearId')} placeholder="Current year"
            options={(lk.data?.academicYears ?? []).map((y) => ({ value: y.id, label: `${y.label}${y.isCurrent ? ' (current)' : ''}` }))} />
          <SelectField label="Department" required value={f.department} onChange={set('department')} placeholder="Choose…" error={errs.department}
            options={withCurrent(lk.data?.departments ?? [], f.department)} />
          <SelectField label="Budget category" required value={f.category} onChange={set('category')} placeholder="Choose…" error={errs.category}
            options={withCurrent(lk.data?.categories ?? [], f.category)} hint="An approval is added to this category’s budget line." />
          <TextField label="Period from" required type="date" value={f.periodStart} onChange={set('periodStart')} error={errs.periodStart} />
          <TextField label="Period to" required type="date" min={f.periodStart || undefined} value={f.periodEnd} onChange={set('periodEnd')} error={errs.periodEnd} />
          <TextArea label="Justification" value={f.justification} onChange={set('justification')} rows={3} maxLength={4000} className="span-2" />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Line items</div>
        {errs.lines && <div className="t-xs t-critical mb-2" role="alert">{errs.lines}</div>}
        <div className="col g-2">
          {lines.map((l, i) => {
            const pr = touched ? lineProblems[used.indexOf(l)] : undefined;
            return (
              <div key={i} className="row g-2 wrap" style={{ alignItems: 'flex-end' }}>
                <TextField label={i === 0 ? 'Item' : ''} value={l.item} onChange={(v) => setLine(i, 'item', v)} maxLength={160} error={pr?.item} style={{ flex: '3 1 200px' }} />
                <TextField label={i === 0 ? 'Qty' : ''} type="number" min="0" step="any" value={l.quantity} onChange={(v) => setLine(i, 'quantity', v)} error={pr?.quantity} style={{ flex: '0 1 80px' }} />
                <TextField label={i === 0 ? 'Unit cost (₹)' : ''} type="number" min="0" step="0.01" value={l.unitCost} onChange={(v) => setLine(i, 'unitCost', v)} error={pr?.unitCost} style={{ flex: '1 1 110px' }} />
                <TextField label={i === 0 ? 'Notes' : ''} value={l.notes} onChange={(v) => setLine(i, 'notes', v)} maxLength={300} style={{ flex: '2 1 140px' }} />
                <div className="t-num t-bold" style={{ flex: '0 0 110px', textAlign: 'right', paddingBottom: 10 }}>{fmt.money(lineTotal(l))}</div>
                <IconButton icon="trash" label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} />
              </div>
            );
          })}
        </div>
        <div className="row between mt-3">
          <Button size="sm" icon="plus" onClick={() => setLines((ls) => [...ls, blankLine()])} disabled={lines.length >= 100}>Add line</Button>
          <span>Total <strong className="t-num">{fmt.money(total)}</strong></span>
        </div>
      </div>
      {isNew && (
        <div className="field"><Switch checked={f.submit} onChange={(v) => setF((x) => ({ ...x, submit: v }))} label="Submit to the Super Admin for approval now" /></div>
      )}
    </Modal>
  );
}
