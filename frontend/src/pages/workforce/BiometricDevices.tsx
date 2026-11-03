import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import { Badge, Banner, Button, DataTable, Modal, SelectField, TextField, useConfirm } from '@/components/ui';
import { fmt } from '@/lib/format';

interface Device {
  id: string; deviceCode: string; name: string; location: string | null; status: 'active' | 'inactive'; campus: string | null;
  lastSeenAt: string | null; tokenIssuedAt: string | null; hasToken: boolean; punchesToday: number;
}

const INVALIDATE = ['/workforce/biometric-devices'];

/** Biometric machines that post punches to the API, with one-time token display. */
export function BiometricDevicesModal({ onClose }: { onClose: () => void }) {
  const { can } = useAuth();
  const manage = can('hr.manage');
  const confirm = useConfirm();
  const q = useApiQuery<Device[]>('/workforce/biometric-devices');
  const [adding, setAdding] = useState(false);
  const [token, setToken] = useState<{ deviceCode: string; token: string } | null>(null);
  const regen = useApiMutation<string, { deviceCode: string; token: string }>('post', (id) => `/workforce/biometric-devices/${id}/token`, {
    invalidate: INVALIDATE, body: () => ({}), onSuccess: (r) => setToken(r.data),
  });
  const toggle = useApiMutation<{ id: string; status: string }>('patch', (v) => `/workforce/biometric-devices/${v.id}`, {
    invalidate: INVALIDATE, body: (v) => ({ status: v.status }),
  });
  const api = `${window.location.origin}/api/v1/attendance/punches`;

  return (
    <Modal open onClose={onClose} size="wide" title="Biometric machines" sub="Each machine (or its bridge software) posts punches with its own token."
      foot={<>
        <Button onClick={onClose}>Close</Button>
        {manage && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add machine</Button>}
      </>}>
      <div className="col g-4">
        {token && <TokenBanner {...token} onDone={() => setToken(null)} />}
        <DataTable compact stack={false} rows={q.data} loading={q.isLoading} rowKey={(d) => d.id}
          emptyText="No machines yet. Add one, or import the machine's attendance log as CSV."
          columns={[
            { key: 'name', label: 'Machine', render: (d) => <span><b>{d.deviceCode}</b> · {d.name}<div className="t-micro t-muted">{[d.campus, d.location].filter(Boolean).join(' · ')}</div></span> },
            { key: 'seen', label: 'Last seen', render: (d) => (d.lastSeenAt ? fmt.dateTime(d.lastSeenAt) : <span className="t-faint">Never</span>) },
            { key: 'punches', label: 'Punches (24 h)', className: 'num', render: (d) => d.punchesToday },
            { key: 'status', label: 'Status', render: (d) => <Badge tone={d.status === 'active' ? 'success' : 'neutral'}>{d.status === 'active' ? 'Active' : 'Inactive'}</Badge> },
            { key: 'a', label: '', className: 'num', render: (d) => manage && (
              <div className="row g-2 end">
                <Button size="sm" loading={regen.isPending && regen.variables === d.id} onClick={async () => {
                  if (await confirm({ title: `New token for ${d.deviceCode}?`, body: 'The old token stops working at once. Update the machine or bridge with the new one.', confirmLabel: 'Issue new token' })) regen.mutate(d.id);
                }}>New token</Button>
                <Button size="sm" variant="quiet" onClick={() => toggle.mutate({ id: d.id, status: d.status === 'active' ? 'inactive' : 'active' })}>
                  {d.status === 'active' ? 'Deactivate' : 'Activate'}
                </Button>
              </div>
            ) },
          ]} />
        <Banner icon="info">
          <span>
            Machines send <code>POST {api}</code> with <code>Authorization: Bearer &lt;token&gt;</code> and
            {' '}<code>{'{"device_id":"BIO-0001","punches":[{"employee_code":"EMP-1001","punched_at":"2026-11-03 08:05"}]}'}</code>.
            Times without a zone are school time. The first punch of the day is check-in, the last is check-out; arrival over 15 minutes after the shift start is Late.
          </span>
        </Banner>
      </div>
      {adding && <AddDeviceModal onClose={() => setAdding(false)} onCreated={(t) => { setAdding(false); setToken(t); }} />}
    </Modal>
  );
}

function TokenBanner({ deviceCode, token, onDone }: { deviceCode: string; token: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Banner tone="warning" icon="key">
      <div className="col g-2">
        <span><b>Token for {deviceCode}</b> — copy it into the machine or bridge now. It is not shown again.</span>
        <code className="t-xs" style={{ wordBreak: 'break-all' }}>{token}</code>
        <div className="row g-2">
          <Button size="sm" icon="copy" onClick={() => { void navigator.clipboard?.writeText(token); setCopied(true); }}>{copied ? 'Copied' : 'Copy token'}</Button>
          <Button size="sm" variant="quiet" onClick={onDone}>I have saved it</Button>
        </div>
      </div>
    </Banner>
  );
}

function AddDeviceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (t: { deviceCode: string; token: string }) => void }) {
  const { lookups } = useLookups();
  const [f, setF] = useState({ name: '', campusId: '', location: '' });
  const [err, setErr] = useState('');
  const add = useApiMutation<Record<string, unknown>, { deviceCode: string; token: string }>('post', '/workforce/biometric-devices', {
    invalidate: INVALIDATE, onSuccess: (r) => onCreated(r.data),
  });
  return (
    <Modal open onClose={onClose} busy={add.isPending} title="Add biometric machine"
      foot={<><Button onClick={onClose} disabled={add.isPending}>Cancel</Button>
        <Button variant="primary" loading={add.isPending} onClick={() => {
          if (f.name.trim().length < 2) { setErr('Give the machine a name, e.g. "Main gate staff entry"'); return; }
          add.mutate({ name: f.name.trim(), campusId: f.campusId || null, location: f.location.trim() || null });
        }}>Add machine</Button></>}>
      <div className="col g-3">
        <TextField label="Name" required value={f.name} onChange={(v) => { setF((x) => ({ ...x, name: v })); setErr(''); }} error={err} maxLength={80} placeholder="Main gate staff entry" />
        <SelectField label="Campus" value={f.campusId} onChange={(v) => setF((x) => ({ ...x, campusId: v }))} placeholder="Any campus"
          options={(lookups?.campuses ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <TextField label="Location" value={f.location} onChange={(v) => setF((x) => ({ ...x, location: v }))} maxLength={120} placeholder="Staff room corridor" />
      </div>
    </Modal>
  );
}
