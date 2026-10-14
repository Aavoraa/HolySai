import { useState } from 'react';
import {
  Badge, Button, Card, Chart, DataTable, Empty, ErrorState, FilterSelect, Grid, Icon, Kpi, Legend, Page, CampusBanner, PageSkeleton, Segment, Status,
  StudentLink, charts, DashLayout, DashRail, SchoolPulse } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApi';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { fmt } from '@/lib/format';
import { CAMPUS_COLORS, ComparisonCard, comparisonCsv, fmtMetric, type CampusMetrics, type MetricRow } from './shared';

interface Dashboard {
  kpis: {
    campuses: number; students: number; staff: number; staffTarget: number | null; staffingPct: number | null; admissionsYtd: number; admissionsTarget: number | null;
    attendancePct: number | null; attendanceDelta: number | null; feesCollected: number; feesOutstanding: number; collectionPct: number | null;
    nps: number | null; npsDelta: number | null; atRisk: number;
  };
  campuses: CampusMetrics[];
  rows: MetricRow[];
  transfers: { id: string; studentId: string; studentName: string; grade: string | null; fromCampus: string; toCampus: string; status: string }[];
}

export default function GroupDashboardPage() {
  const school = useSchool();
  const { can } = useAuth();
  const q = useApiQuery<Dashboard>('/group/dashboard');
  const [view, setView] = useState<'group' | 'campus'>(school.scope === 'campus' ? 'campus' : 'group');
  const [pick, setPick] = useState<string>('');
  if (q.isLoading) return <Page><PageSkeleton /></Page>;
  if (q.error || !q.data) return <Page><ErrorState error={q.error} onRetry={q.refetch} /></Page>;
  const d = q.data;
  const k = d.kpis;
  const campusId = pick || school.campusId || d.campuses[0]?.id;
  const segment = <Segment items={[{ id: 'group', label: 'Group View' }, { id: 'campus', label: 'Campus View' }]} active={view} onChange={setView} />;

  if (!d.campuses.length) {
    return (
      <Page>
        <CampusBanner title="Group Dashboard" sub="Consolidated position across the Holy Sai group." />
        <Card>
          <Empty icon="building" title="No campuses set up yet" sub="Group figures appear once campuses are configured and have students enrolled."
            action={can('group.read') ? <Button to="/campuses">Open campuses</Button> : undefined} />
        </Card>
      </Page>
    );
  }

  if (view === 'campus') {
    const c = d.campuses.find((x) => x.id === campusId) ?? d.campuses[0];
    const measures = d.rows.map((m) => {
      const val = m.values[c.id];
      const others = d.campuses.filter((x) => x.id !== c.id).map((x) => m.values[x.id]).filter((x): x is number => x != null);
      const avg = others.length ? others.reduce((a, b) => a + b, 0) / others.length : null;
      const delta = val != null && avg ? Math.round(((val - avg) / avg) * 1000) / 10 : null;
      return { m, val, delta };
    });
    const tile = ({ m, val, delta }: (typeof measures)[number], size?: 'compact') => (
      <Kpi key={m.key} size={size} label={m.label} value={fmtMetric(val, m.format)} tone={delta == null || delta >= 0 ? 'teal' : 'amber'}
        delta={delta} deltaUnit="% vs other campuses" foot={delta == null ? m.hint : undefined} />
    );
    const headline = measures.slice(0, 4);
    const rest = measures.slice(4);
    return (
      <Page>
        <CampusBanner title={c.name} sub={`${c.place} · established ${c.established ?? '—'}${c.curriculum ? ` · ${c.curriculum}` : ''}`}
          actions={<>
            {segment}
            <FilterSelect label="Campus" allLabel={null} value={c.id} onChange={setPick} options={d.campuses.map((x) => ({ value: x.id, label: x.shortName }))} />
            <Button icon="refresh" onClick={() => school.setCampus(c.id)}>Switch app to {c.shortName}</Button>
          </>} />
        <DashLayout rail={<DashRail events={false} actions={[
          { label: 'Campuses', icon: 'building', to: '/campuses' },
          { label: 'Campus Comparison', icon: 'barChart', to: '/campus-comparison', show: can('group.read') },
          { label: 'Transfers', icon: 'refresh', to: '/transfers', show: can('group.read') },
          { label: 'Group Policies', icon: 'shield', to: '/group-policies', show: can('group.read') },
          { label: 'Reports', icon: 'fileText', to: '/reports', show: can('reports.read') },
        ]} />}>
          {headline.length > 0 && <Grid cols="g-4col">{headline.map((x) => tile(x))}</Grid>}
          {rest.length > 0 && <div className="statgrid statgrid--card">{rest.map((x) => tile(x, 'compact'))}</div>}
          <SchoolPulse />
          <ComparisonCard campuses={d.campuses} rows={d.rows} />
        </DashLayout>
      </Page>
    );
  }

  return (
    <Page>
      <CampusBanner title="Group Dashboard" sub="Consolidated position across the Holy Sai group, with each campus visible beside the total."
        actions={<>{segment}<Button icon="download" onClick={() => comparisonCsv(d.campuses, d.rows)}>Board pack (CSV)</Button></>} />
      <DashLayout rail={<DashRail events={false} actions={[
        { label: 'Campuses', icon: 'building', to: '/campuses' },
        { label: 'Campus Comparison', icon: 'barChart', to: '/campus-comparison', show: can('group.read') },
        { label: 'Transfers', icon: 'refresh', to: '/transfers', show: can('group.read') },
        { label: 'Group Policies', icon: 'shield', to: '/group-policies', show: can('group.read') },
        { label: 'Reports', icon: 'fileText', to: '/reports', show: can('reports.read') },
      ]} />}>
      <Grid cols="g-4col">
        <Kpi size="hero" icon="users" label="Students" value={fmt.n(k.students)} foot={`${k.campuses} campuses`} />
        <Kpi size="hero" icon="checkSquare" label="Group attendance" value={fmt.pct(k.attendancePct, 1)} tone="teal" delta={k.attendanceDelta} deltaUnit=" pts vs prior 30 days" />
        <Kpi size="hero" icon="wallet" label="Fees collected" value={fmt.money(k.feesCollected, { compact: true })} tone="teal"
          foot={k.collectionPct != null ? `${fmt.pct(k.collectionPct, 1)} of billed` : undefined} />
        <Kpi size="hero" icon="alert" label="Students needing attention" value={fmt.n(k.atRisk)} tone="critical" to="/early-warning" foot="At Risk or Developing Risk" />
      </Grid>
      <div className="statgrid statgrid--card mt-4">
        <Kpi size="compact" icon="briefcase" label="Staff" value={fmt.n(k.staff)} tone="info"
          foot={k.staffingPct != null ? `${fmt.pct(k.staffingPct, 1)} of ${fmt.n(k.staffTarget)} positions filled` : 'No staffing target set'} />
        <Kpi size="compact" icon="userCheck" label="Admissions YTD" value={fmt.n(k.admissionsYtd)} tone="teal"
          foot={k.admissionsTarget ? `Group target ${fmt.n(k.admissionsTarget)}` : undefined} to="/admissions" />
        <Kpi size="compact" icon="receipt" label="Outstanding fees" value={fmt.money(k.feesOutstanding, { compact: true })} tone="amber" />
        <Kpi size="compact" icon="heart" label="Parent NPS" value={k.nps != null ? fmt.n(Math.round(k.nps)) : '—'} tone="teal" delta={k.npsDelta} deltaUnit=" vs last survey" />
      </div>
          <SchoolPulse />
      <Card icon="building" title="Campuses" sub="Select a campus to switch the whole application to it" className="mt-5">
        <div className="grid g-3col g-3">
          {d.campuses.map((c) => {
            const current = school.scope === 'campus' && school.campusId === c.id;
            return (
              <button key={c.id} type="button" className="optioncard" aria-pressed={current} onClick={() => school.setCampus(c.id)}
                title={current ? `${c.name} is the current campus` : `Switch to ${c.name}`}>
                <span className="avatar avatar--teal none"><Icon name="building" size={18} /></span>
                <span className="col grow" style={{ minWidth: 0 }}>
                  <span className="row g-2 wrap"><span className="t-bold t-clip">{c.name}</span>{current && <Badge tone="success">Current</Badge>}</span>
                  <span className="t-micro t-muted">{c.place} · since {c.established ?? '—'}{c.curriculum ? ` · ${c.curriculum}` : ''}</span>
                  <span className="t-xs t-num mt-1">
                    <strong>{fmt.n(c.students)}</strong> students · <strong>{fmt.n(c.staff)}</strong> staff · <strong>{fmt.pct(c.attendancePct, 1)}</strong> attendance
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>
      <div className="mt-4"><ComparisonCard campuses={d.campuses} rows={d.rows} /></div>
      <div className="grid g-2col g-4 mt-4">
        <Card icon="building" title="Students by campus">
          <Chart svg={charts.donut({
            size: 200, thickness: 30, center: fmt.n(k.students), centerSub: 'students',
            data: d.campuses.map((c, i) => ({ label: c.shortName, value: c.students, color: CAMPUS_COLORS[i % CAMPUS_COLORS.length] })),
          })} />
          <div className="mt-4"><Legend items={d.campuses.map((c, i) => ({ label: `${c.shortName} (${fmt.n(c.students)})`, color: CAMPUS_COLORS[i % CAMPUS_COLORS.length] }))} /></div>
        </Card>
        <Card icon="building" title="Inter-campus transfers" sub="Movement within the group" flush actions={<Button size="sm" to="/transfers">All transfers</Button>}>
          {!d.transfers.length ? (
            <Empty icon="refresh" title="No transfers in progress" sub="Requests to move a student between campuses appear here until the record has moved." />
          ) : (
            <DataTable compact rows={d.transfers} rowKey={(r) => r.id} columns={[
              { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={r.grade ?? undefined} /> },
              { key: 'route', label: 'From → To', render: (r) => <span className="t-sm">{r.fromCampus} <Icon name="arrowRight" size={12} className="t-faint" /> {r.toCampus}</span> },
              { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
            ]} />
          )}
        </Card>
      </div>
      </DashLayout>
    </Page>
  );
}
