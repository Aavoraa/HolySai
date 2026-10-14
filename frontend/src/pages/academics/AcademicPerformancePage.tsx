import { useMemo } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import {
  AlertItem, Badge, Card, Chart, charts, DataTable, Empty, ErrorState, FilterSelect, Grid, Kpi, Legend, Page, PageHead,
  PageSkeleton, Pagination, Risk, SearchInput, StudentLink, Toolbar,
} from '@/components/ui';
import { SUBJECT_SHORT } from './shared';

interface Performance {
  currentTerm: string | null;
  previousTerm: string | null;
  expectation: { above: number; at: number };
  kpis: { average: number | null; averageDelta: number | null; students: number; abovePct: number; aboveDelta: number; atPct: number; atDelta: number; belowPct: number; belowDelta: number };
  subjectAverages: { subject: string; current: number; previous: number }[];
  movers: { title: string; delta: number; current: number; previous: number; students: number }[];
}
interface StudentPerf {
  id: string; admissionNo: string; fullName: string; grade: string; section: string; risk: string;
  average: number; target: number | null; trend: number | null; weakest: string | null; strongest: string | null; band: 'above' | 'at' | 'below';
}

const BAND: Record<string, { label: string; tone: string }> = {
  above: { label: 'Above expectation', tone: 'success' },
  at: { label: 'At expectation', tone: 'info' },
  below: { label: 'Below expectation', tone: 'critical' },
};

