import { useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useSchool } from '@/layouts/SchoolContext';
import {
  Badge, Button, Card, DataTable, ErrorState, FilterSelect, Flow, Page, PageHead, Pagination, SearchInput, Skeleton, Status, Toolbar,
} from '@/components/ui';
import { LeadProfileHost } from './LeadProfile';
import { useLeadParam } from './shared';
import type { ApplicationRow } from './types';

interface Summary {
  live: number; documentsIncomplete: number; underReview: number; assessmentScheduled: number; offersIssued: number;
  offersOpen: number; accepted: number; enrolled: number; rejected: number; withdrawn: number; total: number;
}

const STATUS_OPTIONS = [
  { value: 'live', label: 'Live applications' }, 'Submitted', 'Under Review', 'Assessment Scheduled', 'Offer Made', 'Accepted', 'Enrolled', 'Rejected', 'Withdrawn',
];

export default function ApplicationsPage() {
  const { campusParam } = useSchool();
  const { openLead } = useLeadParam();
  const list = useListParams({ sort: 'created', dir: 'desc' }, ['status', 'documents']);
  const q = usePagedQuery<ApplicationRow>('/applications', { ...list.query, ...campusParam });
  const s = useApiQuery<Summary>('/applications/summary', campusParam);
  const d = s.data;

  return (
    <Page>
      <PageHead title="Applications" sub="Online applications, document checks, assessment and offer." />
      <Card>
        {s.isLoading ? <Skeleton height={56} /> : s.error ? <ErrorState error={s.error} onRetry={() => s.refetch()} /> : d && (
          <Flow steps={[
            { label: 'Application received', meta: `${d.live} live`, state: 'done' },
            { label: 'Documents verified', meta: d.documentsIncomplete ? `${d.documentsIncomplete} incomplete` : 'All complete', state: d.documentsIncomplete ? 'active' : 'done' },
            { label: 'Assessment', meta: `${d.assessmentScheduled} scheduled` },
            { label: 'Offer issued', meta: `${d.offersIssued} this year${d.offersOpen ? ` · ${d.offersOpen} awaiting reply` : ''}` },
            { label: 'Enrolled', meta: `${d.enrolled} this year${d.accepted ? ` · ${d.accepted} ready` : ''}` },
          ]} />
        )}
      </Card>
      <Card flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search applicant, APP- or LD- reference" />
          <FilterSelect label="Status" value={list.filters.status} onChange={(x) => list.setFilter('status', x)} options={STATUS_OPTIONS} />
          <FilterSelect label="Documents" value={list.filters.documents} onChange={(x) => list.setFilter('documents', x)}
            options={[{ value: 'incomplete', label: 'Incomplete' }, { value: 'complete', label: 'Complete' }]} />
          {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
          <div className="spacer" />
          <span className="t-sm t-muted t-num">{q.data ? `${q.data.meta.total} applications` : ''}</span>
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable
            rows={q.data?.rows}
            loading={q.isLoading || q.isPlaceholderData}
            rowKey={(r) => r.id}
            sort={list.sort}
            onSort={list.setSort}
            onRowClick={(r) => r.leadCode && openLead(r.leadCode)}
            emptyText={list.hasFilters ? 'No applications match the current filters.' : 'No applications yet. Open one from a lead profile, or move a lead to the Application stage — the document checklist is created automatically.'}
            columns={[
              {
                key: 'student', label: 'Applicant', render: (r) => (
                  <>
                    <span className="t-bold">{r.studentName}</span>
                    <div className="t-micro t-muted">{[r.applicationNo, r.leadCode, r.parentName].filter(Boolean).join(' · ')}</div>
                  </>
                ),
              },
              { key: 'grade', label: 'Grade', render: (r) => `${r.grade}${r.campusName ? ` · ${r.campusName}` : ''}` },
              { key: 'curriculum', label: 'Curriculum', render: (r) => <span className="t-xs t-muted">{r.curriculum ?? '—'}</span> },
              { key: 'status', label: 'Stage', render: (r) => <Status value={r.status} /> },
              {
                key: 'blocking', label: 'Next step', sortable: false, render: (r) => (
                  <span className="adm-next">
                    <span className={`adm-next__what ${r.offerExpiring ? 't-critical t-bold' : ''}`}>{r.blockingItem}</span>
                    <span className="adm-next__when">
                      {r.offerExpiring && <Badge tone="critical" dot>Offer expiring</Badge>}
                      {r.counsellor ? <span>{r.counsellor}</span> : null}
                    </span>
                  </span>
                ),
              },
              {
                key: 'docs', label: 'Documents', sortable: false, render: (r) => (
                  <Badge tone={r.documentsTotal && r.documentsVerified === r.documentsTotal ? 'success' : 'warning'}>{r.documentsVerified}/{r.documentsTotal}</Badge>
                ),
              },
              {
                key: 'a', label: '', sortable: false, className: 'num', render: (r) => r.leadCode
                  ? <Button size="sm" variant={r.status === 'Accepted' ? 'primary' : undefined} icon={r.status === 'Accepted' ? 'userCheck' : undefined} onClick={(e) => { e.stopPropagation(); openLead(r.leadCode!); }}>{r.status === 'Accepted' ? 'Enrol' : 'Open'}</Button>
                  : null,
              },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      <LeadProfileHost />
    </Page>
  );
}
