import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n/I18nProvider';
import { useSchool } from '@/layouts/SchoolContext';
import {
  AiNotice, AlertItem, Badge, Button, CampusBanner, Card, CardLink, Chart, charts, Empty, ErrorState, Feed, Funnel, greeting, Icon, Kpi, Meter, Page,
  PageSkeleton, QuickActions, QuoteCard, RecentNotifications, Ring, SchoolPulse, SectionHead,
} from '@/components/ui';
import type { FeeDashboard } from '@/pages/finance/types';
import { fmt } from '@/lib/format';

interface Dashboard {
  scope: 'campus' | 'group';
  generatedAt: string;
  students: { total: number; atRisk: number; developing: number; onTrack: number };
  attendance: {
    today: { present: number; late: number; absent: number; leave: number; marked: number; total: number };
    todayPct: number | null;
    trend: { label: string; date: string; value: number }[];
    byGrade: { grade: string; level: number; present: number }[];
    lateByTime: { label: string; value: number }[];
    weekdayAbsences: { day: string; dow: number; absences: number }[];
    repeatAbsentees: number;
  };
  staff: { total: number; present: number; absent: number; onLeave: number; late: number; teaching: number; nonTeaching: number; teachingPresent: number; nonTeachingPresent: number };
  admissions?: {
    enquiries: number; admitted: number; thisMonth: number; unassigned: number; conversion: number; costPerAdmission: number | null;
    funnel: { label: string; value: number }[]; sources: { label: string; value: number }[]; overdueFollowUps: number;
  };
  finance?: { billed: number; collected: number; outstanding: number; overdue: number; overdueAccounts: number; collectedToday: number; collectionPct: number };
  earlyWarning?: { open: number; awaitingReview: number; inIntervention: number; closedThisTerm: number };
  parentEngagement: { score: number | null; unanswered: number; oldestUnanswered: string | null };
  academic: { byGrade: { grade: string; level: number; average: number }[] };
  approvals: { total: number; expenses: number; leave: number; overtime: number; concessions: number; reimbursements: number; certificates: number; payroll: number };
  tracking?: { total: number; active: number; offline: number; paused: number; disabled: number; atSchool: number; inTransit: number; atHome: number };
  attention: { tone: string; icon: string; title: string; meta: string; route: string; count: number }[];
  activity: { at: string; text: string; module: string; by: string; icon: string }[];
}


