import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n/I18nProvider';
import { useLookups } from '@/hooks/useLookups';
import { useSchool } from '@/layouts/SchoolContext';
import {
  AlertItem, Badge, Banner, Button, Card, Chart, charts, Empty, ErrorState, Grid, Icon, Kpi, Legend, Meter, Page, PageSkeleton,
  Person, StudentLink, CampusBanner, DashLayout, DashRail, UpcomingEvents, SchoolPulse } from '@/components/ui';
import { fmt } from '@/lib/format';

/**
 * Owner Overview — the Super Admin's landing page.
 *
 * A welcome strip (last sign-in, what has changed), then one panel for the
 * campus picked in its dropdown (or all campuses), in five numbered sections:
 * school overview, strategic goals, final approvals, critical exceptions, and
 * configuration & governance. Revenue, activity and school arrive as null when
 * the signed-in role lacks finance.read / audit.read, so each part renders only
 * when permitted. Day-to-day running stays on the Command Center.
 */

interface Overview {
  previousVisit: { at: string | null; device: string | null; ip: string | null; firstVisit: boolean };
  welcome: { changes: number; people: number; important: number };
  revenue: null | {
    billed: number; collected: number; collectedPct: number | null; concessions: number; outstanding: number;
    aged: { notYetDue: number; due0to30: number; due31to60: number; due60plus: number; familiesOverdue: number };
    collection: { thisMonth: number; lastMonth: number; changePct: number | null; last30: number; receipts30: number };
    out: { expenses: number; payroll: number; payrollMonths: number; total: number };
    net: number;
    pending: { expenses: { count: number; amount: number }; concessions: { count: number; amount: number } };
    trend: { month: string; label: string; collected: number; payroll: number; expenses: number }[];
    topOwing: { studentId: string; name: string; admissionNo: string; className: string | null; campus: string;
                overdue: number; charges: number; oldestDue: string; daysOverdue: number }[];
    byClass: { grade: string; students: number; outstanding: number; overdue: number }[];
    byHead: { head: string; billed: number; collected: number; concessions: number; outstanding: number }[];
    byCampus: { campus: string; billed: number; collected: number; outstanding: number; spent: number }[];
  };
  activity: null | {
    byModule: { module: string; count: number; actions: { action: string; count: number }[]; topPerson: string | null; topCount: number }[];
    byPerson: { name: string; role: string; count: number; lastAt: string; modules: { module: string; count: number }[] }[];
    important: {
      id: string; at: string; userName: string; role: string; action: string; module: string; description: string;
      entityType: string | null; entityId: string | null; device: string | null; ip: string | null;
      metadata: Record<string, unknown> | null;
    }[];
    approvals: { label: string; count: number; to: string; icon: string; unit: 'money' | 'days'; total: number; oldest: string | null }[];
  };
  school: null | {
    standards: { avgScore: number | null; assessments: number; belowPass: number; assessed: number;
                 syllabus: number | null; mastery: number | null; attendance: number | null };
    discipline: { openIncidents: number; critical: number; escalated: number; incidents30: number; concerns30: number; positive30: number };
    goals: {
      overall: number | null;
      targets: { label: string; pct: number | null; to: string }[];
      departments: { module: string; total: number; done: number; overdue: number }[];
      staff: { name: string; role: string; open: number; overdue: number; oldestDue: string | null }[];
      blockers: { kind: string; title: string; meta: string; daysLate: number; to: string }[];
    };
    approvals: {
      total: number; overdue: number; amount: number;
      items: { id: string; kind: string; title: string; requestor: string | null; amount: number | null; days: number | null;
               raisedAt: string; deadline: string; to: string; priority: 'High' | 'Medium' | 'Low' }[];
    };
    exceptions: { marksLate: number; plansWaiting: number; safetyOpen: number; tasksOverdue: number; tasksHigh: number;
                  fees60: number; families60: number; overBudget: number };
    governance: {
      setup: { pct: number; checks: { label: string; ok: boolean }[] };
      access: { active: number; suspended: number; invited: number; locked: number; dormant: number; roles: number; failed7: number };
      policies: { active: number; review: number; draft: number; lastChange: string | null };
      trail: { day: number; week: number; sensitive: number };
      hierarchy: { role: string; users: number }[];
    };
  };
}

type Revenue = NonNullable<Overview['revenue']>;
type Activity = NonNullable<Overview['activity']>;

/** Dropdown value for the consolidated group view. */
const GROUP = '__group__';

/**
 * Campus calendar highlights. Sample data until the calendar is wired to the
 * events table; keyed by campus code, dates as days from today so it stays upcoming.
 */
const SAMPLE_EVENTS: Record<string, { in: number; title: string; kind: string; icon: string }[]> = {
  gdv: [
    { in: 4, title: 'Inter-house Sports Day', kind: 'Sports', icon: 'award' },
    { in: 11, title: 'Parent–Teacher Meeting · Term 1', kind: 'PTM', icon: 'users' },
    { in: 19, title: 'Science Exhibition', kind: 'Academic', icon: 'lightbulb' },
    { in: 37, title: 'Annual Day Celebration', kind: 'Cultural', icon: 'star' },
  ],
  vdv: [
    { in: 6, title: 'Annual Sports Meet', kind: 'Sports', icon: 'award' },
    { in: 14, title: 'Diwali Celebration', kind: 'Festival', icon: 'sun' },
    { in: 23, title: 'Term 1 Examinations begin', kind: 'Exam', icon: 'clipboard' },
    { in: 45, title: 'Annual Day', kind: 'Cultural', icon: 'star' },
  ],
  plc: [
    { in: 3, title: "Children's Day Assembly", kind: 'Cultural', icon: 'heart' },
    { in: 9, title: 'Sports Day', kind: 'Sports', icon: 'award' },
    { in: 17, title: 'Field Trip · Grade 5', kind: 'Trip', icon: 'bus' },
    { in: 40, title: 'Annual Day & Prize Distribution', kind: 'Cultural', icon: 'star' },
  ],
};
const sampleEventsFor = (code: string | undefined, campuses: { code: string; shortName: string }[]) => {
  const pick = code ? campuses.filter((c) => c.code === code) : campuses;
  return pick
    .flatMap((c) => (SAMPLE_EVENTS[c.code] ?? SAMPLE_EVENTS.gdv).map((e) => ({ ...e, campus: c.shortName })))
    .sort((a, b) => a.in - b.in)
    .slice(0, 4)
    .map((e) => ({ ...e, date: new Date(Date.now() + e.in * 86_400_000) }));
};

