import { useMemo, useState } from 'react';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { Badge, Button, Card, DataTable, Empty, ErrorState, FilterSelect, InlineError, Modal, Page, PageHead, SearchInput, Switch, TextArea, TextField, Toolbar } from '@/components/ui';
import { fmt } from '@/lib/format';

interface Setting { key: string; value: unknown; description: string | null; isPublic: boolean; updatedAt: string }

/** Friendly names for the setting key prefixes (anything else is title-cased). */
const GROUPS: Record<string, string> = {
  school: 'School identity',
  attendance: 'Attendance',
  tracking: 'Student tracking',
  finance: 'Finance',
  auth: 'Sign-in & security',
  early_warning: 'Early warning',
  admissions: 'Admissions',
  staffing: 'Staffing',
};

const groupOf = (key: string) => key.split('.')[0] || 'other';
const groupLabel = (g: string) => GROUPS[g] ?? g.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const kindOf = (v: unknown): 'boolean' | 'number' | 'string' | 'json' =>
  typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : typeof v === 'string' ? 'string' : 'json';

function ValueView({ value }: { value: unknown }) {
  if (typeof value === 'boolean') return <Badge tone={value ? 'success' : 'neutral'}>{value ? 'On' : 'Off'}</Badge>;
  if (typeof value === 'string' || typeof value === 'number') return <span className="t-sm t-strong">{String(value)}</span>;
  if (Array.isArray(value) && value.every((x) => typeof x === 'string' || typeof x === 'number')) {
    return <span className="row g-1 wrap">{value.map((x) => <span key={String(x)} className="tag">{String(x)}</span>)}</span>;
  }
  return <code className="t-xs oi-code">{JSON.stringify(value)}</code>;
}

export default function AdminSettingsPage() {
  const q = useApiQuery<Setting[]>('/settings');
  const [edit, setEdit] = useState<Setting | null>(null);
  const [text, setText] = useState('');
  const [bool, setBool] = useState(false);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [vis, setVis] = useState('');
  const save = useApiMutation<{ key: string; value: unknown }>('put', (v) => `/settings/${v.key}`, {
    invalidate: ['/settings'], body: (v) => ({ value: v.value }), success: 'Setting saved', error: false, onSuccess: () => setEdit(null),
  });
  const kind = edit ? kindOf(edit.value) : 'json';

  const open = (r: Setting) => {
    setEdit(r);
    save.reset();
    setErr('');
    const k = kindOf(r.value);
    if (k === 'boolean') setBool(r.value as boolean);
    setText(k === 'string' ? (r.value as string) : k === 'number' ? String(r.value) : JSON.stringify(r.value, null, 2));
  };

  const submit = () => {
    if (!edit) return;
    if (kind === 'boolean') return save.mutate({ key: edit.key, value: bool });
    if (kind === 'string') return save.mutate({ key: edit.key, value: text });
    if (kind === 'number') {
      const n = Number(text);
      if (text.trim() === '' || !Number.isFinite(n)) return setErr('Enter a number');
      setErr('');
      return save.mutate({ key: edit.key, value: n });
    }
    try {
      const value = JSON.parse(text);
      setErr('');
      save.mutate({ key: edit.key, value });
    } catch {
      setErr('Enter valid JSON, e.g. "text", 30, true or ["a","b"]');
    }
  };

  const groups = useMemo(() => {
    const s = search.trim().toLowerCase();
    const rows = (q.data ?? []).filter((r) =>
      (!vis || (vis === 'public') === r.isPublic) &&
      (!s || r.key.toLowerCase().includes(s) || (r.description ?? '').toLowerCase().includes(s)));
    const m = new Map<string, Setting[]>();
    rows.forEach((r) => {
      const g = groupOf(r.key);
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(r);
    });
    return [...m.entries()];
  }, [q.data, search, vis]);

  return (
    <Page>
      <PageHead title="System settings" sub="School-wide configuration, grouped by area. Public settings are visible on the sign-in screen; every change is audited." />
      <Card flush>
        <Toolbar>
          <SearchInput value={search} onSearch={setSearch} placeholder="Search settings" />
          <FilterSelect label="Visibility" value={vis} onChange={setVis} options={[{ value: 'public', label: 'Public' }, { value: 'internal', label: 'Internal' }]} />
          <div className="spacer" />
          <span className="t-xs t-muted">{q.data ? `${q.data.length} settings` : ''}</span>
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? (
          <DataTable rows={undefined} loading rowKey={(r: Setting) => r.key} columns={[{ key: 'key', label: 'Setting' }, { key: 'value', label: 'Value' }]} />
        ) : groups.length === 0 ? (
          <Empty icon="settings" title={search || vis ? 'No settings match' : 'No settings yet'} sub={search || vis ? 'Try a different search or visibility filter.' : 'Settings are created during school setup.'}
            action={search || vis ? <Button size="sm" onClick={() => { setSearch(''); setVis(''); }}>Clear filters</Button> : undefined} />
        ) : null}
      </Card>

      {!q.error && !q.isLoading && groups.map(([g, rows]) => (
        <div key={g} className="mt-4">
          <Card title={groupLabel(g)} sub={`${rows.length} setting${rows.length === 1 ? '' : 's'}`} flush>
            <DataTable rows={rows} rowKey={(r) => r.key}
              columns={[
                { key: 'key', label: 'Setting', render: (r) => <><span className="t-bold">{r.description ?? r.key}</span><div className="t-micro t-muted t-mono">{r.key}</div></> },
                { key: 'value', label: 'Value', render: (r) => <ValueView value={r.value} /> },
                { key: 'public', label: 'Visibility', render: (r) => <Badge tone={r.isPublic ? 'info' : 'neutral'} icon={r.isPublic ? 'eye' : 'lock'}>{r.isPublic ? 'Public' : 'Internal'}</Badge> },
                { key: 'updated', label: 'Updated', render: (r) => <span className="t-xs t-muted">{fmt.dateTime(r.updatedAt)}</span> },
                { key: 'edit', label: '', className: 'num', render: (r) => <Button size="sm" icon="edit" onClick={() => open(r)} aria-label={`Edit ${r.key}`}>Edit</Button> },
              ]} />
          </Card>
        </div>
      ))}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.description ?? edit?.key ?? ''} sub={edit ? <span className="t-mono">{edit.key}</span> : undefined} busy={save.isPending}
        foot={<><Button onClick={() => setEdit(null)} disabled={save.isPending}>Cancel</Button><Button variant="primary" icon="save" loading={save.isPending} onClick={submit}>Save setting</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate className="col g-4">
          {save.error && <InlineError error={save.error} />}
          {kind === 'boolean' && <Switch checked={bool} onChange={setBool} label={bool ? 'On' : 'Off'} />}
          {kind === 'number' && <TextField label="Value" type="number" required value={text} onChange={setText} error={err} hint="A number." />}
          {kind === 'string' && <TextField label="Value" required value={text} onChange={setText} error={err} />}
          {kind === 'json' && <TextArea label="Value (JSON)" required value={text} onChange={setText} rows={6} error={err} hint='A list or object in JSON, e.g. ["whatsapp","push"].' />}
          {edit?.isPublic && <p className="t-xs t-muted">This setting is public — it appears on the sign-in screen.</p>}
        </form>
      </Modal>
    </Page>
  );
}