const SOURCE_COLORS = ['var(--teal)', 'var(--navy)', 'var(--viz-4)', 'var(--amber)', 'var(--viz-5)', 'var(--viz-7)', 'var(--viz-6)', 'var(--viz-8)'];
const HONORIFICS = new Set(['dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'prof', 'prof.']);

function firstName(full?: string) {
  // Service accounts (e.g. System Administrator) are greeted by their full name.
  if (!full || /administrat/i.test(full)) return full ?? '';
  const parts = full.split(/\s+/).filter(Boolean);
  return parts.find((p) => !HONORIFICS.has(p.toLowerCase()) && p.replace('.', '').length > 1) ?? parts[0] ?? '';
}

export default function CommandCenterPage() {
  const { user, can } = useAuth();
  const { t } = useI18n();
  const school = useSchool();
  const navigate = useNavigate();
  const q = useApiQuery<Dashboard>('/dashboard/command-center', { scope: school.scope, campusId: school.campusId }, { refetchInterval: 120_000 });
  const fees = useApiQuery<FeeDashboard>(can('finance.read') ? '/finance/fees/summary' : null, school.campusParam);

  const greet = greeting();

  const welcome = (
    <CampusBanner title={<>{greet}, {firstName(user?.fullName)}</>} sub={school.scope === 'group' ? "Here's what's happening across all campuses today." : `Here's what's happening at ${school.campus?.name ?? 'your school'} today.`} />
  );

  if (q.isLoading) return <Page>{welcome}<PageSkeleton kpis={4} /></Page>;
  if (q.error || !q.data) return <Page>{welcome}<ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;
  const d = q.data;
  const a = d.attendance;
  const risk = d.students;
  const adm = d.admissions;

  const glance = [
    <Kpi key="a" size="compact" label={t('Absent Today')} value={fmt.n(a.today.absent)} unit={`· ${a.today.late} late`} tone="critical"
      foot={`${a.repeatAbsentees} absent 3+ days running`} to="/attendance" />,
    <Kpi key="sr" size="compact" label={t('Students Requiring Attention')} value={risk.atRisk} unit={`+ ${risk.developing} developing`} tone="critical"
      foot={d.earlyWarning ? `${d.earlyWarning.awaitingReview} signals awaiting review` : 'Risk bands from live data'} to={can('earlywarning.read') ? '/early-warning' : '/students?risk=At+Risk'} />,
    <Kpi key="tt" size="compact" label={t('Teaching Staff')} value={fmt.n(d.staff.teaching)}
      foot={`${d.staff.teachingPresent} present today`} to={can('hr.read') ? '/teaching-staff' : undefined} />,
    <Kpi key="nt" size="compact" label={t('Non-Teaching Staff')} value={fmt.n(d.staff.nonTeaching)}
      foot={`${d.staff.nonTeachingPresent} present today`} to={can('hr.read') ? '/non-teaching-staff' : undefined} />,
  ];
  if (d.finance) {
    glance.push(
      <Kpi key="fo" size="compact" label={t('Outstanding Fees')} value={fmt.money(d.finance.outstanding, { compact: true })} tone="critical"
        foot={`${fmt.money(d.finance.overdue, { compact: true })} past due · ${d.finance.overdueAccounts} accounts`} to="/fees" />,
    );
  }
  if (adm) {
    glance.push(
      <Kpi key="ad" size="compact" label={t('Admissions Pipeline')} value={fmt.n(adm.funnel[1]?.value ?? 0)} unit="qualified"
        foot={`${adm.admitted} admitted · ${adm.thisMonth} enquiries this month`} to="/admissions" />,
    );
  }
  if (d.tracking) {
    glance.push(
      <Kpi key="tr" size="compact" label="Student Tracking" value={`${d.tracking.active} / ${d.tracking.total}`} unit="live"
        foot={`${d.tracking.atSchool} on campus · ${d.tracking.offline} offline`} to="/student-tracking" />,
    );
  }
  glance.push(
    <Kpi key="pe" size="compact" label="Parent Engagement" value={d.parentEngagement.score != null ? `${d.parentEngagement.score}` : '—'} unit="/100"
      foot={`${d.parentEngagement.unanswered} queries awaiting reply`} to={can('communication.read') ? '/parent-communication' : undefined} />,
  );

  const grades = d.academic.byGrade;

  const quick = [
    { label: 'Add New Student', icon: 'plus', to: '/students?new=1', show: can('students.create') },
    { label: 'Record Attendance', icon: 'calendar', to: '/attendance', show: can(['attendance.mark', 'attendance.read']) },
    { label: 'Generate Report Card', icon: 'fileText', to: '/report-cards', show: can('academics.read') },
    { label: 'Fee Collection', icon: 'wallet', to: '/fees', show: can('finance.read') },
    { label: 'Send Notification', icon: 'send', to: '/circulars', show: can('communication.read') },
    { label: 'Create Timetable', icon: 'calendar', to: '/timetable', show: can('academics.read') },
    { label: 'Emergency Broadcast', icon: 'megaphone', tone: 'critical', to: '/emergency', show: can(['notifications.broadcast', 'safety.manage']) },
  ].filter((x) => x.show);

  const feeTrend = (fees.data?.trend ?? []).slice(-6);
  const feeMax = Math.max(1, ...feeTrend.map((m) => m.billed));

  return (
    <Page>
      {welcome}
      <div className="dash">
        <div className="dash__main">
          <SchoolPulse metrics events={false} />

          <div className={adm ? 'grid dash__bottom' : 'grid'}>
            {adm && (
              <section className="promo" aria-label="Admissions">
                <span className="promo__ico"><Icon name="graduation" size={24} /></span>
                <div className="grow" style={{ minWidth: 200 }}>
                  <div className="promo__title">Admissions Open for {school.yearLabel}</div>
                  <div className="promo__sub">
                    {fmt.n(adm.thisMonth)} enquiries this month · {fmt.n(adm.admitted)} admitted · {adm.conversion}% conversion
                    {adm.overdueFollowUps ? ` · ${adm.overdueFollowUps} follow-ups overdue` : ''}
                  </div>
                </div>
                <Button variant="primary" iconRight="chevronRight" to="/admissions">View Admissions</Button>
              </section>
            )}
            <Card icon="clock" title="Recent Activity" actions={can('safety.read') ? <CardLink to="/smart-gate">View All</CardLink> : undefined}>
              {d.activity.length ? (
                <div className="actstrip">
                  {d.activity.slice(0, 4).map((x, i) => (
                    <div className="actstrip__item" key={i}>
                      <span className="actstrip__ico"><Icon name={x.icon} size={14} /></span>
                      <div style={{ minWidth: 0 }}>
                        <div className="actstrip__text t-clamp-2">{x.text}</div>
                        <div className="actstrip__time">{fmt.time(x.at)} · {x.module}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="t-sm t-muted">No activity yet today.</p>
              )}
            </Card>
          </div>
        </div>

        <aside className="dash__rail" aria-label="Shortcuts and updates">
          <QuickActions items={quick} />
          <QuoteCard />
          <RecentNotifications />

          {d.finance && (
            <Card icon="wallet" title="Fee Collection" actions={<CardLink to="/fees">View Report</CardLink>}>
              <div className="feemini">
                <Ring pct={d.finance.collectionPct} size={88} color="var(--brand)" text={`${Math.round(d.finance.collectionPct)}%`} />
                <dl>
                  <dt>Total Fees</dt><dd>{fmt.money(d.finance.billed, { compact: true })}</dd>
                  <dt>Collected</dt><dd>{fmt.money(d.finance.collected, { compact: true })}</dd>
                  <dt>Pending</dt><dd className="t-critical">{fmt.money(d.finance.outstanding, { compact: true })}</dd>
                </dl>
              </div>
              {feeTrend.length > 0 && (
                <>
                  <div className="minibars" role="img" aria-label="Fees collected and pending by month">
                    {feeTrend.map((m) => (
                      <div className="minibars__col" key={m.month} title={`${m.label}: ${fmt.money(m.collected)} collected of ${fmt.money(m.billed)} billed`}>
                        <span className="minibars__stack" style={{ height: `${Math.max(4, (m.billed / feeMax) * 100)}%` }}>
                          <span className="minibars__bar" style={{ height: `${m.billed ? (Math.min(m.collected, m.billed) / m.billed) * 100 : 0}%` }} />
                          <span className="minibars__bar minibars__bar--pending" style={{ flex: 1 }} />
                        </span>
                        <span className="minibars__lbl">{m.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="minibars__legend"><span><i />Collected</span><span><i className="p" />Pending</span></div>
                </>
              )}
            </Card>
          )}
        </aside>
      </div>

      {/* Further detail, below the fold */}
      <div className="col g-4 mt-5">
        <div className="grid g-main">
          <Card icon="alert" title={t("Today's Attention")} sub="Ranked by urgency. Every row opens the screen where it is resolved." flush
            actions={<CardLink to="/my-tasks">My tasks</CardLink>}
            foot={<span>Signals are advisory. Nothing is actioned automatically.</span>}>
            {d.attention.length ? (
              <div>
                {d.attention.map((i) => (
                  <AlertItem key={i.title} tone={i.tone} icon={i.icon} title={i.title} meta={i.meta} to={i.route} right={<Badge tone={i.tone}>{i.count}</Badge>} />
                ))}
              </div>
            ) : (
              <Empty icon="check" title="All clear" sub="Nothing needs attention right now." />
            )}
          </Card>
          <Card icon="activity" title="Live activity" sub="Gate, transport and system events">
            {d.activity.length ? (
              <Feed items={d.activity.slice(0, 8).map((x) => ({ time: fmt.time(x.at), text: x.text, meta: `${x.by} · ${x.module}`, icon: x.icon }))} />
            ) : (
              <Empty icon="activity" title="No activity yet today" />
            )}
          </Card>
        </div>

        <section aria-label="School at a glance">
          <SectionHead title="School at a glance" sub="Secondary figures — select any figure to open its module." />
          <div className="statgrid statgrid--card">{glance}</div>
        </section>

        {(adm || grades.length > 0) && (
          <div className={`grid ${adm ? 'g-main' : 'g-2col'}`}>
            {adm && (
              <Card icon="target" title="Admissions funnel"
                sub={`${adm.conversion}% enquiry-to-admission${adm.costPerAdmission ? ` · cost per admission ${fmt.money(adm.costPerAdmission)}` : ''}`}
                actions={<CardLink to="/admissions">Open CRM</CardLink>}>
                <Funnel rows={adm.funnel} onSelect={() => navigate('/pipeline')} />
                <div className="divider" />
                <div className="eyebrow mb-3">Enquiries by source</div>
                {adm.sources.length ? (
                  <Chart svg={charts.hbar({ rows: adm.sources.map((s, i) => ({ label: s.label, value: s.value, color: SOURCE_COLORS[i % SOURCE_COLORS.length] })), labelW: 104, rowH: 27, label: 'Enquiries by source' })} />
                ) : <p className="t-sm t-muted">No enquiries recorded.</p>}
              </Card>
            )}
            <Card icon="trending" title="Results by grade" sub="Latest-term average by grade" actions={<CardLink to="/academic-performance">Details</CardLink>}>
              {grades.length ? (
                <div className="col g-3">
                  {grades.map((g) => (
                    <Meter key={g.grade} label={g.grade} value={g.average} right={`${g.average}/100`} tone={g.average >= 75 ? 'teal' : g.average >= 60 ? undefined : 'critical'} />
                  ))}
                </div>
              ) : <Empty icon="trending" title="No results recorded yet" />}
            </Card>
          </div>
        )}

        <AiNotice><strong>Students are never auto-labelled.</strong> Risk bands are decision support. A teacher confirms every signal before it becomes an intervention.</AiNotice>
      </div>
    </Page>
  );
}
