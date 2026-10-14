import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, Button, Card, DataTable, Empty, ErrorState, InlineError, Modal, Page, PageHead, Pagination, SearchInput, Segment, SelectField, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useAuth } from '@/auth/AuthContext';
import { fmt } from '@/lib/format';
import { FormGrid, daysLabel, req, useForm } from '../operations/shared';
import type { ProjectRow } from './shared';

interface Entry { projectId: string; code: string; title: string; result: string | null; studentId: string; studentName: string }
interface Competition { id: string; name: string; level: string; heldOn: string; result: string | null; daysAway: number; teams: number; entries: Entry[] }

const LEVELS = ['School', 'District', 'State', 'National', 'International'];
const placed = (r: string | null) => /place|finalist|winner|1st|2nd|3rd|medal/i.test(r ?? '');

export default function CompetitionsPage() {
  const list = useListParams({ sort: 'date' }, ['when']);
  const { can } = useAuth();
  const manage = can('innovation.manage');
  const q = usePagedQuery<Competition>('/innovation/competitions', { q: list.query.q, page: list.page, pageSize: list.pageSize, when: list.filters.when || undefined });
  const [edit, setEdit] = useState<Competition | 'new' | null>(null);
  const [open, setOpen] = useState<Competition | null>(null);
  const current = open ? q.data?.rows.find((c) => c.id === open.id) ?? open : null;
  return (
    <Page>
      <PageHead title="Competitions" sub="External events entered, teams sent and results recorded."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Register for a competition</Button>} />
      <Card flush>
        <Toolbar>
          <Segment items={[{ id: '', label: 'All' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'past', label: 'Past' }]} active={list.filters.when} onChange={(v) => list.setFilter('when', v)} />
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search competitions" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
          <DataTable<Competition>
            rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} onRowClick={setOpen}
            emptyText={list.hasFilters ? 'No competitions match. Try All or clear the search.' : 'No competitions recorded yet. Register for an event to send project teams.'}
            columns={[
              { key: 'name', label: 'Competition', render: (r) => <><span className="t-bold">{r.name}</span><div className="t-micro t-muted">{r.level} level</div></> },
              { key: 'date', label: 'Date', render: (r) => <><span className="t-num">{fmt.date(r.heldOn)}</span>{r.daysAway >= 0 && <div className="t-micro t-muted">{daysLabel(r.daysAway)}</div>}</> },
              { key: 'teams', label: 'Teams', className: 'num', render: (r) => <span className="t-num">{r.teams}</span> },
              { key: 'entries', label: 'Our entries', render: (r) => r.entries.length ? <span className="t-sm">{r.entries.map((e) => e.code).join(', ')}</span> : <span className="t-faint">None visible</span> },
              { key: 'result', label: 'Result', render: (r) => placed(r.result) ? <Badge tone="success" icon="award">{r.result}</Badge> : <span className="t-sm">{r.result ?? '—'}</span> },
              { key: 'a', label: '', className: 'num', render: (r) => <Button size="sm" onClick={(e) => { e.stopPropagation(); setOpen(r); }}>{manage ? 'Manage' : 'View'}</Button> },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      {edit && <CompetitionModal comp={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {current && <EntriesModal comp={current} manage={manage} onEdit={() => { setEdit(current); setOpen(null); }} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function CompetitionModal({ comp, onClose }: { comp: Competition | null; onClose: () => void }) {
  const f = useForm({ name: comp?.name ?? '', level: comp?.level ?? 'District', heldOn: comp?.heldOn ?? '', result: comp?.result ?? '' });
  const v = f.values;
  const save = useApiMutation<Record<string, unknown>>(comp ? 'put' : 'post', comp ? `/innovation/competitions/${comp.id}` : '/innovation/competitions',
    { invalidate: ['/innovation'], success: comp ? 'Competition updated' : 'Competition registered' });
  const submit = async () => {
    if (!f.validate({ name: req(v.name, 'Name'), heldOn: req(v.heldOn, 'Date') })) return;
    try { await save.mutateAsync({ name: v.name.trim(), level: v.level, heldOn: v.heldOn, result: v.result || null }); onClose(); } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title={comp ? 'Edit competition' : 'Register for a competition'} busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>{comp ? 'Save changes' : 'Register'}</Button></>}>
      {save.error && <div className="mb-3"><InlineError error={save.error} /></div>}
      <FormGrid>
        <TextField label="Competition" required maxLength={160} value={v.name} onChange={(x) => f.set('name', x)} error={f.errors.name} />
        <SelectField label="Level" value={v.level} onChange={(x) => f.set('level', x)} options={LEVELS} />
        <TextField label="Date" type="date" required value={v.heldOn} onChange={(x) => f.set('heldOn', x)} error={f.errors.heldOn} />
        <TextField label="Overall result" maxLength={200} value={v.result} onChange={(x) => f.set('result', x)} placeholder="Registered" />
      </FormGrid>
    </Modal>
  );
}

function EntriesModal({ comp, manage, onEdit, onClose }: { comp: Competition; manage: boolean; onEdit: () => void; onClose: () => void }) {
  const projects = useApiQuery<ProjectRow[]>(manage ? '/innovation/projects' : null, { pageSize: 100, active: true, sort: 'title' });
  const [projectId, setProjectId] = useState('');
  const [err, setErr] = useState('');
  const [results, setResults] = useState<Record<string, string>>({});
  const confirm = useConfirm();
  const inv = ['/innovation'];
  const add = useApiMutation<{ projectId: string }>('post', `/innovation/competitions/${comp.id}/entries`, { invalidate: inv, success: 'Project entered' });
  const record = useApiMutation<{ projectId: string; result: string }>('patch', (v) => `/innovation/competitions/${comp.id}/entries/${v.projectId}`,
    { invalidate: inv, body: (v) => ({ result: v.result }), success: 'Result saved' });
  const remove = useApiMutation<string>('delete', (pid) => `/innovation/competitions/${comp.id}/entries/${pid}`, { invalidate: inv, success: 'Entry withdrawn' });
  const eligible = (projects.data ?? []).filter((p) => p.stage >= 3 && !comp.entries.some((e) => e.projectId === p.id));
  return (
    <Modal open onClose={onClose} title={comp.name} sub={`${comp.level} · ${fmt.date(comp.heldOn)} · ${comp.teams} team(s)`} size="wide"
      foot={<>{manage && <Button icon="edit" onClick={onEdit}>Edit details</Button>}<Button onClick={onClose}>Close</Button></>}>
      {!comp.entries.length ? (
        <Empty icon="award" title="No entries in your scope"
          sub={manage ? 'Choose a project at Project stage or beyond below to enter it.' : 'Projects entered by the lab appear here with their results.'} />
      ) : (
        <DataTable<Entry> compact stack={false} rows={comp.entries} rowKey={(e) => e.projectId} columns={[
          { key: 'project', label: 'Project', render: (e) => <><Link to={`/projects/${e.projectId}`} className="t-bold t-info">{e.code}</Link> <span className="t-sm">{e.title}</span>
            <div className="t-micro t-muted">{e.studentName}</div></> },
          { key: 'result', label: 'Result', render: (e) => manage ? (
            <div className="row g-2">
              <input className="input" aria-label={`Result for ${e.code}`} style={{ maxWidth: 200 }} maxLength={200}
                value={results[e.projectId] ?? e.result ?? ''} onChange={(ev) => setResults((r) => ({ ...r, [e.projectId]: ev.target.value }))} />
              <Button size="sm" disabled={!results[e.projectId]?.trim() || results[e.projectId] === e.result}
                loading={record.isPending && record.variables?.projectId === e.projectId}
                onClick={() => record.mutate({ projectId: e.projectId, result: results[e.projectId].trim() })}>Save</Button>
            </div>
          ) : placed(e.result) ? <Badge tone="success" icon="award">{e.result}</Badge> : (e.result ?? '—') },
          { key: 'a', label: '', className: 'num', render: (e) => manage ? <Button size="sm" variant="quiet" onClick={async () => {
            if (await confirm({ title: `Withdraw ${e.code}?`, body: `${e.title} will be removed from ${comp.name}.`, confirmLabel: 'Withdraw', danger: true })) remove.mutate(e.projectId);
          }}>Withdraw</Button> : null },
        ]} />
      )}
      {manage && (
        <div className="row-top g-2 mt-4">
          <SelectField label="Enter a project" value={projectId} onChange={(x) => { setProjectId(x); setErr(''); }} error={err} style={{ flex: 1 }}
            placeholder={projects.isLoading ? 'Loading…' : eligible.length ? 'Choose a project at Project stage or beyond' : 'No eligible projects'}
            options={eligible.map((p) => ({ value: p.id, label: `${p.code} — ${p.title}` }))} />
          <Button variant="primary" icon="plus" style={{ marginTop: 22 }} loading={add.isPending} onClick={async () => {
            if (!projectId) { setErr('Choose a project'); return; }
            try { await add.mutateAsync({ projectId }); setProjectId(''); } catch { /* toast */ }
          }}>Enter</Button>
        </div>
      )}
      <p className="t-xs t-muted mt-2">Entering a project moves it to the Competition stage.</p>
    </Modal>
  );
}
