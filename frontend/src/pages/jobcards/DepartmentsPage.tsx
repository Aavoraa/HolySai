import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, Button, Card, DataTable, Empty, ErrorState, Grid, Kpi, Modal, Page, PageHead, Person, SearchInput, SelectField, Switch, TextArea, TextField, Toolbar,
} from '@/components/ui';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import { useAuth } from '@/auth/AuthContext';
import { fmt } from '@/lib/format';
import { FormError, FormGrid, req, useCampusOptions, useForm } from '../operations/shared';
import type { Department, Member } from './shared';

export default function DepartmentsPage() {
  const { can } = useAuth();
  const manage = can('jobcards.manage');
  const [q, setQ] = useState('');
  const [inactive, setInactive] = useState(false);
  const list = useApiQuery<Department[]>('/departments', { q: q || undefined, includeInactive: inactive || undefined });
  const [edit, setEdit] = useState<Department | 'new' | null>(null);
  const [members, setMembers] = useState<Department | null>(null);
  const rows = list.data ?? [];
  const active = rows.filter((d) => d.isActive);
  const totals = {
    count: active.length,
    noHead: active.filter((d) => !d.headEmployeeId).length,
    openIn: active.reduce((a, d) => a + d.openIn, 0),
    overdue: active.reduce((a, d) => a + d.overdueIn, 0),
  };
  return (
    <Page>
      <PageHead title="Departments" sub="Departments that send and receive job cards, their heads and current workload."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>New department</Button>} />
      <Grid cols="g-4col" className="mb-4">
        <Kpi label="Active departments" icon="building" value={fmt.n(totals.count)} loading={list.isLoading} />
        <Kpi label="Without a head" icon="user" tone="amber" value={fmt.n(totals.noHead)} loading={list.isLoading} foot="Cards notify every member instead" />
        <Kpi label="Open job cards" icon="clipboard" tone="info" value={fmt.n(totals.openIn)} loading={list.isLoading} to="/job-cards?status=active" />
        <Kpi label="Overdue" icon="alertCircle" tone="critical" value={fmt.n(totals.overdue)} loading={list.isLoading} to="/job-cards?overdue=true" />
      </Grid>
      <Card flush>
        <Toolbar>
          <SearchInput value={q} onSearch={setQ} placeholder="Search departments" />
          <Switch checked={inactive} onChange={setInactive} label="Show inactive" />
        </Toolbar>
        {list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : !list.isLoading && !rows.length && !q ? (
          <Empty icon="building" title="No departments yet" sub="Add the school's departments so staff can raise job cards to each other."
            action={manage ? <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>New department</Button> : undefined} />
        ) : (
          <DataTable<Department>
            rows={rows} loading={list.isLoading} rowKey={(r) => r.id} emptyText="No departments match your search."
            columns={[
              { key: 'name', label: 'Department', sortable: false, render: (r) => <>
                <span className="t-bold">{r.name}</span> <span className="tag">{r.code}</span>
                {!r.isActive && <> <Badge tone="neutral">Inactive</Badge></>}
                {r.isMine && <> <Badge tone="info">Yours</Badge></>}
                {r.description && <div className="t-micro t-muted">{r.description}</div>}</> },
              { key: 'head', label: 'Head', sortable: false, render: (r) => r.headName ? <Person name={r.headName} meta={r.headDesignation ?? undefined} /> : <span className="t-warning t-sm">No head</span> },
              { key: 'members', label: 'Members', sortable: false, className: 'num', render: (r) => (
                <Button size="sm" variant="quiet" onClick={() => setMembers(r)}>{fmt.n(r.membersCount)}</Button>) },
              { key: 'in', label: 'Open in', sortable: false, className: 'num', render: (r) => (
                <Link to={`/job-cards?departmentId=${r.id}&status=active`} className="t-num t-bold">{r.openIn}</Link>) },
              { key: 'out', label: 'Open out', sortable: false, className: 'num', render: (r) => <span className="t-num">{r.openOut}</span> },
              { key: 'overdue', label: 'Overdue', sortable: false, className: 'num', render: (r) => r.overdueIn ? <Badge tone="critical" dot>{r.overdueIn}</Badge> : <span className="t-faint">0</span> },
              { key: 'campus', label: 'Campus', sortable: false, render: (r) => r.campusName ?? <span className="t-faint">All</span> },
              { key: 'a', label: '', sortable: false, className: 'num', render: (r) => manage ? <Button size="sm" icon="edit" onClick={() => setEdit(r)}>Edit</Button> : null },
            ]}
          />
        )}
      </Card>
      {edit && <DepartmentModal dept={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {members && <MembersModal dept={members} onClose={() => setMembers(null)} />}
    </Page>
  );
}

function DepartmentModal({ dept, onClose }: { dept: Department | null; onClose: () => void }) {
  const campuses = useCampusOptions();
  const f = useForm({
    name: dept?.name ?? '', code: dept?.code ?? '', description: dept?.description ?? '',
    headEmployeeId: dept?.headEmployeeId ?? '', campusId: dept?.campusId ?? '', isActive: dept?.isActive ?? true,
  });
  const v = f.values;
  // Head candidates: anyone on staff (a department head may sit in another department's record).
  const { lookups } = useLookups();
  const headOptions = (lookups?.staff ?? []).map((s) => ({ value: s.id, label: `${s.fullName} — ${s.designation}` }));
  const save = useApiMutation<Record<string, unknown>>(dept ? 'put' : 'post', dept ? `/departments/${dept.id}` : '/departments', {
    invalidate: ['/departments', '/job-cards'], success: dept ? 'Department updated' : 'Department created',
  });
  const submit = async () => {
    if (!f.validate({
      name: req(v.name, 'Name') ?? (v.name.trim().length < 2 ? 'Use at least 2 characters' : null),
      code: req(v.code, 'Code') ?? (!/^[A-Za-z0-9_-]{2,12}$/.test(v.code.trim()) ? '2–12 letters or digits' : null),
    })) return;
    try {
      await save.mutateAsync({
        name: v.name.trim(), code: v.code.trim(), description: v.description.trim() || null,
        headEmployeeId: v.headEmployeeId || null, campusId: v.campusId || null, isActive: v.isActive,
      });
      onClose();
    } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title={dept ? `Edit ${dept.name}` : 'New department'} busy={save.isPending}
      sub="Staff are matched to departments by the department on their employee record."
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>{dept ? 'Save changes' : 'Create department'}</Button></>}>
      <FormGrid>
        <TextField label="Name" required maxLength={80} value={v.name} onChange={(x) => f.set('name', x)} error={f.errors.name} />
        <TextField label="Code" required maxLength={12} value={v.code} onChange={(x) => f.set('code', x.toUpperCase())} error={f.errors.code} hint="Short code, e.g. TRANS" />
        <SelectField label="Head of department" value={v.headEmployeeId} onChange={(x) => f.set('headEmployeeId', x)} options={headOptions} placeholder="No head" error={f.errors.headEmployeeId} />
        <SelectField label="Campus" value={v.campusId} onChange={(x) => f.set('campusId', x)} options={campuses.options} placeholder="All campuses" error={f.errors.campusId} />
      </FormGrid>
      <div className="mt-3"><TextArea label="Description" rows={2} maxLength={300} value={v.description} onChange={(x) => f.set('description', x)} error={f.errors.description} /></div>
      {dept && <div className="mt-3"><Switch checked={v.isActive} onChange={(x) => f.set('isActive', x)} label="Active — can receive job cards" /></div>}
      {dept && dept.aliases.length > 0 && <p className="t-micro t-muted mt-2">Also matches staff records that say: {dept.aliases.join(', ')}</p>}
      <FormError error={save.error} />
    </Modal>
  );
}

function MembersModal({ dept, onClose }: { dept: Department; onClose: () => void }) {
  const q = useApiQuery<Member[]>(`/departments/${dept.id}/members`);
  return (
    <Modal open onClose={onClose} title={`${dept.name} members`} sub="Staff whose employee record belongs to this department, and its head." foot={<Button onClick={onClose}>Close</Button>}>
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <DataTable<Member> rows={q.data} loading={q.isLoading} rowKey={(m) => m.id} compact emptyText="No staff are linked to this department."
          columns={[
            { key: 'name', label: 'Name', sortable: false, render: (m) => <Person name={m.fullName} meta={m.designation} /> },
            { key: 'code', label: 'Code', sortable: false, render: (m) => <span className="t-num">{m.employeeCode}</span> },
            { key: 'role', label: '', sortable: false, render: (m) => <>{m.isHead && <Badge tone="info">Head</Badge>} {!m.hasAccount && <Badge tone="neutral">No login</Badge>}</> },
          ]} />
      )}
    </Modal>
  );
}
