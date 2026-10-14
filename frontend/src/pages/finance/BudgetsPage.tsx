import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { fmt } from '@/lib/format';
import {
  Banner, Button, Card, DataTable, ErrorState, Grid, Kpi, Meter, Modal, Page, PageHead, SelectField, TextField,
} from '@/components/ui';
import type { BudgetRow, Budgets } from './types';
import { fieldErrors, Money, TotalsBar, useFinanceLookups } from './shared';

export default function BudgetsPage() {
  const { can } = useAuth();
  const { campusParam, campus } = useSchool();
  const q = useApiQuery<Budgets>('/finance/budgets', campusParam);
  const [editing, setEditing] = useState<BudgetRow | 'new' | null>(null);
  const k = q.data?.kpis;
  const spentPct = k?.allocated ? Math.round((k.spent / k.allocated) * 100) : 0;
  const canEdit = can('finance.manage') && !!campusParam.campusId;
  const rows = q.data?.rows ?? [];
  const sum = (pick: (r: BudgetRow) => number) => rows.reduce((acc, r) => acc + (pick(r) || 0), 0);
  const totalVariance = sum((r) => r.variance);

  return (
    <Page>
      <PageHead title="Budgets" sub="Budget against actual, by department, with the year-end position projected."
        actions={canEdit && <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Add budget line</Button>} />
      <Grid cols="g-4col">
        <Kpi icon="wallet" label="Annual budget" value={fmt.money(k?.allocated, { compact: true })} loading={q.isLoading} foot={campus ? campus.shortName : 'All campuses'} />
        <Kpi icon="pieChart" label="Spent to date" value={fmt.money(k?.spent, { compact: true })} tone="teal" loading={q.isLoading}
          foot={k ? `${spentPct}% of budget, ${k.yearElapsedPct}% of year` : undefined} />
        <Kpi icon="clock" label="Committed" value={fmt.money(k?.committed, { compact: true })} tone="amber" loading={q.isLoading} foot="Expenses awaiting approval" />
        <Kpi icon="trending" label="Projected variance" loading={q.isLoading}
          value={k ? `${k.projectedVariance > 0 ? '+' : ''}${fmt.money(k.projectedVariance, { compact: true })}` : '—'}
          tone={k && k.projectedVariance > 0 ? 'critical' : 'teal'}
          foot={k?.overBudget ? `Over budget — ${k.overBudget.category}` : 'Within budget at the current run rate'} />
      </Grid>
      <div className="mt-4">
        <Card icon="wallet" title="Budget against actual by department" sub="Actual = approved and paid expenses this academic year; projection = actual ÷ share of year elapsed" flush
          foot={rows.length ? <TotalsBar items={[
            { label: 'Total budget', value: fmt.money(sum((r) => r.allocated), { compact: true }) },
            { label: 'Actual', value: fmt.money(sum((r) => r.actual), { compact: true }) },
            { label: 'Committed', value: fmt.money(sum((r) => r.committed), { compact: true }) },
            { label: 'Projected', value: fmt.money(sum((r) => r.projected), { compact: true }) },
            { label: 'Variance', value: `${totalVariance > 0 ? '+' : ''}${fmt.money(totalVariance, { compact: true })}`, tone: totalVariance > 0 ? 'critical' : 'success' },
          ]} /> : undefined}>
          {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <DataTable rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.category} emptyText={canEdit ? 'No budgets have been set for this year. Add a budget line to start tracking spend.' : 'No budgets have been set for this year.'}
              columns={[
                { key: 'dept', label: 'Department', render: (r) => <span className="t-bold">{r.category}</span> },
                { key: 'budget', label: 'Budget', className: 'num', render: (r) => <Money v={r.allocated} compact /> },
                { key: 'actual', label: 'Actual', className: 'num', render: (r) => <Money v={r.actual} compact /> },
                {
                  key: 'use', label: 'Utilisation', render: (r) => {
                    const p = r.utilisation ?? 0;
                    return <Meter label="" value={Math.min(100, p)} right={r.utilisation == null ? '—' : `${p}%`} tone={p > 95 ? 'critical' : p > 75 ? 'amber' : 'teal'} />;
                  },
                },
                { key: 'committed', label: 'Committed', className: 'num', render: (r) => (r.committed ? <Money v={r.committed} compact /> : <span className="t-faint">—</span>) },
                { key: 'projected', label: 'Projected', className: 'num', render: (r) => <><Money v={r.projected} compact />{r.allocated > 0 && <div className={`t-micro ${r.variance > 0 ? 't-critical' : 't-muted'}`}>{r.variance > 0 ? '+' : ''}{fmt.money(r.variance, { compact: true })}</div>}</> },
                { key: 'owner', label: 'Owner', render: (r) => r.owner ?? '—' },
                { key: 'a', label: '', className: 'num', render: (r) => canEdit && r.id && <Button size="sm" icon="edit" onClick={() => setEditing(r)}>Edit</Button> },
              ]} />
          )}
        </Card>
      </div>
      {!campusParam.campusId && can('finance.manage') && (
        <div className="mt-3"><Banner tone="neutral" icon="info">Budgets are set per campus. Choose a campus in the header to edit them.</Banner></div>
      )}
      <BudgetModal row={editing} onClose={() => setEditing(null)} />
    </Page>
  );
}

