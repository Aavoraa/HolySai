import { useMemo } from 'react';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiQuery } from '@/hooks/useApi';
import { Badge, Button, Card, DataTable, ErrorState, Meter, Page, PageHead, SearchInput, type Sort, Toolbar } from '@/components/ui';
import { useListParams } from '@/hooks/useListParams';

interface SubjectRow { id: string; code: string; name: string; stage: string | null; isCore: boolean; teachers: number; classes: number; average: number | null; coverage: number | null; objectives: number }

const SORTERS: Record<string, (r: SubjectRow) => number | string> = {
  subject: (r) => r.name, teachers: (r) => r.teachers, classes: (r) => r.classes, avg: (r) => r.average ?? -1, coverage: (r) => r.coverage ?? -1,
};

export default function SubjectsPage() {
  const { campusParam } = useSchool();
  const list = useListParams({ sort: 'subject' });
  const q = useApiQuery<SubjectRow[]>('/academics/subjects', campusParam);

  // A short, fixed list: search and sort run in the browser.
  const rows = useMemo(() => {
    const term = list.q.toLowerCase();
    const data = (q.data ?? []).filter((r) => !term || r.name.toLowerCase().includes(term) || r.code.toLowerCase().includes(term));
    const get = SORTERS[list.sort.key] ?? SORTERS.subject;
    return [...data].sort((a, b) => {
      const x = get(a), y = get(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return list.sort.dir === 'asc' ? c : -c;
    });
  }, [q.data, list.q, list.sort]);

  return (
    <Page>
      <PageHead title="Subjects" sub="Subject configuration across stages, with staffing and performance in one view." />
      <Card flush>
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search subjects" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable
            rows={rows}
            loading={q.isLoading}
            rowKey={(r) => r.id}
            sort={list.sort}
            onSort={(s: Sort) => list.setSort(s)}
            emptyText={list.q ? 'No subjects match this search.' : 'No subjects are configured yet.'}
            columns={[
              { key: 'subject', label: 'Subject', render: (r) => <><span className="t-bold">{r.name}</span> {!r.isCore && <Badge>Elective</Badge>}<div className="t-micro t-muted">{r.code} · {r.stage ?? 'All stages'}</div></> },
              { key: 'teachers', label: 'Teachers', className: 'num', render: (r) => <span className="t-num">{r.teachers}</span> },
              { key: 'classes', label: 'Classes', className: 'num', render: (r) => <span className="t-num">{r.classes}</span> },
              { key: 'avg', label: 'Average', className: 'num', render: (r) => <span className="t-num t-bold">{r.average ?? '—'}</span> },
              {
                key: 'coverage', label: 'Objective coverage', render: (r) => (r.coverage == null
                  ? <span className="t-faint">No objectives mapped</span>
                  : <Meter label="" value={r.coverage} right={`${r.coverage}% · ${r.objectives} obj.`} tone={r.coverage >= 70 ? 'teal' : 'amber'} />),
              },
              {
                key: 'a', label: '', sortable: false, className: 'num',
                render: (r) => <Button size="sm" icon="target" to={`/objectives?subjectId=${r.id}`} aria-label={`Objectives for ${r.name}`}>Objectives</Button>,
              },
            ]}
          />
        )}
      </Card>
    </Page>
  );
}
