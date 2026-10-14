import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { Avatar, Badge, Banner, Button, Card, DataTable, ErrorState, Grid, Icon, InlineError, Page, PageHead, Tabs, TextField, useConfirm } from '@/components/ui';
import { fmt } from '@/lib/format';

type Tab = 'profile' | 'security' | 'notifications' | 'sessions';
interface Pref { topic: string; inApp: boolean; whatsapp: boolean; sms: boolean; email: boolean; push: boolean }
const TOPICS = ['attendance', 'tracking', 'fees', 'transport', 'homework', 'events', 'circulars', 'safety', 'system'];

export default function AccountPage() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'profile';
  if (!user) return null;
  return (
    <Page>
      <PageHead title="My account" sub="Your profile, password, notification preferences and signed-in devices." />
      <section className="card profilehead">
        <div className="profilehead__main">
          <Avatar name={user.fullName} size="xl" tone="avatar--amber" />
          <div className="profilehead__id">
            <h2 className="profilehead__name">{user.fullName}</h2>
            <p className="profilehead__meta">{user.title || user.role.name}</p>
            <div className="profilehead__facts">
              <span><Icon name="mail" size={14} />{user.email}</span>
              {user.campus_name && <span><Icon name="building" size={14} />{user.campus_name}</span>}
              {user.academic_year && <span><Icon name="calendar" size={14} />{user.academic_year}</span>}
            </div>
          </div>
          <div className="profilehead__actions"><Badge tone="info" lg>{user.role.name}</Badge></div>
        </div>
      </section>
      <div className="tabsbar">
        <Tabs<Tab>
          items={[{ id: 'profile', label: 'Profile' }, { id: 'security', label: 'Password' }, { id: 'notifications', label: 'Notification preferences' }, { id: 'sessions', label: 'Privacy & sessions' }]}
          active={tab}
          onChange={(t) => setSp(t === 'profile' ? {} : { tab: t }, { replace: true })}
        />
      </div>
      <div className="mt-4">
        {tab === 'profile' && (
          <Card icon="user" title="Profile" sub="Details held on your school account">
            <div className="formsection">
              <div className="formsection__title">Identity</div>
              <dl className="dl">
                <dt>Name</dt><dd>{user.fullName}</dd>
                <dt>Title</dt><dd>{user.title ?? '—'}</dd>
                <dt>Email</dt><dd>{user.email}</dd>
              </dl>
            </div>
            <div className="formsection">
              <div className="formsection__title">Access</div>
              <dl className="dl">
                <dt>Role</dt><dd><Badge tone="info">{user.role.name}</Badge></dd>
                <dt>Campus</dt><dd>{user.campus_name ?? '—'}</dd>
                <dt>Academic year</dt><dd>{user.academic_year ?? '—'}</dd>
                <dt>Permissions</dt><dd>{user.permissions.length} granted by your role</dd>
              </dl>
            </div>
            <p className="t-xs t-muted mt-4 row g-2"><Icon name="info" size={14} />To correct your name or contact details, contact the school office — changes to identity records are verified.</p>
          </Card>
        )}
        {tab === 'security' && <PasswordForm />}
        {tab === 'notifications' && <Preferences />}
        {tab === 'sessions' && <Sessions />}
      </div>
    </Page>
  );
}

