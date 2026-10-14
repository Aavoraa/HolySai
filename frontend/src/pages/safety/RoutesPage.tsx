import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import {
  Badge, Button, Card, DataTable, Dl, Empty, ErrorState, IconButton, Modal, Page, PageHead, SearchInput, SelectField,
  Skeleton, StudentLink, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { RouteStopsMap } from './BusMap';
import { FormModal, gradeOf, runTone, StudentPicker, TRANSPORT_KEYS, useFieldErrors } from './shared';
import type { RouteDetail, RouteRow, RoutesResponse, StopRow, StudentOption, Vehicle } from './types';

export default function RoutesPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const manage = can('transport.manage');
  const list = useApiQuery<RoutesResponse>('/transport/routes', { ...campusParam, q: q || undefined });
  const [editing, setEditing] = useState<RouteRow | 'new' | null>(null);
  const openId = sp.get('open');
  const open = (id: string | null) => setSp(id ? { open: id } : {}, { replace: true });

  return (
    <Page>
      <PageHead
        title="Routes"
        sub="Route configuration, vehicle assignment and staffing."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Add route</Button>}
      />
      <Card flush>
        <Toolbar>
          <SearchInput value={q} onSearch={setQ} placeholder="Search route, name or area" />
          {list.data && <span className="t-xs t-muted">{list.data.routes.length} routes · {list.data.summary.students} students</span>}
        </Toolbar>
        {list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : (
          <DataTable
            rows={list.data?.routes}
            loading={list.isLoading}
            rowKey={(r) => r.id}
            onRowClick={(r) => open(r.id)}
            emptyText={q ? 'No routes match your search.' : 'No routes yet. Add the first route.'}
            columns={[
              { key: 'code', label: 'Route', render: (r) => <span className="t-bold">{r.code}</span> },
              { key: 'bus', label: 'Vehicle', render: (r) => <><span className="t-bold">{r.busNo ? `${r.busNo} · ${r.registrationNo}` : 'No vehicle'}</span><div className="t-micro t-muted">{r.name} · {r.area}</div></> },
              { key: 'driver', label: 'Driver', render: (r) => r.driverName ?? <span className="t-faint">Unassigned</span> },
              { key: 'attendant', label: 'Attendant', render: (r) => r.attendantName ?? <span className="t-faint">None</span> },
              { key: 'students', label: 'Students', className: 'num', render: (r) => <span className="t-num">{r.students}{r.capacity ? <span className="t-muted"> / {r.capacity}</span> : null}</span> },
              { key: 'stops', label: 'Stops', className: 'num', render: (r) => <span className="t-num">{r.stops}</span> },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={runTone(r.runStatus)} dot>{r.runStatus}</Badge> },
            ]}
          />
        )}
      </Card>

      {openId && <RouteDrawer id={openId} campuses={list.data?.campuses ?? []} onClose={() => open(null)} onEdit={(r) => setEditing(r)} />}
      {editing && <RouteFormModal route={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); open(id); }} />}
    </Page>
  );
}

