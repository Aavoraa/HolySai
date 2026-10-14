import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n/I18nProvider';
import { useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { Avatar, Badge, Button, Card, Empty, ErrorState, Icon, Meter, Page, PageSkeleton, Skeleton, Status, CampusBanner, DashLayout, DashRail, DonutCard, RankCard, TrendCard } from '@/components/ui';
import { cx, fmt, todayKey } from '@/lib/format';
import { SkillWebCard, Student360, type Profile } from './Student360Page';

interface Notice { id: string; tone: string; icon: string; title: string; route: string | null; createdAt: string; readAt: string | null }

const TODAY_LABEL: Record<string, string> = { present: 'Present today', absent: 'Absent today', late: 'Late today', leave: 'On leave today', unmarked: 'Attendance not marked yet' };
const todayTone = (v: string) => (v === 'present' ? 'success' : v === 'late' ? 'warning' : v === 'absent' ? 'critical' : v === 'leave' ? 'info' : 'neutral');

/**
 * Student portal. The default view is "My day" — today's attendance, results, notices
 * and bus — built from the same profile the API scopes to the signed-in student.
 * "Full profile" (?view=profile) opens the complete Student 360 record.
 */
export default function MyProfilePage() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  if (!user?.studentId) {
    return <Page><Card><Empty icon="user" title="No student record is linked to this account" sub="Please contact the school office." /></Card></Page>;
  }
  const openProfile = (tab?: string) => setSp(() => {
    const n = new URLSearchParams({ view: 'profile' });
    if (tab) n.set('tab', tab);
    return n;
  });
  if (sp.get('view') === 'profile') {
    return (
      <>
        <div className="portal-back">
          <Button size="sm" variant="quiet" icon="chevronLeft" onClick={() => setSp(new URLSearchParams())}>Back to My day</Button>
        </div>
        <Student360 id={user.studentId} />
      </>
    );
  }
  return <MyDay id={user.studentId} onProfile={openProfile} />;
}

function Item({ icon, tone, title, meta, end, onClick }: { icon: string; tone?: string; title: ReactNode; meta?: ReactNode; end?: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <span className={cx('portal-item__ico', tone && `portal-item__ico--${tone}`)}><Icon name={icon} size={17} /></span>
      <span className="portal-item__body">
        <span className="portal-item__title">{title}</span>
        {meta && <span className="portal-item__meta">{meta}</span>}
      </span>
      {end !== undefined && <span className="portal-item__end">{end}</span>}
    </>
  );
  return onClick ? <button type="button" className="portal-item" onClick={onClick}>{body}</button> : <div className="portal-item">{body}</div>;
}

