import { useState } from 'react';
import {
  Badge, Button, Card, DataTable, Dl, ErrorState, FilterSelect, Icon, InlineError, Modal, Page, PageHead, PageSkeleton, Pagination, SearchInput, SelectField,
  TextArea, TextField, Timeline, Toolbar, useConfirm,
} from '@/components/ui';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useAuth } from '@/auth/AuthContext';
import { fmt } from '@/lib/format';
import { FormGrid, req, useForm } from '../operations/shared';

interface Policy {
  id: string; name: string; scope: string; version: string; status: string; effectiveOn: string | null; updatedAt: string; updatedBy: string | null;
  hasBody: boolean; previousVersions: number;
}
interface PolicyDetail extends Omit<Policy, 'hasBody' | 'previousVersions'> {
  body: string | null; createdAt: string;
  versions: { id: string; version: string; status: string; effectiveOn: string | null; changeNote: string | null; archivedAt: string; archivedBy: string | null }[];
}

const STATUSES = ['Draft', 'Under review', 'Active', 'Retired'];
const tone = (s: string) => (s === 'Active' ? 'success' : s === 'Retired' ? 'neutral' : s === 'Draft' ? 'info' : 'warning');
const VERSION_RE = /^v\d+(\.\d+){0,2}$/;

function bump(v: string) {
  const parts = v.replace(/^v/, '').split('.').map(Number);
  if (parts.length < 2) parts.push(0);
  parts[parts.length - 1] += 1;
  return `v${parts.join('.')}`;
}

