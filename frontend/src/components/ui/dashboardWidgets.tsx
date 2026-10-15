/**
 * The dashboard visualisations as reusable cards, so every role dashboard can
 * show the same picture from data that role may see: headline metrics with
 * sparklines, attendance trend (line), performance (donut), ranking (table).
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiQuery, usePagedQuery } from '@/hooks/useApi';
import type { StudentRow } from '@/api/types';
import { fmt } from '@/lib/format';
import { Avatar, Card, CardLink, Chart, charts, Empty, Icon } from './primitives';
import { UpcomingEvents } from './dashboard';
import { Donut, LineChart, MetricCard, type LineSeries } from './dashboardViz';

export interface TrendPoint { label: string; value: number }

/** Line chart card (percentages by default), e.g. attendance over recent days. */
export function TrendCard({ title = 'Attendance Overview', icon = 'calendar', points, series = 'Students', unit = '%', color = 'var(--brand)', actions, empty, children }: {
  title?: string; icon?: string; points: TrendPoint[]; series?: string; unit?: string; color?: string;
  actions?: ReactNode; empty?: { title: string; sub?: string }; children?: ReactNode;
}) {
  return (
    <Card icon={icon} title={title} actions={actions}>
      {children ?? (points.length > 1 ? (
        <>
          <LineChart labels={points.map((p) => p.label)} series={[{ name: series, values: points.map((p) => p.value), color }]}
            unit={unit} yMax={unit === '%' ? 100 : Math.max(...points.map((p) => p.value)) * 1.1} label={`${title}, ${series}`} />
          <div className="vizlegend"><span><i style={{ background: color }} />{series}</span></div>
        </>
      ) : (
        <Empty icon="chart" title={empty?.title ?? 'No data yet'} sub={empty?.sub ?? 'Figures appear once records are entered.'} />
      ))}
    </Card>
  );
}

export interface Band { label: string; value: number; color: string; to?: string }

/** Donut with a centre figure and a percentage legend. */
export function DonutCard({ title = 'Academic Performance', icon = 'graduation', link, center, centerSub, bands, empty }: {
  title?: string; icon?: string; link?: { to: string; label?: string }; center?: string; centerSub?: string; bands: Band[];
  empty?: { title: string; sub?: string };
}) {
  const navigate = useNavigate();
  const total = bands.reduce((s, b) => s + b.value, 0);
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return (
    <Card icon={icon} title={title} className="donutcard" actions={link ? <CardLink to={link.to}>{link.label ?? 'View Details'}</CardLink> : undefined}>
      {total ? (
        <div className="donutwrap">
          <Donut bands={bands} center={center ?? `${pct(bands[0].value)}%`} centerSub={centerSub ?? bands[0].label} label={title} />
          <div className="dlegend">
            {bands.map((b) => {
              const inner = <><span className="dot" style={{ background: b.color }} /><span>{b.label}</span><strong>{pct(b.value)}%</strong></>;
              return b.to
                ? <button key={b.label} type="button" className="dlegend__row" onClick={() => navigate(b.to!)}>{inner}</button>
                : <div key={b.label} className="dlegend__row">{inner}</div>;
            })}
          </div>
        </div>
      ) : (
        <Empty icon="trending" title={empty?.title ?? 'No results yet'} sub={empty?.sub} />
      )}
    </Card>
  );
}

export interface RankRow { key: string; name: string; photo?: string | null; meta?: ReactNode; value: ReactNode; to?: string }

