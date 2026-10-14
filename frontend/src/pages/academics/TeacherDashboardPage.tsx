import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthContext';
import { useApiQuery } from '@/hooks/useApi';
import { api } from '@/api/client';
import { useSchool } from '@/layouts/SchoolContext';
import {
  AlertItem, Badge, Button, Card, Empty, ErrorState, Grid, Icon, Kpi, Meter, Page, PageSkeleton, CampusBanner, DashLayout, DashRail,
  DonutCard, RankCard, TrendCard, UpcomingEvents, useTopStudents, type TrendPoint,
} from '@/components/ui';
import { fmt, todayKey } from '@/lib/format';
import { DueDate, meterTone, plural, ratio } from './shared';

interface DashClass { id: string; name: string; subject: string; students: number; marked: number; next: string; attendance: string; isClassTeacher: boolean; hasClassToday: boolean }
interface DashPeriod { periodNo: number; startsAt: string; endsAt: string; what: string; where: string; state: 'now' | 'done' | 'upcoming'; free?: boolean; cover?: boolean; sectionId?: string }
interface DashSignal { id: string; code: string; signal: string; signalType: string; stage: number; studentId: string; name: string; admissionNo: string; sectionLabel: string }
interface DashTask { id: string; title: string; module: string; dueOn: string | null; route: string | null; overdue: boolean; priority: string }
interface DashHomework { id: string; title: string; subject: string; sectionLabel: string; dueOn: string; submitted: number; of: number }
interface TeacherDashboard {
  date: string;
  dayName: string;
  lede: string;
  employee: { id: string; fullName: string; designation: string } | null;
  kpis: { classes: number; students: number; toMark: number; toMarkNames: string[]; marksPending: number; marksPendingFoot: string | null; watch: number } | null;
  classes: DashClass[];
  today: DashPeriod[];
  watchlist: DashSignal[];
  watchCount: number;
  tasks: DashTask[];
  homework: DashHomework[];
}

interface RegisterSummary { summary: { total: number; present: number; late: number; absent: number; leave: number; unmarked: number } }
interface StudentSummary { total: number; atRisk: number; developing: number; onTrack: number }

/** The last `n` school days (Monday to Saturday) up to today, oldest first, as YYYY-MM-DD in school time. */
function recentSchoolDays(n: number) {
  const out: string[] = [];
  const d = new Date(todayKey() + 'T00:00:00Z');
  while (out.length < n) {
    if (d.getUTCDay() !== 0) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

/**
 * Command Center style picture scoped to the teacher: attendance across their own
 * sections (registers they may read), risk bands and top performers among their
 * assigned students (/students is scoped server-side for students.read_assigned).
 */
function TeacherPulse({ sectionIds }: { sectionIds: string[] }) {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const sections = [...new Set(sectionIds)];
  const days = recentSchoolDays(5);
  const canAtt = can('attendance.read');
  const canStudents = can('students.read_assigned') || can('students.read');
  const registers = useQueries({
    queries: (canAtt ? days : []).flatMap((date) => sections.map((sectionId) => ({
      queryKey: ['/attendance/register', { sectionId, date }],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<RegisterSummary>('/attendance/register', { sectionId, date }, signal),
      staleTime: 300_000,
    }))),
  });
  const summary = useApiQuery<StudentSummary>(canStudents ? '/students/summary' : null, campusParam);

  const attLoading = registers.some((r) => r.isLoading);
  const points: TrendPoint[] = [];
  days.forEach((date, di) => {
    let attended = 0;
    let marked = 0;
    sections.forEach((_, si) => {
      const s = registers[di * sections.length + si]?.data?.summary;
      if (!s) return;
      attended += s.present + s.late;
      marked += s.present + s.late + s.absent + s.leave;
    });
    if (marked) points.push({ label: fmt.dateShort(date), value: Math.round((attended / marked) * 100) });
  });
  const st = summary.data;
  const events = can('communication.read');

  return (
    <>
      <div className="grid dash__pair">
        {canAtt && attLoading ? <span className="skeleton" style={{ height: 300, borderRadius: 12 }} /> : (
          <TrendCard title="Attendance Overview" series={sectionIds.length > 1 ? 'My classes' : 'My class'} points={points}
            empty={{ title: 'No attendance data yet', sub: 'The trend appears once your registers have been marked on two or more school days.' }} />
        )}
        {canStudents && summary.isLoading ? <span className="skeleton" style={{ height: 300, borderRadius: 12 }} /> : (
          <DonutCard title="Academic Performance" link={canStudents ? { to: '/academic-performance' } : undefined}
            centerSub="On Track"
            bands={st ? [
              { label: 'On Track', value: st.onTrack, color: 'var(--success)', to: '/students?risk=On+Track' },
              { label: 'Developing Risk', value: st.developing, color: 'var(--accent)', to: '/students?risk=Developing+Risk' },
              { label: 'At Risk', value: st.atRisk, color: 'var(--critical)', to: '/students?risk=At+Risk' },
            ] : []}
            empty={{ title: 'No students yet', sub: 'Risk bands appear once students are assigned to your classes.' }} />
        )}
      </div>
      {canStudents && (
        <div className={events ? 'grid dash__events' : 'grid'}>
          {events && <UpcomingEvents />}
          <MyTopPerformers />
        </div>
      )}
      {!canStudents && events && <UpcomingEvents />}
    </>
  );
}

/** Top five of the teacher's own students by academic average (rendered only with a student-read permission). */
function MyTopPerformers() {
  const top = useTopStudents();
  return (
    <RankCard title="Top Performers" link={{ to: '/academic-performance' }} rows={top.rows} loading={top.loading}
      empty={{ title: 'No results recorded yet', sub: 'Your students appear here once assessment marks are entered.' }} />
  );
}

const ATT_TONE: Record<string, string> = { Marked: 'success', Pending: 'warning', 'Not marked': 'critical' };

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date()));
  return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
}

