import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, DataTable, ErrorState, FilterSelect, Grid, Icon, Kpi, Page, PageHead, Pagination, SearchInput, StudentLink, Toolbar } from '@/components/ui';
import { useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useSchool } from '@/layouts/SchoolContext';
import { fmt } from '@/lib/format';

interface Row {
  id: string; title: string; type: string; level: string | null; achievedOn: string; verified: boolean; verifiedBy: string | null;
  studentId: string; studentName: string; admissionNo: string; grade: string | null; section: string | null; projectId: string | null; projectCode: string | null;
}
interface Summary { thisYear: number; lastYear: number; competition: number; academic: number; other: number; total: number }

export default function AchievementsPage() {
  const list = useListParams({ sort: 'date', dir: 'desc' }, ['type']);
  const { campusParam } = useSchool();
  const navigate = useNavigate();
  const q = usePagedQuery<Row>('/innovation/achievements', { ...list.query, ...campusParam });
  const sum = useApiQuery<Summary>('/innovation/achievements/summary', campusParam);
  const types = useApiQuery<string[]>('/innovation/achievement-types', undefined, { staleTime: 5 * 60_000 });
  const s = sum.data;
  const delta = s && s.lastYear ? Math.round(((s.thisYear - s.lastYear) / s.lastYear) * 100) : null;
  return (
    <Page>
      <PageHead title="Achievements" sub="Verified recognition of Innovation Lab students, recorded on the student profile and in the portfolio." />
      <Grid cols="g-4col">
        <Kpi icon="award" label="Achievements this year" value={fmt.n(s?.thisYear)} tone="teal" delta={delta} deltaUnit="% vs last year" loading={sum.isLoading} />
        <Kpi icon="rocket" label="Competition & innovation" value={fmt.n(s?.competition)} tone="amber" loading={sum.isLoading} onClick={() => list.setFilter('type', 'Competition')} />
        <Kpi icon="graduation" label="Academic honours" value={fmt.n(s?.academic)} tone="info" loading={sum.isLoading} onClick={() => list.setFilter('type', 'Academic')} />
        <Kpi icon="star" label="Sport, arts and other" value={fmt.n(s?.other)} loading={sum.isLoading} />
      </Grid>
      <Card flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search achievement or student" />
          <FilterSelect label="Type" value={list.filters.type} onChange={(v) => list.setFilter('type', v)} options={types.data ?? []} />
          {list.hasFilters && <Button size="sm" variant="quiet" icon="x" onClick={list.clear}>Clear filters</Button>}
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
          <DataTable<Row>
            rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            onRowClick={(r) => navigate(`/student-360/${r.studentId}`)}
            emptyText={list.hasFilters ? 'No achievements match these filters.' : 'No achievements recorded yet. They are added when a project completes or from Student 360.'}
            columns={[
              { key: 'title', label: 'Achievement', render: (r) => <span className="row g-3"><Icon name="award" size={16} className="t-warning" />
                <span><span className="t-bold">{r.title}</span>{r.projectCode && <div className="t-micro"><Link to={`/projects/${r.projectId}`} className="t-info" onClick={(e) => e.stopPropagation()}>Project {r.projectCode}</Link></div>}</span></span> },
              { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={`${r.grade ?? ''}${r.section ?? ''}`} /> },
              { key: 'type', label: 'Type', render: (r) => <>{r.type}{r.level && <div className="t-micro t-muted">{r.level}</div>}</> },
              { key: 'date', label: 'Date', render: (r) => <span className="t-num">{fmt.date(r.achievedOn)}</span> },
              { key: 'verified', label: 'Verification', sortable: false, render: (r) => <Badge tone={r.verified ? 'success' : 'neutral'} icon={r.verified ? 'check' : undefined}
                title={r.verifiedBy ? `Verified by ${r.verifiedBy}` : undefined}>{r.verified ? 'Verified' : 'Unverified'}</Badge> },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
    </Page>
  );
}
