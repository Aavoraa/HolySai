import { useState } from 'react';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { fmt } from '@/lib/format';
import {
  Badge, Button, Card, Chips, DataTable, ErrorState, Grid, Kpi, Page, PageHead, Pagination, SearchInput, Status, Toolbar, useConfirm,
} from '@/components/ui';
import { ListCount, Money, ReasonModal } from '../finance/shared';
import type { ApprovalSummary, PendingApproval } from './types';

/**
 * Central Approvals inbox — every request across the school that is waiting for a
 * Super Admin decision. Decisions go through each module's own workflow on the API.
 */
export default function ApprovalsPage() {
  const { campusParam, campus } = useSchool();
  const confirm = useConfirm();
  const list = useListParams({ sort: 'age', dir: 'desc' }, ['module']);
  const q = usePagedQuery<PendingApproval>('/approvals/pending', { ...list.query, ...campusParam });
  const s = useApiQuery<ApprovalSummary>('/approvals/summary', campusParam);
  const [rejecting, setRejecting] = useState<PendingApproval | null>(null);
  const decide = useApiMutation<{ row: PendingApproval; decision: 'approve' | 'reject'; reason?: string }>(
    'post', (v) => `/approvals/${v.row.module}/${encodeURIComponent(v.row.id)}/decide`,
    {
      // Decisions change the module's own lists and counts too.
      invalidate: ['/approvals', '/planning', '/finance', '/workforce', '/payroll', '/academics', '/circulars', '/documents',
        '/applications', '/maintenance', '/certificates', '/group', '/innovation', '/notifications'],
      body: (v) => ({ decision: v.decision, reason: v.reason }),
      onSuccess: () => setRejecting(null),
    },
  );
  const busy = (row: PendingApproval, d: string) => decide.isPending && decide.variables?.row.id === row.id && decide.variables.decision === d;
  const sm = s.data;
  const withItems = (sm?.modules ?? []).filter((m) => m.count > 0);
  const moneyPending = (sm?.modules ?? []).reduce((a, m) => a + (m.amount ?? 0), 0);

  return (
    <Page>
      <PageHead title="Approvals" sub="Everything waiting for your decision, across every module. Only the Super Admin approves or rejects; others prepare and submit." />
      <Grid cols="g-4col">
        <Kpi icon="shieldCheck" label="Awaiting your decision" tone="amber" value={sm ? fmt.n(sm.total) : '—'} loading={s.isLoading}
          foot={campus ? campus.shortName : 'All campuses'} />
        <Kpi icon="wallet" label="Value awaiting approval" value={fmt.money(moneyPending, { compact: true })} loading={s.isLoading}
          foot="Budget plans, expenses, claims, payroll…" />
        <Kpi icon="clock" label="Waiting over 7 days" tone={sm && sm.over7Days > 0 ? 'critical' : 'teal'} value={sm ? fmt.n(sm.over7Days) : '—'} loading={s.isLoading}
          foot={sm?.oldestAt ? `Oldest ${fmt.relative(sm.oldestAt)}` : 'Nothing overdue'} onClick={() => list.setSort({ key: 'age', dir: 'desc' })} />
        <Kpi icon="grid" label="Modules with requests" value={sm ? fmt.n(withItems.length) : '—'} loading={s.isLoading}
          foot={withItems.slice(0, 3).map((m) => m.label).join(', ') || undefined} />
      </Grid>

      <Card flush className="mt-4">
        <div style={{ padding: '12px 16px 0' }}>
          <Chips active={list.filters.module || 'all'} onChange={(id) => list.setFilter('module', id === 'all' ? '' : id)}
            items={[
              { id: 'all', label: 'All', count: sm?.total },
              ...withItems.map((m) => ({ id: m.module, label: m.label, count: m.count })),
            ]} />
        </div>
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search title, reference or requester" />
          <div className="spacer" />
          <ListCount total={q.data?.meta.total} noun="requests" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable rows={q.data?.rows} loading={q.isLoading || q.isPlaceholderData} rowKey={(r) => `${r.module}:${r.id}`} sort={list.sort} onSort={list.setSort}
            emptyText={list.hasFilters ? 'Nothing matches the current filters.' : 'All clear — nothing is waiting for a decision.'}
            columns={[
              { key: 'module', label: 'Module', render: (r) => <Badge tone="neutral">{r.moduleLabel}</Badge> },
              {
                key: 'title', label: 'Request', sortable: false, render: (r) => <>
                  <span className="t-bold">{r.code && <span className="t-num t-muted">{r.code} · </span>}{r.title}</span>
                  {r.detail && <div className="t-micro t-muted" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.detail}</div>}
                  <div className="t-micro t-muted">{[r.requestedBy, r.campus].filter(Boolean).join(' · ')}</div>
                </>,
              },
              { key: 'amount', label: 'Amount', className: 'num', render: (r) => (r.amount != null ? <Money v={r.amount} strong /> : <span className="t-faint">—</span>) },
              {
                key: 'age', label: 'Waiting', render: (r) => (
                  <span className={r.ageDays > 7 ? 't-critical t-bold' : r.ageDays > 2 ? 't-amber' : undefined} title={fmt.date(r.requestedAt)}>
                    {r.ageDays < 1 ? 'Today' : `${r.ageDays} day${r.ageDays === 1 ? '' : 's'}`}
                  </span>
                ),
              },
              { key: 'status', label: 'Status', sortable: false, render: (r) => <Status value={r.status} /> },
              {
                key: 'a', label: '', className: 'num', sortable: false, render: (r) => (
                  <div className="row g-2 end">
                    <Button size="sm" variant="quiet" to={r.route} iconRight="arrowRight">Open</Button>
                    <Button size="sm" icon="x" disabled={decide.isPending} onClick={() => setRejecting(r)}>Reject</Button>
                    <Button size="sm" variant="teal" icon="check" loading={busy(r, 'approve')} disabled={decide.isPending && !busy(r, 'approve')} onClick={async () => {
                      if (await confirm({
                        title: `Approve ${r.code ?? r.moduleLabel.toLowerCase()}?`,
                        body: `${r.title}${r.amount != null ? ` — ${fmt.money(r.amount)}` : ''}. ${r.module === 'budget_plan' ? 'The full requested amount is approved; open the plan to approve a lower amount.' : 'The module’s own approval rules apply.'}`,
                        confirmLabel: 'Approve', icon: 'check',
                      })) decide.mutate({ row: r, decision: 'approve' });
                    }}>Approve</Button>
                  </div>
                ),
              },
            ]} />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      <ReasonModal open={!!rejecting} title={`Reject ${rejecting?.code ?? rejecting?.moduleLabel ?? ''}`}
        sub={rejecting ? `${rejecting.title}${rejecting.amount != null ? ` — ${fmt.money(rejecting.amount)}` : ''}` : ''}
        label="Reason (sent back to the requester)" confirmLabel="Reject" danger busy={decide.isPending}
        onClose={() => setRejecting(null)} onSubmit={(reason) => rejecting && decide.mutate({ row: rejecting, decision: 'reject', reason })} />
    </Page>
  );
}