function BudgetModal({ row, onClose }: { row: BudgetRow | 'new' | null; onClose: () => void }) {
  const { campusParam, campus } = useSchool();
  const lk = useFinanceLookups();
  const isNew = row === 'new';
  const [f, setF] = useState({ category: '', allocated: '', owner: '' });
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!row) return;
    setTouched(false);
    setF(row === 'new' ? { category: '', allocated: '', owner: '' } : { category: row.category, allocated: String(row.allocated), owner: row.owner ?? '' });
  }, [row]);
  const create = useApiMutation<Record<string, unknown>>('post', '/finance/budgets', { invalidate: ['/finance/budgets'], onSuccess: onClose });
  const update = useApiMutation<Record<string, unknown>>('patch', `/finance/budgets/${row && row !== 'new' ? row.id : ''}`, { invalidate: ['/finance/budgets'], onSuccess: onClose });
  const m = isNew ? create : update;
  const problems = {
    category: f.category.trim().length < 2 && 'Enter a department or category.',
    allocated: !/^\d+(\.\d{1,2})?$/.test(f.allocated) && 'Enter the annual budget.',
  };
  const errs: Record<string, string> = { ...fieldErrors(m.error) };
  if (touched) for (const [k, v] of Object.entries(problems)) if (v) errs[k] = v;
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal open={!!row} onClose={onClose} busy={m.isPending} title={isNew ? 'Add budget line' : `Edit ${f.category} budget`} sub={campus?.shortName}
      foot={<>
        <Button onClick={onClose} disabled={m.isPending}>Cancel</Button>
        <Button variant="primary" loading={m.isPending} onClick={() => {
          setTouched(true);
          if (Object.values(problems).some(Boolean)) return;
          if (isNew) create.mutate({ campusId: campusParam.campusId, category: f.category.trim(), allocated: Number(f.allocated), owner: f.owner.trim() || undefined });
          else update.mutate({ allocated: Number(f.allocated), owner: f.owner.trim() || undefined });
        }}>Save budget</Button>
      </>}>
      <div className="col g-3">
        {isNew ? (
          <SelectField label="Department / category" required value={f.category} onChange={set('category')} placeholder="Choose…" error={errs.category}
            options={lk.data?.expenseCategories ?? []} hint="Expenses raised against this category count as actual spend." />
        ) : null}
        <TextField label="Annual budget (₹)" required type="number" min="0" step="1" value={f.allocated} onChange={set('allocated')} error={errs.allocated} />
        <TextField label="Budget owner" value={f.owner} onChange={set('owner')} maxLength={80} />
      </div>
    </Modal>
  );
}
