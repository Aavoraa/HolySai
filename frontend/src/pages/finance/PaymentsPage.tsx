import { useState } from 'react';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { api } from '@/api/client';
import { fmt } from '@/lib/format';
import {
  Badge, Button, Card, DataTable, ErrorState, FilterSelect, Grid, Kpi, Page, PageHead, Pagination, SearchInput, Status,
  StudentLink, Toolbar, useToast,
} from '@/components/ui';
import type { PaymentRow, PaymentSummary } from './types';
import { ListCount, Money, ReceiptModal } from './shared';

export default function PaymentsPage() {
  const { campusParam } = useSchool();
  const toast = useToast();
  const list = useListParams({ sort: 'date', dir: 'desc' }, ['method', 'status', 'reconciled', 'from', 'to']);
  const q = usePagedQuery<PaymentRow>('/finance/payments', { ...list.query, ...campusParam });
  const s = useApiQuery<PaymentSummary>('/finance/payments/summary', campusParam);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const qs = new URLSearchParams();
      Object.entries({ ...list.query, ...campusParam }).forEach(([k, v]) => { if (v != null && v !== '' && !['page', 'pageSize'].includes(k)) qs.set(k, String(v)); });
      await api.download(`/finance/payments/export?${qs}`, 'payments.csv');
      toast('Payment register exported', 'success', 'download');
    } catch (err) {
      toast((err as Error).message, 'critical');
    } finally {
      setExporting(false);
    }
  };

  const d = s.data;
  return (
    <Page>
      <PageHead title="Payments" sub="Every transaction across UPI, card, net banking and counter collection."
        actions={<>
          <Button icon="check" to="/reconciliation">Reconcile</Button>
          <Button icon="download" loading={exporting} onClick={exportCsv}>Export</Button>
        </>} />
      <Grid cols="g-4col">
        <Kpi icon="wallet" label="Collected today" value={fmt.money(d?.collectedToday, { compact: true })} tone="teal" loading={s.isLoading}
          foot={d ? `${fmt.money(d.collected30d, { compact: true })} in the last 30 days` : undefined} />
        <Kpi icon="receipt" label="Transactions today" value={d?.transactionsToday ?? '—'} loading={s.isLoading} />
        <Kpi icon="alertCircle" label="Failed or pending" value={d?.failedOrPending ?? '—'} tone="amber" loading={s.isLoading} foot="Last 7 days"
          onClick={() => list.setFilter('status', 'Failed')} />
        <Kpi icon="link" label="Unreconciled" value={d?.unreconciled ?? '—'} tone="critical" loading={s.isLoading} to="/reconciliation" />
      </Grid>
      <Card flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search receipt, reference or student" />
          <FilterSelect label="Method" value={list.filters.method} onChange={(v) => list.setFilter('method', v)} options={['UPI', 'Card', 'Net Banking', 'Cash / DD']} />
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={['Success', 'Initiated', 'Failed', 'Refunded']} />
          <FilterSelect label="Reconciled" value={list.filters.reconciled} onChange={(v) => list.setFilter('reconciled', v)}
            options={[{ value: 'true', label: 'Reconciled' }, { value: 'false', label: 'Not reconciled' }]} />
          <input className="input fw-date" type="date" aria-label="Paid from" title="Paid from" value={list.filters.from} max={list.filters.to || undefined}
            onChange={(e) => list.setFilter('from', e.target.value)} />
          <input className="input fw-date" type="date" aria-label="Paid to" title="Paid to" value={list.filters.to} min={list.filters.from || undefined}
            onChange={(e) => list.setFilter('to', e.target.value)} />
          {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
          <div className="spacer" />
          <ListCount total={q.data?.meta.total} noun="transactions" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable rows={q.data?.rows} loading={q.isLoading || q.isPlaceholderData} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            emptyText={list.hasFilters ? 'No transactions match the current filters — clear a filter to widen the search.' : 'No payments recorded yet. Counter payments are taken from a student ledger; online payments appear automatically.'}
            columns={[
              { key: 'receiptNo', label: 'Reference', render: (r) => <><span className="t-bold t-num">{r.receiptNo}</span><div className="t-micro t-muted">{r.gatewayRef ?? (r.collectedBy ? `Counter · ${r.collectedBy}` : '—')}</div></> },
              { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={`${r.grade ?? ''}${r.section ?? ''} · ${r.admissionNo}`} /> },
              { key: 'amount', label: 'Amount', className: 'num', render: (r) => <Money v={r.amount} strong /> },
              { key: 'method', label: 'Method', render: (r) => <Badge tone="neutral">{r.method}</Badge> },
              { key: 'date', label: 'When', render: (r) => fmt.dateTime(r.paidAt) },
              { key: 'status', label: 'Status', render: (r) => <Status value={r.status === 'Success' ? 'Paid' : r.status} /> },
              {
                key: 'reconciled', label: 'Bank', sortable: false, render: (r) => (r.status !== 'Success' ? <span className="t-faint">—</span>
                  : r.reconciled ? <Badge tone="success" dot>Matched</Badge> : <Badge tone="warning" dot>Open</Badge>),
              },
              { key: 'a', label: '', className: 'num', sortable: false, render: (r) => r.status === 'Success' && <Button size="sm" icon="receipt" onClick={() => setReceipt(r.id)}>Receipt</Button> },
            ]} />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      <ReceiptModal paymentId={receipt} onClose={() => setReceipt(null)} />
    </Page>
  );
}
