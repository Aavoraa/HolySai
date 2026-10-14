import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiQuery, usePagedQuery } from '@/hooks/useApi';
import {
  Avatar, Button, Card, Chart, charts, DataTable, Empty, ErrorState, Grid, Icon, Kpi, Page, PageHead, PageSkeleton, Skeleton, Status,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { GateEventModal, incidentRowClass, LiveBadge, POLL_MS, SeverityBadge, UnauthorisedModal } from './shared';
import type { FeedItem, GateSummary, Incident, PickupAuth } from './types';

export default function SmartGatePage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const summary = useApiQuery<GateSummary>('/gate/summary', campusParam, { refetchInterval: POLL_MS });
  const feed = useApiQuery<FeedItem[]>('/gate/feed', campusParam, { refetchInterval: POLL_MS });
  const pending = usePagedQuery<PickupAuth>('/pickup/authorisations', { status: 'Pending', pageSize: 4, sort: 'created', dir: 'desc', ...campusParam });
  const incidents = usePagedQuery<Incident>('/incidents', { pageSize: 5, sort: 'date', dir: 'desc', ...campusParam });
  const [modal, setModal] = useState<'gate' | 'unauthorised' | null>(null);
  const manage = can('safety.manage');
  const s = summary.data;
  // Critical events (held collections, unauthorised attempts, alarms) are pinned above the routine feed.
  const criticalFeed = (feed.data ?? []).filter((i) => i.tone === 'critical');
  const routineFeed = (feed.data ?? []).filter((i) => i.tone !== 'critical');
  const actor = (i: FeedItem) => i.actor && (i.studentId
    ? <Link to={`/student-360/${i.studentId}`} className="t-bold">{i.actor}</Link>
    : <strong>{i.actor}</strong>);

  return (
    <Page>
      <PageHead
        title="Smart Gate"
        sub="Live child safety: who has arrived, who is inside, who has left, and who is authorised to collect them."
        actions={
          <>
            {manage && <Button variant="primary" icon="scan" onClick={() => setModal('gate')}>Record entry / exit</Button>}
            <Button icon="idCard" to="/visitors">Visitor check-in</Button>
            {can(['notifications.broadcast', 'safety.manage']) && <Button variant="danger" icon="megaphone" to="/emergency">Emergency broadcast</Button>}
          </>
        }
      />

      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : summary.isLoading || !s ? <PageSkeleton kpis={4} /> : (
        <>
          <Grid cols="g-4col">
            <Kpi icon="activity" label="Arrived" value={fmt.n(s.arrived)} tone="teal" foot={`of ${fmt.n(s.expected)} expected · parents notified automatically`} to="/gate-log?status=Inside" />
            <Kpi icon="building" label="Inside campus" value={fmt.n(s.inside)} foot="Live headcount" />
            <Kpi icon="door" label="Exited" value={fmt.n(s.exited)} tone="amber" foot="Early departures and collections" to="/gate-log?status=Exited" />
            <Kpi icon="door" label="Pending pickup" value={fmt.n(s.pendingPickup)} tone={s.pendingPickup ? 'critical' : undefined}
              foot="Sick bay or held collections" to="/pickup" />
          </Grid>
          <div className="statgrid statgrid--card mt-3">
            <Kpi size="compact" label="Not yet arrived" value={fmt.n(s.notArrived)} tone={s.notArrived ? 'amber' : undefined} to="/gate-log?status=Not%20arrived" />
            <Kpi size="compact" label="Visitors on site" value={fmt.n(s.visitorsOnSite)} to="/visitors" />
            <Kpi size="compact" label="Visitors expected" value={fmt.n(s.visitorsExpected)} foot="Later today" to="/visitors" />
            <Kpi size="compact" label="Pickup persons to verify" value={fmt.n(s.pendingAuthorisations)} to="/pickup?status=Pending" />
          </div>

          <div className="grid g-main mt-4">
            <Card icon="wallet" title="Live activity feed" sub="Every entry, exit and notification, as it happens" actions={<LiveBadge at={s.generatedAt} />} flush>
              <div className="card__body">
                {feed.error ? <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
                  : feed.isLoading ? <div className="col g-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={34} />)}</div>
                  : !feed.data?.length ? <Empty icon="door" title="Nothing yet today" sub="Scans, visitors and bus arrivals appear here as they happen." />
                  : (
                    <>
                      {criticalFeed.length > 0 && (
                        <div className="st-critical-list" role="region" aria-label="Critical events">
                          {criticalFeed.map((i) => (
                            <div className="st-alertrow" key={i.id}>
                              <Icon name={i.icon || 'alert'} size={16} />
                              <div className="st-alertrow__body">
                                {actor(i)}{i.actor ? ' ' : ''}{i.text}
                                {i.meta && <div className="st-alertrow__meta">{i.meta}</div>}
                              </div>
                              <span className="st-alertrow__time">{fmt.time(i.at)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {routineFeed.map((i) => (
                        <div className="feed__item" key={i.id}>
                          <span className="feed__time">{fmt.time(i.at)}</span>
                          <span className="none"><Icon name={i.icon} size={15} className="t-muted" /></span>
                          <div className="grow">
                            <div className="t-sm">{actor(i)}{i.actor ? ' ' : ''}{i.text}</div>
                            {i.meta && <div className="t-micro t-muted">{i.meta}</div>}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
              </div>
            </Card>

            <div className="col g-4">
              <Card icon="shield" title="Gate status" sub="Main, rear and visitor gates, and the bus bay">
                <div className="col g-3">
                  {s.gates.map((g) => (
                    <div className="st-gate" key={g.gate}>
                      <span className={`dot dot--${g.tone}`} aria-hidden="true" />
                      <span className="col grow">
                        <span className="t-sm t-bold">{g.gate}</span>
                        <span className="t-micro t-muted">{g.detail}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>

              <Card icon="shield" title="Pickup verification" sub={`${s.pendingAuthorisations} authorised ${s.pendingAuthorisations === 1 ? 'person' : 'people'} awaiting verification`} flush
                actions={<Button size="sm" variant="quiet" to="/pickup">Open</Button>}>
                <div className="card__body">
                  {pending.error ? <ErrorState error={pending.error} onRetry={() => pending.refetch()} />
                    : pending.isLoading ? <Skeleton height={60} />
                    : !pending.data?.rows.length ? <Empty icon="key" title="Everyone is verified" sub="New pickup persons added by parents or the office appear here." />
                    : (
                      <div className="col g-2">
                        {pending.data.rows.map((p) => (
                          <Link key={p.id} to={`/pickup?studentId=${p.studentId}`} className="st-tile">
                            <Avatar name={p.personName} size="sm" />
                            <span className="col grow" style={{ minWidth: 0 }}>
                              <span className="t-sm t-bold t-clip">{p.personName}</span>
                              <span className="t-micro t-muted t-clip">{p.relation} · {p.method} · for {p.studentName}</span>
                            </span>
                            <Status value={p.status} />
                          </Link>
                        ))}
                      </div>
                    )}
                  {manage && (
                    <div className="mt-4">
                      <Button block variant="danger" icon="alert" onClick={() => setModal('unauthorised')}>Report unauthorised pickup</Button>
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </div>

          <div className="grid g-2col g-4 mt-4">
            <Card icon="grid" title="Arrivals through the morning" sub="Cumulative first entries, every 15 minutes">
              {s.arrivals.values.some((v) => v > 0)
                ? <Chart svg={charts.line({ labels: s.arrivals.labels, series: [{ name: 'Cumulative arrivals', values: s.arrivals.values, color: 'var(--teal)' }], height: 210 })} />
                : <Empty icon="clock" title="No arrivals yet" sub="The curve fills in as students scan in." />}
            </Card>
            <Card icon="shield" title="Incidents and audit trail" sub="Every safety event is logged and closed with an owner" flush
              actions={<Button size="sm" variant="quiet" to="/safeguarding">All incidents</Button>}>
              {incidents.error ? <ErrorState error={incidents.error} onRetry={() => incidents.refetch()} /> : (
                <DataTable
                  rows={incidents.data?.rows}
                  loading={incidents.isLoading}
                  rowKey={(r) => r.id}
                  compact
                  rowClassName={incidentRowClass}
                  emptyText="No incidents recorded."
                  columns={[
                    { key: 'code', label: 'Ref', render: (r) => <span className="t-num t-bold">{r.code}</span> },
                    { key: 'type', label: 'Type', render: (r) => r.incidentType },
                    { key: 'summary', label: 'Summary', render: (r) => <span className="row g-1">{r.isConfidential && <Icon name="lock" size={12} />}{r.summary}</span> },
                    { key: 'severity', label: 'Severity', render: (r) => <SeverityBadge value={r.severity} /> },
                    { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
                    { key: 'owner', label: 'Owner', render: (r) => r.ownerName ?? '—' },
                  ]}
                />
              )}
            </Card>
          </div>
        </>
      )}

      {modal === 'gate' && <GateEventModal onClose={() => setModal(null)} />}
      {modal === 'unauthorised' && <UnauthorisedModal onClose={() => setModal(null)} />}
    </Page>
  );
}
