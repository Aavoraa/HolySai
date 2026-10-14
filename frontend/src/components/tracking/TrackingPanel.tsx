import { useMemo, useState } from 'react';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { useAuth } from '@/auth/AuthContext';
import type { CurrentLocation, LocationHistory as History } from '@/api/types';
import { Avatar, Badge, Banner, Button, Card, Dl, Empty, ErrorState, Grid, Icon, Kpi, Segment, SelectField, Skeleton, Switch, TextField, useConfirm } from '@/components/ui';
import { HistoryMap, StudentMap } from '@/components/map/StudentMap';
import { fmt, todayKey } from '@/lib/format';
import { statusTone } from '@/lib/tones';
import { AssignDeviceModal, BatteryLevel, GpsStatusBadge, LastSeen, useUnassign } from './devices';

const STATUS_DOT: Record<string, string> = {
  'Tracking Active': 'success',
  'Tracking Paused': 'warning',
  Offline: 'critical',
  'No Location Yet': 'neutral',
  'Tracking Disabled': 'neutral',
};

export function TrackingStatusPill({ status }: { status: string }) {
  const tone = STATUS_DOT[status] ?? 'neutral';
  return (
    <span className="trackpill">
      <span className={`dot dot--${tone}${status === 'Tracking Active' ? ' dot--pulse' : ''}`} />
      {status}
    </span>
  );
}

/**
 * "Student Tracking" section: status, current location on a map, coordinates
 * and last update — the layout from the brief. `locationPath` / `historyPath`
 * point at the student or parent-scoped endpoints so the same component serves
 * staff and families without widening anyone's access.
 */
export function TrackingPanel({
  locationPath, historyPath, showHistory = true, historyNote, compact = false, refetchMs = 60_000,
}: {
  locationPath: string;
  historyPath?: string;
  showHistory?: boolean;
  historyNote?: string;
  compact?: boolean;
  refetchMs?: number;
}) {
  const { can } = useAuth();
  const q = useApiQuery<CurrentLocation>(locationPath, undefined, { refetchInterval: refetchMs });
  const [view, setView] = useState<'current' | 'history'>('current');

  if (q.isLoading) return <Card title="Student Tracking"><Skeleton height={340} /></Card>;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} title="Tracking is unavailable" />;
  const loc = q.data!;
  const hasPoint = loc.latitude != null && loc.longitude != null;
  const canHistory = showHistory && !!historyPath;

  return (
    <Card
      title="Student Tracking"
      sub={loc.isSampleData ? 'Sample GPS coordinates for development and demonstration' : `Device: ${deviceLabel(loc.deviceType)}`}
      actions={
        <>
          {loc.isSampleData && <span className="sample-note"><Icon name="info" size={12} />Sample data</span>}
          {canHistory && (
            <Segment items={[{ id: 'current', label: 'Current' }, { id: 'history', label: 'History' }]} active={view} onChange={setView} />
          )}
          <Button size="sm" icon="refresh" onClick={() => q.refetch()} aria-label="Refresh location" loading={q.isFetching} />
        </>
      }
    >
      {view === 'current' || !canHistory ? (
        <div className={compact ? 'col g-4' : 'grid g-main st-top'}>
          <div className="col g-3">
            <div className="row g-3">
              <Avatar name={loc.fullName} size="lg" src={loc.photoUrl} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t-bold">{loc.fullName}</div>
                <div className="t-xs t-muted">{loc.admissionNo} · {loc.grade}{loc.section} · {loc.campusName}</div>
              </div>
              <TrackingStatusPill status={loc.displayStatus} />
            </div>
            <div>
              <div className="eyebrow mb-2">Current Location</div>
              <StudentMap
                height={compact ? 'short' : 'default'}
                showAccuracy
                students={hasPoint ? [{ ...loc, latitude: loc.latitude!, longitude: loc.longitude! }] : []}
                campuses={[{ id: 'campus', name: loc.campusName, latitude: loc.campusLatitude, longitude: loc.campusLongitude, radiusM: 350 }]}
                fitToStudents
                emptyMessage={loc.trackingEnabled ? 'No location has been recorded for this student yet.' : 'Tracking is disabled for this student.'}
              />
            </div>
          </div>
          <div className="col g-3">
            <Dl
              items={[
                ['Student Name', loc.fullName],
                ['Student ID', loc.admissionNo],
                ['Tracking Status', <Badge key="s" tone={statusTone(loc.displayStatus)} dot>{loc.displayStatus}</Badge>],
                ['Current Location', hasPoint ? <span key="l">{loc.placeLabel ?? loc.locationStatusLabel}{loc.isStale ? <span className="t-muted"> · last known</span> : null}</span> : '—'],
                ['Status', hasPoint ? loc.locationStatusLabel : '—'],
                ['Latitude', <span key="la" className="coord">{hasPoint ? Number(loc.latitude).toFixed(4) : '—'}</span>],
                ['Longitude', <span key="lo" className="coord">{hasPoint ? Number(loc.longitude).toFixed(4) : '—'}</span>],
                ['Accuracy', loc.accuracy != null ? `± ${Math.round(loc.accuracy)} m` : '—'],
                ['GPS Device', loc.deviceCode ? <span key="d" className="row g-2 wrap"><span className="coord t-bold">{loc.deviceCode}</span><GpsStatusBadge status={loc.gpsStatus} seenAt={loc.deviceLastSeenAt} /><LastSeen at={loc.deviceLastSeenAt} prefix="Last ping" /></span> : <span key="d" className="t-muted">No device assigned</span>],
                ...(loc.speed != null ? [['Speed', `${(loc.speed * 3.6).toFixed(1)} km/h`] as [string, string]] : []),
                ['Last Updated', loc.recordedAt ? <span key="u"><strong>{fmt.time(loc.recordedAt)}</strong> <span className="t-muted">· {fmt.date(loc.recordedAt)}</span></span> : '—'],
                ['Device battery', <BatteryLevel key="b" pct={loc.batteryPct} />],
              ]}
            />
            {loc.isStale && hasPoint && loc.trackingEnabled && (
              <Banner tone="warning" icon="clock">No update for more than 30 minutes. The map shows the last known location.</Banner>
            )}
            {hasPoint && (
              <a className="btn btn--ghost btn--sm" target="_blank" rel="noopener noreferrer"
                href={`https://www.openstreetmap.org/?mlat=${loc.latitude}&mlon=${loc.longitude}#map=17/${loc.latitude}/${loc.longitude}`}>
                <Icon name="mapPin" size={14} />Open in OpenStreetMap
              </a>
            )}
            {can('tracking.manage') && <TrackingControls loc={loc} onChanged={() => q.refetch()} />}
          </div>
        </div>
      ) : (
        <LocationHistory path={historyPath!} note={historyNote} campus={{ id: 'campus', name: loc.campusName, latitude: loc.campusLatitude, longitude: loc.campusLongitude }} />
      )}
    </Card>
  );
}