/** Ranked table: medal, initials, a middle column (brand colour) and a right-aligned value. */
export function RankCard({ title = 'Top Performers', icon = 'trophy', link, nameLabel, middle = 'Class', valueLabel = 'Percentage', rows, loading, empty, fill, minRows = 5 }: {
  title?: string; icon?: string; link?: { to: string; label?: string }; nameLabel?: string; middle?: string; valueLabel?: string;
  rows: RankRow[]; loading?: boolean; empty?: { title: string; sub?: string };
  /** Fill the card's height: list as many rows as fit (at least `minRows`), so no blank space is left under the table. */
  fill?: boolean; minRows?: number;
}) {
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(minRows);
  const [rowH, setRowH] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!fill || !box.current) return;
    const el = box.current;
    const measure = () => {
      const head = el.querySelector('thead')?.getBoundingClientRect().height ?? 36;
      const BASE = 41; // natural row height
      const n = Math.max(minRows, Math.floor((el.clientHeight - head) / BASE));
      setFit(n);
      // Share any leftover height across the rows, so the list ends exactly at the card's foot.
      setRowH(Math.min(BASE * 1.4, Math.max(BASE, (el.clientHeight - head) / Math.min(n, rows.length || n))));
    };
    measure();
    // The card's height follows the rail (and the window), so re-measure whenever either changes.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [fill, minRows, rows.length, loading]);
  const shown = fill ? rows.slice(0, fit) : rows;
  return (
    <Card icon={icon} title={title} flush actions={link ? <CardLink to={link.to}>{link.label ?? 'View All'}</CardLink> : undefined}>
      {loading ? (
        <div className="card__body col g-3">{[0, 1, 2].map((i) => <span key={i} className="skeleton" style={{ height: 30 }} />)}</div>
      ) : rows.length ? (
        <div className={fill ? 'rankfill' : 'table-wrap'} ref={box}>
          <div className={fill ? 'rankfill__inner table-wrap' : undefined} style={fill ? undefined : { display: 'contents' }}>
          <table className="table table--compact ranktable">
            <thead><tr><th style={{ width: 80 }}>#</th><th>{nameLabel ?? (title.includes('Subject') ? 'Subject' : 'Student')}</th><th>{middle}</th><th className="num">{valueLabel}</th></tr></thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.key} className={r.to ? 'row--link' : undefined} onClick={r.to ? () => navigate(r.to!) : undefined}
                  style={fill && rowH ? { height: rowH } : undefined}>
                  <td>
                    <span className="row g-4">
                      <span className={`medal medal--${i < 3 ? i + 1 : 'n'}`} aria-hidden="true">{i + 1}</span>
                      <span className="t-muted">{i + 1}</span>
                    </span>
                  </td>
                  <td><span className="person"><Avatar name={r.name} src={r.photo} size="sm" /><span className="person__name t-clip">{r.name}</span></span></td>
                  <td className="t-nowrap" style={{ color: 'var(--brand)' }}>{r.meta}</td>
                  <td className="num">{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : (
        <Empty icon={icon} title={empty?.title ?? 'Nothing to rank yet'} sub={empty?.sub} />
      )}
    </Card>
  );
}

/** Top five students by academic average among the students this user may see. */
export function useTopStudents(limit = 5) {
  const { campusParam } = useSchool();
  const q = usePagedQuery<StudentRow>('/students', { sort: 'average', dir: 'desc', pageSize: limit, ...campusParam });
  const rows: RankRow[] = (q.data?.rows ?? []).filter((s) => s.average != null).map((s) => ({
    key: s.id, name: s.fullName, photo: s.photoUrl, meta: `${s.grade ?? ''}${s.section ? ` - ${s.section}` : ''}`, value: `${s.average}%`, to: `/student-360/${s.id}`,
  }));
  return { rows, loading: q.isLoading };
}

interface Pulse {
  students: { total: number; atRisk: number; developing: number; onTrack: number };
  attendance: {
    trend: { label: string; day: string; value: number }[]; staffTrend?: (number | null)[];
    byGrade: { grade: string; present: number }[]; lateByTime: { label: string; value: number }[]; weekdayAbsences: { day: string; absences: number }[]; todayPct: number | null;
  };
  staff: { total: number; present: number };
  academic: { byGrade: { grade: string; average: number }[] };
  history?: { months: string[]; students: number[]; staff: number[] };
  finance?: { collectionPct: number; monthly?: { label: string; pct: number }[] };
}

type AttView = 'trend' | 'grade' | 'late' | 'pattern';

const MONTH = (iso: string, withDay = false) => {
  const d = new Date(`${iso}T00:00:00`);
  return withDay
    ? d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).replace(',', '')
    : d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
};
const change = (now: number, before: number | undefined) => (before ? Math.round(((now - before) / before) * 1000) / 10 : null);
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/**
 * The dashboard picture for any role that may read school-wide figures
 * (dashboard.view + students.read): headline metrics (optional), attendance,
 * performance, events and top performers. Renders nothing for other roles.
 */