export default function GroupPoliciesPage() {
  const list = useListParams({ sort: 'name' }, ['status']);
  const { can } = useAuth();
  const manage = can('group.manage');
  const q = usePagedQuery<Policy>('/group/policies', list.query);
  const [open, setOpen] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  return (
    <Page>
      <PageHead title="Group Policies" sub="Policies that apply across every campus, with version and review status."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setCreate(true)}>Add policy</Button>} />
      <Card flush>
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search policies" />
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={STATUSES} />
          {list.hasFilters && <Button size="sm" variant="quiet" icon="x" onClick={list.clear}>Clear filters</Button>}
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
          <DataTable<Policy>
            rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort} onRowClick={(r) => setOpen(r.id)}
            emptyText={list.hasFilters ? 'No policies match these filters.' : 'No group policies yet. Add one to share it with every campus, with version history.'}
            columns={[
              { key: 'name', label: 'Policy', render: (r) => <span className="row g-3"><Icon name="shield" size={16} className="t-muted" /><span className="t-bold">{r.name}</span></span> },
              { key: 'scope', label: 'Scope', sortable: false, render: (r) => r.scope },
              { key: 'version', label: 'Version', render: (r) => <><span className="t-num">{r.version}</span>{r.previousVersions > 0 && <div className="t-micro t-muted">{r.previousVersions} earlier</div>}</> },
              { key: 'updated', label: 'Last updated', render: (r) => <><span className="t-num">{fmt.date(r.updatedAt)}</span><div className="t-micro t-muted">{r.updatedBy ?? ''}</div></> },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={tone(r.status)}>{r.status}</Badge> },
              { key: 'a', label: '', sortable: false, className: 'num', render: (r) => <Button size="sm" onClick={(e) => { e.stopPropagation(); setOpen(r.id); }}>Open</Button> },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      {create && <PolicyForm onClose={() => setCreate(false)} />}
      {open && <PolicyModal id={open} manage={manage} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function PolicyModal({ id, manage, onClose }: { id: string; manage: boolean; onClose: () => void }) {
  const q = useApiQuery<PolicyDetail>(`/group/policies/${id}`);
  const [editing, setEditing] = useState(false);
  const confirm = useConfirm();
  const del = useApiMutation<void, { result: string }>('delete', `/group/policies/${id}`, {
    invalidate: ['/group/policies'], success: q.data?.status === 'Draft' ? 'Draft deleted' : 'Policy retired',
  });
  const p = q.data;
  if (editing && p) return <PolicyForm policy={p} onClose={() => setEditing(false)} />;
  return (
    <Modal open onClose={onClose} size="wide" title={p?.name ?? 'Policy'} sub={p ? `${p.scope} · ${p.version}` : ''} busy={del.isPending}
      foot={<>
        {manage && p && p.status !== 'Retired' && <Button variant="danger" loading={del.isPending} onClick={async () => {
          const draft = p.status === 'Draft';
          if (!(await confirm({
            title: draft ? `Delete draft "${p.name}"?` : `Retire "${p.name}"?`,
            body: draft ? 'The draft is removed permanently.' : 'The policy stays on record with its version history but no longer applies.',
            confirmLabel: draft ? 'Delete draft' : 'Retire policy', danger: true,
          }))) return;
          try { await del.mutateAsync(); onClose(); } catch { /* toast */ }
        }}>{p.status === 'Draft' ? 'Delete draft' : 'Retire'}</Button>}
        <Button onClick={onClose}>Close</Button>
        {manage && p && p.status !== 'Retired' && <Button variant="primary" icon="edit" onClick={() => setEditing(true)}>Edit / new version</Button>}
      </>}>
      {q.isLoading ? <PageSkeleton kpis={0} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : p && (
        <>
          <Dl items={[
            ['Status', <Badge tone={tone(p.status)}>{p.status}</Badge>],
            ['Effective from', fmt.date(p.effectiveOn)],
            ['Last updated', `${fmt.date(p.updatedAt)}${p.updatedBy ? ` by ${p.updatedBy}` : ''}`],
          ]} />
          <div className="eyebrow mt-4 mb-2">Policy text</div>
          <div className="card card--tint">
            <div className="card__body card__body--tight t-sm" style={{ whiteSpace: 'pre-wrap' }}>
              {p.body || <span className="t-muted">No text recorded yet.{manage && p.status !== 'Retired' ? ' Use “Edit / new version” to add it.' : ''}</span>}
            </div>
          </div>
          <div className="eyebrow mt-4 mb-2">Version history</div>
          {!p.versions.length ? <p className="t-sm t-muted">This is the first version.</p> : (
            <Timeline items={[
              { time: `Current · ${fmt.date(p.updatedAt)}`, title: `${p.version} — ${p.status}`, tone: 'teal' },
              ...p.versions.map((v) => ({
                time: `Superseded ${fmt.date(v.archivedAt)}${v.archivedBy ? ` · ${v.archivedBy}` : ''}`,
                title: `${v.version} — ${v.status}`, body: v.changeNote ?? undefined, tone: 'muted',
              })),
            ]} />
          )}
        </>
      )}
    </Modal>
  );
}

function PolicyForm({ policy, onClose }: { policy?: PolicyDetail; onClose: () => void }) {
  const f = useForm({
    name: policy?.name ?? '', scope: policy?.scope ?? 'All campuses', version: policy?.version ?? 'v1.0', body: policy?.body ?? '',
    status: policy?.status ?? 'Draft', effectiveOn: policy?.effectiveOn ?? '', changeNote: '',
  });
  const v = f.values;
  const save = useApiMutation<Record<string, unknown>>(policy ? 'put' : 'post', policy ? `/group/policies/${policy.id}` : '/group/policies',
    { invalidate: ['/group/policies'], success: policy ? 'Policy updated' : 'Policy created' });
  const contentChanged = !!policy && (v.body !== (policy.body ?? '') || v.scope !== policy.scope);
  const submit = async () => {
    if (!f.validate({
      name: req(v.name, 'Name'), scope: req(v.scope, 'Scope'),
      version: req(v.version, 'Version') ?? (!VERSION_RE.test(v.version) ? 'Use a version like v1.0' : contentChanged && v.version === policy!.version ? `Text changed — increase from ${policy!.version}` : null),
      effectiveOn: v.status === 'Active' ? req(v.effectiveOn, 'Effective date') : null,
    })) return;
    const body = { name: v.name.trim(), scope: v.scope.trim(), version: v.version, body: v.body || null, status: v.status, effectiveOn: v.effectiveOn || null };
    try { await save.mutateAsync(policy ? { ...body, changeNote: v.changeNote || null } : body); onClose(); } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} size="wide" title={policy ? `Edit ${policy.name}` : 'Add policy'}
      sub={policy ? 'Changing the text or scope creates a new version; the previous one is kept in the history.' : undefined} busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>{policy ? 'Save changes' : 'Add policy'}</Button></>}>
      {save.error && <div className="mb-4"><InlineError error={save.error} /></div>}
      <div className="formsection">
        <div className="formsection__title">Details</div>
        <FormGrid>
          <TextField label="Policy name" required maxLength={160} value={v.name} onChange={(x) => f.set('name', x)} error={f.errors.name} />
          <TextField label="Scope" required maxLength={80} value={v.scope} onChange={(x) => f.set('scope', x)} error={f.errors.scope} />
          <div className="row-top g-2">
            <TextField label="Version" required maxLength={12} value={v.version} onChange={(x) => f.set('version', x)} error={f.errors.version} style={{ flex: 1 }} />
            {policy && <Button size="sm" style={{ marginTop: 24 }} onClick={() => f.set('version', bump(policy.version))}>Next version</Button>}
          </div>
          <SelectField label="Status" value={v.status} onChange={(x) => f.set('status', x)} options={STATUSES.filter((s) => s !== 'Retired')} />
          <TextField label="Effective from" type="date" required={v.status === 'Active'} value={v.effectiveOn} onChange={(x) => f.set('effectiveOn', x)} error={f.errors.effectiveOn} />
          {policy && <TextField label="Change note" maxLength={300} value={v.changeNote} onChange={(x) => f.set('changeNote', x)} placeholder="What changed in this version" />}
        </FormGrid>
      </div>
      <div className="formsection">
        <div className="formsection__title">Policy text</div>
        <TextArea label="Text" rows={10} maxLength={20000} value={v.body} onChange={(x) => f.set('body', x)}
          hint={policy ? 'Changing the text requires a higher version number.' : undefined} />
      </div>
    </Modal>
  );
}
