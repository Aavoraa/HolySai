import { useState } from 'react';
import { usePagedQuery, useApiMutation } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useSchool } from '@/layouts/SchoolContext';
import { useAuth } from '@/auth/AuthContext';
import { Button, Card, ErrorState, FilterSelect, Page, PageHead, Pagination, SearchInput, Toolbar, useConfirm } from '@/components/ui';
import { fmt } from '@/lib/format';
import { LeadFormModal } from './LeadForms';
import { LeadProfileHost } from './LeadProfile';
import { LeadsTable, useCounsellors, useLeadParam } from './shared';
import { SOURCES, STAGES, type Lead } from './types';

export default function LeadsPage() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const { campusParam } = useSchool();
  const { openLead } = useLeadParam();
  const counsellors = useCounsellors();
  const list = useListParams({ sort: 'created', dir: 'desc' }, ['stage', 'source', 'counsellorId', 'overdue']);
  const q = usePagedQuery<Lead>('/enquiries', { ...list.query, ...campusParam });
  const unassigned = usePagedQuery<Lead>('/enquiries', { counsellorId: 'unassigned', open: true, pageSize: 1, ...campusParam });
  const [adding, setAdding] = useState(false);
  const autoAssign = useApiMutation<Record<string, unknown>>('post', '/enquiries/auto-assign', { invalidate: ['/enquiries', '/admissions'] });
  const unassignedCount = unassigned.data?.meta.total ?? 0;

  const assignAll = async () => {
    const ok = await confirm({
      title: `Assign ${unassignedCount} unassigned lead${unassignedCount === 1 ? '' : 's'}?`,
      body: 'Each open lead without a counsellor goes to the admissions counsellor with the fewest open leads. Counsellors with a user account are notified.',
      confirmLabel: 'Assign counsellors', icon: 'userCheck',
    });
    if (ok) autoAssign.mutate(campusParam);
  };

  return (
    <Page>
      <PageHead
        title="Leads"
        sub="Every enquiry becomes a lead, whatever channel it arrived through."
        actions={can('admissions.manage') && (
          <>
            <Button icon="userCheck" onClick={assignAll} loading={autoAssign.isPending} disabled={!unassignedCount}
              title={unassignedCount ? undefined : 'Every open lead has a counsellor'}>
              Assign counsellor{unassignedCount ? ` (${unassignedCount})` : ''}
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add lead</Button>
          </>
        )}
      />
      <Card flush>
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search student, parent or reference" />
          <FilterSelect label="Stage" value={list.filters.stage} onChange={(x) => list.setFilter('stage', x)} options={[...STAGES, 'Lost']} />
          <FilterSelect label="Source" value={list.filters.source} onChange={(x) => list.setFilter('source', x)} options={[...SOURCES]} />
          <FilterSelect label="Counsellor" value={list.filters.counsellorId} onChange={(x) => list.setFilter('counsellorId', x)}
            options={[{ value: 'unassigned', label: 'Unassigned' }, ...(counsellors.data ?? []).map((c) => ({ value: c.id, label: c.fullName }))]} />
          <FilterSelect label="Follow-up" value={list.filters.overdue} onChange={(x) => list.setFilter('overdue', x)} options={[{ value: 'true', label: 'Overdue only' }]} />
          {list.hasFilters && <Button size="sm" variant="quiet" icon="x" onClick={list.clear}>Clear filters</Button>}
          <div className="spacer" />
          <span className="t-sm t-muted t-num">{q.data ? `${fmt.n(q.data.meta.total)} ${list.hasFilters ? 'matching' : 'leads'}` : ''}</span>
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <LeadsTable rows={q.data?.rows} loading={q.isLoading || q.isPlaceholderData} sort={list.sort} onSort={list.setSort} onOpen={openLead}
            emptyText={list.hasFilters ? 'No leads match the current filters. Clear them to see every lead.' : 'No leads yet. Enquiries from every channel appear here — use “Add lead” to record a walk-in or phone enquiry.'} />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      {adding && <LeadFormModal onClose={() => setAdding(false)} onCreated={(code) => { setAdding(false); openLead(code); }} />}
      <LeadProfileHost />
    </Page>
  );
}