export function SchoolPulse({ events = true, metrics = false }: { events?: boolean; metrics?: boolean }) {
  const { can } = useAuth();
  const school = useSchool();
  const allowed = can('dashboard.view') && can('students.read');
  const [view, setView] = useState<AttView>('trend');
  const q = useApiQuery<Pulse>(allowed ? '/dashboard/command-center' : null, { scope: school.scope, campusId: school.campusId });
  const top = useTopStudents(15);
  if (!allowed) return null;
  if (q.isLoading) {
    return (
      <>
        {metrics && <div className="grid g-4col">{[0, 1, 2, 3].map((i) => <span key={i} className="skeleton" style={{ height: 133, borderRadius: 10 }} />)}</div>}
        <div className="grid dash__pair">{[0, 1].map((i) => <span key={i} className="skeleton" style={{ height: 300, borderRadius: 10 }} />)}</div>
      </>
    );
  }
  if (!q.data) return null;
  const d = q.data;
  const a = d.attendance;
  const s = d.students;
  const h = d.history;

  // Headline metrics, each compared with an earlier point of its own series.
  const trendVals = a.trend.map((t) => t.value);
  const last = trendVals[trendVals.length - 1];
  const attRate = a.todayPct ?? last ?? null;
  const recent = avg(trendVals.slice(-5)), earlier = avg(trendVals.slice(-10, -5));
  const attDelta = recent != null && earlier != null ? Math.round((recent - earlier) * 10) / 10 : null;
  const growth = (xs?: number[]) => (xs && xs.length > 3 ? change(xs[xs.length - 1], xs[xs.length - 4]) : null);
  // Headcounts are compared with three month-ends ago (about one term).
  const since = h && h.months.length > 3 ? `vs ${h.months[h.months.length - 4]}` : undefined;
  const fee = d.finance;
  const feeMonths = fee?.monthly ?? [];
  const feeDelta = feeMonths.length > 1 ? Math.round((feeMonths[feeMonths.length - 1].pct - feeMonths[feeMonths.length - 2].pct) * 10) / 10 : null;

  let chart: ReactNode = null;
  if (view === 'trend' && a.trend.length > 1) {
    const series: LineSeries[] = [{ name: 'Students', values: trendVals, color: 'var(--brand)' }];
    if (a.staffTrend?.some((v) => v != null)) series.push({ name: 'Staff', values: a.staffTrend, color: '#B4ACD3', area: false });
    chart = (
      <>
        <LineChart labels={a.trend.map((t) => MONTH(t.day))} tips={a.trend.map((t) => MONTH(t.day, true))} series={series}
          height={158} label="Attendance over recent school days" />
        <div className="vizlegend">{series.map((x) => <span key={x.name}><i style={{ background: x.color }} />{x.name}</span>)}</div>
      </>
    );
  } else if (view === 'grade' && a.byGrade.length) {
    chart = <Chart svg={charts.bar({ labels: a.byGrade.map((g) => g.grade.replace('Grade ', 'G')), series: [{ name: 'Present %', values: a.byGrade.map((g) => g.present), colors: a.byGrade.map((g) => (g.present < 85 ? 'var(--critical)' : g.present < 93 ? 'var(--viz-3)' : 'var(--brand)')) }], yMax: 100, target: 93, targetLabel: 'Target 93%', height: 210, label: 'Attendance by grade, last 7 days' })} />;
  } else if (view === 'late' && a.lateByTime.length) {
    chart = <Chart svg={charts.bar({ labels: a.lateByTime.map((x) => x.label), series: [{ name: 'Late arrivals', values: a.lateByTime.map((x) => x.value), color: 'var(--viz-3)' }], height: 210, label: 'Late arrival times, last 30 days' })} />;
  } else if (view === 'pattern' && a.weekdayAbsences.length) {
    chart = <Chart svg={charts.hbar({ rows: a.weekdayAbsences.map((w) => ({ label: w.day.trim(), value: w.absences, display: `${w.absences} absences` })), labelW: 120, rowH: 34, label: 'Absences by weekday, last 60 days' })} />;
  }
  const grades = d.academic.byGrade;
  const overall = grades.length ? Math.round(grades.reduce((sum, g) => sum + g.average, 0) / grades.length) : null;
  const range = a.trend.length > 1 ? `${new Date(`${a.trend[0].day}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} – ${new Date(`${a.trend[a.trend.length - 1].day}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : null;

  return (
    <>
      {metrics && (
        <div className="grid g-4col">
          <MetricCard icon="users" tone="rose" label="Total Students" value={fmt.n(s.total)} to="/students"
            delta={growth(h?.students)} compare={since} spark={h?.students} />
          <MetricCard icon="user" tone="blue" label="Total Staff" value={fmt.n(d.staff.total)} to={can('hr.read') ? '/workforce' : undefined}
            delta={growth(h?.staff)} compare={since} spark={h?.staff?.slice(-6)} sparkLabels={h?.months.slice(-6)} viz="bars" />
          <MetricCard icon="calendar" tone="green" label="Attendance Rate" value={attRate != null ? `${attRate}%` : '—'} to="/attendance"
            delta={attDelta} deltaUnit=" pts" compare="vs last week" pct={attRate} viz="ring" />
          {fee ? (
            <MetricCard icon="rupee" tone="amber" label="Fee Collection" value={`${Math.round(fee.collectionPct)}%`} to="/fees"
              delta={feeDelta} deltaUnit=" pts" compare="vs last month" pct={fee.collectionPct} spark={feeMonths.map((m) => m.pct)} viz="progress" />
          ) : (
            <MetricCard icon="trending" tone="amber" label="Students On Track" value={s.total ? `${Math.round((s.onTrack / s.total) * 100)}%` : '—'}
              compare={`${fmt.n(s.onTrack)} of ${fmt.n(s.total)} students`} to="/students?risk=On+Track" />
          )}
        </div>
      )}
      <div className="grid dash__pair">
        <TrendCard points={[]} actions={(
          <>
            {view === 'trend' && range && <span className="rangepill"><Icon name="calendar" size={13} />{range}</span>}
            <select className="select select--sm" aria-label="Attendance view" value={view} onChange={(e) => setView(e.target.value as AttView)}>
              <option value="trend">Last {a.trend.length} school days</option>
              <option value="grade">By class (7 days)</option>
              <option value="late">Late arrivals (30 days)</option>
              <option value="pattern">Absences by weekday</option>
            </select>
          </>
        )}>
          {chart ?? <Empty icon="chart" title="No attendance data yet" sub="Figures appear once attendance is marked." />}
        </TrendCard>
        <DonutCard link={{ to: '/academic-performance' }}
          center={overall != null ? `${overall}%` : undefined} centerSub={overall != null ? 'Overall Performance' : undefined}
          bands={[
            { label: 'On Track', value: s.onTrack, color: '#1F9D6B', to: '/students?risk=On+Track' },
            { label: 'Developing Risk', value: s.developing, color: '#F2B32E', to: '/students?risk=Developing+Risk' },
            { label: 'At Risk', value: s.atRisk, color: '#E8435F', to: '/students?risk=At+Risk' },
          ]} />
      </div>
      <div className={events && can('communication.read') ? 'grid dash__events' : 'grid'}>
        {events && <UpcomingEvents />}
        <RankCard link={{ to: '/academic-performance' }} rows={top.rows} loading={top.loading} fill
          empty={{ title: 'No results recorded yet', sub: 'Students appear here once assessment marks are entered.' }} />
      </div>
    </>
  );
}
