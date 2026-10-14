import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiQuery } from '@/hooks/useApi';
import { fmt } from '@/lib/format';
import { SERIES } from '@/lib/tones';
import { Button, Card, Chart, charts, Chips, Empty, ErrorState, Funnel, Legend, Page, PageHead, PageSkeleton } from '@/components/ui';
import { useCsvDownload } from './shared';

/* eslint-disable @typescript-eslint/no-explicit-any */
type LV = { label: string; value: number };
interface Analytics { area: string; areas: { id: string; label: string }[]; scope: string; generatedAt: string; data: any }

const RISK_COLORS: Record<string, string> = { 'On Track': 'var(--teal)', Watch: 'var(--viz-5)', 'Developing Risk': 'var(--amber)', 'At Risk': 'var(--critical)' };
const color = (i: number) => SERIES[i % SERIES.length];
const withColors = (rows: LV[]) => rows.map((r, i) => ({ ...r, color: color(i) }));
const ATT_BANDS = [{ label: '92% and above', color: 'var(--teal)' }, { label: '85–92%', color: 'var(--amber)' }, { label: 'Below 85%', color: 'var(--critical)' }];
const DELAY_BANDS = [{ label: 'On time', color: 'var(--teal)' }, { label: 'Up to 10 min late', color: 'var(--amber)' }, { label: 'Over 10 min late', color: 'var(--critical)' }];
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function ChartCard({ title, sub, empty, children }: { title: string; sub?: string; empty?: boolean; children: ReactNode }) {
  return <Card title={title} sub={sub}>{empty ? <Empty icon="barChart" title="No data yet" sub="Figures appear as records are added." /> : children}</Card>;
}

function Donut({ rows, center, centerSub, size = 190 }: { rows: LV[]; center: string; centerSub: string; size?: number }) {
  const data = withColors(rows);
  return <>
    <Chart svg={charts.donut({ size, thickness: 28, center, centerSub, data })} />
    <div className="mt-4"><Legend items={data.map((d) => ({ label: `${d.label} ${fmt.n(d.value)}`, color: d.color }))} /></div>
  </>;
}

export default function AnalyticsPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const [sp, setSp] = useSearchParams();
  const area = sp.get('area') ?? 'students';
  const q = useApiQuery<Analytics>('/analytics/overview', { area, ...campusParam });
  const { download, busy } = useCsvDownload();
  const setArea = (a: string) => setSp((p) => { const n = new URLSearchParams(p); if (a === 'students') n.delete('area'); else n.set('area', a); return n; }, { replace: true });

  const head = (
    <PageHead
      title="Analytics"
      sub="The same figures the Command Center summarises, with room to explore them."
      actions={<>
        {can('ai.use') && <Button variant="amber" icon="brain" to="/knowledge-ai">Ask in plain language</Button>}
        <Button icon="download" title="Download the figures for this area as a CSV file" loading={busy === 'a'} onClick={() => download('a', '/analytics/export', { area, ...campusParam }, `analytics-${area}.csv`)}>Export</Button>
      </>}
    />
  );
  const areas = q.data?.areas ?? [{ id: area, label: area.charAt(0).toUpperCase() + area.slice(1) }];
  return (
    <Page>
      {head}
      <div className="filterbar">
        <Chips items={areas.map((a) => ({ id: a.id, label: a.label }))} active={area} onChange={setArea} />
        <div className="spacer" />
        {q.data && <span className="t-xs t-muted">Live data · {q.data.scope} · {fmt.dateTime(q.data.generatedAt)}</span>}
      </div>
      {q.isLoading ? <PageSkeleton kpis={0} /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <AreaBody area={area} d={q.data.data} />}
    </Page>
  );
}