function PasswordForm() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [v, setV] = useState({ current: '', next: '', confirm: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const save = useApiMutation<{ currentPassword: string; newPassword: string }>('post', '/auth/change-password', {
    error: false,
    success: 'Password changed — please sign in again',
    onSuccess: async () => { await logout(); navigate('/login', { replace: true }); },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const x: Record<string, string> = {};
    if (!v.current) x.current = 'Enter your current password';
    if (v.next.length < 10 || !/[a-z]/.test(v.next) || !/[A-Z]/.test(v.next) || !/[0-9]/.test(v.next)) x.next = 'At least 10 characters with upper case, lower case and a number';
    if (v.next !== v.confirm) x.confirm = 'Passwords do not match';
    setErr(x);
    if (!Object.keys(x).length) save.mutate({ currentPassword: v.current, newPassword: v.next });
  };
  return (
    <Card icon="grid" title="Change password" sub="You will be signed out of every device after the change.">
      <form className="col g-4 oi-form-narrow" onSubmit={submit} noValidate>
        {save.error && <InlineError error={save.error} />}
        <div className="formsection">
          <div className="formsection__title">Verify it’s you</div>
          <TextField label="Current password" type="password" autoComplete="current-password" required value={v.current} onChange={(x) => setV({ ...v, current: x })} error={err.current} />
        </div>
        <div className="formsection">
          <div className="formsection__title">New password</div>
          <div className="col g-4">
            <TextField label="New password" type="password" autoComplete="new-password" required value={v.next} onChange={(x) => setV({ ...v, next: x })} error={err.next ?? (save.error instanceof ApiError ? save.error.fieldErrors.newPassword : undefined)} hint="At least 10 characters, with upper case, lower case and a number." />
            <TextField label="Confirm new password" type="password" autoComplete="new-password" required value={v.confirm} onChange={(x) => setV({ ...v, confirm: x })} error={err.confirm} />
          </div>
        </div>
        <div><Button variant="primary" type="submit" icon="lock" loading={save.isPending}>Change password</Button></div>
      </form>
    </Card>
  );
}

function Preferences() {
  const q = useApiQuery<Pref[]>('/notification-preferences');
  const [rows, setRows] = useState<Pref[]>([]);
  const [baseline, setBaseline] = useState('');
  useEffect(() => {
    if (!q.data) return;
    const next = TOPICS.map((t) => q.data!.find((p) => p.topic === t) ?? { topic: t, inApp: true, whatsapp: true, sms: false, email: true, push: true });
    setRows(next);
    setBaseline(JSON.stringify(next));
  }, [q.data]);
  const save = useApiMutation<Pref[]>('put', '/notification-preferences', { invalidate: ['/notification-preferences'], success: 'Preferences saved', error: false });
  const dirty = useMemo(() => baseline !== '' && JSON.stringify(rows) !== baseline, [rows, baseline]);
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const toggle = (i: number, k: keyof Omit<Pref, 'topic'>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: !x[k] } : x)));
  const ch = (k: keyof Omit<Pref, 'topic'>, label: string) => ({
    key: k, label, className: 't-center', render: (r: Pref) => <input type="checkbox" className="oi-check" aria-label={`${label} for ${r.topic}`} checked={r[k]} onChange={() => toggle(rows.indexOf(r), k)} />,
  });
  return (
    <Card title="Notification preferences" sub="Choose how each topic reaches you. Critical safety alerts are always shown in the app." flush
      foot={
        <div className="row g-3 wrap">
          <Button variant="primary" icon="save" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(rows)}>Save preferences</Button>
          {dirty && <Button onClick={() => setRows(JSON.parse(baseline) as Pref[])} disabled={save.isPending}>Discard changes</Button>}
          <span className="t-xs t-muted">{dirty ? 'You have unsaved changes' : save.isSuccess ? 'All changes saved' : 'No changes'}</span>
        </div>
      }>
      {save.error && <div className="card__body"><InlineError error={save.error} /></div>}
      <div className="oi-scroll-x">
        <DataTable rows={rows} loading={q.isLoading} rowKey={(r) => r.topic} stack={false}
          columns={[{ key: 'topic', label: 'Topic', render: (r) => <span className="t-bold oi-cap">{r.topic}</span> },
            ch('inApp', 'In-app'), ch('push', 'Push'), ch('whatsapp', 'WhatsApp'), ch('sms', 'SMS'), ch('email', 'Email')]} />
      </div>
    </Card>
  );
}

interface Session { family_id: string; client_type: string; user_agent: string | null; ip: string | null; started_at: string; last_active_at: string }

function Sessions() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const q = useApiQuery<Session[]>('/auth/sessions');
  const revoke = useApiMutation('post', '/auth/sessions/revoke-all', { onSuccess: async () => { await logout(); navigate('/login', { replace: true }); } });
  return (
    <Grid cols="g-main">
      <Card icon="grid" title="Signed-in devices" sub={q.data ? `${q.data.length} active session${q.data.length === 1 ? '' : 's'}` : undefined} flush>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable rows={q.data} loading={q.isLoading} rowKey={(r) => r.family_id} emptyText="No active sessions."
            columns={[
              { key: 'client', label: 'Client', render: (r) => <Badge tone="info">{r.client_type}</Badge> },
              { key: 'agent', label: 'Device', render: (r) => <span className="t-xs t-clip oi-clip-device" title={r.user_agent ?? undefined}>{r.user_agent ?? '—'}</span> },
              { key: 'ip', label: 'IP', render: (r) => <span className="t-mono t-xs">{r.ip ?? '—'}</span> },
              { key: 'last', label: 'Last active', render: (r) => fmt.dateTime(r.last_active_at) },
            ]} />
        )}
      </Card>
      <Card icon="grid" title="Privacy and access">
        <p className="t-sm">Your data is visible only to people whose role requires it. Views of sensitive records — including student locations — are recorded in the audit trail.</p>
        <div className="mt-4">
          <Banner tone="warning" icon="logout">Lost a device or shared a password? Sign out everywhere, then change your password.</Banner>
        </div>
        <div className="mt-4">
          <Button variant="danger" icon="logout" loading={revoke.isPending} onClick={async () => {
            if (await confirm({ title: 'Sign out everywhere?', body: 'Every device, including this one, will need to sign in again.', confirmLabel: 'Sign out everywhere', danger: true, icon: 'logout' })) revoke.mutate({});
          }}>Sign out of all devices</Button>
        </div>
      </Card>
    </Grid>
  );
}
