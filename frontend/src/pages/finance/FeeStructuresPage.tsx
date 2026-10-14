import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import { fmt } from '@/lib/format';
import {
  Banner, Button, Card, Checkbox, DataTable, ErrorState, FilterSelect, Modal, Page, PageHead, Pagination, SearchInput,
  SectionHead, SelectField, Status, Switch, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import type { StructureRow, StructureSummaryRow } from './types';
import { fieldErrors, ListCount, Money, useFinanceLookups } from './shared';

export default function FeeStructuresPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const summary = useApiQuery<StructureSummaryRow[]>('/finance/fee-structures/summary', campusParam);
  const list = useListParams({ sort: 'class' }, ['feeHeadId', 'status']);
  const q = usePagedQuery<StructureRow>('/finance/fee-structures', { ...list.query, ...campusParam });
  const lk = useFinanceLookups();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const apply = useApiMutation<string>('post', (id) => `/finance/fee-structures/${id}/apply`, { invalidate: ['/finance'], body: () => ({}) });
  const patch = useApiMutation<{ id: string; status: string }>('patch', (v) => `/finance/fee-structures/${v.id}`, {
    invalidate: ['/finance/fee-structures'], body: (v) => ({ status: v.status }), success: (_r, v) => `Structure marked ${v.status}`,
  });

  return (
    <Page>
      <PageHead title="Fee Structures" sub="Defined per stage and campus, then applied to student accounts automatically."
        actions={can('finance.manage') && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New structure</Button>} />
      <Card flush>
        {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : (
          <DataTable rows={summary.data} loading={summary.isLoading} rowKey={(r) => `${r.campusId}:${r.stage}`}
            emptyText="No fee structures have been defined for this academic year."
            columns={[
              { key: 'stage', label: 'Stage', render: (r) => <><span className="t-bold">{r.stage}</span><div className="t-micro t-muted">{r.campus} · Grade {r.fromGrade}{r.toGrade !== r.fromGrade ? `–${r.toGrade}` : ''}</div></> },
              { key: 'tuition', label: 'Tuition / year', className: 'num', render: (r) => <Money v={r.tuition} /> },
              { key: 'transport', label: 'Transport', className: 'num', render: (r) => <Money v={r.transport} /> },
              { key: 'activities', label: 'Activities', className: 'num', render: (r) => <Money v={r.activities} /> },
              { key: 'instalments', label: 'Instalments', render: (r) => `${r.terms} term${r.terms === 1 ? '' : 's'}` },
              { key: 'students', label: 'Students', className: 'num', render: (r) => fmt.n(r.students) },
              { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
            ]} />
        )}
      </Card>

      <div className="mt-5">
        <SectionHead title="Structure lines" sub="Every class, head and instalment. Applying a structure raises the charge on each enrolled student's account." />
        <Card flush>
          <Toolbar>
            <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search class, stage or head" />
            <FilterSelect label="Head" value={list.filters.feeHeadId} onChange={(v) => list.setFilter('feeHeadId', v)}
              options={(lk.data?.feeHeads ?? []).map((h) => ({ value: h.id, label: h.name }))} />
            <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={['Active', 'Draft', 'Archived']} />
            {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
            <div className="spacer" />
            <ListCount total={q.data?.meta.total} noun="lines" />
          </Toolbar>
          {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <DataTable rows={q.data?.rows} loading={q.isLoading || q.isPlaceholderData} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
              emptyText="No structure lines match the current filters."
              columns={[
                { key: 'class', label: 'Class', render: (r) => <><span className="t-bold">{r.class}</span><div className="t-micro t-muted">{r.campus} · {r.stage}</div></> },
                { key: 'head', label: 'Head' },
                { key: 'term', label: 'Instalment' },
                { key: 'amount', label: 'Amount', className: 'num', render: (r) => <Money v={r.amount} strong /> },
                { key: 'dueDate', label: 'Due', render: (r) => fmt.date(r.dueDate) },
                { key: 'applied', label: 'Accounts', className: 'num', sortable: false, render: (r) => fmt.n(r.applied) },
                { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
                {
                  key: 'a', label: '', className: 'num', sortable: false, render: (r) => can('finance.manage') && (
                    <div className="row g-2 end">
                      {r.status === 'Draft' && <Button size="sm" loading={patch.isPending && patch.variables?.id === r.id} onClick={() => patch.mutate({ id: r.id, status: 'Active' })}>Activate</Button>}
                      {r.status === 'Active' && (
                        <Button size="sm" variant="teal" loading={apply.isPending && apply.variables === r.id} onClick={async () => {
                          if (await confirm({ title: 'Apply to student accounts?', body: `${r.head} ${r.term} (${fmt.money(r.amount)}) will be raised for every enrolled student in ${r.class} who does not have it yet.`, confirmLabel: 'Apply' })) apply.mutate(r.id);
                        }}>Apply</Button>
                      )}
                      {r.status !== 'Archived' && (
                        <Button size="sm" variant="quiet" onClick={async () => {
                          if (await confirm({ title: 'Archive this structure line?', body: 'Existing charges stay on student accounts; the line will no longer be applied.', confirmLabel: 'Archive', danger: true })) patch.mutate({ id: r.id, status: 'Archived' });
                        }}>Archive</Button>
                      )}
                    </div>
                  ),
                },
              ]} />
          )}
          <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
        </Card>
      </div>
      <StructureModal open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}

function StructureModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { campusParam } = useSchool();
  const { lookups } = useLookups();
  const lk = useFinanceLookups();
  const empty = { feeHeadId: '', term: 'Term 1', amount: '', dueDate: '', status: 'Active', applyNow: true };
  const [f, setF] = useState(empty);
  const [classIds, setClassIds] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setF(empty); setClassIds(new Set()); setTouched(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useApiMutation<Record<string, unknown>, { ids: string[]; applied: number }>('post', '/finance/fee-structures', {
    invalidate: ['/finance'], onSuccess: onClose,
    success: (r) => `Structure created${r.data.applied ? ` and raised on ${r.data.applied} account(s)` : ''}`,
  });
  const classes = (lookups?.classes ?? []).filter((c) => !campusParam.campusId || c.campusId === campusParam.campusId);
  const campusName = (id: string) => lookups?.campuses.find((c) => c.id === id)?.shortName ?? '';
  const errs: Record<string, string> = { ...fieldErrors(save.error) };
  if (touched) {
    if (!classIds.size) errs.classIds = 'Choose at least one class.';
    if (!f.feeHeadId) errs.feeHeadId = 'Choose a fee head.';
    if (!/^\d+(\.\d{1,2})?$/.test(f.amount)) errs.amount = 'Enter the amount per instalment.';
    if (!f.dueDate) errs.dueDate = 'Choose a due date.';
  }
  const valid = classIds.size && f.feeHeadId && /^\d+(\.\d{1,2})?$/.test(f.amount) && f.dueDate;
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (id: string) => setClassIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Modal open={open} onClose={onClose} busy={save.isPending} size="wide" title="New fee structure" sub="One line per class, head and instalment for the current academic year."
      foot={<>
        <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={() => {
          setTouched(true);
          if (!valid) return;
          save.mutate({ classIds: [...classIds], feeHeadId: f.feeHeadId, term: f.term, amount: Number(f.amount), dueDate: f.dueDate, status: f.status, applyNow: f.status === 'Active' && f.applyNow });
        }}>Create structure</Button>
      </>}>
      <div className="col g-4">
        <div className="grid g-2col">
          <SelectField label="Fee head" required value={f.feeHeadId} onChange={set('feeHeadId')} placeholder="Choose…" error={errs.feeHeadId}
            options={(lk.data?.feeHeads ?? []).map((h) => ({ value: h.id, label: h.name }))} />
          <SelectField label="Instalment" required value={f.term} onChange={set('term')} options={['Term 1', 'Term 2', 'Term 3', 'Annual']} />
          <TextField label="Amount per instalment (₹)" required type="number" min="0" step="0.01" value={f.amount} onChange={set('amount')} error={errs.amount} />
          <TextField label="Due date" required type="date" value={f.dueDate} onChange={set('dueDate')} error={errs.dueDate} />
          <SelectField label="Status" value={f.status} onChange={set('status')} options={['Active', 'Draft']} hint="Draft structures are not applied to accounts." />
          <div className="field fw-field-end">
            <Switch checked={f.status === 'Active' && f.applyNow} disabled={f.status !== 'Active'} onChange={(v) => setF((x) => ({ ...x, applyNow: v }))} label="Raise on student accounts now" />
          </div>
        </div>
        <div>
          <div className="row between">
            <span className="label">Classes<span className="req"> *</span></span>
            <Button size="sm" variant="quiet" onClick={() => setClassIds(classIds.size === classes.length ? new Set() : new Set(classes.map((c) => c.id)))}>
              {classIds.size === classes.length ? 'Clear all' : 'Select all'}
            </Button>
          </div>
          <div className="grid g-3col mt-2 fw-checklist">
            {classes.map((c) => (
              <Checkbox key={c.id} checked={classIds.has(c.id)} onChange={() => toggle(c.id)} label={`${c.name} · ${campusName(c.campusId)}`} />
            ))}
          </div>
          {errs.classIds && <span className="hint hint--error" role="alert">{errs.classIds}</span>}
        </div>
        <Banner tone="neutral" icon="info">Transport lines are raised only for students with a bus route. A duplicate class, head and instalment is rejected.</Banner>
      </div>
    </Modal>
  );
}
