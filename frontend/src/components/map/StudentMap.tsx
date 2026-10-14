/**
 * Interactive maps built on Leaflet + OpenStreetMap tiles (no API key needed).
 * The tile URL can be switched to another provider via /public/config.
 */
import { useEffect, useMemo } from 'react';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L, { type LatLngExpression } from 'leaflet';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { LocationPoint, LocationStatus } from '@/api/types';
import { fmt } from '@/lib/format';
import { iconPaths } from '@/lib/legacy-icons';
import { BatteryLevel } from '@/components/tracking/devices';

const DEFAULT_TILE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

function useTiles() {
  const q = useQuery({
    queryKey: ['public-config'],
    queryFn: () => api.get<{ map?: { tileUrl: string; attribution: string } }>('/public/config'),
    staleTime: 30 * 60_000,
  });
  return {
    url: q.data?.map?.tileUrl || DEFAULT_TILE,
    attribution: q.data?.map?.attribution ? `&copy; ${q.data.map.attribution.replace(/^©\s*/, '')}` : '&copy; OpenStreetMap contributors',
  };
}

export function studentPin(initials: string, status: LocationStatus | null, opts: { stale?: boolean; selected?: boolean } = {}) {
  const cls = `stu-pin stu-pin--${opts.stale ? 'stale' : status ?? 'unknown'}${opts.selected ? ' stu-pin--selected' : ''}`;
  return L.divIcon({
    className: '',
    html: `<div class="${cls}"><span>${initials.replace(/[<>&"]/g, '')}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
    tooltipAnchor: [12, -18],
  });
}


/** Gives a map marker an accessible name (Leaflet renders it as a focusable button). */
const named = (label: string) => ({ add: (e: L.LeafletEvent) => (e.target as L.Marker).getElement()?.setAttribute('aria-label', label) });
const campusIcon = L.divIcon({
  className: '',
  html: `<div class="campus-pin"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths.building ?? ''}</svg></div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

const dot = (kind: 'start' | 'end' | 'mid') =>
  L.divIcon({ className: '', html: `<div class="point-dot point-dot--${kind}"></div>`, iconSize: kind === 'end' ? [16, 16] : kind === 'mid' ? [9, 9] : [12, 12] });

/** Fits the view to the given points whenever they change. */
function FitBounds({ points, maxZoom = 16 }: { points: [number, number][]; maxZoom?: number }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join('|');
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], Math.min(maxZoom, 15));
    else map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Pans to a selected point without changing zoom level below 14. */
function FlyTo({ target }: { target?: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 14), { duration: 0.6 });
  }, [target?.[0], target?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export interface MapStudent {
  studentId: string;
  fullName: string;
  admissionNo?: string;
  grade?: string | null;
  section?: string | null;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  locationStatus: LocationStatus | null;
  locationStatusLabel?: string;
  displayStatus?: string;
  recordedAt?: string | null;
  isStale?: boolean;
  placeLabel?: string | null;
  batteryPct?: number | null;
  deviceCode?: string | null;
  gpsStatus?: 'online' | 'stale' | 'offline' | 'never' | null;
}

export interface MapCampus {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusM?: number | null;
}

/** Many students on one map (admin tracking) or one student (profile / parent). */
export function StudentMap({
  students, campuses = [], selectedId, onSelect, height = 'default', showAccuracy = false, fitToStudents = true, emptyMessage, onOpenProfile,
}: {
  students: MapStudent[];
  campuses?: MapCampus[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  height?: 'default' | 'tall' | 'short';
  showAccuracy?: boolean;
  fitToStudents?: boolean;
  emptyMessage?: string;
  onOpenProfile?: (id: string) => void;
}) {
  const tiles = useTiles();
  const points = useMemo<[number, number][]>(() => {
    const p = students.map((s) => [Number(s.latitude), Number(s.longitude)] as [number, number]);
    if (!p.length || !fitToStudents) campuses.forEach((c) => p.push([Number(c.latitude), Number(c.longitude)]));
    return p;
  }, [students, campuses, fitToStudents]);
  const center: LatLngExpression = points[0] ?? [11.0168, 76.9558];
  const selected = students.find((s) => s.studentId === selectedId);

  return (
    <div className={`mapbox${height !== 'default' ? ` mapbox--${height}` : ''}`}>
      <MapContainer center={center} zoom={13} scrollWheelZoom style={{ width: '100%', height: '100%' }}>
        <TileLayer url={tiles.url} attribution={tiles.attribution} maxZoom={19} referrerPolicy="strict-origin-when-cross-origin" />
        <FitBounds points={points} />
        <FlyTo target={selected ? [Number(selected.latitude), Number(selected.longitude)] : null} />
        {campuses.map((c) => (
          <span key={c.id}>
            {c.radiusM ? <Circle center={[Number(c.latitude), Number(c.longitude)]} radius={c.radiusM} pathOptions={{ className: 'st-geofence', weight: 1.5, fillOpacity: 0.06, dashArray: '4 4' }} /> : null}
            <Marker position={[Number(c.latitude), Number(c.longitude)]} icon={campusIcon} eventHandlers={named(`Campus: ${c.name}`)}>
              <Tooltip direction="top" offset={[0, -14]}>{c.name}</Tooltip>
            </Marker>
          </span>
        ))}
        {students.map((s) => {
          const pos: [number, number] = [Number(s.latitude), Number(s.longitude)];
          return (
            <span key={s.studentId}>
              {showAccuracy && s.accuracy ? <Circle center={pos} radius={Number(s.accuracy)} pathOptions={{ className: 'st-accuracy', weight: 1, fillOpacity: 0.1 }} /> : null}
              <Marker
                position={pos}
                icon={studentPin(fmt.initials(s.fullName), s.locationStatus, { stale: s.isStale, selected: s.studentId === selectedId })}
                eventHandlers={{ ...named(`${s.fullName}, ${s.locationStatus}`), click: () => onSelect?.(s.studentId) }}
                zIndexOffset={s.studentId === selectedId ? 1000 : 0}
              >
                <Tooltip direction="right">{s.fullName}</Tooltip>
                <Popup>
                  <div className="st-popup">
                    <strong>{s.fullName}</strong>
                    <div className="t-micro t-muted">{[s.admissionNo, s.grade ? `${s.grade}${s.section ?? ''}` : null].filter(Boolean).join(' · ')}</div>
                    <div className="mt-2">{s.placeLabel ?? s.locationStatusLabel ?? '—'}{s.isStale ? ' (last known)' : ''}</div>
                    <table className="popup-dl t-micro">
                      <tbody>
                        {s.deviceCode !== undefined && <tr><th>Device</th><td className="coord">{s.deviceCode ?? '—'}</td></tr>}
                        <tr><th>Latitude</th><td className="coord">{Number(s.latitude).toFixed(7)}</td></tr>
                        <tr><th>Longitude</th><td className="coord">{Number(s.longitude).toFixed(7)}</td></tr>
                        {s.accuracy != null && <tr><th>Accuracy</th><td>{Number(s.accuracy).toFixed(1)} m</td></tr>}
                        {s.recordedAt && <tr><th>Last updated</th><td>{fmt.time(s.recordedAt)} <span className="t-muted">{fmt.date(s.recordedAt)}</span></td></tr>}
                        {s.batteryPct != null && <tr><th>Battery</th><td><BatteryLevel pct={s.batteryPct} /></td></tr>}
                        {s.gpsStatus && <tr><th>GPS status</th><td><strong className={`gps-${s.gpsStatus}`}>{s.gpsStatus === 'never' ? 'NO CONTACT' : s.gpsStatus.toUpperCase()}</strong></td></tr>}
                      </tbody>
                    </table>
                    {onOpenProfile && (
                      <button type="button" className="btn btn--primary btn--sm mt-2" onClick={() => onOpenProfile(s.studentId)}>Open Student 360</button>
                    )}
                  </div>
                </Popup>
              </Marker>
            </span>
          );
        })}
      </MapContainer>
      {!students.length && (
        <div className="mapbox__empty">
          <div>
            <div className="h3">No location to show</div>
            <p className="t-sm t-muted mt-2">{emptyMessage ?? 'There is no recorded location for the current selection.'}</p>
          </div>
        </div>
      )}
      <div className="mapbox__overlay" role="group" aria-label="Map legend">
        <span className="st-key"><span className="dot dot--success" />At school</span>
        <span className="st-key"><span className="dot dot--warning" />In transit</span>
        <span className="st-key"><span className="dot dot--info" />At home</span>
        <span className="st-key"><span className="dot st-key__dot--trip" />On trip</span>
        <span className="st-key"><span className="dot dot--neutral" />Last known (stale)</span>
        {campuses.some((c) => c.radiusM) && <span className="st-key"><span className="st-key__geofence" />Campus zone</span>}
      </div>
    </div>
  );
}

/** A student's movement for a day: a path with start/end markers and every recorded point. */
export function HistoryMap({ points, selectedId, onSelect, campuses = [] }: { points: LocationPoint[]; selectedId?: number | null; onSelect?: (id: number) => void; campuses?: MapCampus[] }) {
  const tiles = useTiles();
  const path = points.map((p) => [Number(p.latitude), Number(p.longitude)] as [number, number]);
  const selected = points.find((p) => p.id === selectedId);
  return (
    <div className="mapbox mapbox--tall">
      <MapContainer center={path[0] ?? [11.0168, 76.9558]} zoom={13} scrollWheelZoom style={{ width: '100%', height: '100%' }}>
        <TileLayer url={tiles.url} attribution={tiles.attribution} maxZoom={19} referrerPolicy="strict-origin-when-cross-origin" />
        <FitBounds points={path.length ? path : campuses.map((c) => [Number(c.latitude), Number(c.longitude)] as [number, number])} maxZoom={17} />
        <FlyTo target={selected ? [Number(selected.latitude), Number(selected.longitude)] : null} />
        {campuses.map((c) => (
          <Marker key={c.id} position={[Number(c.latitude), Number(c.longitude)]} icon={campusIcon} eventHandlers={named(`Campus: ${c.name}`)}>
            <Tooltip direction="top" offset={[0, -14]}>{c.name}</Tooltip>
          </Marker>
        ))}
        {path.length > 1 && <Polyline positions={path} pathOptions={{ className: 'st-path-history', weight: 4, opacity: 0.75 }} />}
        {points.map((p, i) => {
          const kind = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'mid';
          return (
            <Marker key={p.id} position={[Number(p.latitude), Number(p.longitude)]} icon={dot(kind)} eventHandlers={{ ...named(`Location at ${fmt.time(p.recordedAt)}`), click: () => onSelect?.(p.id) }}
              zIndexOffset={kind === 'end' ? 900 : p.id === selectedId ? 1000 : 0}>
              <Tooltip direction="top">
                {fmt.time(p.recordedAt)} · {p.locationStatusLabel}
                <br />
                {Number(p.latitude).toFixed(4)}, {Number(p.longitude).toFixed(4)}
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>
      {!points.length && (
        <div className="mapbox__empty">
          <div>
            <div className="h3">No movement recorded</div>
            <p className="t-sm t-muted mt-2">Choose another date or widen the time window.</p>
          </div>
        </div>
      )}
      <div className="mapbox__overlay" role="group" aria-label="Map legend">
        <span className="st-key"><span className="point-dot point-dot--start" />Start</span>
        <span className="st-key"><span className="point-dot point-dot--mid" />Recorded point</span>
        <span className="st-key"><span className="point-dot point-dot--end st-key__dot--last" />Last known</span>
      </div>
    </div>
  );
}
