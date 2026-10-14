/**
 * GPS device building blocks shared by the device pages, Student 360 and the
 * tracking detail: status badges, QR labels, the camera QR scanner, the
 * one-time token dialog and the assign-device dialog.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import qrcode from 'qrcode-generator';
import { API_BASE, ApiError, api } from '@/api/client';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import type { CurrentLocation, DeviceType, GpsDevice, GpsStatus } from '@/api/types';
import {
  Avatar, Badge, Banner, Button, Icon, InlineError, Modal, Segment, Svg, TextArea, useConfirm, useToast,
} from '@/components/ui';
import { fmt } from '@/lib/format';

// ---------------------------------------------------------------------------
// Labels and badges
// ---------------------------------------------------------------------------
export const DEVICE_TYPE_LABEL: Record<DeviceType, string> = {
  gps_tracker: 'GPS tracker',
  id_card_tag: 'ID-card GPS tag',
  wearable: 'Wearable',
  mobile_app: 'Android phone',
};

export const DEVICE_STATUS_TONE: Record<string, string> = {
  available: 'info', assigned: 'success', maintenance: 'warning', inactive: 'neutral', lost: 'critical',
};

const GPS_TONE: Record<GpsStatus, string> = { online: 'success', stale: 'warning', offline: 'critical', never: 'neutral' };
const GPS_LABEL: Record<GpsStatus, string> = { online: 'Online', stale: 'Stale', offline: 'Offline', never: 'Never connected' };

/**
 * Device connectivity badge: dot + word, so the state reads without colour.
 * `showSeen` adds the last ping as relative time ("4 min ago") underneath.
 */
export function GpsStatusBadge({ status, seenAt, showSeen }: { status: GpsStatus | null | undefined; seenAt?: string | null; showSeen?: boolean }) {
  if (!status) return <span className="t-faint">—</span>;
  const badge = (
    <Badge tone={GPS_TONE[status]} dot title={seenAt ? `Last contact ${fmt.dateTime(seenAt)}` : undefined}>
      {GPS_LABEL[status]}
    </Badge>
  );
  if (!showSeen) return badge;
  return (
    <span className="col g-1 st-gps">
      {badge}
      <LastSeen at={seenAt} prefix="Last ping" />
    </span>
  );
}

/** Relative "last seen" time with the exact timestamp on hover. */
export function LastSeen({ at, prefix, empty = 'Never' }: { at?: string | null; prefix?: string; empty?: string }) {
  if (!at) return <span className="st-seen">{prefix ? `${prefix}: ` : ''}{empty}</span>;
  return (
    <time className="st-seen" dateTime={at} title={fmt.dateTime(at)}>
      {prefix ? `${prefix} ` : ''}{fmt.relative(at)}
    </time>
  );
}