function AreaBody({ area, d }: { area: string; d: any }) {
  if (area === 'students') {
    const bands: LV[] = d.bands;
    const total = bands.reduce((a, b) => a + b.value, 0);
    return (
      <div className="grid g-2col g-4">
        <ChartCard title="Enrolment by grade" sub="Students enrolled in each grade" empty={!d.enrolment.length}>
          <Chart svg={charts.bar({ labels: d.enrolment.map((x: LV) => x.label), series: [{ name: 'Students', values: d.enrolment.map((x: LV) => x.value), color: 'var(--navy)' }], height: 230 })} />
        </ChartCard>
        <ChartCard title="Risk bands today" sub="Working view for staff only" empty={!total}>
          <Chart svg={charts.donut({ size: 190, thickness: 28, center: fmt.n(total), centerSub: 'students', data: bands.map((b) => ({ ...b, color: RISK_COLORS[b.label] })) })} />
          <div className="mt-4"><Legend items={bands.map((b) => ({ label: `${b.label} ${b.value}`, color: RISK_COLORS[b.label] }))} /></div>
        </ChartCard>
        <ChartCard title="Early Warning signals" sub="Raised and closed by month">
          <Chart svg={charts.bar({ labels: d.signals.map((x: any) => x.label), series: [
            { name: 'Raised', values: d.signals.map((x: any) => x.raised), color: 'var(--amber)' },
            { name: 'Closed', values: d.signals.map((x: any) => x.closed), color: 'var(--teal)' },
          ], height: 230 })} />
          <div className="mt-3"><Legend items={[{ label: 'Raised', color: 'var(--amber)' }, { label: 'Closed', color: 'var(--teal)' }]} /></div>
        </ChartCard>
        <ChartCard title="Attendance against academic average" sub="Latest-term average for each attendance band" empty={!d.attendanceVsAverage.some((x: any) => x.students)}>
          <Chart svg={charts.line({ labels: d.attendanceVsAverage.map((x: any) => x.label), series: [{ name: 'Academic average', values: d.attendanceVsAverage.map((x: any) => x.value ?? 0), color: 'var(--teal)' }], height: 220 })} />
          <p className="t-xs t-muted mt-3">Students per band: {d.attendanceVsAverage.map((x: any) => `${x.label} ${x.students}`).join(' · ')}. The relationship between attendance and attainment is why attendance drives the Early Warning check.</p>
        </ChartCard>
        <ChartCard title="Participation" sub="Students in at least one activity" empty={!d.participation?.total}>
          <Chart svg={charts.gauge({ percent: pct(d.participation.participating, d.participation.total), value: `${pct(d.participation.participating, d.participation.total)}%`, sub: `${fmt.n(d.participation.participating)} of ${fmt.n(d.participation.total)} students`, color: 'var(--amber)' })} />
        </ChartCard>
      </div>
    );
  }
  if (area === 'attendance') {
    const t = d.today;
    return (
      <div className="grid g-2col g-4">
        <ChartCard title="Daily attendance" sub="Present or late, last 20 school days" empty={!d.trend.length}>
          <Chart svg={charts.line({ labels: d.trend.map((x: LV) => x.label), series: [{ name: 'Attendance', values: d.trend.map((x: LV) => x.value), color: 'var(--teal)' }], yMax: 100, unit: '%', height: 230 })} />
        </ChartCard>
        <ChartCard title="Attendance by grade" sub="Present %, last 30 days" empty={!d.byGrade.length}>
          <Chart svg={charts.bar({ labels: d.byGrade.map((x: LV) => x.label), series: [{ name: 'Present %', values: d.byGrade.map((x: LV) => x.value), colors: d.byGrade.map((x: LV) => (x.value < 85 ? 'var(--critical)' : x.value < 92 ? 'var(--amber)' : 'var(--teal)')) }], yMax: 100, height: 230 })} />
          <div className="mt-3"><Legend items={ATT_BANDS} /></div>
        </ChartCard>
        <ChartCard title="Absences by weekday" sub="Last 60 days" empty={!d.weekday.length}>
          <Chart svg={charts.bar({ labels: d.weekday.map((x: LV) => x.label), series: [{ name: 'Absences', values: d.weekday.map((x: LV) => x.value), color: 'var(--navy)' }], height: 220 })} />
        </ChartCard>
        <ChartCard title="Register today" sub={`${t.marked} of ${t.students} students marked`} empty={!t.students}>
          <Chart svg={charts.gauge({ percent: pct(t.present, t.marked), value: t.marked ? `${pct(t.present, t.marked)}%` : '—', sub: `${t.absent} absent · ${t.late} late`, color: 'var(--teal)' })} />
        </ChartCard>
      </div>
    );
  }
  if (area === 'academics') {
    const subj: LV[] = d.subjects;
    const avg = subj.length ? Math.round(subj.reduce((a, s) => a + s.value, 0) / subj.length) : 0;
    const DIST = ['var(--teal)', 'var(--teal)', 'var(--navy)', 'var(--navy)', 'var(--amber)', 'var(--critical)'];
    return (
      <div className="grid g-2col g-4">
        <ChartCard title="Subject averages" sub="Latest term, against the school average" empty={!subj.length}>
          <Chart svg={charts.bar({ labels: subj.map((s) => s.label), series: [{ name: 'Average', values: subj.map((s) => s.value), color: 'var(--navy)' }], yMax: 100, target: avg, targetLabel: 'School average', height: 230 })} />
        </ChartCard>
        <ChartCard title="Average by term" sub="School-wide academic average for each term" empty={!d.terms.length}>
          <Chart svg={charts.line({ labels: d.terms.map((x: LV) => x.label), series: [{ name: 'Average', values: d.terms.map((x: LV) => x.value), color: 'var(--teal)' }], yMax: 100, height: 230 })} />
        </ChartCard>
        <ChartCard title="Coverage against mastery" sub="Average across learning objectives, by subject" empty={!d.coverage.length}>
          <Chart svg={charts.bar({ labels: d.coverage.map((x: any) => x.label.split(' ')[0]), series: [
            { name: 'Coverage', values: d.coverage.map((x: any) => x.coverage), color: 'var(--navy)' },
            { name: 'Mastery', values: d.coverage.map((x: any) => x.mastery), color: 'var(--teal)' },
          ], yMax: 100, height: 230 })} />
          <div className="mt-3"><Legend items={[{ label: 'Coverage', color: 'var(--navy)' }, { label: 'Mastery', color: 'var(--teal)' }]} /></div>
        </ChartCard>
        <ChartCard title="Grade distribution" sub="Latest-term subject results" empty={!d.distribution.some((x: LV) => x.value)}>
          <Chart svg={charts.bar({ labels: d.distribution.map((x: LV) => x.label), series: [{ name: 'Results', values: d.distribution.map((x: LV) => x.value), colors: DIST }], height: 220 })} />
        </ChartCard>
        <ChartCard title="Assessment completion" sub={`${d.completion?.assessments ?? 0} assessments held this year`} empty={!d.completion?.expected}>
          <Chart svg={charts.gauge({ percent: d.completion?.pct ?? 0, value: `${d.completion?.pct ?? 0}%`, sub: `${fmt.n(d.completion?.entered)} of ${fmt.n(d.completion?.expected)} marks entered`, color: 'var(--teal)' })} />
        </ChartCard>
      </div>
    );
  }
  if (area === 'admissions') {
    const sources: LV[] = d.sources;
    return (
      <div className="grid g-2col g-4">
        <ChartCard title="Admissions funnel" sub="Every lead at a later stage has passed the earlier ones" empty={!d.funnel[0]?.value}><Funnel rows={d.funnel} /></ChartCard>
        <ChartCard title="Source mix" sub="Where enquiries came from" empty={!sources.length}><Donut rows={sources} center={fmt.n(d.totals?.enquiries)} centerSub="enquiries" /></ChartCard>
        <ChartCard title="Enquiries and admissions" sub="Last six months">
          <Chart svg={charts.bar({ labels: d.monthly.map((x: any) => x.label), series: [
            { name: 'Enquiries', values: d.monthly.map((x: any) => x.enquiries), color: 'var(--navy)' },
            { name: 'Admissions', values: d.monthly.map((x: any) => x.admissions), color: 'var(--teal)' },
          ], height: 230 })} />
          <div className="mt-3"><Legend items={[{ label: 'Enquiries', color: 'var(--navy)' }, { label: 'Admissions', color: 'var(--teal)' }]} /></div>
        </ChartCard>
        <ChartCard title="Conversion" sub={`Enquiries that enrolled · ${d.lost} leads lost`} empty={!d.totals?.enquiries}>
          <Chart svg={charts.gauge({ percent: d.conversion ?? 0, value: `${d.totals?.enrolled}/${d.totals?.enquiries}`, sub: `${d.conversion ?? 0}% of enquiries enrolled`, color: 'var(--amber)' })} />
        </ChartCard>
      </div>
    );
  }
  if (area === 'finance') {
    const AGE = ['var(--teal)', 'var(--viz-4)', 'var(--amber)', 'var(--critical)'];
    return (
      <div className="grid g-2col g-4">
        <ChartCard title="Collection trend" sub="Billed against collected, by due month" empty={!d.trend.length}>
          <Chart svg={charts.bar({ labels: d.trend.map((x: any) => x.label), series: [
            { name: 'Billed', values: d.trend.map((x: any) => x.billed), color: 'var(--border-strong)' },
            { name: 'Collected', values: d.trend.map((x: any) => x.collected), color: 'var(--teal)' },
          ], height: 230 })} />
          <div className="mt-3"><Legend items={[{ label: 'Billed', color: 'var(--border-strong)' }, { label: 'Collected', color: 'var(--teal)' }]} /></div>
        </ChartCard>
        <ChartCard title="Overdue ageing" sub="Overdue amount by days past the due date" empty={!d.ageing.some((x: LV) => x.value)}>
          <Chart svg={charts.hbar({ rows: d.ageing.map((a: LV, i: number) => ({ label: a.label, value: a.value, color: AGE[i], display: fmt.money(a.value, { compact: true }) })), labelW: 92, rowH: 32 })} />
        </ChartCard>
        <ChartCard title="Payment method" sub="Fees collected, by how they were paid" empty={!d.methods.length}>
          <Donut size={180} rows={d.methods} center={fmt.money(d.methods.reduce((a: number, m: LV) => a + m.value, 0), { compact: true })} centerSub="collected" />
        </ChartCard>
        <ChartCard title="Collection rate" sub="Collected against billed, year to date" empty={!d.totals?.billed}>
          <Chart svg={charts.gauge({ percent: d.collectionRate ?? 0, value: fmt.pct(d.collectionRate, 1), sub: 'Of billed, year to date', color: 'var(--teal)' })} />
        </ChartCard>
      </div>
    );
  }
  if (area === 'workforce') {
    const comp: LV[] = d.composition;
    return (
      <div className="grid g-2col g-4">
        <ChartCard title="Workforce composition" sub="Employees by group" empty={!comp.length}><Donut rows={comp} center={fmt.n(comp.reduce((a, c) => a + c.value, 0))} centerSub="employees" /></ChartCard>
        <ChartCard title="Attendance by department" sub="Last 30 days" empty={!d.attendance.length}>
          <Chart svg={charts.bar({ labels: d.attendance.map((x: LV) => x.label.slice(0, 8)), series: [{ name: 'Present %', values: d.attendance.map((x: LV) => x.value), color: 'var(--teal)' }], yMax: 100, height: 230 })} />
        </ChartCard>
        <ChartCard title="CPD against target" sub="Teaching staff" empty={!d.cpd?.staff}>
          <Chart svg={charts.gauge({ percent: Math.min(100, Math.round(((d.cpd?.average ?? 0) / d.cpd.target) * 100)), value: `${d.cpd?.average ?? 0} h`, sub: `Average, target ${d.cpd.target} hours · ${d.cpd.metTarget} met`, color: 'var(--amber)' })} />
        </ChartCard>
      </div>
    );
  }
  // safety
  const routes = d.routes as { label: string; delay: number; status: string }[];
  const del = d.delivery;
  return (
    <div className="grid g-2col g-4">
      <ChartCard title="Arrivals through the morning" sub="Cumulative gate entries today" empty={!d.arrivals.some((x: LV) => x.value)}>
        <Chart svg={charts.line({ labels: d.arrivals.map((x: LV) => x.label), series: [{ name: 'Cumulative', values: d.arrivals.map((x: LV) => x.value), color: 'var(--teal)' }], height: 230 })} />
      </ChartCard>
      <ChartCard title="Safety events by type" sub="Last 90 days" empty={!d.incidents.length}>
        <Chart svg={charts.hbar({ rows: d.incidents.map((x: LV, i: number) => ({ ...x, color: x.label === 'Safeguarding' ? 'var(--critical)' : color(i) })), labelW: 120, rowH: 30 })} />
      </ChartCard>
      <ChartCard title="Bus delays now" sub="Minutes behind schedule by route" empty={!routes.length}>
        <Chart svg={charts.bar({ labels: routes.map((r) => r.label), series: [{ name: 'Delay (min)', values: routes.map((r) => r.delay), colors: routes.map((r) => (r.delay > 10 ? 'var(--critical)' : r.delay > 0 ? 'var(--amber)' : 'var(--teal)')) }], height: 220 })} />
        <div className="mt-3"><Legend items={DELAY_BANDS} /></div>
        <p className="t-xs t-muted mt-2">{routes.filter((r) => r.delay === 0).length} of {routes.length} routes on time.</p>
      </ChartCard>
      <ChartCard title="Parent notification delivery" sub="External channels, last 30 days" empty={!del?.total}>
        <Chart svg={charts.gauge({ percent: pct(del?.delivered ?? 0, del?.total ?? 0), value: `${pct(del?.delivered ?? 0, del?.total ?? 0)}%`, sub: `${del?.pending ?? 0} queued · ${del?.failed ?? 0} failed`, color: 'var(--teal)' })} />
      </ChartCard>
    </div>
  );
}
