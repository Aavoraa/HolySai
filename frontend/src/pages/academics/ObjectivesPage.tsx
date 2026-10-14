import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import { Button, Card, DataTable, ErrorState, FilterSelect, Meter, Page, PageHead, Pagination, SearchInput, Toolbar } from '@/components/ui';
import { ObjectiveModal, type ObjectiveRow } from './objectiveForms';

export default function ObjectivesPage() {
  const { can } = useAuth();
  const { lookups } = useLookups();
  const list = useListParams({ sort: 'code', pageSize: 25 }, ['subjectId', 'stage']);
  const q = usePagedQuery<ObjectiveRow>('/academics/objectives', list.query);
  const stages = useApiQuery<string[]>('/academics/objectives/stages', undefined, { staleTime: 300_000 });
  const [editing, setEditing] = useState<ObjectiveRow | 'new' | null>(null);
  const canEdit = can('academics.manage') && can('students.read');

  return (
    <Page>
      <PageHead
        title="Cambridge Objectives"
        sub="Each objective is tracked for coverage and for mastery, so a gap is visible before the exam is."
        actions={canEdit && <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Add objective</Button>}
      />
      <Card flush>
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search code or objective" />
          <FilterSelect label="Subject" value={list.filters.subjectId} onChange={(v) => list.setFilter('subjectId', v)} options={(lookups?.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          <FilterSelect label="Stage" value={list.filters.stage} onChange={(v) => list.setFilter('stage', v)} options={stages.data ?? []} />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable
            rows={q.data?.rows}
            loading={q.isLoading}
            rowKey={(r) => r.id}
            sort={list.sort}
            onSort={list.setSort}
            emptyText={list.hasFilters ? 'No objectives match these filters.' : canEdit ? 'No objectives mapped yet. Use “Add objective”, or import them from the Curriculum page.' : 'No objectives mapped yet.'}
            columns={[
              { key: 'code', label: 'Code', render: (r) => <span className="t-bold t-num">{r.code}</span> },
              { key: 'text', label: 'Objective', render: (r) => <>{r.text}{r.lessonPlans > 0 && <div className="t-micro t-muted">{r.lessonPlans} lesson plan{r.lessonPlans === 1 ? '' : 's'}</div>}</> },
              { key: 'subject', label: 'Subject', render: (r) => r.subject },
              { key: 'stage', label: 'Stage', render: (r) => r.stage },
              { key: 'coverage', label: 'Coverage', render: (r) => <Meter label="" value={r.coverage} right={`${r.coverage}%`} tone="info" /> },
              { key: 'mastery', label: 'Mastery', render: (r) => <Meter label="" value={r.mastery} right={`${r.mastery}%`} tone={r.mastery >= 75 ? 'teal' : 'amber'} /> },
              {
                key: 'a', label: '', sortable: false, className: 'num', render: (r) => (
                  <span className="ac-links">
                    {can('ai.use') && <Button size="sm" variant="amber" icon="sparkle" to="/copilot">Practice</Button>}
                    {canEdit && <Button size="sm" icon="edit" onClick={() => setEditing(r)} aria-label={`Edit ${r.code}`}>Edit</Button>}
                  </span>
                ),
              },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      {editing && <ObjectiveModal objective={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}