/** Modules read better in the owner's language than in the API's. */
const MODULE_LABEL: Record<string, string> = {
  finance: 'Finance', communication: 'Communication', academics: 'Academics', workforce: 'Staff',
  safety: 'Safety', admissions: 'Admissions', transport: 'Transport', tracking: 'Tracking',
  students: 'Students', payroll: 'Payroll', earlywarning: 'Early Warning', documents: 'Documents',
  devices: 'Devices', crm: 'CRM', auth: 'Sign-ins', ai: 'AI Co-Pilot', users: 'Users & roles',
  settings: 'Settings', reports: 'Reports', parents: 'Parents', wellbeing: 'Wellbeing',
  assessments: 'Assessments', attendance: 'Attendance', notifications: 'Notifications',
  tasks: 'Tasks', audit: 'Audit', talent: 'Talent', knowledge: 'Knowledge',
};
const moduleLabel = (m: string) => MODULE_LABEL[m] ?? m.charAt(0).toUpperCase() + m.slice(1);

/** Tone for a change in the "worth naming" list. */
function toneFor(action: string, module: string) {
  if (action.endsWith('_failed')) return 'critical';
  if (action === 'delete') return 'critical';
  if (module === 'users' || module === 'settings') return 'warning';
  if (action === 'reject') return 'warning';
  if (action === 'approve') return 'success';
  return 'info';
}
const ICON_FOR: Record<string, string> = {
  delete: 'trash', approve: 'check', reject: 'x', broadcast: 'megaphone', export: 'download',
  create: 'plus', update: 'edit',
};

/** Where a changed record lives, so a change opens the record rather than the raw trail. */
const ENTITY_ROUTE: Record<string, (id: string) => string> = {
  student: (id) => `/student-360/${id}`,
  innovation_project: (id) => `/projects/${id}`,
  expense: () => '/expenses',
  concession: () => '/concessions',
  reimbursement: () => '/reimbursements',
  payroll_run: () => '/payroll',
  leave_request: () => '/leave',
  fee_payment: () => '/payments',
  student_fee: () => '/student-accounts',
  fee_structure: () => '/fee-structures',
  budget: () => '/budgets',
  user: () => '/admin/users',
  role: () => '/admin/users',
  employee: () => '/workforce',
  circular: () => '/circulars',
  enquiry: () => '/enquiries',
  admission: () => '/applications',
  campus: () => '/campuses',
};
const entityLink = (type: string | null, id: string | null) =>
  type && ENTITY_ROUTE[type] ? ENTITY_ROUTE[type](id ?? '') : '/audit';

/** A short, readable line from an audit entry's metadata: "from → to", else up to three key: value pairs. */
function metaSummary(meta: Record<string, unknown> | null) {
  if (!meta) return null;
  const plain = (v: unknown) => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean');
  if (plain(meta.from) && plain(meta.to)) return `${meta.from} → ${meta.to}`;
  const words = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase();
  const parts = Object.entries(meta).filter(([, v]) => plain(v) && String(v).length <= 40).slice(0, 3)
    .map(([k, v]) => `${words(k)}: ${v}`);
  return parts.length ? parts.join(' · ') : null;
}

const daysSince = (at: string | null) => (at ? Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000)) : 0);
const ageTone = (days: number) => (days > 60 ? 'critical' : days > 30 ? 'warning' : 'caution');

