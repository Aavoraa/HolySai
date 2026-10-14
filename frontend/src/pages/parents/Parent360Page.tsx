import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n/I18nProvider';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import {
  Avatar, Badge, Banner, Button, Card, Chart, charts, Empty, ErrorState, Icon, Meter, Modal, Page, Skeleton, Status, Tabs, TextArea,
  TextField, Timeline, useConfirm, useToast, CampusBanner, DashLayout, DashRail, TrendCard, DonutCard, RankCard, UpcomingEvents } from '@/components/ui';
import { TrackingPanel, TrackingStatusPill } from '@/components/tracking/TrackingPanel';
import type { CurrentLocation, StudentRow } from '@/api/types';
import { cx, fmt, todayKey } from '@/lib/format';
import type { Profile } from '../students/Student360Page';

type ChildRow = StudentRow & { relationship: string; isPrimary: boolean; canViewTracking: boolean; locationStatus: string | null; locationRecordedAt: string | null };
interface ParentMe {
  id: string; parentCode: string; fullName: string; phone: string; email: string | null; children: ChildRow[];
}
interface Overview {
  child: StudentRow;
  gateToday: { gate: string; direction: 'in' | 'out'; method: string; occurredAt: string }[];
  bus: {
    routeName: string; runStatus: string; delayMinutes: number; eta: string | null; busNo: string | null; registrationNo: string | null;
    driver: string | null; attendant: string | null; stopName: string | null; pickupTime: string | null; dropTime: string | null;
    boardingToday: { type: 'boarded' | 'deboarded'; at: string }[] | null;
  } | null;
  homework: { id: string; subject: string; title: string; dueOn: string; status: string; submitted: boolean }[];
  fees: { billed: number; paid: number; outstanding: number; nextDue: string | null };
  notifications: { id: string; category: string; tone: string; icon: string; title: string; body: string | null; route: string | null; createdAt: string }[];
  events: { id: string; title: string; startsOn: string; endsOn: string | null; venue: string | null; audience: string }[];
  pickup: { id: string; personName: string; relation: string; method: string; status: string; lastPickupAt: string | null }[];
}
interface FamilyCircular { id: string; title: string; publishedAt: string; audience: string; requiresAck: boolean; acknowledged: boolean; body?: string }

type Tab = 'home' | 'track' | 'academics' | 'safety' | 'fees' | 'more';
const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'track', label: 'Track' },
  { id: 'academics', label: 'Academics' },
  { id: 'safety', label: 'Safety' },
  { id: 'fees', label: 'Fees' },
  { id: 'more', label: 'More' },
];
const TODAY_LABEL: Record<string, string> = { present: 'Present today', absent: 'Absent today', late: 'Late today', leave: 'On leave today', unmarked: 'Attendance not marked' };
const todayTone = (v: string) => (v === 'present' ? 'success' : v === 'late' ? 'warning' : v === 'absent' ? 'critical' : v === 'leave' ? 'info' : 'neutral');
const trackLabel = (s: string) => (s === 'active' ? 'Tracking Active' : s === 'paused' ? 'Tracking Paused' : s === 'offline' ? 'Offline' : 'Tracking Disabled');
const hhmm = (t: string | null | undefined) => t?.slice(0, 5) ?? '—';
const overviewPath = (pid: string, cid: string) => `/parents/${pid}/children/${cid}/overview`;

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------
function Item({ icon, tone, lead, title, meta, end, onClick, wrap, endCol }: {
  icon?: string; tone?: 'success' | 'warning' | 'critical' | 'brand'; lead?: ReactNode; title: ReactNode; meta?: ReactNode; end?: ReactNode;
  onClick?: () => void; wrap?: boolean; endCol?: boolean;
}) {
  const body = (
    <>
      {lead ?? (icon && <span className={cx('portal-item__ico', tone && `portal-item__ico--${tone}`)}><Icon name={icon} size={17} /></span>)}
      <span className="portal-item__body">
        <span className="portal-item__title">{title}</span>
        {meta && <span className="portal-item__meta">{meta}</span>}
      </span>
      {end !== undefined ? <span className={cx('portal-item__end', endCol && 'portal-item__end--col')}>{end}</span> : onClick ? <Icon name="chevronRight" size={16} className="t-faint none" /> : null}
    </>
  );
  if (onClick) return <button type="button" className={cx('portal-item', wrap && 'portal-item--wrap')} onClick={onClick}>{body}</button>;
  return <div className={cx('portal-item', wrap && 'portal-item--wrap')}>{body}</div>;
}

function LinkAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" className="portal-link" onClick={onClick}>{children}<Icon name="chevronRight" size={13} /></button>;
}