function RouteFormModal({ route, onClose, onSaved }: { route: RouteRow | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { lookups } = useLookups();
  const { campusParam } = useSchool();
  const [f, setF] = useState({
    code: route?.code ?? '', name: route?.name ?? '', area: route?.area ?? '',
    campusId: route?.campusId ?? campusParam.campusId ?? lookups?.campuses[0]?.id ?? '',
    vehicleId: route?.vehicleId ?? '', driverId: route?.driverId ?? '', attendantId: route?.attendantId ?? '',
  });
  const vehicles = useApiQuery<Vehicle[]>('/transport/vehicles', f.campusId ? { campusId: f.campusId } : undefined);
  const fe = useFieldErrors();
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); fe.clear(k); };
  const save = useApiMutation<Record<string, unknown>, RouteRow>(route ? 'put' : 'post', route ? `/transport/routes/${route.id}` : '/transport/routes', {
    invalidate: TRANSPORT_KEYS, onSuccess: (r) => onSaved(r.data.id),
  });
  const staff = lookups?.staff ?? [];
  const transportStaff = staff.filter((s) => s.department === 'Transport');
  const staffOpts = (list: typeof staff) => list.map((s) => ({ value: s.id, label: `${s.fullName} — ${s.designation}` }));
  const submit = () => {
    const e: Record<string, string> = {};
    if (!/^[A-Z]{1,3}\d{1,3}$/.test(f.code.trim())) e.code = 'Use a code like R12 or V01';
    if (f.name.trim().length < 2) e.name = 'Enter the route name';
    if (f.area.trim().length < 2) e.area = 'Enter the area served';
    if (!f.campusId) e.campusId = 'Choose a campus';
    if (f.driverId && f.driverId === f.attendantId) e.attendantId = 'The attendant must be a different person';
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({
      code: f.code.trim(), name: f.name.trim(), area: f.area.trim(), campusId: f.campusId,
      vehicleId: f.vehicleId || null, driverId: f.driverId || null, attendantId: f.attendantId || null,
    }, { onError: fe.fromServer });
  };
  return (
    <FormModal title={route ? `Edit ${route.name}` : 'Add route'} onClose={onClose} busy={save.isPending} error={save.error} fieldErrors={fe.errors}
      onSubmit={submit} submitLabel={route ? 'Save route' : 'Create route'}>
      <div className="form-grid">
        <TextField label="Route code" required value={f.code} onChange={(v) => set('code')(v.toUpperCase())} maxLength={6} placeholder="R21" error={fe.errors.code} />
        <TextField label="Name" required value={f.name} onChange={set('name')} maxLength={80} placeholder="Route 21" error={fe.errors.name} />
        <TextField className="span-2" label="Area served" required value={f.area} onChange={set('area')} maxLength={120} error={fe.errors.area} />
        <SelectField label="Campus" required value={f.campusId} onChange={set('campusId')} error={fe.errors.campusId}
          options={(lookups?.campuses ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <SelectField label="Vehicle" value={f.vehicleId} onChange={set('vehicleId')} placeholder="No vehicle"
          options={(vehicles.data ?? []).map((v) => ({ value: v.id, label: `${v.busNo} · ${v.registrationNo}${v.routeCode && v.routeCode !== route?.code ? ` (on ${v.routeCode})` : ''}${v.status !== 'active' ? ` — ${v.status}` : ''}` }))} />
        <SelectField label="Driver" value={f.driverId} onChange={set('driverId')} placeholder="Unassigned" options={staffOpts(transportStaff.length ? transportStaff : staff)} />
        <SelectField label="Attendant" value={f.attendantId} onChange={set('attendantId')} placeholder="None" error={fe.errors.attendantId}
          options={staffOpts(transportStaff.length ? transportStaff : staff)} />
      </div>
    </FormModal>
  );
}

function RouteDrawer({ id, campuses, onClose, onEdit }: { id: string; campuses: RoutesResponse['campuses']; onClose: () => void; onEdit: (r: RouteRow) => void }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const manage = can('transport.manage');
  const q = useApiQuery<RouteDetail>(`/transport/routes/${id}`);
  const [stopForm, setStopForm] = useState<StopRow | 'new' | null>(null);
  const [pending, setPending] = useState<{ latitude: number; longitude: number } | null>(null);
  const [assigning, setAssigning] = useState(false);
  const inv = { invalidate: TRANSPORT_KEYS };
  const reorder = useApiMutation<string[]>('put', `/transport/routes/${id}/stops/order`, { ...inv, body: (ids) => ({ stopIds: ids }), success: 'Stop order saved' });
  const delStop = useApiMutation<string>('delete', (sid) => `/transport/routes/${id}/stops/${sid}`, inv);
  const unassign = useApiMutation<string>('delete', (sid) => `/transport/routes/${id}/students/${sid}`, inv);
  const delRoute = useApiMutation<void>('delete', `/transport/routes/${id}`, { ...inv, onSuccess: onClose });
  const d = q.data;

  const move = (i: number, dir: -1 | 1) => {
    if (!d) return;
    const ids = d.stopList.map((s) => s.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    reorder.mutate(ids);
  };

  const campusList = d ? campuses.filter((c) => c.id === d.campusId) : campuses;
  return (
    <Modal open onClose={onClose} size="wide" title={d ? `${d.code} · ${d.name}` : 'Route'} sub={d ? `${d.area} · ${d.campusName}` : undefined}
      foot={
        <>
          {manage && d && (
            <Button variant="danger" icon="trash" loading={delRoute.isPending} onClick={async () => {
              const ok = await confirm({ title: `Delete ${d.name}?`, danger: true, confirmLabel: 'Delete route', body: 'Routes with students or boarding history cannot be deleted — set them to Maintenance instead.' });
              if (ok) delRoute.mutate();
            }}>Delete</Button>
          )}
          <span className="spacer" />
          {d && <Button icon="bus" to={`/bus-tracking?route=${d.code}`}>Track bus</Button>}
          {manage && d && <Button variant="primary" icon="edit" onClick={() => onEdit(d as unknown as RouteRow)}>Edit route</Button>}
        </>
      }>
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !d ? <Skeleton height={320} /> : (
        <div className="col g-4">
          <Dl items={[
            ['Vehicle', d.busNo ? `${d.busNo} · ${d.registrationNo} (${d.capacity} seats)` : 'No vehicle assigned'],
            ['Driver', d.driverName ? `${d.driverName}${d.driverPhone ? ` · ${d.driverPhone}` : ''}` : 'Unassigned'],
            ['Attendant', d.attendantName ?? 'None'],
            ['Run status', <Badge key="s" tone={runTone(d.runStatus)}>{d.runStatus}</Badge>],
          ]} />

          <RouteStopsMap stops={d.stopList} campuses={campusList} pending={stopForm === 'new' ? pending : null}
            onPick={manage ? (lat, lng) => { setPending({ latitude: lat, longitude: lng }); setStopForm('new'); } : undefined} />

          <Card title="Stops" sub="In pickup order" flush tight
            actions={manage && <Button size="sm" icon="plus" onClick={() => { setPending(null); setStopForm('new'); }}>Add stop</Button>}>
            {!d.stopList.length ? <Empty icon="mapPin" title="No stops yet" sub="Click the map or use Add stop." /> : (
              <DataTable
                compact
                rows={d.stopList}
                rowKey={(s) => s.id}
                columns={[
                  { key: 'seq', label: '#', render: (s) => <span className="t-num t-bold">{s.sequence}</span> },
                  { key: 'name', label: 'Stop', render: (s) => <><span className="t-bold">{s.name}</span><div className="t-micro t-muted coord">{fmt.coord(s.latitude)}, {fmt.coord(s.longitude)}</div></> },
                  { key: 'pickup', label: 'Pickup', render: (s) => <span className="t-num">{s.pickupTime}</span> },
                  { key: 'drop', label: 'Drop', render: (s) => <span className="t-num">{s.dropTime ?? '—'}</span> },
                  { key: 'students', label: 'Students', className: 'num', render: (s) => <span className="t-num">{s.students}</span> },
                  ...(manage ? [{
                    key: 'a', label: '', className: 'num',
                    render: (s: StopRow) => {
                      const i = d.stopList.findIndex((x) => x.id === s.id);
                      return (
                        <span className="row g-1 end">
                          <IconButton icon="chevronUp" label={`Move ${s.name} up`} size={15} disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} />
                          <IconButton icon="chevronDown" label={`Move ${s.name} down`} size={15} disabled={i === d.stopList.length - 1 || reorder.isPending} onClick={() => move(i, 1)} />
                          <IconButton icon="edit" label={`Edit ${s.name}`} size={15} onClick={() => setStopForm(s)} />
                          <IconButton icon="trash" label={`Remove ${s.name}`} size={15} onClick={async () => {
                            const ok = await confirm({ title: `Remove ${s.name}?`, danger: true, confirmLabel: 'Remove stop', body: s.students ? 'Students are assigned to this stop; move them first.' : 'The stop is removed from the route and the remaining stops are renumbered.' });
                            if (ok) delStop.mutate(s.id);
                          }} />
                        </span>
                      );
                    },
                  }] : []),
                ]}
              />
            )}
          </Card>

          <Card title="Assigned students" sub={`${d.students.length} on this route`} flush tight
            actions={manage && <Button size="sm" icon="plus" onClick={() => setAssigning(true)}>Assign student</Button>}>
            <DataTable
              compact
              rows={d.students}
              rowKey={(s) => s.id}
              emptyText="No students assigned."
              columns={[
                { key: 'name', label: 'Student', render: (s) => <StudentLink id={s.id} name={s.fullName} meta={[s.admissionNo, gradeOf(s.grade, s.section)].filter(Boolean).join(' · ')} /> },
                { key: 'stop', label: 'Stop', render: (s) => s.stopName ?? <span className="t-faint">Not set</span> },
                { key: 'time', label: 'Pickup', render: (s) => <span className="t-num">{s.pickupTime ?? '—'}</span> },
                ...(manage ? [{
                  key: 'a', label: '', className: 'num',
                  render: (s: RouteDetail['students'][number]) => (
                    <Button size="sm" variant="quiet" onClick={async () => {
                      const ok = await confirm({ title: `Remove ${s.fullName} from ${d.name}?`, danger: true, confirmLabel: 'Remove', body: 'The student will no longer be expected on this bus.' });
                      if (ok) unassign.mutate(s.id);
                    }}>Remove</Button>
                  ),
                }] : []),
              ]}
            />
          </Card>
        </div>
      )}
      {stopForm && d && (
        <StopFormModal routeId={id} stop={stopForm === 'new' ? null : stopForm} initial={pending}
          onClose={() => { setStopForm(null); setPending(null); }} />
      )}
      {assigning && d && <AssignModal route={d} onClose={() => setAssigning(false)} />}
    </Modal>
  );
}

