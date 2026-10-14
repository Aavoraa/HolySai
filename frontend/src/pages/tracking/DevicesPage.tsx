import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import {
  Banner, Button, Card, DataTable, Dl, ErrorState, FilterSelect, Grid, InlineError, Kpi, Modal, Page, PageHead, Pagination,
  SearchInput, SelectField, Skeleton, StudentLink, TextArea, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import {
  AssignDeviceModal, BatteryLevel, DEVICE_TYPE_LABEL, DeviceStatusBadge, GpsStatusBadge, LastSeen, QrCode, TokenModal, printDeviceLabels, useUnassign,
} from '@/components/tracking/devices';
import type { DeviceSummary, DeviceType, GpsDevice, GpsDeviceDetail } from '@/api/types';
import { fmt } from '@/lib/format';

const TYPE_OPTIONS = Object.entries(DEVICE_TYPE_LABEL).map(([value, label]) => ({ value, label }));
const STATUS_OPTIONS = ['available', 'assigned', 'maintenance', 'inactive', 'lost'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }));
const GPS_OPTIONS = [
  { value: 'online', label: 'Online' }, { value: 'stale', label: 'Stale' }, { value: 'offline', label: 'Offline' }, { value: 'never', label: 'Never connected' },
];

export default function DevicesPage() {
  const { can } = useAuth();
  const manage = can('tracking.manage');
  const { campusParam } = useSchool();
  const list = useListParams({ sort: 'code', pageSize: 25 }, ['status', 'deviceType', 'gpsStatus']);
  const summary = useApiQuery<DeviceSummary>('/devices/summary', campusParam, { refetchInterval: 60_000 });
  const rows = usePagedQuery<GpsDevice>('/devices', { ...list.query, ...campusParam }, { refetchInterval: 60_000 });
  const [registering, setRegistering] = useState(false);
  const [token, setToken] = useState<{ deviceCode: string; deviceType?: DeviceType; token: string } | null>(null);
  const [assigning, setAssigning] = useState<GpsDevice | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const unassign = useUnassign();
  const s = summary.data;
  const offlineFoot = s ? `No contact for ${Math.round(s.thresholds.offlineSeconds / 60)}+ min` : undefined;

  return (
    <Page>
      <PageHead
        title="GPS Devices"
        sub="Every tracker the school owns, who carries it, and whether it is reporting. Devices post to one endpoint; the student comes from the active assignment."
        crumbs={[{ label: 'Safety & Transport' }, { label: 'GPS Devices' }]}
        actions={
          <>
            {rows.data?.rows.length ? <Button icon="printer" onClick={() => printDeviceLabels(rows.data!.rows)}>Print labels</Button> : null}
            {manage && <Button icon="link" onClick={() => setAssigning({} as GpsDevice)}>Assign device</Button>}
            {manage && <Button variant="primary" icon="plus" onClick={() => setRegistering(true)}>Register device</Button>}
          </>
        }
      />

      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : (
        <Grid cols="g-4col" className="mb-4">
          <Kpi icon="mapPin" loading={!s} label="Total devices" value={s?.total ?? '—'} foot={s ? `${s.assigned} assigned · ${s.available} available` : undefined}
            onClick={() => list.clear()} />
          <Kpi icon="activity" loading={!s} label="Online" value={s?.online ?? '—'} tone="teal" unit={s ? `/ ${s.assigned}` : undefined}
            foot={s ? `Contact in the last ${Math.round(s.thresholds.onlineSeconds / 60)} min` : undefined} onClick={() => list.setFilter('gpsStatus', 'online')} />
          <Kpi icon="alert" loading={!s} label="Offline" value={s ? s.offline + s.stale : '—'} tone="critical"
            foot={s ? `${s.stale} stale · ${offlineFoot}` : undefined} onClick={() => list.setFilter('gpsStatus', 'offline')} />
          <Kpi icon="alert" loading={!s} label="Needs attention" value={s ? s.outOfService + s.lowBattery : '—'} tone="amber"
            foot={s ? `${s.maintenance} repair · ${s.lost} lost · ${s.lowBattery} low battery` : undefined} onClick={() => list.setFilter('status', 'maintenance')} />
        </Grid>
      )}
      {s && (
        <div className="statgrid statgrid--card mb-4">
          <Kpi size="compact" label="Assigned" value={fmt.n(s.assigned)} onClick={() => list.setFilter('status', 'assigned')} />
          <Kpi size="compact" label="Available" value={fmt.n(s.available)} onClick={() => list.setFilter('status', 'available')} />
          <Kpi size="compact" label="Stale signal" value={fmt.n(s.stale)} tone={s.stale ? 'amber' : undefined} onClick={() => list.setFilter('gpsStatus', 'stale')} />
          <Kpi size="compact" label="Low battery" value={fmt.n(s.lowBattery)} tone={s.lowBattery ? 'amber' : undefined} />
          <Kpi size="compact" label="Lost" value={fmt.n(s.lost)} tone={s.lost ? 'critical' : undefined} onClick={() => list.setFilter('status', 'lost')} />
        </div>
      )}

      <Card flush>
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search device ID, IMEI, serial or student" />
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={STATUS_OPTIONS} />
          <FilterSelect label="GPS" value={list.filters.gpsStatus} onChange={(v) => list.setFilter('gpsStatus', v)} options={GPS_OPTIONS} />
          <FilterSelect label="Type" value={list.filters.deviceType} onChange={(v) => list.setFilter('deviceType', v)} options={TYPE_OPTIONS} />
          {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
        </Toolbar>
        {rows.error ? <ErrorState error={rows.error} onRetry={() => rows.refetch()} /> : (
          <DataTable
            rows={rows.data?.rows}
            loading={rows.isLoading}
            rowKey={(r) => r.id}
            sort={list.sort}
            onSort={list.setSort}
            onRowClick={(r) => setOpenId(r.id)}
            emptyText="No devices match the current filters."
            columns={[
              { key: 'code', label: 'Device ID', render: (r) => <span className="coord t-bold">{r.deviceCode}</span> },
              { key: 'imei', label: 'IMEI', sortable: false, render: (r) => <span className="coord t-xs">{r.imei ?? '—'}</span> },
              { key: 'serial', label: 'Serial No.', sortable: false, render: (r) => <span className="t-xs">{r.serialNumber ?? '—'}</span> },
              { key: 'type', label: 'Type', render: (r) => DEVICE_TYPE_LABEL[r.deviceType] },
              { key: 'student', label: 'Assigned Student', render: (r) => (r.studentId ? <StudentLink id={r.studentId} name={r.studentName!} meta={r.admissionNo} /> : <span className="t-faint">—</span>) },
              { key: 'status', label: 'Status', render: (r) => <DeviceStatusBadge status={r.status} /> },
              { key: 'seen', label: 'Last Seen', render: (r) => <GpsStatusBadge status={r.gpsStatus} seenAt={r.lastSeenAt} showSeen /> },
              { key: 'battery', label: 'Battery', className: 'num', render: (r) => <BatteryLevel pct={r.batteryPct} /> },
              {
                key: 'a', label: 'Actions', sortable: false, className: 'num', render: (r) => (
                  <span className="row g-1 end" onClick={(e) => e.stopPropagation()}>
                    {manage && r.assignmentId && (
                      <Button size="sm" onClick={() => unassign.run({ id: r.assignmentId!, deviceCode: r.deviceCode, admissionNo: r.admissionNo!, studentName: r.studentName! })}>Unassign</Button>
                    )}
                    {manage && !r.assignmentId && r.status === 'available' && <Button size="sm" variant="teal" onClick={() => setAssigning(r)}>Assign</Button>}
                    {r.studentId && <Button size="sm" variant="quiet" icon="mapPin" to={`/student-tracking/${r.studentId}`} aria-label={`View location of ${r.deviceCode}`} />}
                  </span>
                ),
              },
            ]}
          />
        )}
        <Pagination meta={rows.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>

      {registering && (
        <RegisterDeviceModal onClose={() => setRegistering(false)}
          onDone={(r) => { setRegistering(false); setToken({ deviceCode: r.device.deviceCode, deviceType: r.device.deviceType, token: r.token }); }} />
      )}
      {token && <TokenModal {...token} onClose={() => setToken(null)} />}
      {assigning && <AssignDeviceModal device={assigning.id ? assigning : undefined} onClose={() => setAssigning(null)} />}
      {openId && (
        <DeviceDetailModal id={openId} manage={manage} onClose={() => setOpenId(null)}
          onAssign={(d) => { setOpenId(null); setAssigning(d); }}
          onToken={(t) => setToken(t)} />
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------
function RegisterDeviceModal({ onClose, onDone }: { onClose: () => void; onDone: (r: { device: GpsDevice; token: string }) => void }) {
  const { campusParam } = useSchool();
  const { lookups } = useLookups();
  const [f, setF] = useState({ deviceCode: '', imei: '', serialNumber: '', deviceType: 'gps_tracker', firmwareVersion: '', campusId: campusParam.campusId ?? '', notes: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = useApiMutation<Record<string, string>, { device: GpsDevice; token: string }>('post', '/devices', {
    invalidate: ['/devices'], success: false, onSuccess: (r) => onDone(r.data),
  });
  const codeOk = !f.deviceCode || /^[A-Za-z0-9][A-Za-z0-9-]{2,49}$/.test(f.deviceCode.trim());
  const imeiOk = !f.imei || /^\d{14,17}$/.test(f.imei.trim());
  const submit = () => {
    if (!codeOk || !imeiOk) return;
    const body: Record<string, string> = { deviceType: f.deviceType };
    for (const k of ['deviceCode', 'imei', 'serialNumber', 'firmwareVersion', 'campusId', 'notes'] as const) if (f[k].trim()) body[k] = f[k].trim();
    save.mutate(body);
  };
  return (
    <Modal open onClose={onClose} busy={save.isPending} title="Register GPS device"
      sub="A secure token is generated and shown once, for loading into the device."
      foot={<><Button onClick={onClose} disabled={save.isPending}>Cancel</Button><Button variant="primary" icon="key" onClick={submit} loading={save.isPending}>Register and create token</Button></>}>
      {save.error ? <div className="mb-4"><InlineError error={save.error} /></div> : null}
      <div className="form-grid">
        <TextField label="Device ID" value={f.deviceCode} onChange={(v) => set('deviceCode')(v.toUpperCase())} maxLength={50}
          hint="Leave blank to generate the next GPS number" error={codeOk ? undefined : 'Capital letters, digits and hyphens only'} placeholder="GPS000123" />
        <SelectField label="Device type" required value={f.deviceType} onChange={set('deviceType')} options={TYPE_OPTIONS} />
        <TextField label="IMEI" value={f.imei} onChange={set('imei')} maxLength={17} error={imeiOk ? undefined : 'IMEI is 14–17 digits'} />
        <TextField label="Serial number" value={f.serialNumber} onChange={set('serialNumber')} maxLength={100} />
        <TextField label="Firmware version" value={f.firmwareVersion} onChange={set('firmwareVersion')} maxLength={50} placeholder="1.0.0" />
        <SelectField label="Campus" value={f.campusId} onChange={set('campusId')} placeholder="—"
          options={(lookups?.campuses ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <TextArea className="span-2" label="Notes" rows={2} value={f.notes} onChange={set('notes')} maxLength={500} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Details: label, history, status changes, token
// ---------------------------------------------------------------------------
function DeviceDetailModal({ id, manage, onClose, onAssign, onToken }: {
  id: string; manage: boolean; onClose: () => void; onAssign: (d: GpsDevice) => void;
  onToken: (t: { deviceCode: string; deviceType?: DeviceType; token: string }) => void;
}) {
  const confirm = useConfirm();
  const q = useApiQuery<GpsDeviceDetail>(`/devices/${id}`);
  const unassign = useUnassign(() => q.refetch());
  const [statusTo, setStatusTo] = useState<null | 'maintenance' | 'lost' | 'inactive'>(null);
  const setStatus = useApiMutation<{ status: string; reason?: string }>('put', `/devices/${id}`, {
    invalidate: ['/devices', '/device-assignments', '/tracking'], onSuccess: () => { setStatusTo(null); q.refetch(); },
  });
  const token = useApiMutation<void, { deviceCode: string; token: string }>('post', `/devices/${id}/token`, {
    invalidate: ['/devices'], body: () => ({}), success: false,
    onSuccess: (r) => onToken({ deviceCode: r.data.deviceCode, deviceType: q.data?.deviceType, token: r.data.token }),
  });
  const d = q.data;

  const newToken = async () => {
    const ok = await confirm({
      title: `Issue a new token for ${d!.deviceCode}?`,
      body: <p>The current token stops working immediately. The device sends nothing until the new token is loaded into it.</p>,
      confirmLabel: 'Issue new token', icon: 'key', danger: d!.hasToken,
    });
    if (ok) token.mutate();
  };

  return (
    <Modal open onClose={onClose} size="wide" title={d ? `Device ${d.deviceCode}` : 'Device'} sub={d ? DEVICE_TYPE_LABEL[d.deviceType] : undefined}>
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !d ? <Skeleton height={320} /> : (
        <div className="col g-4">
          {d.isSampleData && <Banner tone="warning" icon="info">Sample device from the demo data. It has no token until you issue one.</Banner>}
          <div className="row-top g-4 wrap">
            <div className="col g-2" style={{ alignItems: 'center' }}>
              <QrCode text={d.deviceCode} size={150} />
              <span className="coord t-bold">{d.deviceCode}</span>
              <Button size="sm" icon="printer" onClick={() => printDeviceLabels([d])}>Print label</Button>
            </div>
            <div className="grow" style={{ minWidth: 260 }}>
              <Dl items={[
                ['Status', <DeviceStatusBadge key="s" status={d.status} />],
                ['GPS', <span key="g" className="row g-2 wrap"><GpsStatusBadge status={d.gpsStatus} seenAt={d.lastSeenAt} />{d.lastSeenAt ? <span className="t-xs t-muted">{fmt.dateTime(d.lastSeenAt)} · <LastSeen at={d.lastSeenAt} /></span> : <span className="t-xs t-muted">Never connected</span>}</span>],
                ['Assigned student', d.studentId ? <StudentLink key="st" id={d.studentId} name={d.studentName!} meta={`${d.admissionNo} · since ${fmt.date(d.assignedAt!)}`} /> : '—'],
                ['IMEI', <span key="i" className="coord">{d.imei ?? '—'}</span>],
                ['Serial number', d.serialNumber ?? '—'],
                ['Firmware', d.firmwareVersion ?? '—'],
                ['Campus', d.campusName ?? '—'],
                ['Battery', <BatteryLevel key="b" pct={d.batteryPct} />],
                ['Device token', d.hasToken ? `Issued ${fmt.dateTime(d.tokenIssuedAt!)}` : <span key="t" className="t-critical">Not issued — the device cannot send yet</span>],
                ...(d.notes ? [['Notes', d.notes] as [string, string]] : []),
              ]} />
            </div>
          </div>

          {manage && (
            <div className="row g-2 wrap">
              {d.assignmentId ? (
                <Button icon="x" onClick={() => unassign.run({ id: d.assignmentId!, deviceCode: d.deviceCode, admissionNo: d.admissionNo!, studentName: d.studentName! })} loading={unassign.pending}>Unassign</Button>
              ) : d.status === 'available' ? (
                <Button variant="teal" icon="link" onClick={() => onAssign(d)}>Assign to student</Button>
              ) : null}
              {d.studentId && <Button icon="mapPin" to={`/student-tracking/${d.studentId}`}>View location</Button>}
              <Button icon="key" onClick={newToken} loading={token.isPending}>{d.hasToken ? 'Issue new token' : 'Issue token'}</Button>
              {d.status !== 'maintenance' && <Button icon="wrench" onClick={() => setStatusTo('maintenance')}>Maintenance</Button>}
              {d.status !== 'lost' && <Button icon="alert" onClick={() => setStatusTo('lost')}>Mark lost</Button>}
              {d.status !== 'inactive' && <Button icon="pause" onClick={() => setStatusTo('inactive')}>Disable</Button>}
              {['maintenance', 'lost', 'inactive'].includes(d.status) && (
                <Button variant="primary" icon="check" onClick={() => setStatus.mutate({ status: 'available' })} loading={setStatus.isPending}>Back in service</Button>
              )}
            </div>
          )}
          {statusTo && (
            <StatusChange device={d} to={statusTo} busy={setStatus.isPending} error={setStatus.error}
              onCancel={() => setStatusTo(null)} onConfirm={(reason) => setStatus.mutate({ status: statusTo, reason: reason || undefined })} />
          )}

          <div>
            <div className="eyebrow mb-2">Assignment history</div>
            <DataTable
              rows={d.assignments}
              rowKey={(a) => a.id}
              compact
              emptyText="This device has never been assigned."
              columns={[
                { key: 's', label: 'Student', sortable: false, render: (a) => <StudentLink id={a.studentId} name={a.studentName} meta={a.admissionNo} /> },
                { key: 'from', label: 'Assigned', sortable: false, render: (a) => <span className="t-xs">{fmt.dateTime(a.assignedAt)}{a.assignedBy ? <div className="t-muted">by {a.assignedBy}</div> : null}</span> },
                { key: 'to', label: 'Unassigned', sortable: false, render: (a) => (a.unassignedAt ? <span className="t-xs">{fmt.dateTime(a.unassignedAt)}<div className="t-muted">{[a.unassignedBy && `by ${a.unassignedBy}`, a.unassignReason].filter(Boolean).join(' · ')}</div></span> : <DeviceStatusBadge status="assigned" />) },
                { key: 'n', label: 'Locations', sortable: false, className: 'num', render: (a) => fmt.n(a.locationCount ?? 0) },
              ]}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

function StatusChange({ device, to, busy, error, onCancel, onConfirm }: {
  device: GpsDevice; to: 'maintenance' | 'lost' | 'inactive'; busy: boolean; error: unknown; onCancel: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const verb = { maintenance: 'Send for maintenance', lost: 'Mark as lost', inactive: 'Disable device' }[to];
  return (
    <div className="st-panel">
      <div className="t-bold">{verb}</div>
      {device.studentName && (
        <Banner tone="warning" icon="alert">
          {device.deviceCode} is with {device.studentName}. It will be unassigned now; their history is kept. Assign a replacement device from the student's page.
        </Banner>
      )}
      {error ? <InlineError error={error} /> : null}
      <TextField label="Reason (optional)" value={reason} onChange={setReason} maxLength={300} placeholder={to === 'lost' ? 'e.g. Lost on the school trip' : 'e.g. Cracked case'} />
      <div className="row g-2">
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant={to === 'maintenance' ? 'primary' : 'danger'} onClick={() => onConfirm(reason.trim())} loading={busy}>{verb}</Button>
      </div>
    </div>
  );
}