function DateChip({ date }: { date: string }) {
  const [day, mon] = fmt.dateShort(date).split(' ');
  return <span className="portal-date" aria-hidden="true"><span className="portal-date__mon">{mon}</span><span className="portal-date__day">{day}</span></span>;
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="t-sm t-muted">{children}</p>;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function Parent360Page() {
  const [sp, setSp] = useSearchParams();
  const me = useApiQuery<ParentMe>('/parents/me');
  const tab = (TABS.some((x) => x.id === sp.get('tab')) ? sp.get('tab') : 'home') as Tab;
  const children = me.data?.children ?? [];
  const childId = sp.get('child') && children.some((c) => c.id === sp.get('child')) ? sp.get('child')! : children[0]?.id;
  const child = children.find((c) => c.id === childId);

  const setParams = (patch: Record<string, string | null>, replace = false) =>
    setSp((p) => {
      const n = new URLSearchParams(p);
      Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
      return n;
    }, { replace });
  // Braces matter: newer browsers return a Promise from scrollTo, which React would treat as a cleanup.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [tab]);

  if (me.isLoading) return <Page className="portal"><Skeleton height={180} /><div className="mt-4"><Skeleton height={320} /></div></Page>;
  if (me.error) return <Page className="portal"><ErrorState error={me.error} onRetry={() => me.refetch()} /></Page>;
  if (!children.length || !child) {
    return (
      <Page className="portal">
        <h1 className="sr-only">Parent 360</h1>
        <Card><Empty icon="users" title="No children are linked to your account" sub="Please contact the school office to link your child's record. Once linked, attendance, homework, fees and bus updates appear here." /></Card>
      </Page>
    );
  }
  const parent = me.data!;
  const pid = parent.id;
  const onTab = (x: Tab, extra: Record<string, string | null> = {}) => setParams({ tab: x === 'home' ? null : x, ...extra });

  return (
    <PortalShell parent={parent} child={child} tab={tab} onTab={onTab} onChild={(id) => setParams({ child: id }, true)}>
      {tab === 'home' && <HomeTab pid={pid} child={child} onTab={onTab} />}
      {tab === 'track' && <TrackTab pid={pid} child={child} />}
      {tab === 'academics' && <AcademicsTab pid={pid} child={child} />}
      {tab === 'safety' && <SafetyTab pid={pid} child={child} onTab={onTab} />}
      {tab === 'fees' && <FeesTab child={child} autoPay={sp.get('pay') === '1'} onAutoPayDone={() => setParams({ pay: null }, true)} />}
      {tab === 'more' && <MoreTab child={child} autoCompose={sp.get('compose')} onAutoComposeDone={() => setParams({ compose: null }, true)} />}
    </PortalShell>
  );
}

/** Child header (identity, one primary action, today's figures) and the sticky portal tabs. */
function PortalShell({ parent, child, tab, onTab, onChild, children: body }: {
  parent: ParentMe; child: ChildRow; tab: Tab; onTab: (t: Tab, extra?: Record<string, string | null>) => void; onChild: (id: string) => void; children: ReactNode;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const kids = parent.children;
  const ov = useApiQuery<Overview>(overviewPath(parent.id, child.id), undefined, { refetchInterval: 60_000 });
  const circulars = useApiQuery<FamilyCircular[]>('/family/circulars');
  const pendingAck = circulars.data?.filter((c) => c.requiresAck && !c.acknowledged).length ?? 0;

  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  const greet = t(hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening');
  const firstName = (user?.fullName ?? parent.fullName).split(' ')[0];

  const d = ov.data;
  const entry = d?.gateToday.find((g) => g.direction === 'in');
  const exit = [...(d?.gateToday ?? [])].reverse().find((g) => g.direction === 'out');
  const due = d?.fees.outstanding ?? 0;

  const primary = due > 0
    ? <Button size="sm" variant="primary" icon="creditCard" onClick={() => onTab('fees', { pay: '1' })}>{t('Pay Now')} · {fmt.money(due, { compact: true })}</Button>
    : child.canViewTracking
      ? <Button size="sm" variant="primary" icon="mapPin" onClick={() => onTab('track')}>Track {child.firstName}</Button>
      : <Button size="sm" variant="primary" icon="message" onClick={() => onTab('more', { compose: 'teacher' })}>Message teacher</Button>;

  return (
    <Page className="portal">
      <CampusBanner bleed={false} title={<>{greet}, {firstName}</>} sub={<>Here's {child.firstName}'s day at a glance — attendance, travel, learning and fees.</>} />
      {kids.length > 1 && (
        <div className="childpick" role="group" aria-label="Choose a child">
          {kids.map((c) => (
            <button key={c.id} type="button" className="childpick__item" aria-pressed={c.id === child.id} onClick={() => onChild(c.id)}>
              <Avatar name={c.fullName} size="sm" src={c.photoUrl} />
              <span className="col">
                <span className="childpick__name">{c.firstName}</span>
                <span className="childpick__meta">{c.grade}{c.section}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <section className="card profilehead">
        <div className="profilehead__main">
          <Avatar name={child.fullName} size="xl" src={child.photoUrl} />
          <div className="profilehead__id">
            <div className="row g-2 wrap">
              <h2 className="profilehead__name">{child.fullName}</h2>
              <Badge tone={todayTone(child.today)} dot>{TODAY_LABEL[child.today] ?? child.today}</Badge>
            </div>
            <p className="profilehead__meta">
              {child.grade} {child.section} · {child.admissionNo} · {child.campusName}{child.house ? ` · ${child.house} House` : ''}
            </p>
            <div className="profilehead__facts">
              <span><Icon name="bus" size={14} />{child.busRoute ?? 'Own transport'}</span>
              {child.trackingStatus && <span><Icon name="mapPin" size={14} />{trackLabel(child.trackingStatus)}</span>}
              {pendingAck > 0 && <span className="t-warning"><Icon name="fileText" size={14} />{pendingAck} circular{pendingAck > 1 ? 's' : ''} to acknowledge</span>}
            </div>
          </div>
          <div className="profilehead__actions">
            {primary}
            {due > 0 && child.canViewTracking && <Button size="sm" icon="mapPin" onClick={() => onTab('track')}>Track</Button>}
            {(due > 0 || child.canViewTracking) && <Button size="sm" icon="message" onClick={() => onTab('more', { compose: 'teacher' })}>Message teacher</Button>}
          </div>
        </div>
        <dl className="profilehead__stats">
          <div>
            <dt>Today</dt>
            <dd className={exit || entry ? 't-success' : child.today === 'absent' ? 't-critical' : undefined}>
              {ov.isLoading ? '…' : exit ? `Left ${fmt.time(exit.occurredAt)}` : entry ? `In ${fmt.time(entry.occurredAt)}` : child.today === 'absent' ? 'Absent' : 'Not in yet'}
            </dd>
            <span className="t-clip">{entry ? `${entry.gate} · ${entry.method}` : 'You are notified on arrival'}</span>
          </div>
          <div>
            <dt>Attendance</dt>
            <dd className={child.attendance != null && child.attendance < 85 ? 't-critical' : undefined}>{child.attendance != null ? `${child.attendance}%` : '—'}</dd>
            <span>this academic year</span>
          </div>
          <div>
            <dt>Average</dt>
            <dd>{child.average ?? '—'}</dd>
            <span className={child.trend > 0 ? 't-success' : child.trend < 0 ? 't-critical' : undefined}>
              {child.average != null ? `${child.trend >= 0 ? '+' : ''}${child.trend} trend` : 'No results yet'}
            </span>
          </div>
          <div>
            <dt>Fees due</dt>
            <dd className={!d ? undefined : due > 0 ? 't-critical' : 't-success'}>{!d ? '—' : due > 0 ? fmt.money(due, { compact: true }) : 'Cleared'}</dd>
            <span className="t-clip">{!d ? '' : due > 0 ? (d.fees.nextDue ? `next due ${fmt.date(d.fees.nextDue)}` : 'outstanding') : 'nothing to pay'}</span>
          </div>
        </dl>
      </section>

      <div className="tabsbar">
        <Tabs
          items={TABS.map((x) => ({ id: x.id, label: t(x.label), count: x.id === 'more' && pendingAck ? pendingAck : undefined }))}
          active={tab}
          onChange={(x) => onTab(x)}
        />
      </div>
      <div className="mt-4">
        {tab === 'home' ? (
          <DashLayout rail={<DashRail events={false} actions={[
            { label: `Track ${child.firstName}`, icon: 'mapPin', to: '/parent-360?tab=track', show: child.canViewTracking },
            { label: 'Academics & Homework', icon: 'bookOpen', to: '/parent-360?tab=academics' },
            { label: 'Pay Fees', icon: 'creditCard', to: '/parent-360?tab=fees&pay=1' },
            { label: 'Safety & Pickup', icon: 'shield', to: '/parent-360?tab=safety' },
            { label: 'Message Teacher', icon: 'message', to: '/parent-360?tab=more&compose=teacher' },
            { label: 'Circulars & PTM', icon: 'megaphone', to: '/parent-360?tab=more' },
          ]} />}>{body}</DashLayout>
        ) : body}
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------------------
function HomeTab({ pid, child, onTab }: { pid: string; child: ChildRow; onTab: (t: Tab, extra?: Record<string, string | null>) => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const ov = useApiQuery<Overview>(overviewPath(pid, child.id), undefined, { refetchInterval: 60_000 });
  const prof = useApiQuery<Profile>(`/students/${child.id}/profile`);
  const d = ov.data;

  if (ov.error) return <ErrorState error={ov.error} onRetry={() => ov.refetch()} />;
  if (ov.isLoading || !d) {
    return <div className="grid g-main"><Skeleton height={320} /><Skeleton height={320} /></div>;
  }

  const entry = d.gateToday.find((g) => g.direction === 'in');
  const exit = [...d.gateToday].reverse().find((g) => g.direction === 'out');
  const openHw = d.homework.filter((h) => !h.submitted).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const achievement = prof.data?.achievements[0];

  return (
    <div className="col g-4">
      <ChildPulse child={child} prof={prof.data} loading={prof.isLoading} />
    <div className="grid g-main">
      <div className="portal-stack">
        <Card icon="grid" title="Today" sub={fmt.date(new Date())}>
          <div className="portal-list">
            <Item
              icon={exit ? 'logout' : entry ? 'shieldCheck' : 'clock'}
              tone={entry ? 'success' : child.today === 'absent' ? 'critical' : undefined}
              title={exit ? `Left campus at ${fmt.time(exit.occurredAt)}` : entry ? `Arrived safely at ${fmt.time(entry.occurredAt)}` : child.today === 'absent' ? 'Marked absent today' : 'No gate entry yet today'}
              meta={entry ? `${entry.gate} · ${entry.method} verified` : 'You will be notified when your child reaches school'}
              end={entry && !exit ? <Badge tone="success" dot>Inside campus</Badge> : undefined}
              onClick={() => onTab('safety')}
            />
            {d.bus && (
              <Item
                icon="bus" tone={d.bus.runStatus === 'Delayed' ? 'warning' : 'brand'}
                title={`${d.bus.busNo ?? 'Bus'} · ${d.bus.routeName}`}
                meta={<>{d.bus.runStatus === 'Delayed' ? `Running ${d.bus.delayMinutes} min late` : d.bus.eta ? `ETA ${d.bus.eta}` : d.bus.runStatus} · stop {d.bus.stopName ?? '—'} · pickup {hhmm(d.bus.pickupTime)} · drop {hhmm(d.bus.dropTime)}</>}
                end={<Status value={d.bus.runStatus} />}
                onClick={() => onTab('safety')}
              />
            )}
            <Item
              icon="mapPin" tone={child.trackingStatus === 'active' ? 'success' : undefined}
              title="Open live location"
              meta={`${child.firstName} · ${child.locationRecordedAt ? `Last update ${fmt.relative(child.locationRecordedAt)}` : child.trackingStatus === 'disabled' ? 'Tracking is not enabled' : 'No location yet'}`}
              end={child.trackingStatus ? <TrackingStatusPill status={trackLabel(child.trackingStatus)} /> : undefined}
              onClick={() => onTab('track')}
            />
          </div>
        </Card>

        <Card icon="edit" title="Homework" sub={openHw.length ? `${openHw.length} to hand in` : 'All handed in'} actions={<LinkAction onClick={() => onTab('academics')}>All</LinkAction>}>
          {openHw.length ? (
            <div className="portal-list">
              {openHw.slice(0, 4).map((h) => (
                <Item key={h.id} icon="edit" tone={h.dueOn <= todayKey() ? 'warning' : undefined} title={h.title} meta={`${h.subject} · due ${fmt.dateShort(h.dueOn)}`} end={<Badge tone="info">Open</Badge>} />
              ))}
            </div>
          ) : <Muted>Nothing due right now. New homework appears here as soon as a teacher sets it.</Muted>}
        </Card>

        <Card icon="trending" title="Academic progress" actions={<LinkAction onClick={() => onTab('academics')}>See all</LinkAction>}>
          {prof.isLoading ? <Skeleton height={120} /> : prof.data?.academics.subjects.length ? (
            <div className="col g-3">
              {prof.data.academics.subjects.slice(0, 4).map((s) => (
                <Meter key={s.name} label={s.name} value={s.score} right={`${s.score} · ${s.grade}`} tone={s.score >= 80 ? 'teal' : s.score >= 70 ? 'info' : 'amber'} />
              ))}
            </div>
          ) : <Muted>Results will appear after the first assessment.</Muted>}
        </Card>
      </div>

      <div className="portal-stack">
        <Card icon="wallet" title="Fees">
          <div className="t-micro t-muted">Total outstanding</div>
          <div className={cx('portal-amount', d.fees.outstanding > 0 ? 'portal-amount--due' : 'portal-amount--clear')}>{fmt.money(d.fees.outstanding)}</div>
          <div className="t-xs t-muted mt-1">{d.fees.outstanding > 0 ? (d.fees.nextDue ? `Next instalment due ${fmt.date(d.fees.nextDue)}` : 'Payment pending') : 'All dues cleared — thank you'}</div>
          <div className="mt-4">
            {d.fees.outstanding > 0
              ? <Button variant="teal" block icon="creditCard" onClick={() => onTab('fees', { pay: '1' })}>{t('Pay Now')}</Button>
              : <Button block icon="receipt" onClick={() => onTab('fees')}>View receipts</Button>}
          </div>
        </Card>

        <Card icon="bell" title="Latest updates" actions={<LinkAction onClick={() => navigate('/notifications')}>All</LinkAction>}>
          {d.notifications.length ? (
            <div className="portal-list">
              {d.notifications.slice(0, 4).map((n) => (
                <Item key={n.id} icon={n.icon} tone={n.tone === 'critical' ? 'critical' : n.tone === 'warning' ? 'warning' : undefined}
                  title={n.title} meta={fmt.relative(n.createdAt)} onClick={n.route ? () => navigate(n.route!) : undefined} />
              ))}
            </div>
          ) : <Muted>No new updates. School notices and alerts about {child.firstName} will appear here.</Muted>}
        </Card>

        {achievement && (
          <Card icon="award" title="Achievements">
            <Item icon="award" tone="brand" title={achievement.title}
              meta={`${fmt.date(achievement.date)} · ${achievement.verified ? 'verified by the school' : 'awaiting verification'}`} />
          </Card>
        )}
      </div>
    </div>
    </div>
  );
}

const BANDS = [
  { label: 'Excellent (85+)', min: 85, color: 'var(--success)' },
  { label: 'Good (70–84)', min: 70, color: 'var(--brand)' },
  { label: 'Average (50–69)', min: 50, color: 'var(--accent)' },
  { label: 'Needs Improvement (<50)', min: -Infinity, color: 'var(--critical)' },
];

/** The Command Center picture, scoped to this one child: attendance trend, subject bands, events and subject ranking. */
function ChildPulse({ child, prof, loading }: { child: ChildRow; prof: Profile | undefined; loading: boolean }) {
  if (loading) return <div className="grid dash__pair">{[0, 1].map((i) => <Skeleton key={i} height={300} />)}</div>;
  const months = prof?.attendance.months ?? [];
  const subjects = prof?.academics.subjects ?? [];
  const bands = BANDS.map((b, i) => ({
    label: b.label, color: b.color, to: '/parent-360?tab=academics',
    value: subjects.filter((s) => s.score >= b.min && (i === 0 || s.score < BANDS[i - 1].min)).length,
  }));
  const overall = subjects.length ? Math.round(subjects.reduce((a, s) => a + s.score, 0) / subjects.length) : null;
  const ranked = [...subjects].sort((a, b) => b.score - a.score);
  return (
    <>
      <div className="grid dash__pair">
        <TrendCard title={`${child.firstName}'s Attendance`} series="Attendance" points={months}
          empty={{ title: 'No attendance trend yet', sub: 'Monthly attendance appears once the school has marked at least two months.' }} />
        <DonutCard link={{ to: '/parent-360?tab=academics' }} bands={bands}
          center={overall != null ? `${overall}%` : undefined} centerSub={overall != null ? 'Overall Average' : undefined}
          empty={{ title: 'No results yet', sub: 'Subject results appear after the first assessment.' }} />
      </div>
      <div className="grid dash__events">
        <UpcomingEvents />
        <RankCard title="Subject Scores" icon="award" middle="Teacher" valueLabel="Score" link={{ to: '/parent-360?tab=academics', label: 'See all' }}
          rows={ranked.map((s) => ({ key: s.name, name: s.name, meta: s.teacher ?? s.grade, value: `${s.score}%` }))}
          empty={{ title: 'No subject scores yet', sub: 'Scores appear once assessment marks are entered.' }} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
function TrackTab({ pid, child }: { pid: string; child: ChildRow }) {
  return (
    <div className="col g-4">
      {child.canViewTracking ? (
        <TrackingPanel
          compact
          locationPath={`/parents/${pid}/children/${child.id}/location`}
          historyPath={`/parents/${pid}/children/${child.id}/location/history`}
          historyNote="You can review the last 7 days of your child's movements."
          refetchMs={30_000}
        />
      ) : (
        <Card><Empty icon="lock" title="Tracking is not available" sub="Location sharing for this child is not enabled on your account. Please contact the school office." /></Card>
      )}
      <Banner tone="neutral" icon="lock">Only you and authorised school staff can see this location. Every view is recorded in the school's audit trail.</Banner>
    </div>
  );
}

/** Dedicated route used by notifications: /parent-360/track/:studentId */
export function TrackChildPage() {
  const { studentId } = useParams();
  const me = useApiQuery<ParentMe>('/parents/me');
  const navigate = useNavigate();
  if (me.isLoading) return <Page className="portal"><Skeleton height={420} /></Page>;
  if (me.error) return <Page className="portal"><ErrorState error={me.error} onRetry={() => me.refetch()} /></Page>;
  const child = me.data!.children.find((c) => c.id === studentId || c.admissionNo === studentId);
  if (!child) return <Page className="portal"><Card><Empty icon="search" title="Child not found" sub="This child is not linked to your account." action={<Button to="/parent-360">Back to Parent 360</Button>} /></Card></Page>;
  return (
    <PortalShell
      parent={me.data!} child={child} tab="track"
      onTab={(t, extra = {}) => {
        const q = new URLSearchParams({ child: child.id });
        if (t !== 'home') q.set('tab', t);
        Object.entries(extra).forEach(([k, v]) => v && q.set(k, v));
        navigate(`/parent-360?${q.toString()}`);
      }}
      onChild={(id) => navigate(`/parent-360/track/${id}`)}
    >
      <TrackTab pid={me.data!.id} child={child} />
    </PortalShell>
  );
}

// ---------------------------------------------------------------------------
function AcademicsTab({ pid, child }: { pid: string; child: ChildRow }) {
  const prof = useApiQuery<Profile>(`/students/${child.id}/profile`);
  const ov = useApiQuery<Overview>(overviewPath(pid, child.id), undefined, { refetchInterval: 60_000 });
  if (prof.isLoading) return <Skeleton height={300} />;
  if (prof.error || !prof.data) return <ErrorState error={prof.error} onRetry={() => prof.refetch()} />;
  const d = prof.data;
  const trend = d.academics.termTrend;
  const hw = [...(ov.data?.homework ?? [])].sort((a, b) => Number(a.submitted) - Number(b.submitted) || a.dueOn.localeCompare(b.dueOn));
  const openHw = hw.filter((h) => !h.submitted).length;

  return (
    <div className="grid g-2col">
      <Card title="Progress this year" actions={<><Badge tone={child.risk === 'On Track' ? 'success' : 'warning'}>{child.risk}</Badge><Button size="sm" variant="quiet" icon="printer" onClick={() => window.print()} aria-label="Print academics" title="Print" /></>}>
        {trend.length > 1 ? (
          <Chart svg={charts.line({ labels: trend.map((x) => x.label), series: [{ name: 'Average', values: trend.map((x) => x.value), color: 'var(--teal)' }], yMin: Math.max(0, Math.min(...trend.map((x) => x.value)) - 10), yMax: 100, height: 150, showDots: false })} />
        ) : <Muted>Progress appears after more assessments.</Muted>}
      </Card>

      <Card icon="checkSquare" title="Attendance" sub={child.attendance != null ? `${child.attendance}% this year` : undefined}>
        {d.attendance.totals ? (
          <div className="portal-figs">
            <div className="portal-fig"><div className="portal-fig__label">Present</div><div className="portal-fig__value t-success">{d.attendance.totals.present}</div></div>
            <div className="portal-fig"><div className="portal-fig__label">Late</div><div className="portal-fig__value t-warning">{d.attendance.totals.late}</div></div>
            <div className="portal-fig"><div className="portal-fig__label">Absent</div><div className="portal-fig__value t-critical">{d.attendance.totals.absent}</div></div>
            <div className="portal-fig"><div className="portal-fig__label">Leave</div><div className="portal-fig__value">{d.attendance.totals.leave}</div></div>
          </div>
        ) : <Muted>No attendance marked yet.</Muted>}
      </Card>

      <Card icon="edit" title="Homework" sub={ov.data ? `${openHw} open` : undefined}>
        {ov.isLoading ? <Skeleton height={100} /> : hw.length ? (
          <div className="portal-list">
            {hw.map((h) => (
              <Item key={h.id} icon={h.submitted ? 'check' : 'edit'} tone={h.submitted ? 'success' : undefined} title={h.title}
                meta={`${h.subject} · due ${fmt.dateShort(h.dueOn)}`} end={<Badge tone={h.submitted ? 'success' : 'info'}>{h.submitted ? 'Submitted' : 'Open'}</Badge>} />
            ))}
          </div>
        ) : <Muted>No homework set at the moment.</Muted>}
      </Card>

      <Card icon="trending" title="Subject performance">
        {d.academics.subjects.length ? (
          <div className="portal-list">
            {d.academics.subjects.map((s) => (
              <Item key={s.name} title={s.name} meta={s.teacher ?? undefined} endCol end={<>
                <span className="t-bold t-num">{s.score} <span className="t-xs t-muted">· {s.grade}</span></span>
                {s.trend != null && <span className={`t-micro ${s.trend >= 0 ? 't-success' : 't-critical'}`}>{s.trend >= 0 ? '+' : ''}{s.trend}</span>}
              </>} />
            ))}
          </div>
        ) : <Muted>No results yet.</Muted>}
      </Card>

      <Card icon="grid" title="Recent assessments">
        {d.academics.assessments.length ? (
          <div className="portal-list">
            {d.academics.assessments.slice(0, 5).map((a) => (
              <Item key={a.code} title={a.name} meta={`${fmt.dateShort(a.heldOn)} · ${a.maxMarks} marks`}
                end={a.isAbsent ? <Badge tone="critical">Absent</Badge> : <span className="t-bold t-num">{a.marks ?? '—'}</span>} />
            ))}
          </div>
        ) : <Muted>No assessment results yet.</Muted>}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
interface FamilySafety {
  bus: { busLocation: { latitude: number; longitude: number; recordedAt: string } | null } | null;
}

function SafetyTab({ pid, child, onTab }: { pid: string; child: ChildRow; onTab: (t: Tab) => void }) {
  const ov = useApiQuery<Overview>(overviewPath(pid, child.id), undefined, { refetchInterval: 60_000 });
  const extra = useApiQuery<FamilySafety>(`/family/children/${child.id}/safety`, undefined, { refetchInterval: 60_000 });
  const loc = useApiQuery<CurrentLocation>(`/parents/${pid}/children/${child.id}/location`);
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ personName: '', relation: '', phone: '', method: 'OTP + ID' });
  const addPickup = useApiMutation<typeof form>('post', `/family/children/${child.id}/pickup`, {
    invalidate: [`/parents/${pid}/children/${child.id}`, `/family/children/${child.id}`], success: 'Request sent to the school office for verification',
    onSuccess: () => { setAdding(false); setForm({ personName: '', relation: '', phone: '', method: 'OTP + ID' }); },
  });
  const pickupAction = useApiMutation<{ id: string; action: 'confirm' | 'revoke' }>('post', (v) => `/family/children/${child.id}/pickup/${v.id}/${v.action}`, {
    invalidate: [`/parents/${pid}/children/${child.id}`, `/family/children/${child.id}`],
    success: (_r, v) => (v.action === 'confirm' ? 'Pickup person confirmed' : 'Pickup authorisation revoked'), body: () => ({}),
  });

  if (ov.isLoading) return <Skeleton height={300} />;
  if (ov.error || !ov.data) return <ErrorState error={ov.error} onRetry={() => ov.refetch()} />;
  const d = ov.data;
  const events = [
    ...d.gateToday.map((g) => ({ at: g.occurredAt, title: `${g.direction === 'in' ? 'Gate entry' : 'Gate exit'} — ${g.gate}`, tone: 'teal' })),
    ...(d.bus?.boardingToday ?? []).map((b) => ({ at: b.at, title: b.type === 'boarded' ? `Boarded ${d.bus?.busNo ?? 'the bus'}` : `Exited ${d.bus?.busNo ?? 'the bus'}`, tone: 'amber' })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const entry = d.gateToday.find((g) => g.direction === 'in');
  const phoneOk = /^\+?[0-9 ]{8,16}$/.test(form.phone);

  return (
    <>
      <div className="grid g-2col">
        <Card icon="grid" title="Arrival today">
          <Item icon={entry ? 'shieldCheck' : 'clock'} tone={entry ? 'success' : undefined}
            title={entry ? 'Child arrived safely' : 'Not yet at school today'}
            meta={entry ? `${entry.gate} · ${fmt.time(entry.occurredAt)} · ${entry.method} verified` : 'Gate entry will appear here'} />
          {events.length > 0 && <div className="mt-4"><Timeline items={events.map((e) => ({ time: fmt.time(e.at), title: e.title, tone: e.tone }))} /></div>}
        </Card>

        <div className="portal-stack">
          <Card icon="bus" title="Live location" actions={<LinkAction onClick={() => onTab('track')}>Open map</LinkAction>}>
            {loc.data ? (
              <Item icon="mapPin" tone="brand" title={loc.data.placeLabel ?? loc.data.locationStatusLabel}
                meta={loc.data.recordedAt ? `Updated ${fmt.time(loc.data.recordedAt)}` : 'No location yet'}
                end={<TrackingStatusPill status={loc.data.displayStatus} />} />
            ) : loc.error ? <Muted>Location is not available.</Muted> : <Skeleton height={36} />}
          </Card>

          {d.bus && (
            <Card icon="bus" title={`${d.bus.busNo ?? 'Bus'} — ${d.bus.routeName}`} actions={<Status value={d.bus.runStatus} />}>
              <div className="t-sm t-bold">{d.bus.runStatus === 'Delayed' ? `Running ${d.bus.delayMinutes} min late` : d.bus.eta ? `ETA ${d.bus.eta}` : d.bus.runStatus}</div>
              <div className="t-xs t-muted mt-1">Driver {d.bus.driver ?? '—'}{d.bus.attendant ? ` · Attendant ${d.bus.attendant}` : ''}</div>
              {extra.data?.bus?.busLocation && <div className="t-xs t-muted mt-1">Bus position updated {fmt.time(extra.data.bus.busLocation.recordedAt)}</div>}
              <div className="t-xs t-muted mt-1">Stop {d.bus.stopName ?? '—'} · pickup {hhmm(d.bus.pickupTime)} · drop {hhmm(d.bus.dropTime)}</div>
            </Card>
          )}
        </div>

        <Card title="Pickup authorisation" sub="People allowed to collect your child from school" className="span-2"
          actions={<Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add person</Button>}>
          {d.pickup.length ? (
            <div className="portal-list">
              {d.pickup.map((p) => (
                <Item key={p.id} wrap lead={<Avatar name={p.personName} size="sm" />} title={p.personName} meta={`${p.relation} · ${p.method}`}
                  end={<>
                    <Status value={p.status} />
                    {p.status === 'Pending' && <Button size="sm" variant="teal" onClick={() => pickupAction.mutate({ id: p.id, action: 'confirm' })}>Confirm</Button>}
                    <Button size="sm" variant="quiet" icon="x" onClick={async () => {
                      if (await confirm({ title: 'Revoke pickup authorisation?', body: `${p.personName} will no longer be allowed to collect ${child.firstName}.`, confirmLabel: 'Revoke', danger: true })) {
                        pickupAction.mutate({ id: p.id, action: 'revoke' });
                      }
                    }}>Revoke</Button>
                  </>} />
              ))}
            </div>
          ) : (
            <Empty icon="users" title="No authorised pickup persons" sub="Add a grandparent, driver or relative so the gate can verify them."
              action={<Button icon="plus" onClick={() => setAdding(true)}>Add person</Button>} />
          )}
        </Card>
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a pickup person" sub="The school office verifies every new person before the first pickup." busy={addPickup.isPending}
        foot={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" loading={addPickup.isPending} disabled={form.personName.trim().length < 2 || form.relation.trim().length < 2 || !phoneOk} onClick={() => addPickup.mutate(form)}>Send for verification</Button></>}>
        <div className="col g-3">
          <TextField label="Full name" required value={form.personName} onChange={(v) => setForm({ ...form, personName: v })} maxLength={120} autoFocus />
          <TextField label="Relationship" required value={form.relation} onChange={(v) => setForm({ ...form, relation: v })} placeholder="Grandfather, driver…" maxLength={40} />
          <TextField label="Mobile" required type="tel" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} error={form.phone && !phoneOk ? 'Enter a valid phone number' : undefined} />
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
interface FamilyFees {
  summary: { billed: number; paid: number; outstanding: number; nextDue: string | null };
  lines: { id: string; description: string; head: string; amountDue: number; concession: number; amountPaid: number; balance: number; dueDate: string; status: string }[];
  payments: { id: string; receiptNo: string; amount: number; method: string; paidAt: string; status: string }[];
}
interface FamilyReceipt {
  id: string; receiptNo: string; amount: number; method: string; gatewayRef: string | null; status: string; paidAt: string; paidBy: string | null;
  academicYear: string | null; student: { fullName: string; admissionNo: string; grade: string | null; section: string | null; campus: string };
  lines: { feeId: string; description: string; head: string; amount: number }[];
}

function FeesTab({ child, autoPay, onAutoPayDone }: { child: ChildRow; autoPay: boolean; onAutoPayDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const q = useApiQuery<FamilyFees>(`/family/children/${child.id}/fees`);
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState<'UPI' | 'Card' | 'Net Banking'>('UPI');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [receipt, setReceipt] = useState<{ receiptNo: string; amount: number; method: string; paidAt: string; gatewayRef?: string } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const pay = useApiMutation<{ amount: number; method: string; feeIds: string[] }, { receiptNo: string; amount: number; method: string; paidAt: string; gatewayRef?: string }>(
    'post', `/family/children/${child.id}/fees/pay`, {
      invalidate: [`/family/children/${child.id}`, '/parents', '/notifications'],
      success: false,
      onSuccess: (r) => { setPaying(false); setReceipt(r.data); },
    });

  const open = useMemo(() => (q.data?.lines ?? []).filter((l) => l.balance > 0), [q.data]);
  useEffect(() => setSelected(new Set(open.map((l) => l.id))), [open]);
  const total = open.filter((l) => selected.has(l.id)).reduce((a, l) => a + l.balance, 0);

  // "Pay now" from the header or home tab opens the payment sheet directly.
  useEffect(() => {
    if (!autoPay || !q.data) return;
    if (q.data.summary.outstanding > 0) setPaying(true);
    onAutoPayDone();
  }, [autoPay, q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <Skeleton height={300} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;

  return (
    <>
      <div className="grid g-side">
        <div className="portal-stack">
          <Card icon="wallet" title="Total outstanding">
            <div className={cx('portal-amount', d.summary.outstanding > 0 ? 'portal-amount--due' : 'portal-amount--clear')}>{fmt.money(d.summary.outstanding)}</div>
            <div className="t-xs t-muted mt-1">{d.summary.nextDue ? `Next instalment due ${fmt.date(d.summary.nextDue)}` : 'All dues cleared'}</div>
            <div className="t-xs t-muted mt-1">Billed {fmt.money(d.summary.billed)} · paid {fmt.money(d.summary.paid)}</div>
            {d.summary.outstanding > 0 && <div className="mt-4"><Button variant="teal" block icon="creditCard" onClick={() => setPaying(true)}>{t('Pay Now')}</Button></div>}
          </Card>
          <Card icon="wallet" title="Receipts">
            {d.payments.length ? (
              <div className="portal-list">
                {d.payments.map((p) => (
                  <Item key={p.id} icon="receipt" tone="success" title={p.receiptNo} meta={`Paid ${fmt.date(p.paidAt)} · ${p.method}`}
                    end={<span className="t-bold t-num">{fmt.money(p.amount)}</span>} onClick={() => setViewing(p.id)} />
                ))}
              </div>
            ) : <Muted>No payments yet. Receipts appear here after each payment.</Muted>}
          </Card>
        </div>

        <Card icon="grid" title="Account breakdown" sub="Every charge for this academic year">
          {d.lines.length ? (
            <div className="portal-list">
              {d.lines.map((l) => (
                <Item key={l.id} title={l.description} meta={`Due ${fmt.date(l.dueDate)}${l.concession ? ` · concession ${fmt.money(l.concession)}` : ''}`} endCol
                  end={<><span className="t-sm t-bold t-num">{fmt.money(l.amountDue - l.concession)}</span><Status value={l.status} /></>} />
              ))}
            </div>
          ) : <Muted>No charges this year.</Muted>}
        </Card>
      </div>

      <Modal open={paying} onClose={() => setPaying(false)} title="Pay fees" sub={`${child.fullName} · ${child.grade}${child.section}`} busy={pay.isPending}
        foot={<><Button onClick={() => setPaying(false)} disabled={pay.isPending}>Cancel</Button><Button variant="teal" icon="lock" loading={pay.isPending} disabled={!total}
          onClick={() => pay.mutate({ amount: total, method, feeIds: [...selected] }, { onError: (e) => toast(e.message, 'critical') })}>Pay {fmt.money(total)}</Button></>}>
        <div className="col g-3">
          <div className="portal-paybox">
            {open.map((l) => (
              <label className="portal-payline check" key={l.id}>
                <span className="row g-2">
                  <input type="checkbox" checked={selected.has(l.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(l.id); else n.delete(l.id); return n; })} />
                  <span className="t-sm">{l.description}</span>
                </span>
                <span className="t-bold t-num">{fmt.money(l.balance)}</span>
              </label>
            ))}
            <div className="portal-paytotal"><span className="t-sm t-bold">Total</span><span className="h2 t-num">{fmt.money(total)}</span></div>
          </div>
          <div className="eyebrow mt-2">Payment method</div>
          <div className="col g-2">
            {(['UPI', 'Card', 'Net Banking'] as const).map((m) => (
              <label className="portal-method" key={m}>
                <input type="radio" name="pm" checked={method === m} onChange={() => setMethod(m)} />
                <Icon name={m === 'UPI' ? 'zap' : m === 'Card' ? 'creditCard' : 'building'} size={15} /> <span className="t-sm">{m}</span>
              </label>
            ))}
          </div>
          <Banner tone="neutral" icon="info">No payment gateway is connected in this environment. The payment is simulated and recorded; a real gateway plugs into the same flow.</Banner>
        </div>
      </Modal>

      <Modal open={!!receipt} onClose={() => setReceipt(null)} title="Payment successful" foot={<Button variant="primary" onClick={() => setReceipt(null)}>Done</Button>}>
        {receipt && (
          <>
            <div className="portal-done">
              <div className="portal-done__ico"><Icon name="check" size={28} /></div>
              <div className="h2 mt-4">{fmt.money(receipt.amount)} paid</div>
              <p className="t-sm t-muted mt-2">Receipt {receipt.receiptNo} issued. A copy has been queued to your registered WhatsApp number.</p>
            </div>
            <dl className="dl">
              <dt>Paid on</dt><dd>{fmt.dateTime(receipt.paidAt)}</dd>
              <dt>Method</dt><dd>{receipt.method}</dd>
              {receipt.gatewayRef && (<><dt>Reference</dt><dd>{receipt.gatewayRef}</dd></>)}
              <dt>Student</dt><dd>{child.fullName} · {child.admissionNo}</dd>
            </dl>
          </>
        )}
      </Modal>

      {viewing && <ReceiptModal paymentId={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

/** A past receipt, loaded from the family receipts endpoint, ready to print. */
function ReceiptModal({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
  const q = useApiQuery<FamilyReceipt>(`/family/receipts/${paymentId}`);
  const r = q.data;
  return (
    <Modal open onClose={onClose} title={r ? `Receipt ${r.receiptNo}` : 'Receipt'} sub={r ? `${r.student.fullName} · ${r.student.admissionNo}` : undefined}
      foot={<><Button onClick={onClose}>Close</Button><Button variant="primary" icon="printer" disabled={!r} onClick={() => window.print()}>Print</Button></>}>
      {q.isLoading ? <Skeleton height={160} /> : q.error || !r ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <div className="portal-done">
            <div className="h2">{fmt.money(r.amount)}</div>
            <p className="t-sm t-muted mt-1">{r.status} · {r.method}</p>
          </div>
          <dl className="dl">
            <dt>Paid on</dt><dd>{fmt.dateTime(r.paidAt)}</dd>
            {r.paidBy && (<><dt>Paid by</dt><dd>{r.paidBy}</dd></>)}
            {r.gatewayRef && (<><dt>Reference</dt><dd>{r.gatewayRef}</dd></>)}
            <dt>Class</dt><dd>{r.student.grade ?? '—'} {r.student.section ?? ''} · {r.student.campus}</dd>
            {r.academicYear && (<><dt>Academic year</dt><dd>{r.academicYear}</dd></>)}
          </dl>
          {r.lines.length > 0 && (
            <div className="portal-list mt-4">
              {r.lines.map((l) => <Item key={l.feeId} title={l.description} meta={l.head} end={<span className="t-bold t-num">{fmt.money(l.amount)}</span>} />)}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
interface FamilyPtm { id: string; teacher: string; subjectLabel: string; sessionDate: string; startsAt: string; slotMinutes: number; totalSlots: number; freeSlots: number[]; myBooking?: { id: string; slotNo: number; status: string } | null }
interface Thread { id: string; subject: string; lastMessageAt: string; status: string; studentName?: string | null; unread?: boolean }

function MoreTab({ child, autoCompose, onAutoComposeDone }: { child: ChildRow; autoCompose: string | null; onAutoComposeDone: () => void }) {
  const { setLang, langs, lang } = useI18n();
  const ptm = useApiQuery<FamilyPtm[]>('/family/ptm', { studentId: child.id });
  const circulars = useApiQuery<FamilyCircular[]>('/family/circulars');
  const threads = useApiQuery<Thread[]>('/family/messages');
  const [booking, setBooking] = useState<FamilyPtm | null>(null);
  const [composing, setComposing] = useState(false);
  const [msg, setMsg] = useState({ subject: '', body: '' });
  const [openCircular, setOpenCircular] = useState<FamilyCircular | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  const ack = useApiMutation<string>('post', (id) => `/family/circulars/${id}/acknowledge`, { invalidate: ['/family/circulars', '/tasks'], success: 'Acknowledged — recorded against your child', body: () => ({}) });
  const book = useApiMutation<{ sessionId: string; slotNo: number }>('post', (v) => `/family/ptm/${v.sessionId}/book`, {
    invalidate: ['/family/ptm', '/tasks'], body: (v) => ({ studentId: child.id, slotNo: v.slotNo }), success: 'PTM slot booked', onSuccess: () => setBooking(null),
  });
  const cancel = useApiMutation<string>('post', (id) => `/family/ptm/bookings/${id}/cancel`, { invalidate: ['/family/ptm'], success: 'Booking cancelled', body: () => ({}) });
  const send = useApiMutation<typeof msg>('post', '/family/messages', {
    invalidate: ['/family/messages'], body: (v) => ({ ...v, studentId: child.id }), success: 'Message sent to the class teacher',
    onSuccess: () => { setComposing(false); setMsg({ subject: '', body: '' }); },
  });
  const pending = circulars.data?.filter((c) => c.requiresAck && !c.acknowledged).length ?? 0;

  // "Message teacher" from the header opens the composer directly.
  useEffect(() => {
    if (!autoCompose) return;
    setComposing(true);
    onAutoComposeDone();
  }, [autoCompose]); // eslint-disable-line react-hooks/exhaustive-deps

  const slotTime = (s: FamilyPtm, n: number) => {
    const [h, m] = s.startsAt.split(':').map(Number);
    const mins = h * 60 + m + (n - 1) * s.slotMinutes;
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  };

  return (
    <>
      <div className="grid g-2col">
        <Card icon="bell" title="Circulars" sub={pending ? `${pending} need your acknowledgement` : 'Notices from the school'}>
          {circulars.error ? <Muted>Circulars are not available right now.</Muted> : circulars.isLoading ? <Skeleton height={80} /> : circulars.data?.length ? (
            <div className="portal-list">
              {circulars.data.slice(0, 6).map((c) => (
                <Item key={c.id} wrap icon="fileText" tone={c.requiresAck && !c.acknowledged ? 'warning' : undefined}
                  title={<button type="button" className="portal-titlebtn" onClick={() => setOpenCircular(c)}>{c.title}</button>}
                  meta={`${fmt.date(c.publishedAt)} · ${c.audience}`}
                  end={c.requiresAck ? (c.acknowledged ? <Badge tone="success" icon="check">Acknowledged</Badge> : <Button size="sm" variant="primary" onClick={() => ack.mutate(c.id)} loading={ack.isPending && ack.variables === c.id}>Acknowledge</Button>) : <Button size="sm" variant="quiet" onClick={() => setOpenCircular(c)}>Read</Button>} />
              ))}
            </div>
          ) : <Muted>No circulars yet. School notices will appear here.</Muted>}
        </Card>

        <Card icon="calendar" title="Parent–teacher meetings">
          {ptm.error ? <Muted>PTM booking is not available right now.</Muted> : ptm.isLoading ? <Skeleton height={80} /> : ptm.data?.length ? (
            <div className="portal-list">
              {ptm.data.map((p) => (
                <Item key={p.id} wrap lead={<DateChip date={p.sessionDate} />} title={p.teacher}
                  meta={<>{p.subjectLabel} · {fmt.date(p.sessionDate)} · <span className={p.myBooking ? 't-success' : p.freeSlots.length ? undefined : 't-critical'}>
                    {p.myBooking ? `Booked ${slotTime(p, p.myBooking.slotNo)}` : `${p.freeSlots.length} of ${p.totalSlots} slots left`}</span></>}
                  end={p.myBooking ? (
                    <Button size="sm" loading={cancel.isPending && cancel.variables === p.myBooking.id} onClick={async () => {
                      if (await confirm({ title: 'Cancel this PTM booking?', body: `Your ${slotTime(p, p.myBooking!.slotNo)} slot with ${p.teacher} is released for other parents.`, confirmLabel: 'Cancel booking', cancelLabel: 'Keep booking', danger: true })) {
                        cancel.mutate(p.myBooking!.id);
                      }
                    }}>Cancel</Button>
                  ) : (
                    <Button size="sm" variant={p.freeSlots.length ? 'primary' : 'ghost'} disabled={!p.freeSlots.length} onClick={() => setBooking(p)}>{p.freeSlots.length ? 'Book slot' : 'Full'}</Button>
                  )} />
              ))}
            </div>
          ) : <Muted>No PTM sessions are open for booking.</Muted>}
        </Card>

        <Card title="Messages" actions={<Button size="sm" icon="plus" onClick={() => setComposing(true)}>New message</Button>}>
          {threads.error ? <Muted>Messaging is not available right now.</Muted> : threads.isLoading ? <Skeleton height={80} /> : threads.data?.length ? (
            <div className="portal-list">
              {threads.data.slice(0, 5).map((th) => (
                <Item key={th.id} icon="message" tone={th.unread ? 'brand' : undefined} title={th.subject} meta={fmt.relative(th.lastMessageAt)} end={<Status value={th.status} />} />
              ))}
            </div>
          ) : <Muted>No conversations yet. Messages you send to the class teacher appear here.</Muted>}
        </Card>

        <Card icon="building" title="Contact the school">
          <div className="portal-list">
            <Item icon="message" title="Message class teacher" onClick={() => setComposing(true)} />
            <Item icon="calendar" title="Report an absence" meta="Lets the class teacher know in advance" onClick={() => { setMsg({ subject: `Absence — ${child.firstName}`, body: '' }); setComposing(true); }} />
            <Item icon="globe" title="Language" end={
              <div className="segment">
                {langs.map((l) => <button key={l.id} type="button" aria-pressed={l.id === lang} onClick={() => { setLang(l.id); toast(l.label, 'success', 'globe'); }}>{l.short}</button>)}
              </div>
            } />
          </div>
        </Card>
      </div>

      <Modal open={!!booking} onClose={() => setBooking(null)} title="Book a PTM slot" sub={booking ? `${booking.teacher} · ${fmt.date(booking.sessionDate)}` : undefined} busy={book.isPending}
        foot={<Button onClick={() => setBooking(null)}>Close</Button>}>
        {booking && (
          <>
            <div className="grid g-3col g-2">
              {Array.from({ length: booking.totalSlots }, (_, i) => i + 1).map((n) => {
                const free = booking.freeSlots.includes(n);
                return (
                  <Button key={n} disabled={!free || book.isPending} onClick={() => book.mutate({ sessionId: booking.id, slotNo: n })}>
                    {slotTime(booking, n)}{free ? '' : ' · taken'}
                  </Button>
                );
              })}
            </div>
            <div className="mt-4"><Banner tone="neutral" icon="clock">Slots are {booking.slotMinutes} minutes. You will receive a reminder the evening before.</Banner></div>
          </>
        )}
      </Modal>

      <Modal open={composing} onClose={() => setComposing(false)} title="Message the class teacher" sub={`About ${child.fullName}`} busy={send.isPending}
        foot={<><Button onClick={() => setComposing(false)}>Cancel</Button><Button variant="primary" icon="send" loading={send.isPending}
          disabled={msg.subject.trim().length < 3 || msg.body.trim().length < 3} onClick={() => send.mutate({ subject: msg.subject.trim(), body: msg.body.trim() })}>Send</Button></>}>
        <div className="col g-3">
          <TextField label="Subject" required value={msg.subject} onChange={(v) => setMsg({ ...msg, subject: v })} maxLength={160} autoFocus />
          <TextArea label="Message" required value={msg.body} onChange={(v) => setMsg({ ...msg, body: v })} rows={5} maxLength={2000} hint="At least 3 characters. The teacher usually replies within a school day." />
        </div>
      </Modal>

      <Modal open={!!openCircular} onClose={() => setOpenCircular(null)} title={openCircular?.title ?? ''} sub={openCircular ? `${fmt.date(openCircular.publishedAt)} · ${openCircular.audience}` : undefined}
        foot={openCircular?.requiresAck && !openCircular.acknowledged
          ? <Button variant="primary" icon="check" onClick={() => { ack.mutate(openCircular.id); setOpenCircular(null); }}>Acknowledge</Button>
          : <Button onClick={() => setOpenCircular(null)}>Close</Button>}>
        <p className="t-sm pre-wrap">{openCircular?.body ?? 'Open the circular from the school notice to read the full text.'}</p>
      </Modal>
    </>
  );
}
