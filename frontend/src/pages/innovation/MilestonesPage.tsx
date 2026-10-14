import { Link } from 'react-router-dom';
import { Button, Card, Chips, DataTable, ErrorState, Grid, Kpi, Page, PageHead, Pagination, SearchInput, Status, StudentLink, Toolbar } from '@/components/ui';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { fmt } from '@/lib/format';
import { daysLabel } from '../operations/shared';

interface Row {
  id: string; title: string; dueOn: string | null; completedOn: string | null; status: string; daysLeft: number | null;
  projectId: string; projectCode: string; projectTitle: string; mentor: string | null; studentId: string; studentName: string; grade: string | null; section: string | null;
}
interface Summary { thisYear: number; completed: number; dueThisWeek: number; overdue: number }

export default function MilestonesPage() {
  const list = useListParams({ sort: 'due' }, ['status']);
  const { campusParam } = useSchool();
  const { can } = useAuth();
  const status = list.filters.status || 'open';
  const q = usePagedQuery<Row>('/innovation/milestones', { ...list.query, status: status === 'all' ? undefined : status, ...campusParam });
  const sum = useApiQuery<Summary>('/innovation/milestones/summary', campusParam);
  const complete = useApiMutation<string>('patch', (id) => `/innovation/milestones/${id}`, { invalidate: ['/innovation'], body: () => ({ completed: true }), success: 'Milestone completed' });
  const s = sum.data;
  return (
    <Page>
      <PageHead title="Milestones" sub="Project checkpoints across the lab, and what is running late." />
      <Grid cols="g-4col">
        <Kpi icon="flag" label="Milestones this year" value={fmt.n(s?.thisYear)} loading={sum.isLoading} onClick={() => list.setFilter('status', 'all')} />
        <Kpi icon="checkSquare" label="Completed" value={fmt.n(s?.completed)} tone="teal" loading={sum.isLoading} onClick={() => list.setFilter('status', 'Completed')} />
        <Kpi icon="calendar" label="Due this week" value={fmt.n(s?.dueThisWeek)} tone="amber" loading={sum.isLoading} onClick={() => list.setFilter('status', 'due_week')} />
        <Kpi icon="alert" label="Overdue" value={fmt.n(s?.overdue)} tone="critical" loading={sum.isLoading} onClick={() => list.setFilter('status', 'Overdue')} />
      </Grid>
      <Card flush className="mt-4">
        <Toolbar>
          <Chips active={status} onChange={(v) => list.setFilter('status', v === 'open' ? '' : v)} items={[
            { id: 'open', label: 'Open' }, { id: 'Overdue', label: 'Overdue', tone: 'critical' }, { id: 'due_week', label: 'Due this week', tone: 'warning' },
            { id: 'In Progress', label: 'In progress' }, { id: 'Completed', label: 'Completed', tone: 'success' }, { id: 'all', label: 'All' },
          ]} />
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search milestone, project or student" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
          <DataTable<Row>
            rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            emptyText={list.q ? 'No milestones match this search.' : status === 'Overdue' ? 'Nothing overdue — every milestone is on schedule.' : 'No milestones in this view. Milestones are added on each project page.'}
            columns={[
              { key: 'title', label: 'Milestone', render: (r) => <><span className="t-bold">{r.title}</span>
                <div className="t-micro"><Link to={`/projects/${r.projectId}`} className="t-info">{r.projectCode} · {r.projectTitle}</Link></div></> },
              { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={`${r.grade ?? ''}${r.section ?? ''}`} /> },
              { key: 'due', label: 'Due', render: (r) => r.dueOn ? <><span className="t-num">{fmt.date(r.dueOn)}</span>
                {!r.completedOn && <div className={`t-micro ${r.daysLeft != null && r.daysLeft < 0 ? 't-critical' : 't-muted'}`}>{daysLabel(r.daysLeft)}</div>}</> : '—' },
              { key: 'status', label: 'Status', render: (r) => <><Status value={r.status} />{r.completedOn && <div className="t-micro t-muted mt-1">{fmt.date(r.completedOn)}</div>}</> },
              { key: 'a', label: '', sortable: false, className: 'num', render: (r) => can('innovation.manage') && !r.completedOn
                ? <Button size="sm" variant="teal" icon="check" loading={complete.isPending && complete.variables === r.id} onClick={() => complete.mutate(r.id)}>Complete</Button> : null },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
    </Page>
  );
}