function StopFormModal({ routeId, stop, initial, onClose }: { routeId: string; stop: StopRow | null; initial: { latitude: number; longitude: number } | null; onClose: () => void }) {
  const [f, setF] = useState({
    name: stop?.name ?? '',
    latitude: String(stop?.latitude ?? initial?.latitude ?? ''),
    longitude: String(stop?.longitude ?? initial?.longitude ?? ''),
    pickupTime: stop?.pickupTime ?? '',
    dropTime: stop?.dropTime ?? '',
  });
  const fe = useFieldErrors();
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); fe.clear(k); };
  const save = useApiMutation<Record<string, unknown>>(stop ? 'put' : 'post', stop ? `/transport/routes/${routeId}/stops/${stop.id}` : `/transport/routes/${routeId}/stops`, {
    invalidate: TRANSPORT_KEYS, onSuccess: onClose,
  });
  const submit = () => {
    const e: Record<string, string> = {};
    const lat = Number(f.latitude), lng = Number(f.longitude);
    if (f.name.trim().length < 2) e.name = 'Enter the stop name';
    if (f.latitude === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) e.latitude = 'Latitude between -90 and 90';
    if (f.longitude === '' || !Number.isFinite(lng) || lng < -180 || lng > 180) e.longitude = 'Longitude between -180 and 180';
    if (!/^\d{2}:\d{2}$/.test(f.pickupTime)) e.pickupTime = 'Choose the pickup time';
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({ name: f.name.trim(), latitude: lat, longitude: lng, pickupTime: f.pickupTime, dropTime: f.dropTime || null }, { onError: fe.fromServer });
  };
  return (
    <FormModal title={stop ? `Edit ${stop.name}` : 'Add stop'} sub={stop ? undefined : 'Coordinates fill in when you click the map.'}
      onClose={onClose} busy={save.isPending} error={save.error} fieldErrors={fe.errors} onSubmit={submit} submitLabel={stop ? 'Save stop' : 'Add stop'}>
      <div className="form-grid">
        <TextField className="span-2" label="Stop name" required value={f.name} onChange={set('name')} maxLength={120} error={fe.errors.name} />
        <TextField label="Latitude" type="number" step="0.000001" required value={f.latitude} onChange={set('latitude')} error={fe.errors.latitude} />
        <TextField label="Longitude" type="number" step="0.000001" required value={f.longitude} onChange={set('longitude')} error={fe.errors.longitude} />
        <TextField label="Morning pickup" type="time" required value={f.pickupTime} onChange={set('pickupTime')} error={fe.errors.pickupTime} />
        <TextField label="Afternoon drop" type="time" value={f.dropTime} onChange={set('dropTime')} />
      </div>
    </FormModal>
  );
}

