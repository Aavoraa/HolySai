import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import {
  Badge, Banner, Button, Card, Checkbox, DataTable, Empty, ErrorState, Grid, Icon, Kpi, Page, PageHead, PageSkeleton, SelectField,
  Skeleton, StudentLink, TextArea, TextField, Timeline,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { LastSeen } from '@/components/tracking/devices';
import { BusFleetMap } from './BusMap';
import { FormModal, gradeOf, LiveBadge, POLL_MS, runTone, TimeCell, TRANSPORT_KEYS, useFieldErrors } from './shared';
import { RUN_STATUSES, type RouteDetail, type RouteRow, type RoutesResponse } from './types';

const busLabel = (r: Pick<RouteRow, 'busNo' | 'code'>) => r.busNo ?? r.code;

const ALERT_RANK = (r: RouteRow) => (r.alerts.some((a) => a.tone === 'critical') ? 0 : r.runStatus === 'Maintenance' ? 1 : r.runStatus === 'Delayed' || r.alerts.length ? 2 : 3);

export default function BusTrackingPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const [sp, setSp] = useSearchParams();
  const manage = can('transport.manage');
  const list = useApiQuery<RoutesResponse>('/transport/routes', campusParam, { refetchInterval: POLL_MS });
  const routes = list.data?.routes ?? [];
  const code = sp.get('route');
  const selected = routes.find((r) => r.code === code) ?? routes.find((r) => r.alerts.some((a) => a.tone === 'critical')) ?? routes[0];
  const select = (id: string) => {
    const r = routes.find((x) => x.id === id);
    if (r) setSp({ route: r.code }, { replace: true });
  };
  const detail = useApiQuery<RouteDetail>(selected ? `/transport/routes/${selected.id}` : null, undefined, { refetchInterval: POLL_MS });
  const [modal, setModal] = useState<'status' | 'notify' | null>(null);

  const d = detail.data?.id === selected?.id ? detail.data : undefined;
  const totalStudents = routes.reduce((a, r) => a + r.students, 0);
  // Buses that need attention first (critical alert, out of service, delayed), then the rest in their usual order.
  const ordered = routes.map((r, i) => ({ r, i })).sort((a, b) => ALERT_RANK(a.r) - ALERT_RANK(b.r) || a.i - b.i).map((x) => x.r);
  const critical = routes.filter((r) => r.alerts.some((a) => a.tone === 'critical'));
  const sum = list.data?.summary;

  return (
    <Page>
      <PageHead
        title="Bus Tracking"
        sub="Live location, ETA, onboard count and deviation alerts. Parents see the same position for their own child's bus."
        actions={
          <>
            {list.data && <span className="illustrative"><span className="dot dot--success dot--pulse" />Updated {fmt.time(list.data.generatedAt)}</span>}
            <Button icon="refresh" onClick={() => { list.refetch(); if (selected) detail.refetch(); }} loading={list.isFetching}>Refresh</Button>
            <Button icon="route" to="/routes">Route planner</Button>
            {manage && selected && <Button variant="primary" icon="megaphone" onClick={() => setModal('notify')}>Notify route parents</Button>}
          </>
        }
      />
      {list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isLoading ? <PageSkeleton kpis={4} /> : !routes.length ? (
        <Card><Empty icon="bus" title="No routes for this campus" sub="Add a route in the route planner to start tracking buses." action={<Button to="/routes" icon="route">Open route planner</Button>} /></Card>
      ) : (
        <>
          {critical.length > 0 && (
            <div className="mb-4">
              <Banner tone="critical" icon="alert">
                <strong>{critical.length === 1 ? '1 bus needs attention now' : `${critical.length} buses need attention now`}</strong>
                <ul className="st-banner-list">
                  {critical.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="st-linkbtn" onClick={() => select(r.id)}>{busLabel(r)} · {r.area}</button>
                      {' — '}{r.alerts.filter((a) => a.tone === 'critical').map((a) => a.message).join(' · ')}
                    </li>
                  ))}
                </ul>
              </Banner>
            </div>
          )}

          {sum && (
            <>
              <Grid cols="g-4col">
                <Kpi label="Buses moving" value={fmt.n(sum.moving)} unit={`/ ${fmt.n(sum.buses)}`} tone="info" icon="bus" foot={`${sum.atCampus} at campus`} />
                <Kpi label="Students onboard" value={fmt.n(sum.onboardNow)} tone="teal" icon="users" foot={`${fmt.n(sum.students)} students on routes`} />
                <Kpi label="Delayed" value={fmt.n(sum.delayed)} tone="amber" icon="clock" foot={sum.delayed ? 'Parents can be notified per route' : 'All running buses on time'} />
                <Kpi label="Alerts" value={fmt.n(sum.alerts)} tone={sum.alerts ? 'critical' : 'teal'} icon="alert" foot={sum.alerts ? 'Deviation, speed or delay alerts' : 'No active alerts'} />
              </Grid>
              <div className="statgrid statgrid--card mt-3 mb-4">
                <Kpi size="compact" label="At campus" value={fmt.n(sum.atCampus)} />
                <Kpi size="compact" label="Out of service" value={fmt.n(sum.maintenance)} tone={sum.maintenance ? 'critical' : undefined} />
                <Kpi size="compact" label="Buses on file" value={fmt.n(sum.buses)} />
              </div>
            </>
          )}

          <div className="st-split">
            <Card icon="bus" title="Buses" sub={`${routes.length} buses · ${totalStudents} students · attention first`} flush actions={<LiveBadge at={list.data?.generatedAt} />}>
              <ul className="st-list" aria-label="Buses">
                {ordered.map((x) => {
                  const crit = x.alerts.some((a) => a.tone === 'critical');
                  const tone = crit ? 'critical' : x.runStatus === 'Delayed' || x.runStatus === 'Maintenance' ? 'warning' : '';
                  return (
                    <li key={x.id} className={`st-item${tone ? ` st-item--${tone}` : ''}`} aria-current={x.id === selected?.id || undefined}>
                      <button type="button" className="st-item__main" onClick={() => select(x.id)}>
                        <span className="st-item__top">
                          <span className="st-item__name">{busLabel(x)}<span className="st-item__sub">{x.area}</span></span>
                          {x.location ? <LastSeen at={x.location.recordedAt} /> : <span className="st-seen">No GPS yet</span>}
                        </span>
                        <span className="st-item__meta">
                          <Badge tone={runTone(x.runStatus)} dot>{x.runStatus}</Badge>
                          <span className="t-num">{x.onboardNow || x.boardedToday}/{x.students} {x.onboardNow ? 'onboard' : 'boarded'}</span>
                          {x.eta && <span>ETA {x.eta}</span>}
                        </span>
                        {x.alerts.length > 0 && (
                          <span className={crit ? 'st-item__alert' : 'st-item__meta'}>
                            {crit && <Icon name="alert" size={12} />} {x.alerts.map((a) => a.message).join(' · ')}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>

            {selected && (
              <div className="st-split__map col g-4">
                <Card
                  title={`${busLabel(selected)}${selected.registrationNo ? ` · ${selected.registrationNo}` : ''}`}
                  sub={`${selected.name} · ${selected.area} · ${selected.stops} stops · driver ${selected.driverName ?? 'unassigned'} · attendant ${selected.attendantName ?? 'none'}`}
                  actions={
                    <>
                      <Badge tone={runTone(selected.runStatus)} dot>{selected.runStatus}</Badge>
                      {manage && <Button size="sm" icon="edit" onClick={() => setModal('status')}>Update status</Button>}
                    </>
                  }
                >
                  <div className="st-mapwrap">
                    <BusFleetMap routes={routes} campuses={list.data!.campuses} selectedId={selected.id} onSelect={select}
                      trail={d?.trail ?? []} stops={d?.stopList} />
                    {selected.alerts.some((a) => a.type !== 'delay') && (
                      <div className="st-mapalerts" role="status">
                        {selected.alerts.filter((a) => a.type !== 'delay').map((a) => (
                          <Badge key={a.type} tone={a.tone} icon={a.tone === 'critical' ? 'alert' : undefined} dot={a.tone !== 'critical'} lg>{a.message}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <dl className="st-facts">
                    <div><dt>Onboard</dt><dd>{`${selected.onboardNow || selected.boardedToday}/${selected.students}`}</dd></div>
                    <div><dt>ETA</dt><dd>{selected.eta ?? '—'}</dd></div>
                    <div><dt>Stops done</dt><dd>{`${selected.stopsDone}/${selected.stops}`}</dd></div>
                    <div><dt>Delay</dt><dd className={selected.delayMinutes > 0 ? 't-critical' : undefined}>{selected.delayMinutes ? `+${selected.delayMinutes} min` : 'On time'}</dd></div>
                  </dl>
                  <div className="st-ping">
                    {selected.location ? (
                      <>
                        <span className="row g-1"><Icon name="navigation" size={12} /><LastSeen at={selected.location.recordedAt} prefix="Last GPS ping" /></span>
                        {selected.location.speedKmph != null && <span>{selected.location.speedKmph} km/h</span>}
                        <span className="coord">{fmt.coord(selected.location.latitude)}, {fmt.coord(selected.location.longitude)}</span>
                      </>
                    ) : <span>No GPS position received yet for this bus.</span>}
                  </div>
                </Card>

                <div className="grid g-2col g-4">
                  <Card icon="grid" title="Stop sequence" sub="Morning run" flush>
                    <div className="card__body">
                      {detail.error ? <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
                        : !d ? <Skeleton height={160} />
                        : !d.stopList.length ? <Empty icon="mapPin" title="No stops yet" sub="Add stops in the route planner." />
                        : <Timeline items={d.stopList.map((s) => ({
                          time: s.pickupTime, title: s.name, tone: s.done ? 'teal' : 'muted',
                          body: s.students ? `${s.boarded}/${s.students} boarded here` : '',
                        }))} />}
                    </div>
                  </Card>
                  <Card icon="grid" title="Boarding and de-boarding" sub="Confirmed by the attendant device" flush
                    actions={<Button size="sm" variant="quiet" to={`/boarding?route=${selected.code}`}>Open</Button>}>
                    {!d ? <div className="card__body"><Skeleton height={160} /></div> : (
                      <DataTable
                        compact
                        rows={d.students}
                        rowKey={(r) => r.id}
                        emptyText="No students assigned to this route."
                        columns={[
                          { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.id} name={r.fullName} meta={[gradeOf(r.grade, r.section), r.stopName].filter(Boolean).join(' · ')} /> },
                          { key: 'board', label: 'Boarded', render: (r) => r.boardedAt ? <Badge tone="success" icon="check">{fmt.time(r.boardedAt)}</Badge> : <span className="t-faint">—</span> },
                          { key: 'off', label: 'De-boarded', render: (r) => r.deboardedAt ? <Badge tone="success" icon="check">{fmt.time(r.deboardedAt)}</Badge> : <TimeCell value={null} /> },
                        ]}
                      />
                    )}
                  </Card>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {modal === 'status' && selected && <RunStatusModal route={selected} onClose={() => setModal(null)} />}
      {modal === 'notify' && selected && <NotifyModal route={selected} onClose={() => setModal(null)} />}
    </Page>
  );
}

export function RunStatusModal({ route, onClose }: { route: RouteRow; onClose: () => void }) {
  const [f, setF] = useState({ runStatus: route.runStatus as string, delayMinutes: String(route.delayMinutes || ''), etaText: '', reason: '', notifyParents: true });
  const fe = useFieldErrors();
  useEffect(() => {
    if (f.runStatus !== 'Delayed' && f.runStatus !== 'En route') setF((x) => ({ ...x, delayMinutes: '' }));
  }, [f.runStatus]);
  const save = useApiMutation<Record<string, unknown>>('patch', `/transport/routes/${route.id}/run`, { invalidate: TRANSPORT_KEYS, onSuccess: onClose });
  const delayAllowed = f.runStatus === 'Delayed' || f.runStatus === 'En route';
  const submit = () => {
    const e: Record<string, string> = {};
    const mins = Number(f.delayMinutes || 0);
    if (!Number.isInteger(mins) || mins < 0 || mins > 240) e.delayMinutes = 'Enter 0–240 minutes';
    if (f.runStatus === 'Delayed' && mins < 1) e.delayMinutes = 'Enter how many minutes late';
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({
      runStatus: f.runStatus, delayMinutes: delayAllowed ? mins : 0, notifyParents: f.notifyParents,
      ...(f.etaText.trim() ? { etaText: f.etaText.trim() } : {}),
      ...(f.reason.trim() ? { reason: f.reason.trim() } : {}),
    }, { onError: fe.fromServer });
  };
  return (
    <FormModal title={`Update ${busLabel(route)} run`} sub={`${route.name} · ${route.students} students`} onClose={onClose}
      busy={save.isPending} error={save.error} fieldErrors={fe.errors} onSubmit={submit} submitLabel="Save status">
      <div className="form-grid">
        <SelectField label="Run status" required value={f.runStatus} onChange={(v) => setF((x) => ({ ...x, runStatus: v }))} options={RUN_STATUSES} />
        <TextField label="Delay (minutes)" type="number" min={0} max={240} value={f.delayMinutes} disabled={!delayAllowed}
          required={f.runStatus === 'Delayed'} onChange={(v) => { setF((x) => ({ ...x, delayMinutes: v })); fe.clear('delayMinutes'); }} error={fe.errors.delayMinutes} />
        <TextField label="ETA text" value={f.etaText} maxLength={40} placeholder="e.g. 12 min" onChange={(v) => setF((x) => ({ ...x, etaText: v }))}
          hint="Leave blank to set it automatically" />
        <TextField label="Reason" value={f.reason} maxLength={200} placeholder="Road closure at Vallancheri" onChange={(v) => setF((x) => ({ ...x, reason: v }))} />
        <div className="span-2">
          <Checkbox checked={f.notifyParents} onChange={(v) => setF((x) => ({ ...x, notifyParents: v }))}
            label={`Notify parents on this route about delays or a cancelled run (${route.students} students)`} />
        </div>
      </div>
    </FormModal>
  );
}

function NotifyModal({ route, onClose }: { route: RouteRow; onClose: () => void }) {
  const [message, setMessage] = useState(route.delayMinutes ? `${busLabel(route)} is running about ${route.delayMinutes} minutes late. Pickup times at every stop move by the same amount.` : '');
  const fe = useFieldErrors();
  const save = useApiMutation<{ message: string }>('post', `/transport/routes/${route.id}/notify`, { onSuccess: onClose });
  return (
    <FormModal title={`Message parents on ${route.name}`} sub={`${route.students} students · in-app, WhatsApp and push`} onClose={onClose}
      busy={save.isPending} error={save.error} fieldErrors={fe.errors} submitLabel="Send to parents" submitIcon="send"
      onSubmit={() => {
        if (message.trim().length < 5) return fe.setErrors({ message: 'Write a short message (at least 5 characters)' });
        save.mutate({ message: message.trim() }, { onError: fe.fromServer });
      }}>
      <Banner icon="info">Only the guardians of students assigned to this route receive the message.</Banner>
      <div className="mt-4">
        <TextArea label="Message" required rows={4} maxLength={500} value={message} onChange={(v) => { setMessage(v); fe.clear('message'); }} error={fe.errors.message} />
      </div>
    </FormModal>
  );
}