export default function OwnerOverviewPage() {
  const { user, can } = useAuth();
  const { t } = useI18n();
  const school = useSchool();
  const { lookups } = useLookups();
  const campusOptions = lookups?.campuses ?? [];
  const canGroup = can('dashboard.group');
  const campusValue = school.scope === 'group' ? GROUP : school.campusId ?? '';
  const q = useApiQuery<Overview>('/dashboard/overview', { scope: school.scope, campusId: school.campusId },
    { refetchInterval: 300_000 });

  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  const greet = hour < 12 ? t('Good Morning') : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const scopeLabel = school.scope === 'group' ? 'All campuses' : school.campus?.name ?? 'your campus';

  const head = (
    <CampusBanner
      title={<>{greet}, {user?.fullName}</>}
      sub={school.scope === 'group' ? "Here's what's happening across all campuses today." : <>Here's what's happening at {scopeLabel} today.</>}
      actions={(
        <>
          {can('audit.read') && <Button variant="primary" icon="pulse" iconRight="arrowRight" to="/audit">View Audit Trail</Button>}
          <Button variant="ghost" icon="calendar" iconRight="chevronRight" to="/command-center">Daily Operations</Button>
        </>
      )}
    />
  );

  // The dashboard top (metrics, charts, rail) loads its own data, in parallel with the overview below it.
  const top = (
    <DashLayout rail={<DashRail events={false} actions={[
      { label: 'Add New Student', icon: 'plus', to: '/students?new=1', show: can('students.create') },
      { label: 'Users & Roles', icon: 'users', to: '/admin/users', show: can('users.manage') },
      { label: 'Fee Collection', icon: 'wallet', to: '/fees', show: can('finance.read') },
      { label: 'Audit Trail', icon: 'list', to: '/audit', show: can('audit.read') },
      { label: 'Report Centre', icon: 'barChart', to: '/admin/reports', show: can('users.manage') },
      { label: 'System Settings', icon: 'settings', to: '/admin/settings', show: can('settings.manage') },
    ]} />}>
      <SchoolPulse events={false} metrics />
    </DashLayout>
  );

  if (q.isLoading) return <Page>{head}{top}<div className="mt-4"><PageSkeleton /></div></Page>;
  if (q.error || !q.data) return <Page>{head}{top}<ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;

  const d = q.data;
  const { previousVisit: visit, welcome, revenue, activity, school: sc } = d;
  const todayIso = new Date().toISOString().slice(0, 10);

  const ex = sc?.exceptions;
  const exceptions = ex ? [
    { label: 'Academic delays', icon: 'book', tone: 'warning', to: '/assessments', count: ex.marksLate + ex.plansWaiting,
      badge: String(ex.marksLate + ex.plansWaiting),
      detail: `${ex.marksLate} assessment${ex.marksLate === 1 ? '' : 's'} not finalised a week after the exam · ${ex.plansWaiting} lesson plan${ex.plansWaiting === 1 ? '' : 's'} waiting over a week` },
    { label: 'Safety issues', icon: 'shield', tone: 'critical', to: '/safeguarding', count: ex.safetyOpen, badge: String(ex.safetyOpen),
      detail: `${ex.safetyOpen} critical or escalated incident${ex.safetyOpen === 1 ? '' : 's'} still open` },
    { label: 'Overdue tasks', icon: 'clock', tone: ex.tasksHigh > 0 ? 'critical' : 'warning', to: '/my-tasks', count: ex.tasksOverdue,
      badge: String(ex.tasksOverdue), detail: `${ex.tasksOverdue} past their due date · ${ex.tasksHigh} high priority` },
    { label: 'Financial risks', icon: 'wallet', tone: 'critical', to: '/student-accounts', count: (ex.fees60 > 0 ? 1 : 0) + ex.overBudget,
      badge: ex.fees60 > 0 ? fmt.money(ex.fees60, { compact: true }) : String(ex.overBudget),
      detail: `${fmt.money(ex.fees60, { compact: true })} unpaid over 60 days by ${ex.families60} famil${ex.families60 === 1 ? 'y' : 'ies'} · ${ex.overBudget} budget line${ex.overBudget === 1 ? '' : 's'} overspent` },
  ] : [];
  const exceptionCount = exceptions.reduce((s, x) => s + x.count, 0);

  const today = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date());

  return (
    <Page>
      {head}
      {top}

      {/* ---- Welcome strip ---------------------------------------------- */}
      <section className="card oi-ov-welcome mt-4">
        <div className="row g-4 wrap between">
          <div className="row g-3 grow oi-minw0">
            <span className="avatar avatar--gold none"><Icon name="shield" size={18} /></span>
            <div className="grow oi-minw0">
              <div className="t-sm t-bold t-strong">
                {visit.firstVisit
                  ? 'Welcome — this is your first recorded sign-in.'
                  : <>You last signed in on <strong>{fmt.dateTime(visit.at)}</strong>{visit.device ? ` from ${visit.device}` : ''}{visit.ip ? ` (${visit.ip})` : ''}.</>}
              </div>
              <div className="t-xs t-muted mt-1">
                {welcome.changes === 0
                  ? visit.firstVisit ? 'Showing the last seven days of activity.' : 'Nothing has changed since then.'
                  : <>Since then <strong>{fmt.n(welcome.changes)}</strong> change{welcome.changes === 1 ? '' : 's'} by <strong>{welcome.people}</strong> {welcome.people === 1 ? 'person' : 'people'}
                      {welcome.important > 0 ? <> · <strong>{welcome.important}</strong> worth your attention</> : ''}.</>}
              </div>
            </div>
          </div>
          {!visit.firstVisit && (
            <span className="illustrative none" title="If this was not you, review the audit trail">
              <Icon name="clock" size={13} />If this was not you, check the audit trail
            </span>
          )}
        </div>
      </section>

      {/* ---- The campus panel: five numbered sections -------------------- */}
      <section className="ov-panel mt-4">
        {/* 1. School overview */}
        <div className="ov-box">
        <div className="ov-head">
          <h2 className="ov-head__title grow"><Icon name="grid" size={20} />1. School overview</h2>
          <div className="row g-3 wrap t-sm t-muted">
            {campusOptions.length > 0 ? (
              <select className="select ov-campus" aria-label="Campus" value={campusValue}
                onChange={(e) => (e.target.value === GROUP ? school.setGroup() : school.setCampus(e.target.value))}>
                {canGroup && <option value={GROUP}>All campuses</option>}
                {campusOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : <span className="t-bold">{scopeLabel}</span>}
            <span>{school.yearLabel}</span>
            <span>·</span>
            <span>{today}</span>
          </div>
        </div>

        <Grid cols="g-4col">
          <OverviewTile icon="wallet" eyebrow="Finance" title="Revenue" sub="Collection & expenditure" to={revenue ? '/financial-reports' : undefined}
            figs={revenue ? [
              ['Collected', fmt.money(revenue.collected, { compact: true })],
              ['Spent', fmt.money(revenue.out.total, { compact: true })],
              ['Outstanding', fmt.money(revenue.outstanding, { compact: true }), revenue.aged.due60plus > 0 ? 'critical' : undefined],
              ['Net', fmt.money(revenue.net, { compact: true }), revenue.net < 0 ? 'critical' : undefined],
            ] : [['Access', 'Not in your role']]} />
          <OverviewTile icon="graduation" eyebrow="Academics" title="Standards" sub="Results & syllabus" to="/academic-performance"
            figs={sc ? [
              ['Average score', sc.standards.avgScore != null ? `${sc.standards.avgScore}%` : '—'],
              ['Syllabus covered', sc.standards.syllabus != null ? `${sc.standards.syllabus}%` : '—'],
              ['Attendance (30 days)', sc.standards.attendance != null ? `${sc.standards.attendance}%` : '—',
                sc.standards.attendance != null && sc.standards.attendance < 85 ? 'critical' : undefined],
              ['Below pass mark', `${fmt.n(sc.standards.belowPass)} student${sc.standards.belowPass === 1 ? '' : 's'}`,
                sc.standards.belowPass > 0 ? 'critical' : undefined],
            ] : []} />
          <OverviewTile icon="shield" eyebrow="Operations" title="Discipline" sub="Safety & incidents" to="/safeguarding"
            figs={sc ? [
              ['Open incidents', fmt.n(sc.discipline.openIncidents)],
              ['Critical', fmt.n(sc.discipline.critical), sc.discipline.critical > 0 ? 'critical' : undefined],
              ['Behaviour concerns', `${fmt.n(sc.discipline.concerns30)} in 30 days`],
              ['Positive notes', `${fmt.n(sc.discipline.positive30)} in 30 days`],
            ] : []} />
          {can('communication.read') ? <UpcomingEvents /> : (
            <EventsTile events={sampleEventsFor(school.scope === 'group' ? undefined : school.campus?.code, campusOptions)}
              showCampus={school.scope === 'group'} />
          )}
        </Grid>

        {revenue && (
          <details className="ov-details">
            <summary>Finance detail<Icon name="chevronDown" size={14} className="ov-chev" /></summary>
            <FinanceDetail revenue={revenue} />
          </details>
        )}
        </div>

        {/* 2. Strategic goals and management performance */}
        {sc && (
          <div className="ov-box">
            <h3 className="ov-head__title"><Icon name="target" size={19} />2. Strategic goals and management performance</h3>
            <div className="ov-head__sub">Institutional targets · Department progress · Staff accountability · Project blockers</div>
            <div className="row g-3 mt-3">
              <div className="ov-progress grow" role="progressbar" aria-valuenow={sc.goals.overall ?? 0} aria-valuemin={0} aria-valuemax={100}
                aria-label="Overall progress against targets">
                <span style={{ width: `${sc.goals.overall ?? 0}%` }} />
              </div>
              <strong className="t-sm t-num none">{sc.goals.overall != null ? `${sc.goals.overall}% overall` : 'No targets yet'}</strong>
            </div>

            <Grid cols="g-4col" className="ov-goals">
              <div className="ov-tile ov-col">
                <div className="ov-label">Institutional targets</div>
                {sc.goals.targets.map((t) => (
                  <Meter key={t.label} label={t.label} value={t.pct ?? 0} right={t.pct != null ? `${t.pct}%` : '—'}
                    tone={t.pct != null && t.pct < 60 ? 'critical' : 'teal'} />
                ))}
              </div>
              <div className="ov-tile ov-col">
                <div className="ov-label">Department progress</div>
                {sc.goals.departments.length ? sc.goals.departments.map((d) => (
                  <Meter key={d.module} label={moduleLabel(d.module)} value={pctOf(d.done, d.total)}
                    right={d.overdue > 0 ? `${d.done}/${d.total} · ${d.overdue} late` : `${d.done}/${d.total}`}
                    tone={d.overdue > 0 ? 'critical' : 'teal'} />
                )) : <div className="t-sm t-muted">No tasks assigned yet.</div>}
              </div>
              <div className="ov-tile ov-col">
                <div className="ov-label">Staff accountability</div>
                {sc.goals.staff.length ? sc.goals.staff.map((p) => (
                  <div key={p.name} className="row between g-3">
                    <Person name={p.name} meta={`${p.role} · ${p.open} open`} />
                    <Badge tone={p.overdue > 3 ? 'critical' : 'warning'} title={p.oldestDue ? `Oldest due ${fmt.date(p.oldestDue)}` : undefined}>
                      {p.overdue} overdue
                    </Badge>
                  </div>
                )) : <div className="row g-2 t-sm t-muted"><Icon name="check" size={16} />Nobody is behind on their tasks.</div>}
              </div>
              <div className="ov-tile ov-col">
                <div className="ov-label">Project blockers</div>
                {sc.goals.blockers.length ? sc.goals.blockers.map((b, i) => (
                  <Link key={i} to={b.to} className="ov-blocker">
                    <span className={`ov-blocker__dot ov-blocker__dot--${b.daysLate > 30 ? 'critical' : 'warning'}`} aria-hidden="true" />
                    <span className="grow oi-minw0">
                      <span className="ov-blocker__title">{b.title}</span>
                      <span className="ov-blocker__meta">{b.meta} · <strong>{b.daysLate} day{b.daysLate === 1 ? '' : 's'} late</strong></span>
                    </span>
                  </Link>
                )) : <div className="row g-2 t-sm t-muted"><Icon name="check" size={16} />No project is past a deadline.</div>}
              </div>
            </Grid>

            {activity && (
              <details className="ov-details mt-5">
                <summary>Management activity {visit.firstVisit ? 'in the last seven days' : 'since your last sign-in'}<Icon name="chevronDown" size={14} className="ov-chev" /></summary>
                <ActivityDetail activity={activity} firstVisit={visit.firstVisit} />
              </details>
            )}
          </div>
        )}

        {/* 3. Final approvals · 4. Critical exceptions */}
        {sc && (
          <Grid cols="g-2col">
            <div className="ov-box">
              <h3 className="ov-head__title"><Icon name="checkSquare" size={19} />3. Final approvals</h3>
              <div className="ov-head__sub">Priority, amount, requestor, age and decision deadline.</div>
              <div className="row g-2 wrap mt-3">
                {sc.approvals.total > 0
                  ? <Badge tone="warning">Action required</Badge>
                  : <Badge tone="success">All clear</Badge>}
                {sc.approvals.total > 0 && (
                  <span className="t-xs t-muted">
                    {sc.approvals.total} waiting · {fmt.money(sc.approvals.amount, { compact: true })} at stake
                    {sc.approvals.overdue > 0 && <> · <strong className="oi-crit">{sc.approvals.overdue} past deadline</strong></>}
                  </span>
                )}
              </div>
              {sc.approvals.items.length > 0 && (
                <div className="table-wrap mt-3">
                  <table className="table table--compact">
                    <thead>
                      <tr><th>Priority</th><th>Request</th><th className="t-right">Amount</th><th>Age</th><th>Decide by</th></tr>
                    </thead>
                    <tbody>
                      {sc.approvals.items.map((a) => {
                        const late = a.deadline < todayIso;
                        return (
                          <tr key={a.kind + a.id}>
                            <td><Badge tone={a.priority === 'High' ? 'critical' : a.priority === 'Medium' ? 'warning' : 'neutral'}>{a.priority}</Badge></td>
                            <td>
                              <Link to={a.to} className="t-bold t-sm">{a.title}</Link>
                              <div className="t-micro t-muted">{a.kind}{a.requestor ? ` · ${a.requestor}` : ''}</div>
                            </td>
                            <td className="t-right t-num">{a.amount != null ? fmt.money(a.amount, { compact: true }) : `${a.days} day${a.days === 1 ? '' : 's'}`}</td>
                            <td className="t-num">{daysSince(a.raisedAt)}d</td>
                            <td className={late ? 't-num oi-crit' : 't-num'}>{fmt.date(a.deadline)}{late && <span className="sr-only"> (past deadline)</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="ov-box">
              <h3 className="ov-head__title"><Icon name="alert" size={19} />4. Critical exceptions</h3>
              <div className="ov-head__sub">Academic delays, safety issues, overdue tasks and financial risks.</div>
              <div className="row g-2 wrap mt-3">
                {exceptionCount > 0 ? <Badge tone="critical">Review required</Badge> : <Badge tone="success">Nothing critical</Badge>}
              </div>
              <div className="mt-3">
                {exceptions.map((x) => (
                  <AlertItem key={x.label} tone={x.count > 0 ? x.tone : 'success'} icon={x.count > 0 ? x.icon : 'check'} title={x.label}
                    meta={x.detail} to={x.to} right={<Badge tone={x.count > 0 ? x.tone : 'success'}>{x.badge}</Badge>} />
                ))}
              </div>
            </div>
          </Grid>
        )}

        {/* 5. School configuration & governance */}
        {sc && (
          <div className="oi-ov-section">
            <h3 className="ov-head__title"><Icon name="settings" size={19} />5. School configuration &amp; governance</h3>
            <div className="ov-head__sub">Setup status · Access controls · Policies · Audit trail · Reporting hierarchy</div>
            <Grid cols="oi-ov-govgrid" className="mt-4">
              <div className="ov-tile">
                <div className="ov-label">Setup status</div>
                <Meter label={`${sc.governance.setup.checks.filter((x) => x.ok).length} of ${sc.governance.setup.checks.length} configured`}
                  value={sc.governance.setup.pct} right={`${sc.governance.setup.pct}%`} tone={sc.governance.setup.pct < 100 ? 'critical' : 'teal'} />
                <div className="col g-1 mt-3">
                  {sc.governance.setup.checks.map((x) => (
                    <span key={x.label} className={x.ok ? 'row g-2 t-xs' : 'row g-2 t-xs oi-crit'}>
                      <Icon name={x.ok ? 'check' : 'x'} size={13} />{x.label}
                    </span>
                  ))}
                </div>
              </div>
              <Link className="ov-tile" to="/admin/users">
                <div className="ov-label">Access controls</div>
                <GovLine label="Active users" value={fmt.n(sc.governance.access.active)} />
                <GovLine label="Roles in use" value={fmt.n(sc.governance.access.roles)} />
                <GovLine label="Suspended · invited" value={`${sc.governance.access.suspended} · ${sc.governance.access.invited}`} />
                <GovLine label="Locked accounts" value={fmt.n(sc.governance.access.locked)} warn={sc.governance.access.locked > 0} />
                <GovLine label="Dormant 30+ days" value={fmt.n(sc.governance.access.dormant)} warn={sc.governance.access.dormant > 0} />
                <GovLine label="Failed sign-ins (7 days)" value={fmt.n(sc.governance.access.failed7)} warn={sc.governance.access.failed7 > 0} />
              </Link>
              <Link className="ov-tile" to="/group-policies">
                <div className="ov-label">Policies</div>
                <GovLine label="Active" value={fmt.n(sc.governance.policies.active)} />
                <GovLine label="Under review" value={fmt.n(sc.governance.policies.review)} warn={sc.governance.policies.review > 0} />
                <GovLine label="Drafts" value={fmt.n(sc.governance.policies.draft)} />
                <GovLine label="Last changed" value={sc.governance.policies.lastChange ? fmt.relative(sc.governance.policies.lastChange) : '—'} />
              </Link>
              <Link className="ov-tile" to="/audit">
                <div className="ov-label">Audit trail</div>
                <GovLine label="Changes (24 hours)" value={fmt.n(sc.governance.trail.day)} />
                <GovLine label="Changes (7 days)" value={fmt.n(sc.governance.trail.week)} />
                <GovLine label="Sensitive (7 days)" value={fmt.n(sc.governance.trail.sensitive)} warn={sc.governance.trail.sensitive > 0} />
                <GovLine label="Since your last visit" value={fmt.n(welcome.changes)} />
              </Link>
              <div className="ov-tile">
                <div className="ov-label">Reporting hierarchy</div>
                {sc.governance.hierarchy.length ? sc.governance.hierarchy.map((h, i) => (
                  <GovLine key={h.role} label={<span className={`oi-indent-${Math.min(i, 3)}`}>{i > 0 ? '└ ' : ''}{h.role}</span>} value={fmt.n(h.users)} />
                )) : <div className="t-sm t-muted">No active staff accounts.</div>}
              </div>
            </Grid>

            {activity && activity.important.length > 0 && (
              <details className="ov-details mt-4">
                <summary>Changes worth your attention ({activity.important.length})<Icon name="chevronDown" size={14} className="ov-chev" /></summary>
                <div className="card oi-ov-list">
                  {activity.important.map((e) => {
                    const detail = metaSummary(e.metadata);
                    return (
                      <AlertItem key={e.id} tone={toneFor(e.action, e.module)} icon={ICON_FOR[e.action] ?? 'alertCircle'} title={e.description}
                        meta={
                          <>
                            {e.userName} ({e.role.replace(/_/g, ' ')}) · {moduleLabel(e.module)} · {fmt.dateTime(e.at)}
                            {e.device ? ` · ${e.device}` : ''}{e.ip ? ` (${e.ip})` : ''}
                            {detail && <span className="t-micro t-muted oi-block">{detail}</span>}
                          </>
                        }
                        to={entityLink(e.entityType, e.entityId)} />
                    );
                  })}
                </div>
              </details>
            )}
          </div>
        )}

        {!sc && (
          <Banner tone="neutral" icon="lock">Goals, approvals, exceptions and governance need audit access.</Banner>
        )}
      </section>
    </Page>
  );
}

/** The full money picture behind the Revenue tile: trend, spend, what is owed and where. */
function FinanceDetail({ revenue }: { revenue: Revenue }) {
  return (
    <>
          <Grid cols="g-4col" className="mt-5">
            <Kpi
              label="Fees collected" value={fmt.money(revenue.collected, { compact: true })}
              tone="teal" icon="wallet" to="/payments"
              foot={revenue.collectedPct != null ? `${revenue.collectedPct}% of ${fmt.money(revenue.billed, { compact: true })} billed` : 'No fees billed yet'}
              spark={revenue.trend.map((m) => m.collected)} sparkColor="var(--teal)"
            />
            <Kpi
              label="Still outstanding" value={fmt.money(revenue.outstanding, { compact: true })} icon="alertCircle"
              tone={revenue.aged.due60plus > 0 ? 'critical' : 'amber'} to="/student-accounts"
              foot={`${revenue.aged.familiesOverdue} famil${revenue.aged.familiesOverdue === 1 ? 'y' : 'ies'} past due`}
            />
            <Kpi
              label="Money out" value={fmt.money(revenue.out.total, { compact: true })}
              tone="info" icon="receipt" to="/expenses"
              foot={`Payroll ${fmt.money(revenue.out.payroll, { compact: true })} · expenses ${fmt.money(revenue.out.expenses, { compact: true })}`}
            />
            <Kpi
              label="Net position" value={fmt.money(revenue.net, { compact: true })} icon="trending"
              tone={revenue.net < 0 ? 'critical' : 'teal'}
              foot={revenue.net < 0 ? 'Spending exceeds collection this year' : 'Collection exceeds spending this year'}
            />
          </Grid>

          <Grid cols="g-main" className="mt-5">
            <MoneyTrend trend={revenue.trend} />

            <Card icon="wallet" title="Money out" sub={`This academic year${revenue.out.payrollMonths ? ` · ${revenue.out.payrollMonths} payroll months` : ''}`}>
              <div className="col g-4">
                <Meter label="Salaries" value={pctOf(revenue.out.payroll, revenue.out.total)}
                  right={fmt.money(revenue.out.payroll, { compact: true })} />
                <Meter label="Expenses" value={pctOf(revenue.out.expenses, revenue.out.total)}
                  right={fmt.money(revenue.out.expenses, { compact: true })} tone="teal" />
              </div>
              {(revenue.pending.expenses.count > 0 || revenue.pending.concessions.count > 0) && (
                <>
                  <div className="divider" />
                  <div className="t-xs t-muted mb-2">Waiting on a decision</div>
                  {revenue.pending.expenses.count > 0 && (
                    <div className="row between g-3 t-sm oi-ov-line">
                      <span>{revenue.pending.expenses.count} expense claim{revenue.pending.expenses.count === 1 ? '' : 's'}</span>
                      <strong>{fmt.money(revenue.pending.expenses.amount, { compact: true })}</strong>
                    </div>
                  )}
                  {revenue.pending.concessions.count > 0 && (
                    <div className="row between g-3 t-sm oi-ov-line">
                      <span>{revenue.pending.concessions.count} fee concession{revenue.pending.concessions.count === 1 ? '' : 's'}</span>
                      <strong>{fmt.money(revenue.pending.concessions.amount, { compact: true })}</strong>
                    </div>
                  )}
                </>
              )}
            </Card>
          </Grid>

          <Grid cols="g-main" className="mt-5">
            <Card icon="wallet" title="What families still owe" sub="Unpaid balances by how long they have been due">
              <AgedBar aged={revenue.aged} outstanding={revenue.outstanding} />
              <div className="divider" />
              <div className="row g-5 wrap">
                <Figure label="Collected this month" value={fmt.money(revenue.collection.thisMonth, { compact: true })}
                  delta={revenue.collection.changePct} deltaLabel="vs last month" />
                <Figure label="Last 30 days" value={fmt.money(revenue.collection.last30, { compact: true })}
                  sub={`${revenue.collection.receipts30} receipts`} />
                <Figure label="Concessions given" value={fmt.money(revenue.concessions, { compact: true })}
                  sub="this academic year" />
              </div>
              {revenue.byClass.length > 0 && (
                <>
                  <div className="divider" />
                  <div className="t-xs t-muted mb-3">By class · bar shows the share of the class balance already overdue</div>
                  <div className="col g-3">
                    {revenue.byClass.map((g) => (
                      <Meter key={g.grade} label={g.grade} value={pctOf(g.overdue, g.outstanding)}
                        tone={g.overdue > 0 ? 'critical' : 'teal'}
                        right={fmt.money(g.outstanding, { compact: true })}
                        hint={`${g.students} student${g.students === 1 ? '' : 's'} · ${fmt.money(g.overdue, { compact: true })} overdue`} />
                    ))}
                  </div>
                </>
              )}
            </Card>

            <Card title="Families furthest behind" sub="Largest overdue balances this academic year" flush
              actions={<Button size="sm" variant="ghost" icon="arrowRight" to="/student-accounts">All accounts</Button>}>
              {revenue.topOwing.length ? revenue.topOwing.map((s) => (
                <div key={s.studentId} className="row between g-3 hoverable oi-ov-owing">
                  <StudentLink id={s.studentId} name={s.name}
                    meta={[s.className, s.campus, s.admissionNo].filter(Boolean).join(' · ')} />
                  <div className="col none oi-ov-owing__fig">
                    <strong className="t-sm t-num">{fmt.money(s.overdue)}</strong>
                    <Badge tone={ageTone(s.daysOverdue)} title={`Oldest unpaid charge due ${fmt.date(s.oldestDue)}`}>
                      {s.daysOverdue} days · {s.charges} charge{s.charges === 1 ? '' : 's'}
                    </Badge>
                  </div>
                </div>
              )) : (
                <div className="card__body"><div className="row g-2 t-sm t-muted"><Icon name="check" size={16} />No family is past due.</div></div>
              )}
            </Card>
          </Grid>

          <Grid cols={revenue.byCampus.length ? 'g-2col' : ''} className="mt-5">
            <Card icon="wallet" title="By fee head" sub="Billed after concessions, and how much of it has come in" flush>
              <BreakdownTable
                rows={revenue.byHead.map((h) => ({ key: h.head, label: h.head, billed: h.billed, collected: h.collected,
                  outstanding: h.outstanding, extra: h.concessions }))}
                extraLabel="Concessions" />
            </Card>
            {revenue.byCampus.length > 0 && (
              <Card icon="building" title="By campus" sub="Fees against salaries and expenses, this academic year" flush>
                <BreakdownTable
                  rows={revenue.byCampus.map((c) => ({ key: c.campus, label: c.campus, billed: c.billed, collected: c.collected,
                    outstanding: c.outstanding, extra: c.collected - c.spent }))}
                  extraLabel="Net" signedExtra />
              </Card>
            )}
          </Grid>
    </>
  );
}

/** Approvals in aggregate, the busiest areas and who has been working. */
function ActivityDetail({ activity, firstVisit }: { activity: Activity; firstVisit: boolean }) {
  const visit = { firstVisit };
  return (
        <div className="col g-4">
          <Card icon="checkSquare" title="Waiting for a decision" flush>
            {activity.approvals.length ? activity.approvals.map((a) => {
              const waited = daysSince(a.oldest);
              const total = a.unit === 'days' ? `${fmt.n(a.total)} day${a.total === 1 ? '' : 's'}` : fmt.money(a.total, { compact: true });
              return (
                <AlertItem key={a.label} tone={waited > 7 ? 'critical' : 'warning'} icon={a.icon} title={a.label}
                  meta={`${a.count} pending · ${total} · oldest waiting ${waited === 0 ? 'since today' : `${waited} day${waited === 1 ? '' : 's'}`}`}
                  to={a.to}
                  right={<Badge tone={waited > 7 ? 'critical' : 'warning'}>{a.count}</Badge>} />
              );
            }) : (
              <div className="card__body"><div className="row g-2 t-sm t-muted"><Icon name="check" size={16} />Nothing is waiting on an approval.</div></div>
            )}
          </Card>

          <Card icon="bus" title="Busiest areas" sub={visit.firstVisit ? 'Last seven days' : 'Since your last sign-in'}>
            {activity.byModule.length ? (
              <div className="col g-3">
                {activity.byModule.map((m) => (
                  <Meter key={m.module} label={moduleLabel(m.module)} right={String(m.count)}
                    value={pctOf(m.count, activity.byModule[0].count)}
                    hint={[
                      m.actions.map((x) => `${x.count} ${x.action.replace(/_/g, ' ')}`).join(', '),
                      m.topPerson ? `mostly ${m.topPerson} (${m.topCount})` : null,
                    ].filter(Boolean).join(' · ')} />
                ))}
              </div>
            ) : <div className="t-sm t-muted">No changes recorded in this period.</div>}
          </Card>

          <Card icon="grid" title="Who has been working" sub={visit.firstVisit ? 'Last seven days' : 'Since your last sign-in'}>
            {activity.byPerson.length ? (
              <div className="col g-1">
                {activity.byPerson.map((p) => (
                  <div className="col hoverable oi-ov-person" key={p.name + p.role}>
                    <div className="row between g-3">
                      <Person name={p.name} meta={`${p.role.replace(/_/g, ' ')} · last active ${fmt.relative(p.lastAt)}`} />
                      <span className="t-sm t-bold t-num none" title="Changes made">{p.count}</span>
                    </div>
                    {p.modules.length > 0 && (
                      <div className="row g-1 wrap mt-1 oi-ov-person__mods">
                        {p.modules.map((m) => <Badge key={m.module}>{moduleLabel(m.module)} {m.count}</Badge>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : <div className="t-sm t-muted">No staff changes recorded in this period.</div>}
          </Card>
        </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** One of the three School overview tiles: area, headline, subject, then up to four figures. */
function OverviewTile({ eyebrow, title, sub, to, figs, icon }: {
  eyebrow: string; title: string; sub: string; to?: string; figs: [string, string, ('critical' | undefined)?][];
  /** Icon shown in a tinted tile, as on the dashboard KPI cards. */
  icon?: string;
}) {
  const content = (
    <>
      <div className="ov-tile__top">
        {icon && <span className="ov-tile__ico"><Icon name={icon} size={20} /></span>}
        <div className="oi-minw0">
          <div className="ov-tile__eyebrow">{eyebrow}</div>
          <div className="ov-tile__title">{title}</div>
        </div>
        {to && <Icon name="arrowRight" size={15} className="ov-tile__go" />}
      </div>
      <div className="ov-tile__sub">{sub}</div>
      {figs.length > 0 && (
        <div className="ov-tile__figs">
          {figs.map(([label, value, tone]) => (
            <div key={label}>
              <span className="ov-fig__label">{label}</span>
              <span className={tone ? 'ov-fig__value oi-crit' : 'ov-fig__value'}>{value}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
  return to
    ? <Link className="ov-tile ov-tile--kpi" to={to}>{content}</Link>
    : <div className="ov-tile ov-tile--kpi">{content}</div>;
}

/** Calendar tile: the next few events on the campus calendar. */
function EventsTile({ events, showCampus }: {
  events: { title: string; kind: string; icon: string; campus: string; date: Date; in: number }[]; showCampus: boolean;
}) {
  return (
    <Link className="ov-tile" to="/events">
      <div className="row between g-2">
        <span className="ov-tile__eyebrow">Calendar</span>
        <Badge>Sample data</Badge>
      </div>
      <div className="ov-tile__title">Upcoming events</div>
      <div className="ov-tile__sub">As per the campus calendar</div>
      <div className="ov-tile__figs oi-ov-events">
        {events.length ? events.map((e) => (
          <div key={e.campus + e.title} className="row g-3">
            <span className="ov-date none">
              <span>{e.date.toLocaleDateString('en-IN', { month: 'short' })}</span>
              <strong>{e.date.getDate()}</strong>
            </span>
            <div className="grow oi-minw0">
              <div className="t-sm t-bold t-strong">{e.title}</div>
              <div className="t-micro t-muted">
                {e.kind}{showCampus ? ` · ${e.campus}` : ''} · {e.in === 1 ? 'tomorrow' : `in ${e.in} days`}
              </div>
            </div>
          </div>
        )) : <div className="t-sm t-muted">Nothing on the calendar.</div>}
      </div>
    </Link>
  );
}

/** A label / value line inside a governance tile. */
function GovLine({ label, value, warn }: { label: ReactNode; value: ReactNode; warn?: boolean }) {
  return (
    <div className="row between g-3 t-sm oi-ov-line">
      <span className="t-muted">{label}</span>
      <strong className={warn ? 't-num oi-crit' : 't-num'}>{value}</strong>
    </div>
  );
}

function Figure({ label, value, sub, delta, deltaLabel }: {
  label: string; value: string; sub?: string; delta?: number | null; deltaLabel?: string;
}) {
  return (
    <div className="col">
      <span className="t-xs t-muted">{label}</span>
      <span className="h2 mt-1 t-num">{value}</span>
      {delta != null ? (
        <span className={`kpi__delta mt-1 oi-self-start ${delta >= 0 ? 'kpi__delta--up' : 'kpi__delta--down'}`}>
          <Icon name={delta >= 0 ? 'arrowUp' : 'arrowDown'} size={12} />{Math.abs(delta)}% {deltaLabel}
        </span>
      ) : sub ? <span className="t-micro t-muted mt-1">{sub}</span> : null}
    </div>
  );
}

/** Fees in against salaries + expenses out, month by month across the academic year. */
function MoneyTrend({ trend }: { trend: Revenue['trend'] }) {
  const out = trend.map((m) => m.payroll + m.expenses);
  const months = trend.filter((m) => m.collected > 0);
  const best = months.reduce<Revenue['trend'][number] | null>((b, m) => (!b || m.collected > b.collected ? m : b), null);
  const avg = months.length ? months.reduce((s, m) => s + m.collected, 0) / months.length : 0;
  const shortfall = trend.filter((m, i) => out[i] > m.collected && out[i] > 0).map((m) => m.label);

  return (
    <Card icon="wallet" title="Money in and out by month" sub="Fees collected against salaries and expenses, this academic year"
      actions={<Legend items={[{ label: 'Fees collected', color: 'var(--teal)' }, { label: 'Money out', color: 'var(--brand)' }]} />}>
      {trend.some((m, i) => m.collected > 0 || out[i] > 0) ? (
        <>
          <Chart svg={charts.bar({
            labels: trend.map((m) => m.label),
            series: [
              { name: 'Fees collected', values: trend.map((m) => m.collected), color: 'var(--teal)' },
              { name: 'Money out', values: out, color: 'var(--brand)' },
            ],
            height: 220, label: 'Fees collected and money out by month',
          })} />
          <div className="row g-5 wrap mt-3 t-xs">
            {best && <span><span className="t-muted">Best month </span><strong>{best.label} · {fmt.money(best.collected, { compact: true })}</strong></span>}
            <span><span className="t-muted">Average collected </span><strong>{fmt.money(avg, { compact: true })} a month</strong></span>
            <span>
              <span className="t-muted">Spent more than collected </span>
              <strong className={shortfall.length ? 'oi-crit' : undefined}>
                {shortfall.length ? shortfall.join(', ') : 'no month'}
              </strong>
            </span>
          </div>
        </>
      ) : <div className="t-sm t-muted">No money has moved yet this academic year.</div>}
    </Card>
  );
}

/** Billed / collected / owed per row, with a collection meter and one extra money column. */
function BreakdownTable({ rows, extraLabel, signedExtra }: {
  rows: { key: string; label: string; billed: number; collected: number; outstanding: number; extra: number }[];
  extraLabel: string; signedExtra?: boolean;
}) {
  if (!rows.length) return <div className="card__body t-sm t-muted">No fees billed yet.</div>;
  return (
    <div className="table-wrap">
      <table className="table table--compact">
        <thead>
          <tr>
            <th />
            <th className="t-right">Billed</th>
            <th className="oi-ov-colmeter">Collected</th>
            <th className="t-right">Outstanding</th>
            <th className="t-right">{extraLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="t-bold">{r.label}</td>
              <td className="t-right t-num">{fmt.money(r.billed, { compact: true })}</td>
              <td><Meter label={fmt.money(r.collected, { compact: true })} value={pctOf(r.collected, r.billed)} tone="teal" /></td>
              <td className={r.outstanding > 0 ? 't-right t-num oi-crit' : 't-right t-num'}>
                {fmt.money(r.outstanding, { compact: true })}
              </td>
              <td className={signedExtra && r.extra < 0 ? 't-right t-num oi-crit' : 't-right t-num'}>
                {fmt.money(r.extra, { compact: true })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Outstanding balances split by age. Widths are shares of the total owed. */
function AgedBar({ aged, outstanding }: { aged: Revenue['aged']; outstanding: number }) {
  const bands = [
    { label: 'Not yet due', value: aged.notYetDue, cls: 'var(--neutral)' },
    { label: 'Up to 30 days', value: aged.due0to30, cls: 'var(--caution)' },
    { label: '31–60 days', value: aged.due31to60, cls: 'var(--warning)' },
    { label: 'Over 60 days', value: aged.due60plus, cls: 'var(--critical)' },
  ].filter((b) => b.value > 0);

  if (!outstanding || !bands.length) {
    return <div className="row g-2 t-sm t-muted"><Icon name="check" size={16} />Every billed fee has been collected.</div>;
  }

  return (
    <>
      <div className="row oi-ov-aged" role="img" aria-label={bands.map((b) => `${b.label} ${fmt.money(b.value, { compact: true })}`).join(', ')}>
        {bands.map((b) => (
          <span key={b.label} title={`${b.label}: ${fmt.money(b.value)}`}
            style={{ width: `${(b.value / outstanding) * 100}%`, background: b.cls, height: '100%' }} />
        ))}
      </div>
      <div className="row g-4 wrap mt-3">
        {bands.map((b) => (
          <span className="row g-2 t-xs" key={b.label}>
            <span className="legend__swatch" style={{ background: b.cls }} />
            <span className="t-muted">{b.label}</span>
            <strong className="t-num">{fmt.money(b.value, { compact: true })}</strong>
          </span>
        ))}
      </div>
    </>
  );
}
