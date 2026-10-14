import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { fmt } from '@/lib/format';
import {
  Badge, Button, Card, DataTable, ErrorState, FilterSelect, Flow, Page, PageHead, Pagination, SearchInput, StudentLink, Toolbar,
} from '@/components/ui';
import type { PaymentRow, PaymentSummary } from './types';
import { ListCount, Money, ReceiptModal } from './shared';

export default function ReceiptsPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const list = useListParams({ sort: 'date', dir: 'desc' }, ['delivery']);
  const q = usePagedQuery<PaymentRow>('/finance/payments', { ...list.query, status: 'Success', ...campusParam });
  const s = useApiQuery<PaymentSummary>('/finance/payments/summary', campusParam);
  const [receipt, setReceipt] = useState<string | null>(null);
  const send = useApiMutation<string>('post', (id) => `/finance/payments/${id}/send-receipt`, { invalidate: ['/finance/payments'], body: () => ({}) });
  const pending = s.data?.receiptsPending ?? 0;

  return (
    <Page>
      <PageHead title="Receipts" sub="Issued automatically on payment, delivered to the parent on WhatsApp and stored against the student."
        actions={pending > 0 && <Button icon="message" onClick={() => list.setFilter('delivery', 'Pending')}>{pending} awaiting delivery</Button>} />
      <Card>
        <Flow steps={[
          { label: 'Pay Now', meta: 'Parent app or counter', state: 'done' },
          { label: 'Payment success', meta: 'Gateway confirms', state: 'done' },
          { label: 'Receipt issued', meta: s.data ? `${fmt.n(s.data.receiptsDelivered + pending)} numbered and stored` : 'Numbered and stored', state: 'done' },
          { label: 'WhatsApp receipt', meta: pending ? `${pending} awaiting delivery` : 'Delivered to the parent', state: 'active' },
        ]} />
      </Card>
      <Card flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search receipt or student" />
          <FilterSelect label="Delivery" value={list.filters.delivery} onChange={(v) => list.setFilter('delivery', v)} options={['Delivered', 'Pending']} />
          {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
          <div className="spacer" />
          <ListCount total={q.data?.meta.total} noun="receipts" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable rows={q.data?.rows} loading={q.isLoading || q.isPlaceholderData} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            emptyText={list.hasFilters ? 'No receipts match the current filters.' : 'No receipts issued yet. A numbered receipt is created automatically for every successful payment.'}
            columns={[
              { key: 'receiptNo', label: 'Receipt', render: (r) => <span className="t-bold t-num">{r.receiptNo}</span> },
              { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={r.admissionNo} /> },
              { key: 'amount', label: 'Amount', className: 'num', render: (r) => <Money v={r.amount} strong /> },
              { key: 'date', label: 'Issued', render: (r) => fmt.date(r.paidAt) },
              { key: 'delivery', label: 'Delivery', sortable: false, render: (r) => <Badge tone={r.delivery === 'Delivered' ? 'success' : 'warning'}>{r.delivery}</Badge> },
              {
                key: 'a', label: '', className: 'num', sortable: false, render: (r) => (
                  <div className="row g-2 end">
                    {can('finance.manage') && r.delivery === 'Pending' && (
                      <Button size="sm" icon="message" loading={send.isPending && send.variables === r.id} onClick={() => send.mutate(r.id)}>Send on WhatsApp</Button>
                    )}
                    <Button size="sm" icon="receipt" onClick={() => setReceipt(r.id)}>View / print</Button>
                  </div>
                ),
              },
            ]} />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      <ReceiptModal paymentId={receipt} onClose={() => setReceipt(null)} />
    </Page>
  );
}
