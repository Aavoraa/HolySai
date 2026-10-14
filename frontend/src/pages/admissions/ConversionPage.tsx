import { useApiQuery } from '@/hooks/useApi';
import { useSchool } from '@/layouts/SchoolContext';
import {
  Card, Chart, charts, DataTable, Empty, ErrorState, Grid, Kpi, Legend, Meter, Page, PageHead, PageSkeleton,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import type { Named } from './types';

interface SourceRow { source: string; enquiries: number; qualified: number; applications: number; enrolled: number; spend: number; conversion: number; cpa: number | null; costPerLead: number | null }
interface CounsellorRow { counsellor: string; counsellorId: string | null; leads: number; open: number; qualified: number; visited: number; enrolled: number; lost: number; overdue: number; hoursToContact: number | null; conversion: number }
interface Conversion {
  kpis: { enquiries: number; admitted: number; lost: number; conversion: number; conversionDelta: number | null; cpa: number | null; medianDaysToAdmit: number | null; spend: number };
  sources: SourceRow[];
  counsellors: CounsellorRow[];
  funnel: Named[];
  stages: { from: string; to: string; pct: number; lost: number }[];
  monthly: { labels: string[]; enquiries: number[]; applications: number[]; admissions: number[] };
  lostReasons: Named[];
}

const rankColor = (i: number, n: number) => (i < Math.ceil(n / 3) ? 'var(--teal)' : i < Math.ceil((2 * n) / 3) ? 'var(--navy)' : 'var(--amber)');

export default function ConversionPage() {
  const { campusParam } = useSchool();
  const q = useApiQuery<Conversion>('/admissions/conversion', campusParam);
  const head = <PageHead title="Conversion Analytics" sub="Where enquiries are won and lost, and what each admission costs." />;
  if (q.isLoading) return <Page>{head}<PageSkeleton /></Page>;
  if (q.error || !q.data) return <Page>{head}<ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;
  const { kpis: k, sources, counsellors, stages, monthly, lostReasons } = q.data;
  const byConversion = [...sources].filter((s) => s.enquiries > 0).sort((a, b) => b.conversion - a.conversion);
  const byCost = [...sources].filter((s) => s.cpa != null).sort((a, b) => a.cpa! - b.cpa!);
  const best = byConversion[0];

  return (
    <Page>
      {head}
      <Grid cols="g-4col">
        <Kpi size="hero" icon="target" label="Enquiry → admission" value={`${k.conversion}%`} tone="teal" foot={`${k.admitted} of ${k.enquiries} enquiries`} />
        <Kpi size="hero" icon="rupee" label="Cost per admission" value={k.cpa != null ? fmt.money(k.cpa) : '—'} tone="amber" foot="Marketing spend ÷ admissions" />
        <Kpi size="hero" icon="clock" label="Median days to admit" value={k.medianDaysToAdmit ?? '—'} unit={k.medianDaysToAdmit != null ? 'days' : undefined} foot="First enquiry to enrolment" />
        <Kpi size="hero" icon="wallet" label="Marketing spend YTD" value={fmt.money(k.spend, { compact: true })} tone="info" foot="Acquisition cost of this year's enquiries" />
      </Grid>

      <div className="grid g-2col g-4 mt-4">
        <Card icon="target" title="Conversion by source" sub={best ? `${best.source} converts best${byConversion.length > 1 ? `; ${[...sources].sort((a, b) => b.enquiries - a.enquiries)[0].source} brings the most volume` : ''}` : undefined}>
          {byConversion.length
            ? <Chart svg={charts.hbar({ rows: byConversion.map((s, i) => ({ label: s.source, value: s.conversion, display: `${s.conversion}% · ${s.enrolled}/${s.enquiries}`, color: rankColor(i, byConversion.length) })), labelW: 100, rowH: 30, label: 'Conversion by source' })} />
            : <Empty icon="chart" title="No enquiries yet" />}
        </Card>
        <Card icon="target" title="Cost per admission by source" sub="Channels without an admission yet are not shown">
          {byCost.length
            ? <Chart svg={charts.hbar({ rows: byCost.map((s, i) => ({ label: s.source, value: s.cpa!, display: fmt.money(s.cpa), color: i === byCost.length - 1 && byCost.length > 2 ? 'var(--critical)' : rankColor(i, byCost.length) })), labelW: 100, rowH: 30, label: 'Cost per admission by source' })} />
            : <Empty icon="rupee" title="No admissions yet" />}
        </Card>
      </div>

      <div className="mt-4">
        <Card icon="target" title="Funnel by month">
          <Chart svg={charts.line({
            labels: monthly.labels,
            series: [
              { name: 'Enquiries', values: monthly.enquiries, color: 'var(--navy)' },
              { name: 'Applications', values: monthly.applications, color: 'var(--amber)' },
              { name: 'Admissions', values: monthly.admissions, color: 'var(--teal)' },
            ],
            height: 240, label: 'Enquiries, applications and admissions by month',
          })} />
          <div className="mt-3"><Legend items={[{ label: 'Enquiries', color: 'var(--navy)' }, { label: 'Applications', color: 'var(--amber)' }, { label: 'Admissions', color: 'var(--teal)' }]} /></div>
        </Card>
      </div>

      <div className="grid g-2col g-4 mt-4">
        <Card icon="target" title="Stage conversion" sub="Share of leads that reach the next step">
          <div className="col g-3">
            {stages.map((s) => (
              <Meter key={s.from} label={`${s.from} → ${s.to}`} value={s.pct} tone={s.pct >= 80 ? 'teal' : s.pct < 60 ? 'critical' : undefined}
                right={`${s.pct}%`} hint={`${s.lost} lead${s.lost === 1 ? '' : 's'} did not move on`} />
            ))}
          </div>
        </Card>
        <Card icon="target" title="Why leads are lost" sub={`${k.lost} closed as lost this year`}>
          {lostReasons.length
            ? <Chart svg={charts.hbar({ rows: lostReasons.map((r) => ({ label: r.label, value: r.value, color: 'var(--critical)' })), labelW: 220, rowH: 30, label: 'Lost reasons' })} />
            : <Empty icon="check" title="No lost leads this year" />}
        </Card>
      </div>

      <div className="mt-4">
        <Card icon="target" title="Counsellor performance" sub="Leads owned this academic year" flush>
          <DataTable rows={counsellors} rowKey={(r) => r.counsellorId ?? 'unassigned'}
            columns={[
              { key: 'counsellor', label: 'Counsellor', render: (r) => <span className={r.counsellorId ? 't-bold' : 't-critical t-bold'}>{r.counsellor}</span> },
              { key: 'leads', label: 'Leads', className: 'num' },
              { key: 'open', label: 'Open', className: 'num' },
              { key: 'visited', label: 'Visited', className: 'num' },
              { key: 'enrolled', label: 'Enrolled', className: 'num' },
              { key: 'conversion', label: 'Conversion', className: 'num', render: (r) => `${r.conversion}%` },
              { key: 'hoursToContact', label: 'First contact', className: 'num', render: (r) => (r.hoursToContact != null ? `${r.hoursToContact} h avg` : '—') },
              { key: 'overdue', label: 'Overdue follow-ups', className: 'num', render: (r) => <span className={r.overdue ? 't-critical t-bold' : ''}>{r.overdue}</span> },
            ]} />
        </Card>
      </div>

      <div className="mt-4">
        <Card icon="target" title="Source effectiveness" flush>
          <DataTable rows={sources} rowKey={(r) => r.source}
            columns={[
              { key: 'source', label: 'Source', render: (r) => <span className="t-bold">{r.source}</span> },
              { key: 'enquiries', label: 'Enquiries', className: 'num' },
              { key: 'qualified', label: 'Qualified', className: 'num' },
              { key: 'applications', label: 'Applications', className: 'num' },
              { key: 'enrolled', label: 'Enrolled', className: 'num' },
              { key: 'spend', label: 'Spend', className: 'num', render: (r) => fmt.money(r.spend) },
              { key: 'costPerLead', label: 'Cost / lead', className: 'num', render: (r) => fmt.money(r.costPerLead) },
              { key: 'cpa', label: 'Cost / admission', className: 'num', render: (r) => fmt.money(r.cpa) },
            ]} />
        </Card>
      </div>
    </Page>
  );
}