function AssignModal({ route, onClose }: { route: RouteDetail; onClose: () => void }) {
  const [student, setStudent] = useState<StudentOption | null>(null);
  const [stopId, setStopId] = useState('');
  const [mode, setMode] = useState('both');
  const fe = useFieldErrors();
  const save = useApiMutation<Record<string, unknown>>('post', `/transport/routes/${route.id}/students`, { invalidate: TRANSPORT_KEYS, onSuccess: onClose });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!student) e.studentId = 'Choose a student';
    if (!stopId) e.stopId = 'Choose the stop';
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({ studentId: student!.id, stopId, mode }, { onError: fe.fromServer });
  };
  return (
    <FormModal title={`Assign a student to ${route.name}`} onClose={onClose} busy={save.isPending} error={save.error} fieldErrors={fe.errors}
      onSubmit={submit} submitLabel="Assign">
      <div className="col g-4">
        <StudentPicker value={student} onChange={(s) => { setStudent(s); fe.clear('studentId'); }} required error={fe.errors.studentId}
          hint={student?.routeCode && student.routeCode !== route.code ? `Currently on route ${student.routeCode} — assigning moves the student.` : undefined} />
        <div className="form-grid">
          <SelectField label="Stop" required value={stopId} onChange={(v) => { setStopId(v); fe.clear('stopId'); }} placeholder="Choose a stop" error={fe.errors.stopId}
            options={route.stopList.map((s) => ({ value: s.id, label: `${s.sequence}. ${s.name} (${s.pickupTime})` }))} />
          <SelectField label="Uses the bus" required value={mode} onChange={setMode}
            options={[{ value: 'both', label: 'Both ways' }, { value: 'pickup_only', label: 'Morning only' }, { value: 'drop_only', label: 'Afternoon only' }]} />
        </div>
      </div>
    </FormModal>
  );
}