export default function AcademicPerformancePage() {
  const { campusParam } = useSchool();
  const { can } = useAuth();
  const { lookups } = useLookups();
  const list = useListParams({ sort: 'average', dir: 'asc', pageSize: 10 }, ['grade', 'band', 'subjectId']);
  const grade = list.filters.grade ? Number(list.filters.grade) : undefined;
  const q = useApiQuery<Performance>('/academics/performance', { ...campusParam, grade });
  const students = usePagedQuery<StudentPerf>('/academics/performance/students', { ...list.query, ...campusParam });

  const gradeOptions = useMemo(() => {
    const levels = new Set((lookups?.classes ?? []).filter((c) => !campusParam.campusId || c.campusId === campusParam.campusId).map((c) => c.gradeLevel));
    return [...levels].sort((a, b) => a - b).map((g) => ({ value: String(g), label: `Grade ${g}` }));
  }, [lookups, campusParam.campusId]);

  if (q.isLoading) return <Page><PageSkeleton /></Page>;
  if (q.error) return <Page><ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;
  const d = q.data!;
  const k = d.kpis;
  const termNote = d.currentTerm ? `${d.currentTerm} against ${d.previousTerm ?? 'the previous term'}` : 'No results recorded yet';

  return (
    <Page>
      <PageHead
        title="Academic Performance"
        sub={`Cohort performance, subject by subject, against Cambridge expectations.${can('students.read') ? '' : ' Showing the students in your classes.'}`}
        actions={<FilterSelect label="Grade" value={list.filters.grade} onChange={(v) => list.setFilter('grade', v)} options={gradeOptions} />}
      />
      {k.students === 0 ? (
        <Card><Empty icon="trending" title="No academic records yet" sub="Term results appear here once marks are recorded for students in your scope." /></Card>
      ) : (
        <>
          <Grid cols="g-4col">
            <Kpi icon="barChart" label="School average" value={k.average ?? '—'} tone="teal" delta={k.averageDelta} deltaUnit=" pts" foot={termNote} />
            <Kpi icon="trending" label="Above expectation" value={`${k.abovePct}%`} delta={k.aboveDelta} deltaUnit=" pts" foot={`Average ${d.expectation.above}+`} onClick={() => list.setFilter('band', 'above')} />
            <Kpi icon="target" label="At expectation" value={`${k.atPct}%`} tone="info" delta={k.atDelta} deltaUnit=" pts" foot={`Average ${d.expectation.at}–${d.expectation.above - 1}`} onClick={() => list.setFilter('band', 'at')} />
            <Kpi icon="alert" label="Below expectation" value={`${k.belowPct}%`} tone="critical" delta={k.belowDelta} deltaUnit=" pts" inverse foot={`Average under ${d.expectation.at}`} onClick={() => list.setFilter('band', 'below')} />
          </Grid>

          <div className="grid g-main mt-4">
            <Card icon="trending" title="Subject averages" sub={`${d.currentTerm ?? 'Current term'} against ${d.previousTerm ?? 'last term'}`}>
              <Chart svg={charts.bar({
                labels: d.subjectAverages.map((s) => SUBJECT_SHORT[s.subject] ?? s.subject),
                series: [
                  { name: 'This term', values: d.subjectAverages.map((s) => s.current), color: 'var(--navy)' },
                  { name: 'Last term', values: d.subjectAverages.map((s) => s.previous), color: 'var(--border-strong)' },
                ],
                yMax: 100,
                height: 250,
              })} />
              <div className="mt-3"><Legend items={[{ label: 'This term', color: 'var(--navy)' }, { label: 'Last term', color: 'var(--border-strong)' }]} /></div>
            </Card>
            <Card icon="grid" title="Biggest movers" sub="Grade-level shifts worth a conversation" flush>
              {d.movers.length === 0 ? (
                <Empty icon="activity" title="No term-on-term movement yet" />
              ) : (
                <div>
                  {d.movers.map((m) => {
                    const tone = m.delta >= 2 ? 'success' : m.delta <= -4 ? 'critical' : 'warning';
                    return (
                      <AlertItem key={m.title} tone={tone} icon={m.delta >= 0 ? 'trending' : 'alert'}
                        title={`${m.title} · ${m.delta > 0 ? '+' : ''}${m.delta}`}
                        meta={`${m.students} students · average ${m.previous} → ${m.current}`}
                        to={can('academics.read') ? '/assessments' : undefined} />
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      <div className="mt-4">
        <Card icon="users" title="Students by expectation" sub="Term average against target — lowest first" flush>
          <Toolbar>
            <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search students" />
            <FilterSelect label="Band" value={list.filters.band} onChange={(v) => list.setFilter('band', v)}
              options={Object.entries(BAND).map(([value, b]) => ({ value, label: b.label }))} />
            <FilterSelect label="Subject" value={list.filters.subjectId} onChange={(v) => list.setFilter('subjectId', v)}
              options={(lookups?.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          </Toolbar>
          {students.error ? (
            <ErrorState error={students.error} onRetry={() => students.refetch()} />
          ) : (
            <DataTable
              rows={students.data?.rows}
              loading={students.isLoading}
              rowKey={(r) => r.id}
              sort={list.sort}
              onSort={list.setSort}
              emptyText={list.hasFilters ? 'No students match these filters.' : 'No student results recorded yet.'}
              columns={[
                { key: 'name', label: 'Student', render: (r) => <StudentLink id={r.id} name={r.fullName} meta={`${r.grade}${r.section} · ${r.admissionNo}`} /> },
                { key: 'average', label: 'Average', className: 'num', render: (r) => <span className="t-num t-bold">{r.average}</span> },
                { key: 'target', label: 'Target', className: 'num', render: (r) => <span className="t-num">{r.target ?? '—'}</span> },
                { key: 'trend', label: 'Trend', className: 'num', render: (r) => r.trend == null ? '—' : <span className={r.trend < 0 ? 't-num t-critical' : r.trend > 0 ? 't-num t-success' : 't-num'}>{r.trend > 0 ? '+' : ''}{r.trend}</span> },
                { key: 'weakest', label: 'Focus subject', sortable: false, render: (r) => r.weakest ?? '—' },
                { key: 'band', label: 'Expectation', sortable: false, render: (r) => <Badge tone={BAND[r.band].tone}>{BAND[r.band].label}</Badge> },
                { key: 'risk', label: 'Risk', sortable: false, render: (r) => <Risk value={r.risk} /> },
              ]}
            />
          )}
          <Pagination meta={students.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
        </Card>
      </div>
    </Page>
  );
}
