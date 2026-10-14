import { useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import {
  Badge, Banner, Button, Card, Checkbox, DataTable, Empty, ErrorState, FilterSelect, Grid, InlineError, Modal, Page, PageHead, Pagination, SearchInput, SelectField,
  Status, Tabs, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import { fmt } from '@/lib/format';

interface UserRow { id: string; email: string; phone: string | null; fullName: string; title: string | null; status: string; role: string; roleName: string; lastLoginAt: string | null; lockedUntil: string | null }
interface RoleRow { id: string; key: string; name: string; description: string; scope: string; permissions: string[]; users: number }
interface RolesData { roles: RoleRow[]; permissions: { key: string; module: string; description: string }[] }

const EMPTY_FORM = { fullName: '', email: '', phone: '', title: '', roleKey: '', campusId: '', password: '' };

export default function AdminUsersPage() {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  return (
    <Page>
      <PageHead title="Users & Roles" sub="Accounts, role assignment and the permissions each role grants. Every change is audited." />
      <div className="tabsbar oi-tabsbar-top">
        <Tabs items={[{ id: 'users', label: 'Users' }, { id: 'roles', label: 'Roles & permissions' }]} active={tab} onChange={setTab} />
      </div>
      <div className="mt-4">{tab === 'users' ? <Users /> : <Roles />}</div>
    </Page>
  );
}

function Users() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const { lookups } = useLookups();
  const list = useListParams({ pageSize: 25 }, ['role']);
  const q = usePagedQuery<UserRow>('/users', { page: list.page, pageSize: list.pageSize, q: list.q || undefined, role: list.filters.role || undefined });
  const roles = lookups?.roles ?? [];
  const [creating, setCreating] = useState(false);
  const [tried, setTried] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const patch = useApiMutation<{ id: string; body: Record<string, unknown> }>('patch', (v) => `/users/${v.id}`, { invalidate: ['/users'], body: (v) => v.body, success: 'User updated' });
  const create = useApiMutation<typeof form>('post', '/users', {
    invalidate: ['/users'], success: 'User created', error: false,
    body: (v) => ({ ...v, phone: v.phone || undefined, title: v.title || undefined, campusId: v.campusId || undefined }),
    onSuccess: () => { setCreating(false); setTried(false); setForm(EMPTY_FORM); },
  });
  const pwOk = form.password.length >= 10 && /[a-z]/.test(form.password) && /[A-Z]/.test(form.password) && /[0-9]/.test(form.password);
  const errors = {
    fullName: form.fullName.trim().length >= 2 ? undefined : 'Enter the full name (at least 2 characters)',
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) ? undefined : 'Enter a valid email address',
    roleKey: form.roleKey ? undefined : 'Choose a role',
    password: pwOk ? undefined : 'At least 10 characters with upper case, lower case and a number',
  };
  const valid = !errors.fullName && !errors.email && !errors.roleKey && !errors.password;
  const show = (k: keyof typeof errors, touched: boolean) => ((tried || touched) ? errors[k] : undefined);
  const closeCreate = () => { setCreating(false); setTried(false); create.reset(); };
  const submit = () => {
    setTried(true);
    if (valid) create.mutate(form);
  };
  const isLocked = (r: UserRow) => !!r.lockedUntil && new Date(r.lockedUntil) > new Date();

  return (
    <>
      <Card flush>
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search name or email" />
          <FilterSelect label="Role" value={list.filters.role} onChange={(v) => list.setFilter('role', v)} options={roles.map((r) => ({ value: r.key, label: r.name }))} />
          <div className="spacer" />
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New user</Button>
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id}
            emptyText={list.q || list.filters.role ? 'No users match this search or role filter.' : 'No user accounts yet — create one with “New user”.'}
            columns={[
              { key: 'name', label: 'User', render: (r) => <><span className="t-bold">{r.fullName}</span><div className="t-micro t-muted">{r.email}{r.title ? ` · ${r.title}` : ''}</div></> },
              { key: 'role', label: 'Role', render: (r) => (
                <select className="select oi-select-auto" aria-label={`Role for ${r.fullName}`} value={r.role} disabled={r.id === user?.id || patch.isPending}
                  onChange={async (e) => {
                    const roleKey = e.target.value;
                    if (await confirm({ title: 'Change role?', body: `${r.fullName} will be signed out and receive the permissions of ${roles.find((x) => x.key === roleKey)?.name}.`, confirmLabel: 'Change role' })) {
                      patch.mutate({ id: r.id, body: { roleKey } });
                    }
                  }}>
                  {roles.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                </select>
              ) },
              { key: 'status', label: 'Status', render: (r) => (
                <div className="row g-2 wrap">
                  <Status value={r.status === 'active' ? 'Active' : 'Rejected'} label={r.status} dot />
                  {isLocked(r) && <Badge tone="warning" icon="lock">Locked</Badge>}
                </div>
              ) },
              { key: 'last', label: 'Last sign-in', render: (r) => (r.lastLoginAt ? fmt.dateTime(r.lastLoginAt) : <span className="t-faint">Never</span>) },
              { key: 'actions', label: '', className: 'num', render: (r) => r.id === user?.id ? <Badge>You</Badge> : (
                <div className="row g-2 end wrap">
                  {isLocked(r) && <Button size="sm" icon="lock" onClick={() => patch.mutate({ id: r.id, body: { unlock: true } })}>Unlock</Button>}
                  <Button size="sm" variant={r.status === 'active' ? 'danger' : 'teal'} onClick={async () => {
                    const next = r.status === 'active' ? 'suspended' : 'active';
                    if (next === 'active'
                      ? await confirm({ title: 'Reactivate account?', body: `${r.fullName} will be able to sign in again with their existing role.`, confirmLabel: 'Reactivate' })
                      : await confirm({ title: 'Suspend account?', body: `${r.fullName} will be signed out immediately and cannot sign in until reactivated.`, confirmLabel: 'Suspend', danger: true })) {
                      patch.mutate({ id: r.id, body: { status: next } });
                    }
                  }}>{r.status === 'active' ? 'Suspend' : 'Reactivate'}</Button>
                </div>
              ) },
            ]} />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      <Modal open={creating} onClose={closeCreate} title="New user" sub="The user signs in with this email and the temporary password." busy={create.isPending}
        foot={<><Button onClick={closeCreate} disabled={create.isPending}>Cancel</Button><Button variant="primary" icon="plus" loading={create.isPending} onClick={submit}>Create user</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          {create.error && <div className="mb-4"><InlineError error={create.error} /></div>}
          <div className="formsection">
            <div className="formsection__title">Person</div>
            <div className="form-grid">
              <TextField label="Full name" required value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} autoFocus error={show('fullName', false)} />
              <TextField label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} hint="e.g. Class Teacher, Accountant" />
              <TextField label="Email" type="email" required value={form.email} onChange={(v) => setForm({ ...form, email: v })} error={show('email', false)} />
              <TextField label="Mobile" type="tel" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
            </div>
          </div>
          <div className="formsection">
            <div className="formsection__title">Access</div>
            <div className="form-grid">
              <SelectField label="Role" required value={form.roleKey} placeholder="Select…" onChange={(v) => setForm({ ...form, roleKey: v })} options={roles.map((r) => ({ value: r.key, label: r.name }))} error={show('roleKey', false)} hint="Determines what the user can see and do." />
              <SelectField label="Campus" value={form.campusId} placeholder="All / not set" onChange={(v) => setForm({ ...form, campusId: v })} options={(lookups?.campuses ?? []).map((c) => ({ value: c.id, label: c.name }))} />
              <TextField className="span-2" label="Temporary password" type="password" autoComplete="new-password" required value={form.password}
                onChange={(v) => setForm({ ...form, password: v })} error={show('password', !!form.password)}
                hint="At least 10 characters with upper case, lower case and a number. Share it securely; the user should change it after first sign-in." />
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}

