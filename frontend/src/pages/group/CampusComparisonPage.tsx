import { Button, Card, Chart, Empty, ErrorState, Legend, Page, PageHead, PageSkeleton, charts } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApi';
import { fmt } from '@/lib/format';
import { CAMPUS_COLORS, ComparisonCard, comparisonCsv, type CampusMetrics, type MetricRow } from './shared';

interface Comparison {
  campuses: CampusMetrics[];
  rows: MetricRow[];
  radar: { axes: string[]; series: { campusId: string; name: string; values: (number | null)[] }[] };
  generatedAt: string;
}

// Group targets are policy figures (not statistics) shown as reference lines.
const ATTENDANCE_TARGET = 93;
const COLLECTION_TARGET = 85;

export default function CampusComparisonPage() {
  const q = useApiQuery<Comparison>('/group/comparison');
  if (q.isLoading) return <Page><PageSkeleton kpis={0} /></Page>;
  if (q.error || !q.data) return <Page><ErrorState error={q.error} onRetry={q.refetch} /></Page>;
  const { campuses, rows, radar } = q.data;
  const labels = campuses.map((c) => c.shortName);
  const colors = campuses.map((_, i) => CAMPUS_COLORS[i % CAMPUS_COLORS.length]);
  const v = (x: number | null) => x ?? 0;
  if (!campuses.length) {
    return (
      <Page>
        <PageHead title="Campus Comparison" sub="Benchmarking across the group." />
        <Card>
          <Empty icon="building" title="No campuses to compare"
            sub="Comparison appears once campuses have live figures. Campus details are managed on the Campuses screen."
            action={<Button to="/campuses">Open campuses</Button>} />
        </Card>
      </Page>
    );
  }
  return (
    <Page>
      <PageHead title="Campus Comparison" sub={`Benchmarking across the group. The best figure in each row is highlighted. Computed ${fmt.relative(q.data.generatedAt)}.`}
        actions={<Button icon="download" onClick={() => comparisonCsv(campuses, rows)}>Export CSV</Button>} />
      <ComparisonCard campuses={campuses} rows={rows} />
      <div className="grid g-2col g-4 mt-4">
        <Card icon="checkSquare" title="Attendance" sub="Current academic year">
          <Chart svg={charts.bar({ labels, series: [{ name: 'Attendance %', values: campuses.map((c) => v(c.attendancePct)), colors }],
            yMax: 100, target: ATTENDANCE_TARGET, targetLabel: 'Group target', height: 230 })} />
        </Card>
        <Card icon="wallet" title="Fee collection" sub="Collected against billed, current academic year">
          <Chart svg={charts.bar({ labels, series: [{ name: 'Collection %', values: campuses.map((c) => v(c.collectionPct)), colors }],
            yMax: 100, target: COLLECTION_TARGET, targetLabel: 'Group target', height: 230 })} />
        </Card>
        <Card icon="grid" title="Parent engagement and NPS">
          <Chart svg={charts.bar({ labels, height: 230, series: [
            { name: 'Engagement', values: campuses.map((c) => v(c.engagement)), color: 'var(--navy)' },
            { name: 'NPS', values: campuses.map((c) => v(c.nps)), color: 'var(--teal)' },
          ] })} />
          <div className="mt-3"><Legend items={[{ label: 'Engagement', color: 'var(--navy)' }, { label: 'NPS', color: 'var(--teal)' }]} /></div>
        </Card>
        <Card icon="trending" title="Academic index" sub="Attainment = latest-term mean · Progress = change since the previous term (50 = no change)">
          <Chart svg={charts.radar({ size: 250, axes: radar.axes,
            series: radar.series.map((s, i) => ({ name: s.name, values: s.values.map(v), color: colors[i] })) })} />
          <div className="mt-3"><Legend items={radar.series.map((s, i) => ({ label: s.name, color: colors[i] }))} /></div>
        </Card>
      </div>
    </Page>
  );
}
