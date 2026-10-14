import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import {
  Badge, Banner, Button, Card, DataTable, ErrorState, FilterSelect, Grid, Icon, Kpi, Page, PageHead, Pagination, SearchInput,
  Empty, Segment, Skeleton, StudentLink,
} from '@/components/ui';
import { StudentMap } from '@/components/map/StudentMap';
import { TrackingPanel, TrackingStatusPill } from '@/components/tracking/TrackingPanel';
import { BatteryLevel, GpsStatusBadge, LastSeen } from '@/components/tracking/devices';
import type { CurrentLocation, TrackingMapData } from '@/api/types';
import { fmt } from '@/lib/format';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Tracking active' },
  { value: 'offline', label: 'Offline / no update' },
  { value: 'paused', label: 'Paused' },
  { value: 'disabled', label: 'Disabled' },
];
const SORT_OPTIONS: { value: string; label: string; dir: 'asc' | 'desc' }[] = [
  { value: 'name', label: 'Name', dir: 'asc' },
  { value: 'updated', label: 'Last updated', dir: 'desc' },
  { value: 'status', label: 'Tracking status', dir: 'asc' },
  { value: 'grade', label: 'Class', dir: 'asc' },
];
const LOCATION_OPTIONS = [
  { value: 'at_school', label: 'At school' },
  { value: 'in_transit', label: 'In transit' },
  { value: 'at_home', label: 'At home' },
  { value: 'on_trip', label: 'On a school trip' },
];

export default function StudentTrackingPage() {
  const { id } = useParams();
  if (id) return <TrackingDetail id={id} />;
  return <TrackingOverview />;
}