function dueLabel(d: string | null) {
  if (!d) return 'No date';
  if (d === todayKey()) return 'Today';
  return fmt.dateShort(d);
}

export default function TeacherDashboardPage() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const q = useApiQuery<TeacherDashboard>('/academics/teacher-dashboard', undefined, { refetchInterval: 120_000 });

  if (q.isLoading) return <Page><PageSkeleton /></Page>;
  if (q.error) return <Page><ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;
  const d = q.data!;
  const name = (d.employee?.fullName ?? user?.fullName ?? '').split(' ').slice(0, 2).join(' ');
  // Registers still open today: the teacher's own class, or a class they teach today.
  const toMark = d.classes.filter((c) => c.attendance !== 'Marked' && (c.isClassTeacher || c.hasClassToday));
  const firstToMark = toMark[0];
  const markTo = firstToMark ? `/attendance?section=${firstToMark.id}` : '/attendance';
  const nowPeriod = d.today.find((p) => p.state === 'now');
  const classById = new Map(d.classes.map((c) => [c.id, c]));

  const head = (
    <CampusBanner
      title={<>{greeting()}, {name}</>}
      sub={<>{d.lede}</>}
      actions={(
        <>
          {can('ai.use') && <Button icon="sparkle" to="/copilot">AI Co-Pilot</Button>}
          <Button variant="primary" icon="checkSquare" to={markTo}>{firstToMark ? `Mark attendance · ${firstToMark.name}` : 'Mark attendance'}</Button>
        </>
      )}
    />
  );

  if (!d.employee || !d.kpis) {
    return (
      <Page>
        {head}
        <Card>
          <Empty icon="bookOpen" title="No teaching record linked to your account"
            sub="Classes, timetable and watchlist appear here once your account is linked to a staff record with class assignments. You can still open attendance for any section."
            action={<Button icon="checkSquare" to="/attendance">Open attendance</Button>} />
        </Card>
      </Page>
    );
  }
  const k = d.kpis;

  return (
    <Page>
      {head}
      <DashLayout rail={<DashRail actions={[
        { label: 'Mark Attendance', icon: 'checkSquare', to: '/attendance' },
        { label: 'Homework', icon: 'edit', to: '/homework', show: can('academics.read') },
        { label: 'Enter Marks', icon: 'clipboard', to: '/assessments', show: can('academics.read') },
        { label: 'Lesson Plans', icon: 'bookOpen', to: '/lesson-plans', show: can('academics.read') },
        { label: 'Timetable', icon: 'calendar', to: '/timetable', show: can('academics.read') },
        { label: 'Message Parents', icon: 'message', to: '/parent-communication', show: can('communication.read') },
        { label: 'AI Co-Pilot', icon: 'sparkle', to: '/copilot', show: can('ai.use') },
      ]} events={false} />}>
      <Grid cols="g-4col">
        <Kpi icon="checkSquare" label="Attendance to mark" value={k.toMark} tone={k.toMark ? 'critical' : 'teal'}
          foot={k.toMark ? k.toMarkNames.join(' and ') : 'All registers up to date'} to={markTo} />
        <Kpi icon="clipboard" label="Marks pending" value={k.marksPending} tone={k.marksPending ? 'amber' : 'teal'} foot={k.marksPendingFoot ?? 'Nothing waiting'} to="/assessments" />
        <Kpi icon="alert" label="Students to watch" value={k.watch} tone="info" foot="Open Early Warning signals" to={can('earlywarning.read') ? '/early-warning' : undefined} />
        <Kpi icon="users" label="My classes" value={k.classes} foot={`${plural(k.students, 'student')} in total`} to="/classes" />
      </Grid>
      {/* Chart the teacher's own form classes (or their first two sections) to keep requests light. */}
      <TeacherPulse sectionIds={(d.classes.some((c) => c.isClassTeacher) ? d.classes.filter((c) => c.isClassTeacher) : d.classes).slice(0, 2).map((c) => c.id)} />

      <div className="grid g-main mt-5">
        <div className="col g-4">
          <Card icon="clock" title="Today's timetable" sub={`${d.dayName} ${fmt.date(d.date)}${nowPeriod ? ` · now: Period ${nowPeriod.periodNo}` : ''}`} flush
            actions={<Button size="sm" variant="quiet" iconRight="arrowRight" to={user?.employeeId ? '/timetable?view=mine' : '/timetable'}>Full week</Button>}>
            {d.today.length === 0 ? (
              <Empty icon="calendar" title="No periods today" sub="Your timetable has no lessons on this day." action={<Button size="sm" to="/timetable">Open timetable</Button>} />
            ) : (
              <div className="rule-list">
                {d.today.map((p) => {
                  const cls = p.sectionId ? classById.get(p.sectionId) : undefined;
                  const needsRegister = !!p.sectionId && !p.free && p.state !== 'upcoming' && (!cls || cls.attendance !== 'Marked');
                  return (
                    <div key={p.periodNo} className={['td-period', `td-period--${p.state}`, p.free && 'td-period--free'].filter(Boolean).join(' ')}
                      aria-current={p.state === 'now' ? 'time' : undefined}>
                      <span className="td-period__time"><strong>P{p.periodNo}</strong><span>{p.startsAt}–{p.endsAt}</span></span>
                      <span className="td-period__body">
                        <span className="td-period__what">{p.free ? 'Free period' : p.what}</span>
                        <span className="td-period__where">{p.where}{p.cover ? ' · cover lesson' : ''}</span>
                      </span>
                      <span className="td-period__side">
                        {p.state === 'now' && <Badge tone="info" dot>Now</Badge>}
                        {p.state === 'done' && <span className="t-micro t-faint">Done</span>}
                        {p.cover && <Badge tone="warning">Cover</Badge>}
                        {needsRegister && (
                          <Button size="sm" variant={p.state === 'now' ? 'primary' : 'ghost'} icon="checkSquare" to={`/attendance?section=${p.sectionId}`}>Register</Button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card icon="users" title="My classes" sub="Register, timetable and homework for each class" flush>
            {d.classes.length === 0 ? (
              <Empty icon="users" title="No classes assigned" sub="Class assignments are managed by the academic office." />
            ) : (
              <div className="rule-list">
                {d.classes.map((c) => (
                  <div key={c.id} className="td-class">
                    <span className="td-class__mark" aria-hidden="true">{c.name.replace('Grade ', 'G')}</span>
                    <span className="td-class__body">
                      <span className="td-class__title">{c.name} · {c.subject}{c.isClassTeacher ? ' · Class teacher' : ''}</span>
                      <span className="t-micro t-muted">{plural(c.students, 'student')} · next {c.next}</span>
                    </span>
                    <Badge tone={ATT_TONE[c.attendance] ?? 'neutral'} dot>{c.attendance}</Badge>
                    <span className="td-class__links">
                      <Button size="sm" icon="checkSquare" to={`/attendance?section=${c.id}`} aria-label={`Attendance for ${c.name}`}>Attendance</Button>
                      <Button size="sm" icon="calendar" to={`/timetable?section=${c.id}`} aria-label={`Timetable for ${c.name}`}>Timetable</Button>
                      <Button size="sm" icon="edit" to={`/homework?sectionId=${c.id}`} aria-label={`Homework for ${c.name}`}>Homework</Button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="col g-4">
          <Card icon="alert" title="Needs your attention" sub="Registers still to mark and tasks due" flush>
            {toMark.length === 0 && d.tasks.length === 0 ? (
              <Empty icon="checkSquare" title="You are all caught up" sub="Registers are marked and nothing is pending. New tasks appear here as they are assigned." />
            ) : (
              <div className="rule-list">
                {toMark.map((c) => (
                  <AlertItem key={`att-${c.id}`} tone={c.attendance === 'Not marked' ? 'critical' : 'warning'} icon="checkSquare"
                    title={`Mark attendance — ${c.name}`} meta={`${c.attendance} · ${plural(c.students, 'student')}`}
                    onClick={() => navigate(`/attendance?section=${c.id}`)} />
                ))}
                {d.tasks.map((t) => {
                  const due = dueLabel(t.dueOn);
                  return (
                    <button key={t.id} type="button" className="td-row hoverable" onClick={() => navigate(t.route ?? '/my-tasks')}>
                      <Icon name="list" size={16} className="t-muted" />
                      <span className="td-row__body">
                        <span className="t-sm">{t.title}</span>
                        <span className="t-micro t-muted">{t.module}</span>
                      </span>
                      <Badge tone={t.overdue ? 'critical' : due === 'Today' ? 'warning' : 'neutral'}>{t.overdue ? `Overdue · ${due}` : due}</Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          <Card icon="edit" title="Homework to review" sub="Open assignments in your classes" flush
            actions={<Button size="sm" variant="quiet" iconRight="arrowRight" to="/homework">All homework</Button>}>
            {d.homework.length === 0 ? (
              <Empty icon="edit" title="No open homework" sub="Homework you set appears here with its submission rate."
                action={can('academics.manage') ? <Button size="sm" icon="plus" to="/homework">Set homework</Button> : undefined} />
            ) : (
              <div className="rule-list">
                {d.homework.map((h) => (
                  <button key={h.id} type="button" className="td-row hoverable" onClick={() => navigate(`/homework?q=${encodeURIComponent(h.title)}`)}
                    aria-label={`Review ${h.title}, ${h.sectionLabel} ${h.subject}`}>
                    <span className="td-row__body">
                      <Meter label={`${h.sectionLabel} ${h.subject} — ${h.title}`} value={Math.round(ratio(h.submitted, h.of))}
                        right={`${h.submitted}/${h.of}`} tone={meterTone(ratio(h.submitted, h.of))} />
                      <span className="mt-1"><DueDate date={h.dueOn} /></span>
                    </span>
                    <Icon name="chevronRight" size={15} className="t-faint" />
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card icon="alert" title="Students requiring attention" sub="Select a name to open Student 360" flush
            foot="Signals are advisory. You decide whether they need action.">
            {d.watchlist.length === 0 ? (
              <Empty icon="shieldCheck" title="No open signals" sub="None of your students has an open Early Warning signal." />
            ) : (
              <div>
                {d.watchlist.map((w) => (
                  <AlertItem key={w.id} tone={w.signalType === 'attendance' ? 'critical' : w.stage === 0 ? 'warning' : 'caution'} icon="user"
                    title={w.name} meta={`${w.sectionLabel} · ${w.signal}`} onClick={() => navigate(`/student-360/${w.studentId}`)} />
                ))}
                {d.watchCount > d.watchlist.length && can('earlywarning.read') && (
                  <div className="card__body card__body--tight">
                    <Button size="sm" variant="quiet" iconRight="arrowRight" to="/early-warning">See all {d.watchCount}</Button>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
      </DashLayout>
    </Page>
  );
}
