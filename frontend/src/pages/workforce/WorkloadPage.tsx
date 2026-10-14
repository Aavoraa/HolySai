import { useApiQuery } from '@/hooks/useApi';
import { useSchool } from '@/layouts/SchoolContext';
import { Banner, Card, Chart, DataTable, Empty, ErrorState, Grid, Kpi, Meter, Page, PageHead, Skeleton, charts } from '@/components/ui';
import { EmpLink, useEmployeeModal } from './shared';
import type { Workload } from './types';

const color = (band: string) => (band === 'over' ? 'var(--critical)' : band === 'near' ? 'var(--amber)' : 'var(--teal)');

export default function WorkloadPage() {
  const { campusParam } = useSchool();
  const q = useApiQuery<Workload>('/workforce/workload', campusParam);
  const [openEmployee, employeeModal] = useEmployeeModal();
  const d = q.data;
  const max = d?.rows.find((r) => r.category === 'Teachers')?.max ?? 27;

  return (
    <Page>
      <PageHead title="Workload" sub={`Teaching periods per week against the agreed maximum of ${max}.`} />
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <Grid cols="g-4col">
            <Kpi loading={q.isLoading} icon="users" label="Teachers" value={d?.kpis.teachers ?? 0} />
            <Kpi loading={q.isLoading} icon="barChart" label="Average load" value={d?.kpis.average ?? 0} unit="periods" />
            <Kpi loading={q.isLoading} icon="alert" label="Above maximum" value={d?.kpis.over ?? 0} tone="critical" />
            <Kpi loading={q.isLoading} icon="alertCircle" label="Within 3 of maximum" value={d?.kpis.near ?? 0} tone="amber" />
          </Grid>
          <div className="mt-4">
            <Card icon="clock" title="Periods per week" sub={`Bars turn amber within 3 periods of the maximum and red above ${max}`}>
              {q.isLoading ? <Skeleton height={300} /> : d && d.rows.length ? (
                <>
                  <Chart svg={charts.hbar({
                    rows: d.rows.map((r) => ({ label: r.fullName.replace(/^(Ms|Mr|Dr)\.\s+/, ''), value: r.periods, display: `${r.periods} periods`, color: color(r.band) })),
                    labelW: 150, rowH: 32,
                  })} />
                  <div className="col g-3 mt-4">
                    {d.suggestions.length
                      ? d.suggestions.map((s) => <Banner key={s.employeeId} tone="warning" icon="alert">{s.text}</Banner>)
                      : <Banner tone="success" icon="check">Every teacher is within the agreed maximum.</Banner>}
                  </div>
                </>
              ) : <Empty title="No teaching load recorded" icon="barChart" sub="Teacher assignments and the timetable feed this view." />}
            </Card>
          </div>
          {d && d.rows.length > 0 && (
            <div className="mt-4">
              <Card icon="grid" title="Load by teacher" sub="Periods = the highest of timetabled periods, section assignments and the recorded load (which includes duties)" flush>
                <DataTable rows={d.rows} rowKey={(r) => r.id} onRowClick={(r) => openEmployee(r.id)}
                  columns={[
                    { key: 'name', label: 'Teacher', render: (r) => <EmpLink name={r.fullName} meta={`${r.designation} · ${r.campusName}`} onOpen={() => openEmployee(r.id)} /> },
                    { key: 'sections', label: 'Sections', className: 'num' },
                    { key: 'assigned', label: 'Assigned', className: 'num' },
                    { key: 'timetabled', label: 'Timetabled', className: 'num', render: (r) => r.timetabled || '—' },
                    { key: 'load', label: 'Load', render: (r) => <Meter label="" value={(r.periods / r.max) * 100} right={`${r.periods} / ${r.max}`} tone={r.band === 'over' ? 'critical' : r.band === 'near' ? 'amber' : 'teal'} /> },
                  ]} />
              </Card>
            </div>
          )}
        </>
      )}
      {employeeModal}
    </Page>
  );
}
