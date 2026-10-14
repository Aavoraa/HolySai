import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { fmt } from '@/lib/format';
import {
  Button, Card, DataTable, ErrorState, FilterSelect, Grid, Kpi, Meter, Modal, Page, PageHead, Pagination, SectionHead, Status,
  StudentLink, TextArea, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import type { ConcessionRow, ConcessionSummary, Scholarship } from './types';
import { fieldErrors, isMoney, ListCount, Money } from './shared';
import { ConcessionModal, useConcessionDecisions } from './ConcessionsPage';

const AWARD_TYPES = ['Merit scholarship', 'Need-based support', 'Sports quota'];

export default function ScholarshipsPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const s = useApiQuery<ConcessionSummary>('/finance/concessions/summary', campusParam);
  const schemes = useApiQuery<Scholarship[]>('/finance/scholarships');
  const list = useListParams({ sort: 'date', dir: 'desc' }, ['status']);
  const q = usePagedQuery<ConcessionRow>('/finance/concessions', { ...list.query, group: 'scholarship', ...campusParam });
  const decisions = useConcessionDecisions();
  const confirm = useConfirm();
  const [opening, setOpening] = useState(false);
  const [awarding, setAwarding] = useState(false);
  const close = useApiMutation<{ id: string; status: string }>('patch', (v) => `/finance/scholarships/${v.id}`, {
    invalidate: ['/finance/scholarships'], body: (v) => ({ status: v.status }), success: (_r, v) => `Round marked ${v.status}`,
  });
  const k = s.data?.scholarships;

  return (
    <Page>
      <PageHead title="Scholarships" sub="Merit and need-based awards, with the evidence that supported each decision."
        actions={can('finance.manage') && <>
          <Button icon="plus" onClick={() => setAwarding(true)}>Nominate a student</Button>
          <Button variant="primary" icon="award" onClick={() => setOpening(true)}>Open a scholarship round</Button>
        </>} />
      <Grid cols="g-3col">
        <Kpi icon="award" label="Awards this year" value={k?.awards ?? '—'} tone="teal" loading={s.isLoading} onClick={() => list.setFilter('status', 'Approved')} />
        <Kpi icon="wallet" label="Total value" value={fmt.money(k?.value, { compact: true })} tone="amber" loading={s.isLoading} />
        <Kpi icon="clipboard" label="Applications under review" value={k?.underReview ?? '—'} tone="info" loading={s.isLoading} onClick={() => list.setFilter('status', 'Under Review')} />
      </Grid>

      <Card flush className="mt-4">
        <Toolbar>
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={['Submitted', 'Under Review', 'Approved', 'Rejected']} />
          {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
          <div className="spacer" />
          <ListCount total={q.data?.meta.total} noun="awards and applications" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable rows={q.data?.rows} loading={q.isLoading || q.isPlaceholderData} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            emptyText={list.hasFilters ? 'No awards match this status.' : 'No scholarship awards or applications yet. Nominate a student to start one.'}
            columns={[
              { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={`${r.grade ?? ''}${r.section ?? ''}`} /> },
              { key: 'type', label: 'Award' },
              { key: 'amount', label: 'Value', className: 'num', render: (r) => <Money v={r.amount} strong /> },
              { key: 'basis', label: 'Basis', sortable: false, render: (r) => r.reason ?? '—' },
              { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
              { key: 'a', label: '', className: 'num', sortable: false, render: (r) => can('finance.approve') && decisions.actions(r) },
            ]} />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>

      <div className="mt-5">
        <SectionHead title="Scholarship rounds" sub="Schemes open this academic year and their seats" />
        <Card flush>
          {schemes.error ? <ErrorState error={schemes.error} onRetry={() => schemes.refetch()} /> : (
            <DataTable rows={schemes.data} loading={schemes.isLoading} rowKey={(r) => r.id} emptyText="No scholarship rounds have been opened."
              columns={[
                { key: 'name', label: 'Scheme', render: (r) => <><span className="t-bold">{r.name}</span><div className="t-micro t-muted">{r.criteria}</div></> },
                { key: 'amount', label: 'Award value', className: 'num', render: (r) => <Money v={r.amount} /> },
                { key: 'seats', label: 'Seats filled', render: (r) => <Meter label={`${r.awarded} of ${r.seats}`} value={r.seats ? (r.awarded / r.seats) * 100 : 0} tone="teal" /> },
                { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
                {
                  key: 'a', label: '', className: 'num', render: (r) => can('finance.manage') && r.status === 'Open' && (
                    <Button size="sm" loading={close.isPending && close.variables?.id === r.id} onClick={async () => {
                      if (await confirm({ title: `Close "${r.name}"?`, body: 'No further nominations will be taken for this round.', confirmLabel: 'Close round', danger: true })) close.mutate({ id: r.id, status: 'Closed' });
                    }}>Close round</Button>
                  ),
                },
              ]} />
          )}
        </Card>
      </div>
      {decisions.modal}
      <RoundModal open={opening} onClose={() => setOpening(false)} />
      <ConcessionModal open={awarding} onClose={() => setAwarding(false)} types={AWARD_TYPES} title="Nominate for a scholarship" />
    </Page>
  );
}

function RoundModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ name: '', criteria: '', amount: '', seats: '' });
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setF({ name: '', criteria: '', amount: '', seats: '' }); setTouched(false); } }, [open]);
  const save = useApiMutation<Record<string, unknown>>('post', '/finance/scholarships', { invalidate: ['/finance/scholarships'], onSuccess: onClose });
  const seatsOk = /^\d+$/.test(f.seats) && Number(f.seats) >= 1;
  const errs: Record<string, string> = { ...fieldErrors(save.error) };
  if (touched) {
    if (f.name.trim().length < 3) errs.name = 'Name the scholarship.';
    if (!isMoney(f.amount)) errs.amount = 'Enter the award value.';
    if (!seatsOk) errs.seats = 'Enter the number of seats (1 or more).';
  }
  const set = (key: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [key]: v }));
  return (
    <Modal open={open} onClose={onClose} busy={save.isPending} title="Open a scholarship round"
      foot={<>
        <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={() => {
          setTouched(true);
          if (f.name.trim().length < 3 || !isMoney(f.amount) || !seatsOk) return;
          save.mutate({ name: f.name.trim(), criteria: f.criteria.trim() || undefined, amount: Number(f.amount), seats: Number(f.seats) });
        }}>Open round</Button>
      </>}>
      <div className="col g-3">
        <TextField label="Scheme name" required value={f.name} onChange={set('name')} maxLength={120} error={errs.name} />
        <TextArea label="Eligibility criteria" rows={3} value={f.criteria} onChange={set('criteria')} maxLength={500} />
        <div className="grid g-2col">
          <TextField label="Award value (₹)" required type="number" min="0" value={f.amount} onChange={set('amount')} error={errs.amount} />
          <TextField label="Seats" required type="number" min="1" value={f.seats} onChange={set('seats')} error={errs.seats} />
        </div>
      </div>
    </Modal>
  );
}
