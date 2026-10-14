import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiQuery } from '@/hooks/useApi';
import { Button, Card, Chart, charts, DataTable, Empty, ErrorState, Legend, Meter, Page, PageHead, PageSkeleton } from '@/components/ui';
import { fmt } from '@/lib/format';
import { ImportObjectivesModal, ObjectiveModal } from './objectiveForms';
import { SUBJECT_SHORT } from './shared';

interface Curriculum {
  stages: { id: string; stage: string; grades: string; students: number; subjects: number; classes: number; coverage: number }[];
  coverageBySubject: { subject: string; coverage: number; mastery: number; objectives: number }[];
  trend: { labels: string[]; coverage: number[]; mastery: number[] };
  totals: { coverage: number; mastery: number; objectives: number } | null;
}

/** Planned coverage line on the subject chart (school curriculum plan). */
const PLAN_COVERAGE = 75;

export default function CurriculumPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const q = useApiQuery<Curriculum>('/academics/curriculum', campusParam);
  const [modal, setModal] = useState<'map' | 'import' | null>(null);
  const canMap = can('academics.manage') && can('students.read');

  return (
    <Page>
      <PageHead
        title="Curriculum"
        sub="Cambridge Primary, Lower Secondary, IGCSE, AS and A Level are configured as stages, each with its own objectives and coverage tracking."
        actions={canMap && <>
          <Button icon="upload" onClick={() => setModal('import')}>Import objectives</Button>
          <Button variant="primary" icon="layers" onClick={() => setModal('map')}>Map curriculum</Button>
        </>}
      />
      {q.isLoading ? <PageSkeleton kpis={0} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (() => {
        const d = q.data!;
        return (
          <>
            <Card flush>
              <DataTable
                rows={d.stages}
                rowKey={(r) => r.id}
                emptyText="No curriculum stages are configured."
                columns={[
                  { key: 'stage', label: 'Stage', render: (r) => <><span className="t-bold">{r.stage}</span><div className="t-micro t-muted">{r.grades} · {r.classes} classes</div></> },
                  { key: 'students', label: 'Students', className: 'num', render: (r) => <span className="t-num">{fmt.n(r.students)}</span> },
                  { key: 'subjects', label: 'Subjects', className: 'num', render: (r) => <span className="t-num">{r.subjects}</span> },
                  { key: 'coverage', label: 'Objective coverage this year', render: (r) => <Meter label="" value={r.coverage} right={`${r.coverage}%`} tone={r.coverage >= 70 ? 'teal' : r.coverage >= 55 ? 'amber' : 'critical'} /> },
                  { key: 'a', label: '', className: 'num', render: () => <Button size="sm" to="/objectives">Objectives</Button> },
                ]}
              />
            </Card>
            <div className="grid g-2col g-4 mt-4">
              <Card icon="trending" title="Coverage by subject" sub="Objectives taught against objectives planned">
                {d.coverageBySubject.length ? (
                  <Chart svg={charts.bar({
                    labels: d.coverageBySubject.map((s) => SUBJECT_SHORT[s.subject] ?? s.subject),
                    series: [{ name: 'Coverage %', values: d.coverageBySubject.map((s) => s.coverage), color: 'var(--navy)' }],
                    yMax: 100, target: PLAN_COVERAGE, targetLabel: 'Plan', height: 230,
                  })} />
                ) : <Empty icon="target" title="No objectives mapped yet" />}
              </Card>
              <Card icon="grid" title="Mastery against coverage" sub={`Taught is not the same as learned · ${d.totals?.objectives ?? 0} objectives`}>
                {d.trend.labels.length > 1 ? (
                  <>
                    <Chart svg={charts.line({
                      labels: d.trend.labels,
                      series: [
                        { name: 'Coverage', values: d.trend.coverage, color: 'var(--navy)' },
                        { name: 'Mastery', values: d.trend.mastery, color: 'var(--teal)' },
                      ],
                      yMin: 0, yMax: 100, unit: '%', height: 230,
                    })} />
                    <div className="mt-3"><Legend items={[{ label: 'Coverage', color: 'var(--navy)' }, { label: 'Mastery', color: 'var(--teal)' }]} /></div>
                  </>
                ) : <Empty icon="activity" title="No term history yet" />}
              </Card>
            </div>
          </>
        );
      })()}
      {modal === 'map' && <ObjectiveModal onClose={() => setModal(null)} />}
      {modal === 'import' && <ImportObjectivesModal onClose={() => setModal(null)} />}
    </Page>
  );
}