function MyDay({ id, onProfile }: { id: string; onProfile: (tab?: string) => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const q = useApiQuery<Profile>(`/students/${id}/profile`);
  const notices = usePagedQuery<Notice>('/notifications', { pageSize: 5 });

  if (q.isLoading) return <Page className="portal"><PageSkeleton /></Page>;
  if (q.error || !q.data) return <Page className="portal"><ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;
  const d = q.data;
  const s = d.student;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  const greet = t(hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening');
  const todayRow = d.attendance.recent.find((r) => r.date.slice(0, 10) === todayKey());
  const tot = d.attendance.totals;
  const lowAttendance = s.attendance != null && s.attendance < 85;
  const subjects = d.academics.subjects;
  const band = (lo: number, hi: number) => subjects.filter((x) => x.score >= lo && x.score < hi).length;
  const subjectAvg = subjects.length ? Math.round(subjects.reduce((sum, x) => sum + x.score, 0) / subjects.length) : null;
  const ranked = [...subjects].sort((a, b) => b.score - a.score);

  return (
    <Page className="portal">
      <CampusBanner bleed={false} title={<>{greet}, {s.firstName}</>} sub="Your day at school — classes, attendance, results and notices." />
      <DashLayout rail={<DashRail actions={[
        { label: 'My Full Profile', icon: 'user', to: '/my-profile?view=profile' },
        { label: 'My Ideas', icon: 'lightbulb', to: '/my-ideas' },
        { label: 'My Tasks', icon: 'checkSquare', to: '/my-tasks' },
        { label: 'Notifications', icon: 'bell', to: '/notifications' },
        { label: 'My Account', icon: 'settings', to: '/account' },
      ]} />}>
      <section className="card profilehead">
        <div className="profilehead__main">
          <Avatar name={s.fullName} size="xl" src={s.photoUrl} />
          <div className="profilehead__id">
            <div className="row g-2 wrap">
              <h2 className="profilehead__name">{s.fullName}</h2>
              <Badge tone={todayTone(s.today)} dot>{TODAY_LABEL[s.today] ?? s.today}</Badge>
            </div>
            <p className="profilehead__meta">{s.grade} {s.section}{s.rollNo ? ` · Roll ${s.rollNo}` : ''} · {s.admissionNo} · {s.campusName}</p>
            <div className="profilehead__facts">
              <span><Icon name="graduation" size={14} />{s.classTeacher ?? 'No class teacher yet'}</span>
              {s.house && <span><Icon name="award" size={14} />{s.house} House</span>}
              <span><Icon name="bus" size={14} />{d.transport ? `${d.transport.routeName} · ${d.transport.stopName ?? d.transport.area}` : 'Own transport'}</span>
            </div>
          </div>
          <div className="profilehead__actions">
            <Button size="sm" variant="primary" icon="user" onClick={() => onProfile()}>My full profile</Button>
            <Button size="sm" icon="lightbulb" onClick={() => navigate('/my-ideas')}>My ideas</Button>
          </div>
        </div>
        <dl className="profilehead__stats">
          <div>
            <dt>Today</dt>
            <dd className={s.today === 'present' ? 't-success' : s.today === 'absent' ? 't-critical' : s.today === 'late' ? 't-warning' : undefined}>
              {todayRow?.arrivalTime ? `In ${todayRow.arrivalTime.slice(0, 5)}` : (TODAY_LABEL[s.today] ?? s.today).replace(' today', '').replace(' yet', '')}
            </dd>
            <span>{fmt.date(new Date())}</span>
          </div>
          <div>
            <dt>Attendance</dt>
            <dd className={lowAttendance ? 't-critical' : undefined}>{s.attendance != null ? `${s.attendance}%` : '—'}</dd>
            <span>{lowAttendance ? 'below the 85% target' : 'this academic year'}</span>
          </div>
          <div>
            <dt>Average</dt>
            <dd>{s.average ?? '—'}</dd>
            <span className={s.trend > 0 ? 't-success' : s.trend < 0 ? 't-critical' : undefined}>{s.average != null ? `${s.trend >= 0 ? '+' : ''}${s.trend} trend` : 'No results yet'}</span>
          </div>
          <div>
            <dt>Achievements</dt>
            <dd>{d.achievements.length}</dd>
            <span>{d.achievements[0] ? d.achievements[0].title : 'None recorded yet'}</span>
          </div>
        </dl>
      </section>

      <div className="grid dash__pair mt-4">
        <TrendCard title="My Attendance" series="My attendance" points={d.attendance.months}
          actions={<button type="button" className="portal-link" onClick={() => onProfile('attendance')}>Details<Icon name="chevronRight" size={13} /></button>}
          empty={{ title: 'No attendance trend yet', sub: 'Your monthly attendance appears once a few months are marked.' }} />
        <DonutCard title="My Performance" icon="graduation"
          center={subjectAvg != null ? `${subjectAvg}%` : undefined} centerSub={subjectAvg != null ? 'Overall Average' : undefined}
          bands={[
            { label: 'Excellent (85+)', value: band(85, Infinity), color: 'var(--success)' },
            { label: 'Good (70–84)', value: band(70, 85), color: 'var(--brand)' },
            { label: 'Average (50–69)', value: band(50, 70), color: 'var(--accent)' },
            { label: 'Needs Improvement (<50)', value: band(-Infinity, 50), color: 'var(--critical)' },
          ]}
          empty={{ title: 'No results yet', sub: 'Your subject results appear here after your first assessment.' }} />
      </div>

      <RankCard title="My Subjects" icon="trending" middle="Teacher" valueLabel="Score"
        rows={ranked.map((x) => ({ key: x.name, name: x.name, meta: x.teacher ?? x.grade, value: `${x.score}%` }))}
        empty={{ title: 'No subject results yet', sub: 'Subjects are ranked here once assessment marks are entered.' }} />

      <div className="grid dash__pair mt-4">
        <SkillWebCard d={d} title="My skill web" onOpen={() => onProfile('skills')} />
        <Card icon="award" title="My activities & achievements" actions={<button type="button" className="portal-link" onClick={() => onProfile('achievements')}>All<Icon name="chevronRight" size={13} /></button>}>
          {d.activities.length || d.achievements.length ? (
            <div className="portal-list">
              {d.achievements.slice(0, 3).map((a) => <Item key={a.id} icon="award" tone="brand" title={a.title} meta={`${a.level ?? 'School'} · ${fmt.dateShort(a.date)}`} />)}
              {d.activities.slice(0, 3).map((a) => <Item key={a.name} icon="star" title={a.name} meta={`${a.role} · ${a.hours} hours`} />)}
            </div>
          ) : <p className="t-sm t-muted">Your clubs, sports and achievements appear here.</p>}
        </Card>
      </div>

      <div className="grid g-main mt-4">
        <div className="portal-stack">
          <Card icon="trending" title="My subjects" actions={<button type="button" className="portal-link" onClick={() => onProfile('academics')}>See all<Icon name="chevronRight" size={13} /></button>}>
            {d.academics.subjects.length ? (
              <div className="col g-3">
                {d.academics.subjects.slice(0, 6).map((x) => (
                  <Meter key={x.name} label={x.name} value={x.score} right={`${x.score} · ${x.grade}`} tone={x.score >= 80 ? 'teal' : x.score >= 70 ? 'info' : 'amber'}
                    hint={x.target != null && x.score < x.target ? `Target ${x.target}` : undefined} />
                ))}
              </div>
            ) : <p className="t-sm t-muted">Your results appear here after your first assessment.</p>}
          </Card>

          <Card icon="grid" title="Recent assessments">
            {d.academics.assessments.length ? (
              <div className="portal-list">
                {d.academics.assessments.slice(0, 5).map((a) => (
                  <Item key={a.code} icon="fileText" title={a.name} meta={`${a.subject} · ${fmt.dateShort(a.heldOn)} · out of ${a.maxMarks}`}
                    end={a.isAbsent ? <Badge tone="critical">Absent</Badge> : <span className="t-bold t-num">{a.marks ?? '—'}{a.grade ? <span className="t-xs t-muted"> · {a.grade}</span> : null}</span>} />
                ))}
              </div>
            ) : <p className="t-sm t-muted">No assessment results yet.</p>}
          </Card>
        </div>

        <div className="portal-stack">
          <Card icon="bell" title="Notices" actions={<button type="button" className="portal-link" onClick={() => navigate('/notifications')}>All<Icon name="chevronRight" size={13} /></button>}>
            {notices.isLoading ? <Skeleton height={100} /> : notices.error ? <p className="t-sm t-muted">Notices are not available right now.</p> : notices.data?.rows.length ? (
              <div className="portal-list">
                {notices.data.rows.map((n) => (
                  <Item key={n.id} icon={n.icon || 'bell'} tone={n.tone === 'critical' ? 'critical' : n.tone === 'warning' ? 'warning' : !n.readAt ? 'brand' : undefined}
                    title={n.title} meta={fmt.relative(n.createdAt)} onClick={n.route ? () => navigate(n.route!) : undefined} />
                ))}
              </div>
            ) : <p className="t-sm t-muted">You are all caught up. School notices will appear here.</p>}
          </Card>

          <Card icon="checkSquare" title="My attendance" actions={<button type="button" className="portal-link" onClick={() => onProfile('attendance')}>Details<Icon name="chevronRight" size={13} /></button>}>
            {tot ? (
              <div className="portal-figs">
                <div className="portal-fig"><div className="portal-fig__label">Present</div><div className="portal-fig__value t-success">{tot.present}</div></div>
                <div className="portal-fig"><div className="portal-fig__label">Late</div><div className="portal-fig__value t-warning">{tot.late}</div></div>
                <div className="portal-fig"><div className="portal-fig__label">Absent</div><div className="portal-fig__value t-critical">{tot.absent}</div></div>
                <div className="portal-fig"><div className="portal-fig__label">Leave</div><div className="portal-fig__value">{tot.leave}</div></div>
              </div>
            ) : <p className="t-sm t-muted">No attendance marked yet.</p>}
            {d.attendance.recent.length > 0 && (
              <div className="portal-list mt-4">
                {d.attendance.recent.slice(0, 4).map((r) => (
                  <Item key={r.date} icon="calendar" title={fmt.date(r.date)} meta={r.arrivalTime ? `Arrived ${r.arrivalTime.slice(0, 5)}` : r.remarks ?? undefined} end={<Status value={r.status} />} />
                ))}
              </div>
            )}
          </Card>

          {d.transport && (
            <Card icon="bus" title="My bus" actions={<Status value={d.transport.runStatus} />}>
              <Item icon="bus" tone={d.transport.runStatus === 'Delayed' ? 'warning' : 'brand'} title={`${d.transport.busNo ?? d.transport.routeCode} · ${d.transport.routeName}`}
                meta={`${d.transport.runStatus === 'Delayed' ? `Running ${d.transport.delayMinutes} min late` : d.transport.eta ? `ETA ${d.transport.eta}` : d.transport.runStatus} · stop ${d.transport.stopName ?? '—'} · pickup ${d.transport.pickupTime?.slice(0, 5) ?? '—'}`} />
            </Card>
          )}
        </div>
      </div>
      </DashLayout>
    </Page>
  );
}