function TrackingOverview() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { campusParam, scope } = useSchool();
  const { classOptions, sectionOptions } = useLookups();
  const list = useListParams({ sort: 'name', pageSize: 25 }, ['classId', 'sectionId', 'status', 'locationStatus']);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<'split' | 'map' | 'list'>('split');

  const filters = {
    ...campusParam,
    q: list.q || undefined,
    classId: list.filters.classId || undefined,
    sectionId: list.filters.sectionId || undefined,
    status: list.filters.status || undefined,
    locationStatus: list.filters.locationStatus || undefined,
  };
  const map = useApiQuery<TrackingMapData>('/tracking/map', filters, { refetchInterval: 60_000 });
  const rows = usePagedQuery<CurrentLocation>('/tracking/students', { ...list.query, ...campusParam }, { refetchInterval: 60_000 });
  const s = map.data?.summary;

  const campuses = useMemo(() => (map.data?.campuses ?? []).map((c) => ({ ...c })), [map.data]);

  return (
    <Page>
      <PageHead
        title="Student Tracking"
        sub="Live GPS location of students, with history. Every view of a student's location is recorded in the audit trail."
        crumbs={[{ label: 'Safety & Transport' }, { label: 'Student Tracking' }]}
        actions={
          <>
            {map.data && <span className="illustrative"><span className="dot dot--success dot--pulse" />Refreshed {fmt.time(map.data.generatedAt)}</span>}
            <Segment items={[{ id: 'split', label: 'Map + list' }, { id: 'map', label: 'Map' }, { id: 'list', label: 'List' }]} active={view} onChange={setView} />
            <Button icon="refresh" onClick={() => { map.refetch(); rows.refetch(); }} loading={map.isFetching}>Refresh</Button>
            {(can('tracking.read_all') || can('tracking.manage')) && <Button icon="navigation" to="/gps-devices">GPS Devices</Button>}
          </>
        }
      />
      <div className="mb-4">
        <Banner tone="warning" icon="info">
          <strong>Sample data.</strong> Coordinates in this environment are generated for development and demonstration; they are not real children's locations.
        </Banner>
      </div>

      <Grid cols="g-4col" className="mb-4">
        <Kpi icon="users" label="Students tracked" value={s ? `${s.active} / ${s.total}` : '—'} unit="live" tone="teal" loading={map.isLoading}
          foot={s ? `${s.paused} paused · ${s.disabled} disabled` : undefined} onClick={() => list.setFilter('status', 'active')} />
        <Kpi icon="building" label="On campus" value={s?.atSchool ?? '—'} tone="info" loading={map.isLoading} onClick={() => list.setFilter('locationStatus', 'at_school')} />
        <Kpi icon="activity" label="In transit" value={s?.inTransit ?? '—'} tone="amber" loading={map.isLoading} foot={s ? `${s.atHome} at home` : undefined} onClick={() => list.setFilter('locationStatus', 'in_transit')} />
        <Kpi icon="alert" label="Offline / no update" value={s?.offline ?? '—'} tone="critical" loading={map.isLoading} foot={map.data ? `No update for ${map.data.staleAfterMinutes}+ min` : undefined} onClick={() => list.setFilter('status', 'offline')} />
      </Grid>

      <div className="filterbar">
        <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search student name or ID" />
        <FilterSelect label="Class" value={list.filters.classId} onChange={(v) => { list.setFilter('classId', v); list.setFilter('sectionId', ''); }}
          options={classOptions(scope === 'group' ? undefined : campusParam.campusId)} />
        <FilterSelect label="Section" value={list.filters.sectionId} onChange={(v) => list.setFilter('sectionId', v)} options={sectionOptions(list.filters.classId)} />
        <FilterSelect label="Tracking" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={STATUS_OPTIONS} />
        <FilterSelect label="Location" value={list.filters.locationStatus} onChange={(v) => list.setFilter('locationStatus', v)} options={LOCATION_OPTIONS} />
        {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
      </div>

      <div className={view === 'split' ? 'st-split st-split--wide-list' : 'col g-4'}>
        {view === 'split' && (
          <Card icon="users"
            title="Students"
            sub={rows.data ? `${fmt.n(rows.data.meta.total)} students · select one to find it on the map` : 'Loading…'}
            flush
            actions={
              <select className="select st-sort" aria-label="Sort students" value={list.sort.key}
                onChange={(e) => { const o = SORT_OPTIONS.find((x) => x.value === e.target.value)!; list.setSort({ key: o.value, dir: o.dir }); }}>
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
              </select>
            }
          >
            {rows.error ? <ErrorState error={rows.error} onRetry={() => rows.refetch()} /> : (
              <TrackingList
                rows={rows.data?.rows}
                loading={rows.isLoading}
                selected={selected}
                onPick={(r) => (r.latitude != null ? setSelected(r.studentId) : navigate(`/student-tracking/${r.studentId}`))}
              />
            )}
            <Pagination meta={rows.data?.meta} onPage={list.setPage} />
          </Card>
        )}
        {view !== 'list' && (
          <div className="st-split__map">
          <Card icon="bus"
            title="Map"
            sub={map.data ? `${map.data.markers.length} students with a recorded location` : 'Loading…'}
            actions={selected ? <Button size="sm" iconRight="arrowRight" to={`/student-tracking/${selected}`}>Open tracking detail</Button> : undefined}
          >
            {map.error ? <ErrorState error={map.error} onRetry={() => map.refetch()} /> : map.isLoading ? <Skeleton height={560} /> : (
              <StudentMap
                height="tall"
                students={map.data!.markers}
                campuses={campuses}
                selectedId={selected}
                onSelect={setSelected}
                onOpenProfile={(sid) => navigate(`/student-360/${sid}?tab=tracking`)}
                emptyMessage="No students match the current filters."
              />
            )}
          </Card>
          </div>
        )}
        {view === 'list' && (
          <Card icon="users" title="Student list" sub={rows.data ? `${rows.data.meta.total} students` : undefined} flush>
            {rows.error ? <ErrorState error={rows.error} onRetry={() => rows.refetch()} /> : (
              <DataTable
                rows={rows.data?.rows}
                loading={rows.isLoading}
                rowKey={(r) => r.studentId}
                sort={list.sort}
                onSort={list.setSort}
                onRowClick={(r) => navigate(`/student-tracking/${r.studentId}`)}
                rowClassName={(r) => (r.studentId === selected ? 'is-selected' : undefined)}
                emptyText="No students match the current filters."
                columns={[
                  { key: 'name', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.fullName} meta={r.admissionNo} /> },
                  { key: 'grade', label: 'Class', render: (r) => `${r.grade ?? '—'}${r.section ?? ''}` },
                  { key: 'status', label: 'Status', render: (r) => <TrackingStatusPill status={r.displayStatus} /> },
                  { key: 'device', label: 'Device', sortable: false, render: (r: CurrentLocation) => (r.deviceCode ? <span className="col g-1"><span className="coord t-xs t-bold">{r.deviceCode}</span><GpsStatusBadge status={r.gpsStatus} seenAt={r.deviceLastSeenAt} /></span> : <span className="t-faint">No device</span>) },
                  { key: 'battery', label: 'Battery', sortable: false, className: 'num', render: (r: CurrentLocation) => <BatteryLevel pct={r.batteryPct} /> },
                  { key: 'location', label: 'Location', sortable: false, render: (r: CurrentLocation) => (r.latitude != null ? <span className="row-top g-2 st-loccell"><span className={`st-locdot st-locdot--${r.isStale ? 'stale' : r.locationStatus ?? 'unknown'}`} /><span>{r.placeLabel ?? r.locationStatusLabel}{r.isStale ? <span className="t-muted"> · last known</span> : null}<div className="coord t-micro">{fmt.coord(r.latitude)}, {fmt.coord(r.longitude)}</div></span></span> : '—') },
                  { key: 'updated', label: 'Last Updated', render: (r) => <LastSeen at={r.recordedAt} empty="No location yet" /> },
                  {
                    key: 'action', label: 'Action', sortable: false, className: 'num', render: (r) => (
                      <div className="row g-2 end">
                        <Button size="sm" icon="mapPin" to={`/student-tracking/${r.studentId}`} onClick={(e) => e.stopPropagation()}>Track</Button>
                        <Button size="sm" to={`/student-360/${r.studentId}`} onClick={(e) => e.stopPropagation()}>Student 360</Button>
                      </div>
                    ),
                  },
                ]}
              />
            )}
            <Pagination meta={rows.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
          </Card>
        )}
      </div>
      {!can('tracking.history') && (
        <p className="t-xs t-muted mt-4"><Icon name="lock" size={12} /> Location history is available to authorised staff only.</p>
      )}
    </Page>
  );
}

