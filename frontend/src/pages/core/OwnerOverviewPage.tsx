import { useApiQuery } from '@/hooks/useApi';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n/I18nProvider';
import { useSchool } from '@/layouts/SchoolContext';
import {
  AlertItem, Badge, Button, Card, Chart, charts, Empty, ErrorState, Grid, Icon, Kpi, Legend, Meter, Page, PageSkeleton,
  Person, StudentLink,
} from '@/components/ui';
import { fmt } from '@/lib/format';

/**
 * Owner Overview — the Super Admin's landing page.
 *
 * Three blocks, in the order an owner reads them: when they were last here and
 * what has changed, the money, and what the management team has been doing.
 * Revenue and activity arrive as null when the signed-in role lacks
 * finance.read / audit.read, so each block renders only when permitted.
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
}

type Revenue = NonNullable<Overview['revenue']>;

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
  const { user } = useAuth();
  const { t } = useI18n();
  const school = useSchool();
  const q = useApiQuery<Overview>('/dashboard/overview', { scope: school.scope, campusId: school.campusId },
    { refetchInterval: 300_000 });

  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  const greet = hour < 12 ? t('Good Morning') : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const scopeLabel = school.scope === 'group' ? 'All campuses' : school.campus?.name ?? 'your campus';

  const head = (
    <div className="pagehead">
      <div className="grow">
        <h1 className="display">{greet}, {user?.fullName}</h1>
        <p className="lede mt-2">{scopeLabel} · {school.yearLabel} · figures for this academic year to date.</p>
      </div>
      <div className="pagehead__actions">
        <Button variant="ghost" icon="activity" to="/audit">Full audit trail</Button>
        <Button variant="ghost" icon="pulse" to="/command-center">Daily operations</Button>
      </div>
    </div>
  );

  if (q.isLoading) return <Page>{head}<PageSkeleton kpis={4} /></Page>;
  if (q.error || !q.data) return <Page>{head}<ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;

  const d = q.data;
  const { previousVisit: visit, welcome, revenue, activity } = d;

  return (
    <Page>
      {head}

      {/* ---- 1. Welcome strip ------------------------------------------- */}
      <section className="card card--navy" style={{ padding: 'var(--s-5) var(--s-6)' }}>
        <div className="row g-4 wrap between">
          <div className="row g-3 grow" style={{ minWidth: 0 }}>
            <span className="avatar avatar--gold none"><Icon name="shield" size={18} /></span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="t-sm t-bold" style={{ color: '#fff' }}>
                {visit.firstVisit
                  ? 'Welcome — this is your first recorded sign-in.'
                  : <>You last signed in on <strong>{fmt.dateTime(visit.at)}</strong>{visit.device ? ` from ${visit.device}` : ''}{visit.ip ? ` (${visit.ip})` : ''}.</>}
              </div>
              <div className="t-xs mt-1" style={{ color: 'var(--text-on-navy)' }}>
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

      {/* ---- 2. Revenue -------------------------------------------------- */}
      {revenue ? (
        <>
          <Grid cols="g-4col" className="mt-5">
            <Kpi
              label="Fees collected" value={fmt.money(revenue.collected, { compact: true })}
              tone="teal" to="/payments"
              foot={revenue.collectedPct != null ? `${revenue.collectedPct}% of ${fmt.money(revenue.billed, { compact: true })} billed` : 'No fees billed yet'}
              spark={revenue.trend.map((m) => m.collected)} sparkColor="var(--teal)"
            />
            <Kpi
              label="Still outstanding" value={fmt.money(revenue.outstanding, { compact: true })}
              tone={revenue.aged.due60plus > 0 ? 'critical' : 'amber'} to="/student-accounts"
              foot={`${revenue.aged.familiesOverdue} famil${revenue.aged.familiesOverdue === 1 ? 'y' : 'ies'} past due`}
            />
            <Kpi
              label="Money out" value={fmt.money(revenue.out.total, { compact: true })}
              tone="info" to="/expenses"
              foot={`Payroll ${fmt.money(revenue.out.payroll, { compact: true })} · expenses ${fmt.money(revenue.out.expenses, { compact: true })}`}
            />
            <Kpi
              label="Net position" value={fmt.money(revenue.net, { compact: true })}
              tone={revenue.net < 0 ? 'critical' : 'teal'}
              foot={revenue.net < 0 ? 'Spending exceeds collection this year' : 'Collection exceeds spending this year'}
            />
          </Grid>

          <Grid cols="g-main" className="mt-5">
            <MoneyTrend trend={revenue.trend} />

            <Card title="Money out" sub={`This academic year${revenue.out.payrollMonths ? ` · ${revenue.out.payrollMonths} payroll months` : ''}`}>
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
                    <div className="row between g-3 t-sm" style={{ padding: '4px 0' }}>
                      <span>{revenue.pending.expenses.count} expense claim{revenue.pending.expenses.count === 1 ? '' : 's'}</span>
                      <strong>{fmt.money(revenue.pending.expenses.amount, { compact: true })}</strong>
                    </div>
                  )}
                  {revenue.pending.concessions.count > 0 && (
                    <div className="row between g-3 t-sm" style={{ padding: '4px 0' }}>
                      <span>{revenue.pending.concessions.count} fee concession{revenue.pending.concessions.count === 1 ? '' : 's'}</span>
                      <strong>{fmt.money(revenue.pending.concessions.amount, { compact: true })}</strong>
                    </div>
                  )}
                </>
              )}
            </Card>
          </Grid>

          <Grid cols="g-main" className="mt-5">
            <Card title="What families still owe" sub="Unpaid balances by how long they have been due">
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
                <div key={s.studentId} className="row between g-3 hoverable" style={{ padding: '10px var(--s-5)', borderBottom: '1px solid var(--border-soft)' }}>
                  <StudentLink id={s.studentId} name={s.name}
                    meta={[s.className, s.campus, s.admissionNo].filter(Boolean).join(' · ')} />
                  <div className="col none" style={{ alignItems: 'flex-end', gap: 4 }}>
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
            <Card title="By fee head" sub="Billed after concessions, and how much of it has come in" flush>
              <BreakdownTable
                rows={revenue.byHead.map((h) => ({ key: h.head, label: h.head, billed: h.billed, collected: h.collected,
                  outstanding: h.outstanding, extra: h.concessions }))}
                extraLabel="Concessions" />
            </Card>
            {revenue.byCampus.length > 0 && (
              <Card title="By campus" sub="Fees against salaries and expenses, this academic year" flush>
                <BreakdownTable
                  rows={revenue.byCampus.map((c) => ({ key: c.campus, label: c.campus, billed: c.billed, collected: c.collected,
                    outstanding: c.outstanding, extra: c.collected - c.spent }))}
                  extraLabel="Net" signedExtra />
              </Card>
            )}
          </Grid>
        </>
      ) : (
        <div className="banner banner--neutral mt-5">
          <Icon name="lock" size={17} />
          <div className="grow">Financial figures are not part of your role's access.</div>
        </div>
      )}

      {/* ---- 3. Management activity -------------------------------------- */}
      {activity && (
        <Grid cols="g-side" className="mt-5">
          <div className="col g-4">
            <Card title="Waiting for a decision" flush>
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

            <Card title="Busiest areas" sub={visit.firstVisit ? 'Last seven days' : 'Since your last sign-in'}>
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

            <Card title="Who has been working" sub={visit.firstVisit ? 'Last seven days' : 'Since your last sign-in'}>
              {activity.byPerson.length ? (
                <div className="col g-1">
                  {activity.byPerson.map((p) => (
                    <div className="col hoverable" key={p.name + p.role} style={{ padding: '6px 0' }}>
                      <div className="row between g-3">
                        <Person name={p.name} meta={`${p.role.replace(/_/g, ' ')} · last active ${fmt.relative(p.lastAt)}`} />
                        <span className="t-sm t-bold t-num none" title="Changes made">{p.count}</span>
                      </div>
                      {p.modules.length > 0 && (
                        <div className="row g-1 wrap mt-1" style={{ paddingLeft: 40 }}>
                          {p.modules.map((m) => <Badge key={m.module}>{moduleLabel(m.module)} {m.count}</Badge>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : <div className="t-sm t-muted">No staff changes recorded in this period.</div>}
            </Card>
          </div>

          <Card title="Changes worth your attention"
            sub={visit.firstVisit ? 'Deletions, approvals, account and settings changes — last seven days' : 'Deletions, approvals, account and settings changes since your last sign-in'}
            flush
            actions={<Button size="sm" variant="ghost" icon="arrowRight" to="/audit">Open audit trail</Button>}>
            {activity.important.length ? activity.important.map((e) => {
              const detail = metaSummary(e.metadata);
              return (
                <AlertItem
                  key={e.id}
                  tone={toneFor(e.action, e.module)}
                  icon={ICON_FOR[e.action] ?? 'alertCircle'}
                  title={e.description}
                  meta={
                    <>
                      {e.userName} ({e.role.replace(/_/g, ' ')}) · {moduleLabel(e.module)} · {fmt.dateTime(e.at)}
                      {e.device ? ` · ${e.device}` : ''}{e.ip ? ` (${e.ip})` : ''}
                      {detail && <span className="t-micro t-muted" style={{ display: 'block', marginTop: 2 }}>{detail}</span>}
                    </>
                  }
                  to={entityLink(e.entityType, e.entityId)}
                />
              );
            }) : (
              <div className="card__body">
                <Empty icon="check" title="Nothing needs a second look"
                  sub={visit.firstVisit
                    ? 'No deletions, approvals or account changes in the last seven days.'
                    : 'No deletions, approvals or account changes since you were last here.'} />
              </div>
            )}
          </Card>
        </Grid>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function Figure({ label, value, sub, delta, deltaLabel }: {
  label: string; value: string; sub?: string; delta?: number | null; deltaLabel?: string;
}) {
  return (
    <div className="col">
      <span className="t-xs t-muted">{label}</span>
      <span className="h2 mt-1 t-num">{value}</span>
      {delta != null ? (
        <span className={`kpi__delta mt-1 ${delta >= 0 ? 'kpi__delta--up' : 'kpi__delta--down'}`} style={{ alignSelf: 'flex-start' }}>
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
    <Card title="Money in and out by month" sub="Fees collected against salaries and expenses, this academic year"
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
              <strong style={{ color: shortfall.length ? 'var(--critical)' : undefined }}>
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
            <th style={{ width: '26%' }}>Collected</th>
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
              <td className="t-right t-num" style={{ color: r.outstanding > 0 ? 'var(--critical-text)' : undefined }}>
                {fmt.money(r.outstanding, { compact: true })}
              </td>
              <td className="t-right t-num" style={{ color: signedExtra && r.extra < 0 ? 'var(--critical-text)' : undefined }}>
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
      <div className="row" style={{ height: 14, borderRadius: 99, overflow: 'hidden', background: 'var(--bg-sunken)' }}>
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