function deviceLabel(d: string | null) {
  return ({ id_card_tag: 'ID-card GPS tag', wearable: 'Wearable', bus_rfid: 'Bus RFID + ID-card tag', mobile_app: 'Mobile app' } as Record<string, string>)[d ?? ''] ?? '—';
}

function TrackingControls({ loc, onChanged }: { loc: CurrentLocation; onChanged: () => void }) {
  const confirm = useConfirm();
  const [assigning, setAssigning] = useState(false);
  const unassign = useUnassign(onChanged);
  const save = useApiMutation<{ trackingEnabled?: boolean; trackingStatus?: string }>('patch', `/tracking/students/${loc.studentId}/profile`, {
    invalidate: ['/tracking', `/students/${loc.studentId}`],
    success: 'Tracking settings updated',
    onSuccess: onChanged,
  });
  return (
    <div className="st-controls">
      <div className="eyebrow">GPS device</div>
      <div className="row g-2 wrap">
        <Button size="sm" icon="qr" variant={loc.deviceCode ? undefined : 'teal'} onClick={() => setAssigning(true)}>
          {loc.deviceCode ? 'Replace device' : 'Assign device (scan QR)'}
        </Button>
        {loc.assignmentId && (
          <Button size="sm" icon="x" loading={unassign.pending}
            onClick={() => unassign.run({ id: loc.assignmentId!, deviceCode: loc.deviceCode!, admissionNo: loc.admissionNo, studentName: loc.fullName })}>
            Unassign {loc.deviceCode}
          </Button>
        )}
      </div>
      {assigning && (
        <AssignDeviceModal
          student={{ id: loc.studentId, admissionNo: loc.admissionNo, fullName: loc.fullName, grade: loc.grade, section: loc.section }}
          onClose={() => setAssigning(false)} onDone={onChanged} />
      )}
      <div className="eyebrow mt-2">Tracking settings</div>
      <Switch
        label={loc.trackingEnabled ? 'Tracking enabled' : 'Tracking disabled'}
        checked={loc.trackingEnabled}
        disabled={save.isPending}
        onChange={async (v) => {
          if (!v && !(await confirm({ title: 'Disable tracking?', body: `${loc.fullName}'s location will no longer be recorded or shown to their family until tracking is enabled again.`, confirmLabel: 'Disable tracking', danger: true }))) return;
          save.mutate({ trackingEnabled: v });
        }}
      />
      {loc.trackingEnabled && (
        <div className="row g-2 wrap">
          {loc.trackingStatus !== 'paused' ? (
            <Button size="sm" icon="clock" onClick={() => save.mutate({ trackingStatus: 'paused' })} loading={save.isPending}>Pause tracking</Button>
          ) : (
            <Button size="sm" icon="play" variant="teal" onClick={() => save.mutate({ trackingStatus: 'active' })} loading={save.isPending}>Resume tracking</Button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Location history
// ---------------------------------------------------------------------------
export function LocationHistory({ path, note, campus }: { path: string; note?: string; campus?: { id: string; name: string; latitude: number; longitude: number } }) {
  const [date, setDate] = useState(todayKey());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const q = useApiQuery<History>(path, { date, from: from || undefined, to: to || undefined });
  const invalidRange = !!(from && to && from > to);
  const points = q.data?.points ?? [];
  const last = points[points.length - 1];

  const dayOptions = useMemo(() => {
    const days = q.data?.availableDays ?? [];
    const opts = days.map((d) => ({ value: d.date, label: `${fmt.date(d.date)} · ${d.points} points` }));
    if (!opts.some((o) => o.value === date)) opts.unshift({ value: date, label: fmt.date(date) });
    return opts;
  }, [q.data, date]);

  return (
    <div className="col g-4">
      <div className="filterrow st-histfilters">
        <TextField label="Date" type="date" value={date} max={todayKey()} onChange={(v) => { setDate(v || todayKey()); setSelected(null); }} />
        <SelectField label="Days with data" value={date} onChange={(v) => { setDate(v); setSelected(null); }} options={dayOptions} />
        <TextField className="field--time" label="From" type="time" value={from} onChange={setFrom} />
        <TextField className="field--time" label="To" type="time" value={to} onChange={setTo} error={invalidRange ? 'Must be after From' : undefined} />
        {(from || to) && <Button size="sm" variant="quiet" onClick={() => { setFrom(''); setTo(''); }}>Clear time</Button>}
      </div>
      {note && <div className="t-xs t-muted">{note}</div>}
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Grid cols="g-main st-top">
          {q.isLoading ? <Skeleton height={480} /> : <HistoryMap points={invalidRange ? [] : points} selectedId={selected} onSelect={setSelected} campuses={campus ? [campus] : []} />}
          <div className="col g-3">
            <div className="statgrid statgrid--card">
              <Kpi size="compact" label="Points" value={q.data?.summary.count ?? '—'} loading={q.isLoading} />
              <Kpi size="compact" label="Distance" value={q.data ? q.data.summary.distanceKm : '—'} unit="km" loading={q.isLoading} />
            </div>
            {last && (
              <div className="banner banner--neutral">
                <Icon name="mapPin" size={17} />
                <div className="grow">
                  <strong>Last known location</strong> at {fmt.time(last.recordedAt)}: {last.placeLabel ?? last.locationStatusLabel}
                  <div className="coord t-xs">{Number(last.latitude).toFixed(4)}, {Number(last.longitude).toFixed(4)}</div>
                </div>
              </div>
            )}
            <section className="card card--flush">
              <div className="histlist" role="listbox" aria-label="Recorded locations">
                {!q.isLoading && !points.length ? (
                  <Empty icon="mapPin" title="No locations recorded" sub="There is no movement recorded for this date and time window." />
                ) : (
                  [...points].reverse().map((p) => (
                    <div key={p.id} className="histlist__row" role="option" aria-selected={p.id === selected} tabIndex={0}
                      onClick={() => setSelected(p.id)} onKeyDown={(e) => e.key === 'Enter' && setSelected(p.id)}>
                      <span className="t-sm t-bold t-num">{fmt.time(p.recordedAt)}</span>
                      <span className="col" style={{ minWidth: 0 }}>
                        <span className="coord t-xs">{Number(p.latitude).toFixed(4)}, {Number(p.longitude).toFixed(4)}</span>
                        <span className="t-micro t-muted t-clip">{[p.placeLabel ?? '—', p.deviceCode ?? p.source, p.accuracy != null ? `± ${Math.round(p.accuracy)} m` : null, p.speed != null ? `${(p.speed * 3.6).toFixed(0)} km/h` : null].filter(Boolean).join(' · ')}</span>
                      </span>
                      <Badge tone={p.locationStatus === 'at_school' ? 'success' : p.locationStatus === 'in_transit' ? 'warning' : p.locationStatus === 'on_trip' ? 'info' : 'neutral'}>
                        {p.locationStatusLabel}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </Grid>
      )}
    </div>
  );
}