/** Battery level shown the same way on every tracking screen (critical below 20 %, low below 40 %). */
export function BatteryLevel({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return <span className="t-faint">—</span>;
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  const tone = v < 20 ? 'critical' : v < 40 ? 'warning' : 'ok';
  return (
    <span className={`st-battery st-battery--${tone}`} title={tone === 'critical' ? 'Battery critically low' : tone === 'warning' ? 'Battery low' : 'Battery'}>
      <span className="st-battery__bar" aria-hidden="true"><span className="st-battery__fill" style={{ width: `calc(${v}% - 2px)` }} /></span>
      {v}%{tone === 'critical' && <span className="sr-only"> — critically low</span>}
    </span>
  );
}

export function DeviceStatusBadge({ status }: { status: string }) {
  return <Badge tone={DEVICE_STATUS_TONE[status] ?? 'neutral'}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}

// ---------------------------------------------------------------------------
// QR codes
// ---------------------------------------------------------------------------
function qrSvg(text: string) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

export function QrCode({ text, size = 168 }: { text: string; size?: number }) {
  const svg = useMemo(() => qrSvg(text), [text]);
  return <Svg html={svg} className="qrcode" style={{ width: size, height: size }} />;
}

/** Opens a print dialog with one sticker per device: QR + device code in text. */
export function printDeviceLabels(devices: Pick<GpsDevice, 'deviceCode' | 'imei'>[]) {
  const w = window.open('', '_blank', 'width=720,height=900');
  if (!w) return false;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const labels = devices.map((d) => `
    <div class="label">
      <div class="qr">${qrSvg(d.deviceCode)}</div>
      <div class="code">${esc(d.deviceCode)}</div>
      ${d.imei ? `<div class="meta">IMEI ${esc(d.imei)}</div>` : ''}
      <div class="meta">Holy Sai · GPS device</div>
    </div>`).join('');
  w.document.write(`<!doctype html><html><head><title>Device labels</title><style>
    body{font-family:system-ui,sans-serif;margin:12mm;display:flex;flex-wrap:wrap;gap:6mm}
    .label{width:50mm;border:1px dashed #999;border-radius:3mm;padding:3mm;text-align:center;break-inside:avoid}
    .qr svg{width:38mm;height:38mm}
    .code{font:700 13pt ui-monospace,monospace;letter-spacing:.5px;margin-top:1mm}
    .meta{font-size:7pt;color:#555}
    @media print{.label{border-color:#ccc}}
  </style></head><body>${labels}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
  return true;
}

/** Server address the Android tracker should use (the API origin, without /api). */
export function trackerServerUrl() {
  if (/^https?:\/\//i.test(API_BASE)) return API_BASE.replace(/\/api$/, '');
  return window.location.origin;
}

// ---------------------------------------------------------------------------
// Camera QR scanner
// ---------------------------------------------------------------------------
interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }

async function makeDecoder(): Promise<(src: HTMLVideoElement | HTMLImageElement, canvas: HTMLCanvasElement) => Promise<string | null>> {
  const BD = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (BD && (await BD.getSupportedFormats?.())?.includes('qr_code')) {
    const det = new BD({ formats: ['qr_code'] });
    return async (src) => (await det.detect(src))[0]?.rawValue ?? null;
  }
  // Browsers without a native detector (e.g. desktop Chrome on Windows, Firefox) decode in JS.
  const { default: jsQR } = await import('jsqr');
  return async (src, canvas) => {
    const w = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
    const h = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
    if (!w || !h) return null;
    const scale = Math.min(1, 960 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
  };
}

/**
 * Scans a QR with the camera; falls back to a photo of the label (works on
 * any phone) and to typing the code printed under the QR.
 */
export function QrScanner({ onResult, busy }: { onResult: (text: string) => void; busy?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileId = useId();
  const [state, setState] = useState<'idle' | 'starting' | 'scanning' | 'error'>('idle');
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  const stopRef = useRef<() => void>(() => undefined);
  const done = useRef(onResult);
  done.current = onResult;

  useEffect(() => () => stopRef.current(), []);

  const start = async () => {
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState('error');
      setError('The camera needs a secure (https) connection. Take a photo of the label or type the code instead.');
      return;
    }
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      let alive = true;
      stopRef.current = () => {
        alive = false;
        stream.getTracks().forEach((t) => t.stop());
        if (videoRef.current) videoRef.current.srcObject = null;
      };
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      const decode = await makeDecoder();
      setState('scanning');
      const tick = async () => {
        if (!alive) return;
        try {
          const text = await decode(video, canvasRef.current!);
          if (text && alive) {
            stopRef.current();
            setState('idle');
            done.current(text);
            return;
          }
        } catch { /* frame not ready */ }
        setTimeout(tick, 200);
      };
      tick();
    } catch (e) {
      stopRef.current();
      setState('error');
      const name = (e as Error).name;
      setError(name === 'NotAllowedError' ? 'Camera permission was refused. Allow camera access, or take a photo of the label instead.'
        : name === 'NotFoundError' ? 'No camera was found on this device. Take a photo of the label or type the code.'
          : 'The camera could not be started. Take a photo of the label or type the code.');
    }
  };

  const fromPhoto = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const text = await (await makeDecoder())(img, canvasRef.current!);
      if (text) onResult(text);
      else setError('No QR code found in that photo. Hold the label flat, fill the frame and try again.');
    } catch {
      setError('That photo could not be read.');
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="col g-3">
      <div className="qrscan" data-state={state}>
        <video ref={videoRef} muted playsInline aria-label="Camera preview" />
        {state === 'scanning' && <div className="qrscan__frame" aria-hidden="true" />}
        {state !== 'scanning' && (
          <div className="qrscan__idle">
            <Icon name="qr" size={40} />
            <Button variant="primary" icon="camera" onClick={start} loading={state === 'starting'} disabled={busy}>Scan device QR</Button>
          </div>
        )}
        <canvas ref={canvasRef} hidden />
      </div>
      {state === 'scanning' && (
        <div className="row g-2 between">
          <span className="t-xs t-muted">Point the camera at the QR label on the device.</span>
          <Button size="sm" variant="quiet" onClick={() => { stopRef.current(); setState('idle'); }}>Stop camera</Button>
        </div>
      )}
      {error && <Banner tone="warning" icon="camera">{error}</Banner>}
      <div className="st-scanrow">
        <label htmlFor={fileId} className="btn btn--ghost btn--sm"><Icon name="upload" size={14} />Photo of label</label>
        <input id={fileId} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { fromPhoto(e.target.files?.[0]); e.target.value = ''; }} />
        <span className="t-xs t-muted">or</span>
        <form className="row g-2 grow" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) onResult(typed.trim()); }}>
          <input className="input grow" placeholder="Type device ID or IMEI, e.g. GPS000123" value={typed} aria-label="Device ID or IMEI"
            onChange={(e) => setTyped(e.target.value)} />
          <Button type="submit" size="sm" disabled={!typed.trim() || busy}>Find</Button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One-time token
// ---------------------------------------------------------------------------
export function TokenModal({ deviceCode, deviceType, token, onClose }: { deviceCode: string; deviceType?: DeviceType; token: string; onClose: () => void }) {
  const toast = useToast();
  const [view, setView] = useState<'text' | 'phone'>(deviceType === 'mobile_app' ? 'phone' : 'text');
  const server = trackerServerUrl();
  const setupUri = `holysai-tracker:setup?server=${encodeURIComponent(server)}&device=${encodeURIComponent(deviceCode)}&token=${encodeURIComponent(token)}`;
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`, 'success');
    } catch {
      toast('Copy failed — select the text and copy it manually', 'warning');
    }
  };
  return (
    <Modal open onClose={onClose} title={`Device token — ${deviceCode}`} sub="Shown only once. Store it in the device now."
      foot={<Button variant="primary" onClick={onClose}>I have stored the token</Button>}>
      <div className="col g-4">
        <Banner tone="warning" icon="lock">
          This token lets the device send locations. It is <strong>not stored</strong> on the server and cannot be shown again —
          if it is lost, issue a new one. Never print it on the device label.
        </Banner>
        <Segment items={[{ id: 'text', label: 'Firmware / manual' }, { id: 'phone', label: 'Android phone setup' }]} active={view} onChange={setView} />
        {view === 'text' ? (
          <div className="col g-3">
            <CopyRow label="Endpoint" value={`${server}/api/v1/location`} onCopy={() => copy(`${server}/api/v1/location`, 'Endpoint')} />
            <CopyRow label="Device ID" value={deviceCode} onCopy={() => copy(deviceCode, 'Device ID')} />
            <CopyRow label="Token" value={token} onCopy={() => copy(token, 'Token')} secret />
            <div className="t-xs t-muted">Send it as <span className="coord">Authorization: Bearer &lt;token&gt;</span> on every request.</div>
          </div>
        ) : (
          <div className="row g-4 wrap">
            <QrCode text={setupUri} size={220} />
            <div className="col g-2" style={{ flex: '1 1 200px' }}>
              <div className="t-bold">Scan with the Holy Sai app</div>
              <ol className="t-sm" style={{ paddingLeft: 18, margin: 0 }}>
                <li>Open the app → <strong>GPS Tracker mode</strong>.</li>
                <li>Tap <strong>Scan setup QR</strong> and point it at this code.</li>
                <li>Close this window once the phone shows <em>Ready</em>.</li>
              </ol>
              <div className="t-xs t-muted">This QR contains the token. Show it only on this screen — do not print or share it.</div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function CopyRow({ label, value, onCopy, secret }: { label: string; value: string; onCopy: () => void; secret?: boolean }) {
  return (
    <div className="col g-1">
      <span className="eyebrow">{label}</span>
      <div className="row g-2">
        <code className={`coord st-copy${secret ? ' st-copy--secret' : ''}`}>{value}</code>
        <Button size="sm" icon="copy" onClick={onCopy} aria-label={`Copy ${label}`} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Student picker (tracking-scoped search)
// ---------------------------------------------------------------------------
export interface PickedStudent { id: string; admissionNo: string; fullName: string; grade?: string | null; section?: string | null }

function StudentSearch({ value, onChange }: { value: PickedStudent | null; onChange: (s: PickedStudent | null) => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const res = useApiQuery<CurrentLocation[]>(value || q.length < 2 ? null : '/tracking/students', { q, pageSize: 8 }, { staleTime: 30_000 });
  if (value) {
    return (
      <div className="st-picked">
        <Avatar name={value.fullName} size="sm" />
        <span className="col grow" style={{ minWidth: 0 }}>
          <span className="t-sm t-bold t-clip">{value.fullName}</span>
          <span className="t-micro t-muted">{[value.admissionNo, value.grade ? `${value.grade}${value.section ?? ''}` : null].filter(Boolean).join(' · ')}</span>
        </span>
        <Button size="sm" variant="quiet" onClick={() => { onChange(null); setText(''); }}>Change</Button>
      </div>
    );
  }
  return (
    <div className="col g-1">
      <div className="input-icon">
        <Icon name="search" size={15} />
        <input id={id} className="input" type="search" placeholder="Search by name or admission number" value={text}
          aria-label="Search students" onChange={(e) => setText(e.target.value)} autoComplete="off" />
      </div>
      {q.length >= 2 && (
        <div className="st-results" role="listbox" aria-label="Matching students">
          {res.isLoading ? <div className="st-results__msg">Searching…</div>
            : !res.data?.length ? <div className="st-results__msg">No students match “{q}”.</div>
            : res.data.map((s) => (
              <button key={s.studentId} type="button" role="option" aria-selected={false} className="person person--link st-results__opt"
                onClick={() => onChange({ id: s.studentId, admissionNo: s.admissionNo, fullName: s.fullName, grade: s.grade, section: s.section })}>
                <Avatar name={s.fullName} size="xs" />
                <span className="col">
                  <span className="person__name t-clip">{s.fullName}</span>
                  <span className="person__meta t-clip">{[s.admissionNo, s.grade ? `${s.grade}${s.section ?? ''}` : null, s.deviceCode ? `has ${s.deviceCode}` : 'no device'].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assign a device
// ---------------------------------------------------------------------------
function DeviceCard({ d, onChange }: { d: GpsDevice; onChange?: () => void }) {
  return (
    <div className="st-picked">
      <Icon name="mapPin" size={20} />
      <span className="col grow" style={{ minWidth: 0 }}>
        <span className="row g-2"><span className="t-bold coord">{d.deviceCode}</span><DeviceStatusBadge status={d.status} /></span>
        <span className="t-micro t-muted">
          {[DEVICE_TYPE_LABEL[d.deviceType], d.imei && `IMEI ${d.imei}`, d.studentName ? `with ${d.studentName} (${d.admissionNo})` : 'not assigned'].filter(Boolean).join(' · ')}
        </span>
      </span>
      {onChange && <Button size="sm" variant="quiet" onClick={onChange}>Change</Button>}
    </div>
  );
}

/**
 * Scan the QR on a device (or pick one) and link it to a student. When the
 * device is with someone else, or the student already has one, the API says
 * so and the dialog asks before reassigning.
 */
export function AssignDeviceModal({ student: presetStudent, device: presetDevice, onClose, onDone }: {
  student?: PickedStudent;
  device?: GpsDevice;
  onClose: () => void;
  onDone?: () => void;
}) {
  const confirm = useConfirm();
  const [student, setStudent] = useState<PickedStudent | null>(presetStudent ?? null);
  const [device, setDevice] = useState<GpsDevice | null>(presetDevice ?? null);
  const [mode, setMode] = useState<'scan' | 'list'>('scan');
  const [notes, setNotes] = useState('');
  const [lookupError, setLookupError] = useState<unknown>(null);
  const [looking, setLooking] = useState(false);
  const available = useApiQuery<GpsDevice[]>(device || mode !== 'list' ? null : '/devices', { status: 'available', pageSize: 100, sort: 'code' });

  const save = useApiMutation<{ studentId: string; deviceId: string; notes?: string; reassign?: boolean }, { deviceCode: string; studentName: string }>(
    'post', '/device-assignments', { invalidate: ['/devices', '/device-assignments', '/tracking', '/students'], error: false },
  );

  const lookup = async (text: string) => {
    setLookupError(null);
    setLooking(true);
    try {
      setDevice(await api.get<GpsDevice>('/devices/lookup', { code: text }));
    } catch (e) {
      setLookupError(e);
    } finally {
      setLooking(false);
    }
  };

  const submit = async (reassign = false) => {
    if (!student || !device) return;
    try {
      await save.mutateAsync({ studentId: student.id, deviceId: device.id, notes: notes.trim() || undefined, reassign });
      onDone?.();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'REASSIGN_REQUIRED' && !reassign) {
        const ok = await confirm({
          title: 'Reassign this device?',
          body: <p>{e.message.replace(/ Confirm to reassign\.$/, '')}. The current assignment ends now; its location history is kept.</p>,
          confirmLabel: 'Reassign', icon: 'refresh',
        });
        if (ok) await submit(true);
      }
    }
  };

  const blocked = device && !['available', 'assigned'].includes(device.status);
  return (
    <Modal open onClose={onClose} busy={save.isPending} title="Assign GPS device"
      sub="Scan the QR label on the device, or choose one from the store."
      foot={
        <>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button variant="primary" icon="link" onClick={() => submit()} loading={save.isPending} disabled={!student || !device || !!blocked}>Assign device</Button>
        </>
      }>
      <div className="col g-4">
        {save.error && !(save.error instanceof ApiError && save.error.code === 'REASSIGN_REQUIRED') && <InlineError error={save.error} />}
        <Field label="Student">
          {presetStudent ? <StudentChip s={presetStudent} /> : <StudentSearch value={student} onChange={setStudent} />}
        </Field>
        <Field label="Device">
          {device ? (
            <>
              <DeviceCard d={device} onChange={presetDevice ? undefined : () => setDevice(null)} />
              {blocked && <div className="mt-2"><Banner tone="critical" icon="alert">This device is {device.status}. Mark it available on the GPS Devices page first.</Banner></div>}
              {device.studentId && device.studentId !== student?.id && !blocked && (
                <div className="mt-2 t-xs t-muted"><Icon name="info" size={12} /> Assigning moves it from {device.studentName}; you will be asked to confirm.</div>
              )}
            </>
          ) : (
            <div className="col g-3">
              <Segment items={[{ id: 'scan', label: 'Scan QR' }, { id: 'list', label: 'Available devices' }]} active={mode} onChange={setMode} />
              {mode === 'scan' ? (
                <>
                  <QrScanner onResult={lookup} busy={looking} />
                  {lookupError ? <InlineError error={lookupError} /> : null}
                </>
              ) : available.isLoading ? <div className="t-sm t-muted">Loading…</div> : !available.data?.length ? (
                <div className="t-sm t-muted">No devices are available. Register one on the GPS Devices page.</div>
              ) : (
                <div className="st-results" role="listbox" aria-label="Available devices">
                  {available.data.map((d) => (
                    <button key={d.id} type="button" role="option" aria-selected={false} className="person person--link st-results__opt"
                      onClick={() => setDevice(d)}>
                      <Icon name="mapPin" size={16} />
                      <span className="col">
                        <span className="person__name coord">{d.deviceCode}</span>
                        <span className="person__meta">{[DEVICE_TYPE_LABEL[d.deviceType], d.imei && `IMEI ${d.imei}`, d.campusName].filter(Boolean).join(' · ')}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Field>
        {student && device && (
          <div className="row g-2 t-sm center">
            <strong>{student.admissionNo}</strong><Icon name="link" size={14} /><strong className="coord">{device.deviceCode}</strong>
          </div>
        )}
        <TextArea label="Notes (optional)" rows={2} value={notes} onChange={setNotes} maxLength={500} placeholder="e.g. Issued with new ID card" />
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="field"><span className="label">{label}</span>{children}</div>;
}

function StudentChip({ s }: { s: PickedStudent }) {
  return (
    <div className="st-picked">
      <Avatar name={s.fullName} size="sm" />
      <span className="col"><span className="t-sm t-bold">{s.fullName}</span><span className="t-micro t-muted">{s.admissionNo}</span></span>
    </div>
  );
}

/** Confirm, then end an assignment. History (assignment and locations) is kept. */
export function useUnassign(onDone?: () => void) {
  const confirm = useConfirm();
  const m = useApiMutation<{ id: string; reason?: string }>('post', (v) => `/device-assignments/${v.id}/unassign`, {
    invalidate: ['/devices', '/device-assignments', '/tracking', '/students'],
    body: (v) => ({ reason: v.reason }),
    onSuccess: () => onDone?.(),
  });
  const run = async (a: { id: string; deviceCode: string; admissionNo: string; studentName?: string }) => {
    const ok = await confirm({
      title: `Are you sure you want to unassign ${a.deviceCode} from ${a.admissionNo}?`,
      body: <p>{a.studentName ?? a.admissionNo} will stop being tracked by this device and it becomes available for another student. Assignment and location history are kept.</p>,
      confirmLabel: 'Unassign device', danger: true, icon: 'x',
    });
    if (ok) m.mutate({ id: a.id, reason: 'Unassigned by administrator' });
  };
  return { run, pending: m.isPending };
}

