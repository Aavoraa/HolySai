import { useState } from 'react';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useSchool } from '@/layouts/SchoolContext';
import { useAuth } from '@/auth/AuthContext';
import {
  Badge, Button, Card, DataTable, ErrorState, FilterSelect, Grid, Kpi, Page, PageHead, Pagination, Person, SearchInput, Segment, Status,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { CloseFollowUpModal, FollowUpModal } from './LeadForms';
import { LeadProfileHost } from './LeadProfile';
import { useCounsellors, useLeadParam, whenLabel } from './shared';
import type { Visit } from './types';

interface Summary { thisWeek: number; needHost: number; upcoming: number; completed: number; visitToApplication: number; noShowRate: number; noShowDelta: number | null }

const RANGES = [
  { id: 'week', label: 'This week' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'past', label: 'Past' }, { id: 'all', label: 'All' },
] as const;
type Range = (typeof RANGES)[number]['id'];

export default function VisitsPage() {
  const { can } = useAuth();
  const manage = can('admissions.manage');
  const { campusParam } = useSchool();
  const { openLead } = useLeadParam();
  const counsellors = useCounsellors();
  const list = useListParams({ sort: 'when', dir: 'asc' }, ['range', 'status', 'unhosted']);
  const range = (list.filters.range || 'week') as Range;
  const q = usePagedQuery<Visit>('/visits', { ...list.query, range, ...campusParam });
  const s = useApiQuery<Summary>('/visits/summary', campusParam);
  const [scheduling, setScheduling] = useState(false);
  const [closing, setClosing] = useState<{ v: Visit; status: 'Completed' | 'Missed' | 'Cancelled' } | null>(null);
  const host = useApiMutation<{ id: string; assignedTo: string | null }>('patch', (x) => `/follow-ups/${x.id}`, {
    body: (x) => ({ assignedTo: x.assignedTo }), invalidate: ['/visits', '/enquiries', '/admissions', '/follow-ups'], success: 'Host updated',
  });
  const d = s.data;
  const title = RANGES.find((r) => r.id === range)!.label;

  return (
    <Page>
      <PageHead title="Campus Visits" sub="Scheduling, hosting and the outcome of every visit."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setScheduling(true)}>Schedule visit</Button>} />
      {s.error ? <ErrorState error={s.error} onRetry={() => s.refetch()} /> : (
        <Grid cols="g-4col">
          <Kpi icon="calendar" label="Visits this week" value={d?.thisWeek ?? '—'} tone="amber" loading={s.isLoading}
            foot={d ? (d.needHost ? `${d.needHost} need a host` : 'Every visit has a host') : undefined}
            onClick={() => list.setFilter('unhosted', d?.needHost ? 'true' : '')} />
          <Kpi icon="checkSquare" label="Completed this year" value={d?.completed ?? '—'} tone="teal" loading={s.isLoading} onClick={() => { list.setFilter('range', 'past'); }} />
          <Kpi icon="fileText" label="Visit → application" value={d ? `${d.visitToApplication}%` : '—'} tone="teal" loading={s.isLoading} foot="Visited families who applied" />
          <Kpi icon="alertCircle" label="No-show rate" value={d ? `${d.noShowRate}%` : '—'} tone="critical" delta={d?.noShowDelta} deltaUnit=" pts" inverse loading={s.isLoading}
            foot="Last 90 days vs the year" />
        </Grid>
      )}
      <div className="mt-4">
        <Card title={title} flush actions={
          <span className="row g-2 wrap">
            <Segment items={RANGES.map((r) => ({ id: r.id, label: r.label }))} active={range} onChange={(id) => list.setFilter('range', id === 'week' ? '' : id)} />
          </span>
        }>
          <div className="toolbar">
            <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search family or reference" />
            <FilterSelect label="Status" value={list.filters.status} onChange={(x) => list.setFilter('status', x)} options={['Scheduled', 'Completed', 'Missed', 'Cancelled']} />
            <FilterSelect label="Host" value={list.filters.unhosted} onChange={(x) => list.setFilter('unhosted', x)} options={[{ value: 'true', label: 'Not assigned' }]} />
          </div>
          {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <DataTable
              rows={q.data?.rows}
              loading={q.isLoading || q.isPlaceholderData}
              rowKey={(r) => r.id}
              sort={list.sort}
              onSort={list.setSort}
              onRowClick={(r) => openLead(r.code)}
              emptyText={range === 'week' ? 'No campus visits this week. Schedule one from here or from a lead profile.' : 'No campus visits match the current filters.'}
              columns={[
                {
                  key: 'when', label: 'When', render: (r) => (
                    <span className={r.overdue ? 't-critical t-bold' : ''}>
                      {whenLabel(r.scheduledAt)}
                    </span>
                  ),
                },
                { key: 'family', label: 'Family', render: (r) => <Person name={r.family} meta={`${r.studentName} · ${r.code}`} /> },
                { key: 'grade', label: 'Grade', render: (r) => `${r.grade} · ${r.campusName}` },
                {
                  key: 'host', label: 'Host', render: (r) => manage && r.status === 'Scheduled' ? (
                    <span className={r.hostId ? undefined : 'adm-host--none'} onClick={(e) => e.stopPropagation()}>
                      <FilterSelect label="Host" allLabel={null} value={r.hostId ?? ''}
                        onChange={(x) => host.mutate({ id: r.id, assignedTo: x || null })}
                        options={[{ value: '', label: 'Not assigned' }, ...(counsellors.data ?? []).map((c) => ({ value: c.id, label: c.fullName }))]} />
                    </span>
                  ) : r.host ?? <Badge tone="critical">Not assigned</Badge>,
                },
                {
                  key: 'status', label: 'Status', render: (r) => (
                    <span title={r.outcome ?? undefined}>{r.overdue ? <Badge tone="warning">Outcome due</Badge> : <Status value={r.status === 'Missed' ? 'No-show' : r.status} />}</span>
                  ),
                },
                ...(manage ? [{
                  key: 'act', label: '', sortable: false, className: 'num', render: (r: Visit) => r.status === 'Scheduled' ? (
                    <span className="adm-actions" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" icon="check" onClick={() => setClosing({ v: r, status: 'Completed' })}>Completed</Button>
                      {new Date(r.scheduledAt).getTime() < Date.now()
                        ? <Button size="sm" variant="quiet" onClick={() => setClosing({ v: r, status: 'Missed' })}>No-show</Button>
                        : <Button size="sm" variant="quiet" onClick={() => setClosing({ v: r, status: 'Cancelled' })}>Cancel</Button>}
                    </span>
                  ) : <span className="t-xs t-muted">{r.completedAt ? fmt.relative(r.completedAt) : ''}</span>,
                }] : []),
              ]}
            />
          )}
          <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
        </Card>
      </div>
      {scheduling && <FollowUpModal type="Campus Visit" onClose={() => setScheduling(false)} />}
      {closing && (
        <CloseFollowUpModal followUp={{ id: closing.v.id, type: 'Campus Visit', scheduledAt: closing.v.scheduledAt }} status={closing.status} onClose={() => setClosing(null)} />
      )}
      <LeadProfileHost />
    </Page>
  );
}
