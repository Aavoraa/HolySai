/**
 * Bus maps (Leaflet + OpenStreetMap), following components/map/StudentMap.tsx:
 * the same tile configuration, `mapbox` container and campus marker.
 */
import { useEffect, useMemo } from 'react';
import { Circle, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { fmt } from '@/lib/format';
import { iconPaths } from '@/lib/legacy-icons';
import type { CampusPoint, PathPoint, RouteRow } from './types';

const DEFAULT_TILE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_CENTER: [number, number] = [12.845, 80.06];

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

/** Marker colour per run status (classes in styles/modules/safety-tracking.css). */
const statusClass = (status: string) => `bus-pin--${status.toLowerCase().replace(/s+/g, '-')}`;

function busIcon(label: string, status: string, selected: boolean, alert: boolean) {
  const cls = ['bus-pin', statusClass(status), selected && 'bus-pin--selected', alert && 'bus-pin--alert'].filter(Boolean).join(' ');
  const safe = label.replace(/[<>&"]/g, '');
  return L.divIcon({
    className: '',
    html: `<div class="${cls}">`
      + `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths.bus ?? ''}</svg>${safe}</div>`,
    iconSize: [70, 24],
    iconAnchor: [16, 12],
    tooltipAnchor: [40, 0],
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

const stopIcon = (n: number, done: boolean, highlight = false) => L.divIcon({
  className: '',
  html: `<div class="stop-pin${done ? ' stop-pin--done' : ''}${highlight ? ' stop-pin--pending' : ''}">${n}</div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function FitBounds({ points, maxZoom = 15 }: { points: [number, number][]; maxZoom?: number }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join('|');
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], Math.min(maxZoom, 14));
    else map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function ClickCapture({ onClick }: { onClick?: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick?.(Math.round(e.latlng.lat * 1e6) / 1e6, Math.round(e.latlng.lng * 1e6) / 1e6) });
  return null;
}

/** All buses, with the selected route's planned path, today's trail and stops. */
export function BusFleetMap({ routes, campuses, selectedId, onSelect, trail = [], stops, height = 'default' }: {
  routes: RouteRow[];
  campuses: CampusPoint[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  trail?: { latitude: number; longitude: number; recordedAt: string }[];
  stops?: { name: string; latitude: number; longitude: number; pickupTime: string; done?: boolean }[];
  height?: 'default' | 'tall' | 'short';
}) {
  const tiles = useTiles();
  const selected = routes.find((r) => r.id === selectedId);
  const planned: PathPoint[] = selected?.path ?? [];
  const fit = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = planned.map((p) => [p.latitude, p.longitude]);
    if (selected?.location) pts.push([selected.location.latitude, selected.location.longitude]);
    if (!pts.length) {
      routes.forEach((r) => r.location && pts.push([r.location.latitude, r.location.longitude]));
      campuses.forEach((c) => pts.push([Number(c.latitude), Number(c.longitude)]));
    }
    return pts;
  }, [selectedId, routes, campuses]); // eslint-disable-line react-hooks/exhaustive-deps
  const withLocation = routes.filter((r) => r.location);
  const stopMarkers = stops ?? planned;
  return (
    <div className={`mapbox${height !== 'default' ? ` mapbox--${height}` : ''}`}>
      <MapContainer center={fit[0] ?? DEFAULT_CENTER} zoom={12} scrollWheelZoom style={{ width: '100%', height: '100%' }}>
        <TileLayer url={tiles.url} attribution={tiles.attribution} maxZoom={19} referrerPolicy="strict-origin-when-cross-origin" />
        <FitBounds points={fit} />
        {campuses.map((c) => (
          <span key={c.id}>
            {c.radiusM ? <Circle center={[Number(c.latitude), Number(c.longitude)]} radius={c.radiusM} pathOptions={{ className: 'st-geofence', weight: 1.5, fillOpacity: 0.06, dashArray: '4 4' }} /> : null}
            <Marker position={[Number(c.latitude), Number(c.longitude)]} icon={campusIcon} eventHandlers={named(`Campus: ${c.name}`)}>
              <Tooltip direction="top" offset={[0, -14]}>{c.name}</Tooltip>
            </Marker>
          </span>
        ))}
        {planned.length > 1 && (
          <Polyline positions={planned.map((p) => [p.latitude, p.longitude] as [number, number])} pathOptions={{ className: 'st-path-planned', weight: 3, opacity: 0.55, dashArray: '7 5' }} />
        )}
        {trail.length > 1 && (
          <Polyline positions={trail.map((p) => [Number(p.latitude), Number(p.longitude)] as [number, number])} pathOptions={{ className: 'st-path-trail', weight: 4, opacity: 0.85 }} />
        )}
        {selected && stopMarkers.map((s, i) => (
          <Marker key={`${s.name}-${i}`} position={[Number(s.latitude), Number(s.longitude)]} icon={stopIcon(i + 1, 'done' in s ? !!s.done : false)} eventHandlers={named(`Stop ${i + 1}: ${s.name}`)}>
            <Tooltip direction="top" offset={[0, -8]}>{s.name} · {s.pickupTime}</Tooltip>
          </Marker>
        ))}
        {withLocation.map((r) => {
          const alert = r.alerts.some((a) => a.tone === 'critical');
          return (
            <Marker key={r.id} position={[r.location!.latitude, r.location!.longitude]}
              icon={busIcon(r.busNo ?? r.code, r.runStatus, r.id === selectedId, alert)}
              zIndexOffset={r.id === selectedId ? 1000 : alert ? 500 : 0}
              eventHandlers={{ ...named(`Bus ${r.busNo ?? r.code}`), click: () => onSelect?.(r.id) }}>
              <Tooltip direction="right">
                <strong>{r.busNo ?? r.code}</strong> · {r.name} · {r.runStatus}
                <br />
                {r.eta ?? ''}{r.location?.speedKmph != null ? ` · ${r.location.speedKmph} km/h` : ''} · {fmt.time(r.location!.recordedAt)}
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>
      {!withLocation.length && !planned.length && (
        <div className="mapbox__empty">
          <div>
            <div className="h3">No bus positions yet</div>
            <p className="t-sm t-muted mt-2">GPS positions appear here once buses start reporting.</p>
          </div>
        </div>
      )}
      <div className="mapbox__overlay" role="group" aria-label="Map legend">
        <span className="st-key"><span className="dot dot--info" />En route</span>
        <span className="st-key"><span className="dot dot--warning" />Delayed</span>
        <span className="st-key"><span className="dot dot--success" />At campus</span>
        <span className="st-key"><span className="dot dot--critical" />Out of service</span>
        <span className="st-key"><span className="dot dot--neutral" />Scheduled</span>
        {selected && <span className="st-key"><span className="st-key__line st-key__line--planned" />Planned</span>}
        {trail.length > 1 && <span className="st-key"><span className="st-key__line st-key__line--trail" />Travelled</span>}
      </div>
    </div>
  );
}

/** Route editor map: ordered stops; clicking the map proposes coordinates for a new stop. */
export function RouteStopsMap({ stops, campuses = [], pending, onPick }: {
  stops: { id: string; name: string; latitude: number; longitude: number; pickupTime: string }[];
  campuses?: CampusPoint[];
  pending?: { latitude: number; longitude: number } | null;
  onPick?: (lat: number, lng: number) => void;
}) {
  const tiles = useTiles();
  const pts = stops.map((s) => [Number(s.latitude), Number(s.longitude)] as [number, number]);
  const fit = pts.length ? pts : campuses.map((c) => [Number(c.latitude), Number(c.longitude)] as [number, number]);
  return (
    <div className="mapbox mapbox--short">
      <MapContainer center={fit[0] ?? DEFAULT_CENTER} zoom={12} scrollWheelZoom style={{ width: '100%', height: '100%', cursor: onPick ? 'crosshair' : undefined }}>
        <TileLayer url={tiles.url} attribution={tiles.attribution} maxZoom={19} referrerPolicy="strict-origin-when-cross-origin" />
        <FitBounds points={fit} maxZoom={15} />
        <ClickCapture onClick={onPick} />
        {campuses.map((c) => (
          <Marker key={c.id} position={[Number(c.latitude), Number(c.longitude)]} icon={campusIcon} eventHandlers={named(`Campus: ${c.name}`)}>
            <Tooltip direction="top" offset={[0, -14]}>{c.name}</Tooltip>
          </Marker>
        ))}
        {pts.length > 1 && <Polyline positions={pts} pathOptions={{ className: 'st-path-planned', weight: 3, opacity: 0.6 }} />}
        {stops.map((s, i) => (
          <Marker key={s.id} position={pts[i]} icon={stopIcon(i + 1, false)} eventHandlers={named(`Stop ${i + 1}: ${s.name}`)}>
            <Tooltip direction="top" offset={[0, -8]}>{s.name} · {s.pickupTime}</Tooltip>
          </Marker>
        ))}
        {pending && <Marker position={[pending.latitude, pending.longitude]} icon={stopIcon(stops.length + 1, true, true)} eventHandlers={named(`New stop ${stops.length + 1}`)} />}
      </MapContainer>
      {onPick && (
        <div className="mapbox__overlay" role="note"><span>Click the map to place a new stop</span></div>
      )}
    </div>
  );
}
