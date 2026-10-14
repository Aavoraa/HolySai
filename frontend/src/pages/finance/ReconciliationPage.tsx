import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { fmt } from '@/lib/format';
import {
  Badge, Button, Card, DataTable, Empty, ErrorState, FilterSelect, Grid, Kpi, Modal, Page, PageHead, Pagination, SearchInput,
  Skeleton, Status, Toolbar, useConfirm,
} from '@/components/ui';
import type { ReconCandidate, ReconLine, ReconSummary } from './types';
import { ListCount, Money, ReasonModal } from './shared';

export default function ReconciliationPage() {
  const { can } = useAuth();
  const s = useApiQuery<ReconSummary>('/finance/reconciliation/summary');
  const exceptions = useApiQuery<ReconLine[]>('/finance/reconciliation/lines', { status: 'Exception', pageSize: 50 });
  const list = useListParams({ sort: 'date', dir: 'desc' }, ['status']);
  const q = usePagedQuery<ReconLine>('/finance/reconciliation/lines', list.query);
  const confirm = useConfirm();
  const [matching, setMatching] = useState<ReconLine | null>(null);
  const [noting, setNoting] = useState<{ line: ReconLine; kind: 'exception' | 'resolve' } | null>(null);
  const run = useApiMutation<void>('post', '/finance/reconciliation/run', { invalidate: ['/finance/reconciliation', '/finance/payments'], body: () => ({}) });
  const note = useApiMutation<{ id: string; kind: string; note: string }>('post', (v) => `/finance/reconciliation/lines/${v.id}/${v.kind}`, {
    invalidate: ['/finance/reconciliation', '/finance/payments'], body: (v) => ({ note: v.note }), onSuccess: () => setNoting(null),
  });
  const manage = can('finance.manage');
  const d = s.data;
  const latest = d?.latestDate ? fmt.date(d.latestDate) : '—';

  const actions = (r: ReconLine) => manage && (
    <div className="row g-2 end">
      {['Exception', 'Unmatched'].includes(r.status) && <Button size="sm" onClick={() => setMatching(r)}>Match manually</Button>}
      {r.status === 'Exception' && <Button size="sm" variant="quiet" onClick={() => setNoting({ line: r, kind: 'resolve' })}>Resolve</Button>}
      {['Unmatched', 'Matched'].includes(r.status) && <Button size="sm" variant="quiet" onClick={() => setNoting({ line: r, kind: 'exception' })}>Flag</Button>}
    </div>
  );

  return (
    <Page>
      <PageHead title="Reconciliation" sub="Gateway settlements matched against the fee ledger, every day."
        actions={manage && (
          <Button variant="primary" icon="refresh" loading={run.isPending} onClick={async () => {
            if (await confirm({ title: 'Run reconciliation?', body: `${d?.unmatched ?? 0} unmatched statement line(s) will be matched on reference and amount; anything that does not match becomes an exception.`, confirmLabel: 'Run now' })) run.mutate(undefined);
          }}>Run reconciliation</Button>
        )} />
      <Grid cols="g-4col">
        <Kpi icon="checkSquare" label="Matched in latest statement" value={d?.matchedLatest ?? '—'} tone="teal" loading={s.isLoading} foot={`Statement of ${latest}`} />
        <Kpi icon="alert" label="Exceptions" value={d?.exceptions ?? '—'} tone="critical" loading={s.isLoading} foot={d?.unmatched ? `${d.unmatched} line(s) not yet run` : undefined}
          onClick={() => list.setFilter('status', 'Exception')} />
        <Kpi icon="wallet" label="Settlement received" value={fmt.money(d?.settlementLatest, { compact: true })} loading={s.isLoading} foot={latest} />
        <Kpi icon="truck" label="In transit" value={fmt.money(d?.inTransit, { compact: true })} tone="amber" loading={s.isLoading} foot="Online payments awaiting settlement" />
      </Grid>

      <div className="mt-4">
        <Card title={<span className="fw-queue">Exceptions{exceptions.data?.length ? <Badge tone="critical">{exceptions.data.length}</Badge> : null}</span>} sub="Items that did not match automatically — match manually or resolve with a note" flush>
          {exceptions.error ? <ErrorState error={exceptions.error} onRetry={() => exceptions.refetch()} /> : (
            <DataTable rows={exceptions.data} loading={exceptions.isLoading} rowKey={(r) => r.id} emptyText="No exceptions — every settlement is matched."
              columns={[
                { key: 'ref', label: 'Reference', render: (r) => <><span className="t-num t-bold">{r.reference}</span><div className="t-micro t-muted">{r.channel} · {fmt.date(r.statementDate)}</div></> },
                { key: 'issue', label: 'Issue', render: (r) => r.note ?? '—' },
                { key: 'amount', label: 'Amount', className: 'num', render: (r) => <Money v={r.amount} strong /> },
                { key: 'a', label: '', className: 'num', render: actions },
              ]} />
          )}
        </Card>
      </div>

      <Card icon="grid" title="Statement lines" flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search reference, receipt or note" />
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={['Matched', 'Unmatched', 'Exception', 'Resolved']} />
          {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
          <div className="spacer" />
          <ListCount total={q.data?.meta.total} noun="lines" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable rows={q.data?.rows} loading={q.isLoading || q.isPlaceholderData} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            emptyText={list.hasFilters ? 'No statement lines match the current filters.' : 'No statement lines imported yet.'}
            columns={[
              { key: 'date', label: 'Date', render: (r) => fmt.date(r.statementDate) },
              { key: 'reference', label: 'Reference', render: (r) => <><span className="t-num">{r.reference}</span><div className="t-micro t-muted">{r.channel}</div></> },
              { key: 'amount', label: 'Amount', className: 'num', render: (r) => <Money v={r.amount} strong /> },
              { key: 'receipt', label: 'Ledger', sortable: false, render: (r) => (r.receiptNo ? <>{r.receiptNo}<div className="t-micro t-muted">{r.studentName}</div></> : <span className="t-faint">—</span>) },
              { key: 'status', label: 'Status', render: (r) => <><Status value={r.status} />{r.note && r.status !== 'Matched' && <div className="t-micro t-muted fw-note">{r.note}</div>}</> },
              { key: 'a', label: '', className: 'num', sortable: false, render: actions },
            ]} />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>

      <MatchModal line={matching} onClose={() => setMatching(null)} />
      <ReasonModal open={!!noting} busy={note.isPending} label="Note"
        title={noting?.kind === 'resolve' ? `Resolve ${noting.line.reference}` : `Flag ${noting?.line.reference ?? ''} as an exception`}
        sub={noting ? `${noting.line.channel} · ${fmt.money(noting.line.amount)}` : ''}
        confirmLabel={noting?.kind === 'resolve' ? 'Mark resolved' : 'Flag exception'} danger={noting?.kind === 'exception'}
        onClose={() => setNoting(null)} onSubmit={(text) => noting && note.mutate({ id: noting.line.id, kind: noting.kind, note: text })} />
    </Page>
  );
}

function MatchModal({ line, onClose }: { line: ReconLine | null; onClose: () => void }) {
  const c = useApiQuery<ReconCandidate[]>(line ? `/finance/reconciliation/lines/${line.id}/candidates` : null);
  const confirm = useConfirm();
  const match = useApiMutation<string>('post', `/finance/reconciliation/lines/${line?.id}/match`, {
    invalidate: ['/finance/reconciliation', '/finance/payments'], body: (paymentId) => ({ paymentId }), onSuccess: onClose,
  });
  return (
    <Modal open={!!line} onClose={onClose} busy={match.isPending} size="wide" title={`Match ${line?.reference ?? ''}`}
      sub={line ? `${line.channel} settlement of ${fmt.money(line.amount)} on ${fmt.date(line.statementDate)}` : ''}>
      {c.isLoading && <Skeleton height={120} />}
      {c.error ? <ErrorState error={c.error} onRetry={() => c.refetch()} /> : null}
      {c.data && !c.data.length && <Empty icon="search" title="No candidate receipts" sub="No unreconciled payment has this reference or a similar amount. Resolve the line with a note instead." />}
      {c.data && c.data.length > 0 && (
        <DataTable compact rows={c.data} rowKey={(r) => r.id}
          columns={[
            { key: 'receipt', label: 'Receipt', render: (r) => <><span className="t-bold">{r.receiptNo}</span><div className="t-micro t-muted">{r.gatewayRef ?? r.method}</div></> },
            { key: 'student', label: 'Student', render: (r) => <>{r.studentName}<div className="t-micro t-muted">{r.admissionNo}</div></> },
            { key: 'amount', label: 'Amount', className: 'num', render: (r) => <><Money v={r.amount} />{r.amountDiff > 0 && <div className="t-micro t-critical">differs by {fmt.money(r.amountDiff)}</div>}</> },
            { key: 'paid', label: 'Paid', render: (r) => fmt.dateTime(r.paidAt) },
            { key: 'why', label: 'Match', render: (r) => (r.referenceMatch ? <Badge tone="success">Same reference</Badge> : <Badge tone="warning">Similar amount</Badge>) },
            {
              key: 'a', label: '', className: 'num', render: (r) => (
                <Button size="sm" variant="teal" loading={match.isPending && match.variables === r.id} onClick={async () => {
                  if (await confirm({ title: `Match to ${r.receiptNo}?`, body: r.amountDiff > 0 ? `The amounts differ by ${fmt.money(r.amountDiff)}; the difference will be noted on the line.` : 'The receipt will be marked as reconciled.', confirmLabel: 'Match' })) match.mutate(r.id);
                }}>Match</Button>
              ),
            },
          ]} />
      )}
    </Modal>
  );
}