function Roles() {
  const q = useApiQuery<RolesData>('/roles');
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const confirm = useConfirm();
  const role = q.data?.roles.find((r) => r.id === sel) ?? q.data?.roles[0];
  const save = useApiMutation<string[]>('put', `/roles/${role?.id}/permissions`, { invalidate: ['/roles'], body: (p) => ({ permissions: p }), success: 'Role permissions updated', onSuccess: () => setDraft(null) });
  const grouped = useMemo(() => {
    const m: Record<string, RolesData['permissions']> = {};
    (q.data?.permissions ?? []).forEach((p) => (m[p.module] ??= []).push(p));
    return m;
  }, [q.data]);
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const current = draft ?? new Set(role?.permissions ?? []);
  const locked = role?.key === 'super_admin';
  const changed = draft && role ? [...draft].filter((p) => !role.permissions.includes(p)).length + role.permissions.filter((p) => !draft.has(p)).length : 0;
  const pick = async (id: string) => {
    if (id === role?.id) return;
    if (draft && !(await confirm({ title: 'Discard unsaved changes?', body: `Your permission changes to ${role?.name} have not been saved.`, confirmLabel: 'Discard', danger: true }))) return;
    setSel(id);
    setDraft(null);
  };
  return (
    <Grid cols="g-side">
      <Card icon="grid" title="Roles" sub={q.data ? `${q.data.roles.length} roles` : undefined} flush>
        {q.isLoading ? <div className="card__body t-sm t-muted">Loading roles…</div> : q.data?.roles.length ? (
          <div>
            {q.data.roles.map((r) => (
              <button key={r.id} type="button" className="optioncard oi-rolecard" aria-pressed={r.id === role?.id} onClick={() => pick(r.id)}>
                <span className="col grow"><span className="t-sm t-bold">{r.name}</span><span className="t-xs t-muted">{r.users} users · {r.scope} scope</span></span>
                <Badge title="Permissions granted">{r.permissions.length}</Badge>
              </button>
            ))}
          </div>
        ) : <Empty icon="shield" title="No roles defined" sub="Roles are created during setup." />}
      </Card>
      {role && (
        <Card title={role.name} sub={role.description}
          actions={!locked && draft ? <><Button onClick={() => setDraft(null)} disabled={save.isPending}>Discard</Button><Button variant="primary" icon="save" loading={save.isPending} onClick={async () => {
            if (await confirm({ title: `Update ${role.name} permissions?`, body: `This changes what ${role.users} user(s) can see and do, immediately.`, confirmLabel: 'Save' })) save.mutate([...current]);
          }}>Save changes</Button></> : undefined}>
          {locked && <div className="mb-4"><Banner tone="neutral" icon="lock">Super Admin always holds every permission.</Banner></div>}
          {!locked && draft && changed > 0 && <div className="mb-4"><Banner tone="warning" icon="edit">{changed} unsaved permission change{changed === 1 ? '' : 's'} — save to apply to {role.users} user{role.users === 1 ? '' : 's'}.</Banner></div>}
          <div className="grid g-2col g-4">
            {Object.entries(grouped).map(([mod, perms]) => (
              <div key={mod} className="oi-permgroup">
                <div className="formsection__title">{mod}</div>
                <div className="col g-1">
                  {perms.map((p) => (
                    <Checkbox key={p.key} disabled={locked} checked={current.has(p.key)} label={<span title={p.key} className="t-xs">{p.description}</span>}
                      onChange={(v) => { const n = new Set(current); if (v) n.add(p.key); else n.delete(p.key); setDraft(n); }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </Grid>
  );
}