/** Selectable student list for the split view: name, tracking state, place, device and last update. */
function TrackingList({ rows, loading, selected, onPick }: {
  rows: CurrentLocation[] | undefined; loading: boolean; selected: string | null; onPick: (r: CurrentLocation) => void;
}) {
  const refs = useRef(new Map<string, HTMLLIElement>());
  // When a marker is chosen on the map, bring the matching row into view.
  useEffect(() => {
    if (selected) refs.current.get(selected)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  if (loading) return <div className="card__body col g-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={44} />)}</div>;
  if (!rows?.length) return <Empty icon="mapPin" title="No students match" sub="Change or clear the filters to see more students." />;
  return (
    <ul className="st-list" aria-label="Students">
      {rows.map((r) => {
        const place = r.latitude != null ? r.placeLabel ?? r.locationStatusLabel : null;
        return (
          <li key={r.studentId} className="st-item" aria-current={r.studentId === selected || undefined}
            ref={(el) => { if (el) refs.current.set(r.studentId, el); else refs.current.delete(r.studentId); }}>
            <button type="button" className="st-item__main" onClick={() => onPick(r)}
              title={r.latitude != null ? 'Show on the map' : 'No location yet — open tracking detail'}>
              <span className="st-item__top">
                <span className="st-item__name">{r.fullName}<span className="st-item__sub">{[r.admissionNo, gradeLabel(r)].filter(Boolean).join(' · ')}</span></span>
                <LastSeen at={r.recordedAt} empty="No location" />
              </span>
              <span className="st-item__meta">
                <TrackingStatusPill status={r.displayStatus} />
                {place && (
                  <span className="row g-1">
                    <span className={`st-locdot st-locdot--${r.isStale ? 'stale' : r.locationStatus ?? 'unknown'}`} aria-hidden="true" />
                    {place}{r.isStale ? ' (last known)' : ''}
                  </span>
                )}
                {r.deviceCode ? <GpsStatusBadge status={r.gpsStatus} seenAt={r.deviceLastSeenAt} /> : <span className="t-faint">No device</span>}
                {r.batteryPct != null && <BatteryLevel pct={r.batteryPct} />}
              </span>
            </button>
            <span className="st-item__actions">
              <Button size="sm" variant="quiet" icon="arrowRight" to={`/student-tracking/${r.studentId}`} aria-label={`Open tracking detail for ${r.fullName}`} title="Tracking detail and history" />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const gradeLabel = (r: Pick<CurrentLocation, 'grade' | 'section'>) => (r.grade ? `${r.grade}${r.section ?? ''}` : '');

function TrackingDetail({ id }: { id: string }) {
  const { can } = useAuth();
  const loc = useApiQuery<CurrentLocation>(`/students/${id}/location`);
  return (
    <Page>
      <PageHead
        title={loc.data ? `Tracking — ${loc.data.fullName}` : 'Student Tracking'}
        sub={loc.data ? `${loc.data.admissionNo} · ${loc.data.grade}${loc.data.section} · ${loc.data.campusName}` : undefined}
        crumbs={[{ label: 'Student Tracking', to: '/student-tracking' }, { label: loc.data?.fullName ?? 'Student' }]}
        actions={
          <>
            {loc.data && <Badge tone={loc.data.trackingEnabled ? 'success' : 'neutral'}>{loc.data.trackingEnabled ? 'Consent on file' : 'Tracking disabled'}</Badge>}
            <Button icon="user" to={`/student-360/${id}`}>Open Student 360</Button>
          </>
        }
      />
      <TrackingPanel
        locationPath={`/students/${id}/location`}
        historyPath={can('tracking.history') ? `/students/${id}/location/history` : undefined}
      />
    </Page>
  );
}
