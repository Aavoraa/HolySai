/**
 * The Command Center visualisations as reusable cards, so every role dashboard
 * can show the same kind of picture from data that role may see:
 * attendance trend (line), performance (donut), ranking (table).
 */
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiQuery, usePagedQuery } from '@/hooks/useApi';
import type { StudentRow } from '@/api/types';
import { Avatar, Card, CardLink, Chart, charts, Empty } from './primitives';
import { UpcomingEvents } from './dashboard';

export interface TrendPoint { label: string; value: number }

/** Line chart card (percentages by default), e.g. attendance over recent days. */
export function TrendCard({ title = 'Attendance Overview', icon = 'calendar', points, series = 'Students', unit = '%', color = 'var(--brand)', actions, empty, children }: {
  title?: string; icon?: string; points: TrendPoint[]; series?: string; unit?: string; color?: string;
  actions?: ReactNode; empty?: { title: string; sub?: string }; children?: ReactNode;
}) {
  const min = points.length ? Math.max(0, Math.floor(Math.min(...points.map((p) => p.value)) / 10) * 10 - 10) : 0;
  return (
    <Card icon={icon} title={title} actions={actions}>
      {children ?? (points.length > 1 ? (
        <>
          <Chart svg={charts.line({
            labels: points.map((p) => p.label), series: [{ name: series, values: points.map((p) => p.value), color }],
            yMin: unit === '%' ? min : undefined, yMax: unit === '%' ? 100 : undefined, unit, height: 230, label: `${title}, ${series}`,
          })} />
          <div className="minibars__legend"><span><i style={{ background: color }} />{series}</span></div>
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
    <Card icon={icon} title={title} actions={link ? <CardLink to={link.to}>{link.label ?? 'View Details'}</CardLink> : undefined}>
      {total ? (
        <div className="row g-5 wrap" style={{ alignItems: 'center' }}>
          <div className="none">
            <Chart svg={charts.donut({ size: 160, thickness: 26, center: center ?? `${pct(bands[0].value)}%`, centerSub: centerSub ?? bands[0].label, data: bands, label: title })} />
          </div>
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

/** Ranked table: medal dot, person, a middle column and a value. */
export function RankCard({ title = 'Top Performers', icon = 'award', link, nameLabel, middle = 'Class', valueLabel = 'Percentage', rows, loading, empty }: {
  title?: string; icon?: string; link?: { to: string; label?: string }; nameLabel?: string; middle?: string; valueLabel?: string;
  rows: RankRow[]; loading?: boolean; empty?: { title: string; sub?: string };
}) {
  const navigate = useNavigate();
  return (
    <Card icon={icon} title={title} flush actions={link ? <CardLink to={link.to}>{link.label ?? 'View All'}</CardLink> : undefined}>
      {loading ? (
        <div className="card__body col g-3">{[0, 1, 2].map((i) => <span key={i} className="skeleton" style={{ height: 32 }} />)}</div>
      ) : rows.length ? (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead><tr><th style={{ width: 70 }}>#</th><th>{nameLabel ?? (title.includes('Subject') ? 'Subject' : 'Student')}</th><th>{middle}</th><th className="num">{valueLabel}</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className={r.to ? 'row--link' : undefined} onClick={r.to ? () => navigate(r.to!) : undefined}>
                  <td><span className="row g-3"><span className={`rank rank--${Math.min(i + 1, 5)}`} /><span className="t-muted">{i + 1}</span></span></td>
                  <td><span className="person"><Avatar name={r.name} src={r.photo} size="sm" /><span className="person__name t-clip">{r.name}</span></span></td>
                  <td className="t-nowrap" style={{ color: 'var(--brand)' }}>{r.meta}</td>
                  <td className="num t-bold">{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
  attendance: { trend: { label: string; value: number }[]; byGrade: { grade: string; present: number }[]; lateByTime: { label: string; value: number }[]; weekdayAbsences: { day: string; absences: number }[]; todayPct: number | null };
  academic: { byGrade: { grade: string; average: number }[] };
}

type AttView = 'trend' | 'grade' | 'late' | 'pattern';

/**
 * The Command Center picture for any role that may read school-wide figures
 * (dashboard.view + students.read): attendance, performance, events and top performers.
 * Renders nothing for other roles.
 */
export function SchoolPulse({ events = true }: { events?: boolean }) {
  const { can } = useAuth();
  const school = useSchool();
  const allowed = can('dashboard.view') && can('students.read');
  const [view, setView] = useState<AttView>('trend');
  const q = useApiQuery<Pulse>(allowed ? '/dashboard/command-center' : null, { scope: school.scope, campusId: school.campusId });
  const top = useTopStudents();
  if (!allowed) return null;
  if (q.isLoading) return <div className="grid dash__pair">{[0, 1].map((i) => <span key={i} className="skeleton" style={{ height: 300, borderRadius: 12 }} />)}</div>;
  if (!q.data) return null;
  const d = q.data;
  const a = d.attendance;

  let chart = '';
  if (view === 'trend' && a.trend.length > 1) {
    const min = Math.max(0, Math.floor(Math.min(...a.trend.map((x) => x.value)) / 10) * 10 - 10);
    chart = charts.line({ labels: a.trend.map((x) => x.label), series: [{ name: 'Students', values: a.trend.map((x) => x.value), color: 'var(--brand)' }], yMin: min, yMax: 100, unit: '%', height: 230, label: 'Student attendance over recent school days' });
  } else if (view === 'grade' && a.byGrade.length) {
    chart = charts.bar({ labels: a.byGrade.map((g) => g.grade.replace('Grade ', 'G')), series: [{ name: 'Present %', values: a.byGrade.map((g) => g.present), colors: a.byGrade.map((g) => (g.present < 85 ? 'var(--critical)' : g.present < 93 ? 'var(--accent)' : 'var(--brand)')) }], yMax: 100, target: 93, targetLabel: 'Target 93%', height: 230, label: 'Attendance by grade, last 7 days' });
  } else if (view === 'late' && a.lateByTime.length) {
    chart = charts.bar({ labels: a.lateByTime.map((x) => x.label), series: [{ name: 'Late arrivals', values: a.lateByTime.map((x) => x.value), color: 'var(--accent)' }], height: 230, label: 'Late arrival times, last 30 days' });
  } else if (view === 'pattern' && a.weekdayAbsences.length) {
    chart = charts.hbar({ rows: a.weekdayAbsences.map((w) => ({ label: w.day.trim(), value: w.absences, display: `${w.absences} absences` })), labelW: 120, rowH: 34, label: 'Absences by weekday, last 60 days' });
  }
  const grades = d.academic.byGrade;
  const overall = grades.length ? Math.round(grades.reduce((s, g) => s + g.average, 0) / grades.length) : null;
  const s = d.students;

  return (
    <>
      <div className="grid dash__pair">
        <TrendCard points={[]} actions={(
          <select className="select select--sm" aria-label="Attendance view" value={view} onChange={(e) => setView(e.target.value as AttView)}>
            <option value="trend">Last school days</option>
            <option value="grade">By class (7 days)</option>
            <option value="late">Late arrivals (30 days)</option>
            <option value="pattern">Absences by weekday</option>
          </select>
        )}>
          {chart ? <Chart svg={chart} /> : <Empty icon="chart" title="No attendance data yet" sub="Figures appear once attendance is marked." />}
          {chart && view === 'trend' && <div className="minibars__legend"><span><i />Students</span></div>}
        </TrendCard>
        <DonutCard link={{ to: '/academic-performance' }}
          center={overall != null ? `${overall}%` : undefined} centerSub={overall != null ? 'Overall Performance' : undefined}
          bands={[
            { label: 'On Track', value: s.onTrack, color: 'var(--success)', to: '/students?risk=On+Track' },
            { label: 'Developing Risk', value: s.developing, color: 'var(--accent)', to: '/students?risk=Developing+Risk' },
            { label: 'At Risk', value: s.atRisk, color: 'var(--critical)', to: '/students?risk=At+Risk' },
          ]} />
      </div>
      <div className={events && can('communication.read') ? 'grid dash__events' : 'grid'}>
        {events && <UpcomingEvents />}
        <RankCard link={{ to: '/academic-performance' }} rows={top.rows} loading={top.loading}
          empty={{ title: 'No results recorded yet', sub: 'Students appear here once assessment marks are entered.' }} />
      </div>
    </>
  );
}

