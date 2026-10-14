import { useState } from 'react';
import {
  Banner, Button, Card, DataTable, Empty, ErrorState, FilterSelect, Grid, Kpi, Modal, Page, PageHead, Pagination, Person, SearchInput,
  SelectField, Status, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { fmt } from '@/lib/format';
import {
  DueIn, FormError, FormGrid, FormSection, CRITICAL_ROW, addDaysIso, req, todayIso, useCampusOptions, useForm, useStaffOptions,
} from './shared';

export interface Asset {
  id: string; code: string; name: string; category: string; location: string | null; campusId: string; campusName: string;
  facilityId: string | null; facilityName: string | null; assignedTo: string | null; assignedName: string | null; assignedRole: string | null;
  purchasedOn: string | null; purchaseValue: number | null; nextServiceOn: string | null; serviceInDays: number | null; status: string; storedStatus: string;
}
interface Summary { total: number; serviceDue30: number; serviceOverdue: number; inMaintenance: number; bookValue: number; purchaseValue: number }

const CATEGORIES = ['IT', 'Lab', 'Vehicle', 'Facilities', 'Furniture', 'Sports', 'Library'];
const STATUSES = ['Active', 'Maintenance due', 'In maintenance', 'Retired'];

export default function AssetsPage() {
  const list = useListParams({ sort: 'name' }, ['category', 'status', 'serviceDue']);
  const { campusParam } = useSchool();
  const { can } = useAuth();
  const manage = can('operations.manage');
  const q = usePagedQuery<Asset>('/assets', { ...list.query, ...campusParam });
  const sum = useApiQuery<Summary>('/assets/summary', campusParam);
  const [edit, setEdit] = useState<Asset | 'new' | null>(null);
  const [service, setService] = useState<Asset | null>(null);
  const confirm = useConfirm();
  const retire = useApiMutation<string>('delete', (id) => `/assets/${id}`, { invalidate: ['/assets'], success: 'Asset retired' });
  const overdue = sum.data?.serviceOverdue ?? 0;
  const emptyRegister = !q.isLoading && !q.error && !!q.data && !q.data.rows.length && !list.hasFilters;

  return (
    <Page>
      <PageHead title="Assets" sub="Asset register with location, assigned person and service schedule."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Add asset</Button>} />
      {overdue > 0 && (
        <div className="mb-4">
          <Banner tone="critical" icon="alertCircle">
            <strong>{overdue} asset{overdue === 1 ? ' is' : 's are'} past the service date.</strong>{' '}
            Overdue rows are flagged in the register — log the service or set a new date.
          </Banner>
        </div>
      )}
      <Grid cols="g-4col" className="mb-4">
        <Kpi label="Assets on register" icon="box" value={fmt.n(sum.data?.total)} loading={sum.isLoading} onClick={() => list.clear()} />
        <Kpi label="Service due in 30 days" icon="calendar" value={fmt.n(sum.data?.serviceDue30)} tone="amber" loading={sum.isLoading}
          foot={overdue ? `${overdue} already past due` : undefined} onClick={() => list.setFilter('serviceDue', '30')} />
        <Kpi label="In maintenance" icon="wrench" value={fmt.n(sum.data?.inMaintenance)} tone="critical" loading={sum.isLoading}
          onClick={() => list.setFilter('status', 'In maintenance')} />
        <Kpi label="Book value" icon="rupee" value={fmt.money(sum.data?.bookValue, { compact: true })} tone="info" loading={sum.isLoading}
          foot={sum.data ? `Cost ${fmt.money(sum.data.purchaseValue, { compact: true })} · straight-line` : undefined} />
      </Grid>
      <Card flush>
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search asset, code or location" />
          <FilterSelect label="Category" value={list.filters.category} onChange={(v) => list.setFilter('category', v)} options={CATEGORIES} />
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={STATUSES} />
          <FilterSelect label="Service" allLabel="Any time" value={list.filters.serviceDue} onChange={(v) => list.setFilter('serviceDue', v)}
            options={[{ value: '7', label: 'Due in 7 days' }, { value: '30', label: 'Due in 30 days' }, { value: '90', label: 'Due in 90 days' }]} />
          {list.hasFilters && <Button variant="quiet" size="sm" icon="x" onClick={list.clear}>Clear</Button>}
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : emptyRegister ? (
          <Empty icon="box" title="No assets on the register yet"
            sub="Add laptops, lab equipment, vehicles and furniture to track who holds them and when each is next serviced."
            action={manage ? <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Add asset</Button> : undefined} />
        ) : (
          <DataTable<Asset>
            rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            emptyText="No assets match the current filters."
            rowClassName={(r) => (r.serviceInDays != null && r.serviceInDays < 0 && r.storedStatus !== 'Retired' ? CRITICAL_ROW : undefined)}
            columns={[
              { key: 'name', label: 'Asset', render: (r) => <><span className="t-bold">{r.name}</span><div className="t-micro t-muted">{r.code} · {r.category} · {r.campusName}</div></> },
              { key: 'location', label: 'Location', render: (r) => r.location ?? r.facilityName ?? <span className="t-faint">—</span> },
              { key: 'assigned', label: 'Assigned to', render: (r) => (r.assignedName ? <Person name={r.assignedName} meta={r.assignedRole ?? undefined} /> : <span className="t-faint">Unassigned</span>) },
              { key: 'purchased', label: 'Purchased', render: (r) => <span className="t-num">{fmt.date(r.purchasedOn)}</span> },
              { key: 'nextService', label: 'Next service', render: (r) => r.nextServiceOn ? (
                <><span className="t-num">{fmt.date(r.nextServiceOn)}</span><DueIn days={r.serviceInDays} /></>
              ) : <span className="t-faint">—</span> },
              { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
              ...(manage ? [{
                key: 'a', label: '', sortable: false, className: 'num', render: (r: Asset) => r.storedStatus === 'Retired' ? null : (
                  <div className="row g-2 end">
                    <Button size="sm" icon="wrench" onClick={() => setService(r)}>Log service</Button>
                    <Button size="sm" variant="quiet" icon="edit" aria-label={`Edit ${r.name}`} title="Edit" onClick={() => setEdit(r)} />
                    <Button size="sm" variant="quiet" icon="trash" aria-label={`Retire ${r.name}`} title="Retire"
                      loading={retire.isPending && retire.variables === r.id} onClick={async () => {
                        if (await confirm({ title: `Retire ${r.code}?`, body: `${r.name} will be removed from the active register. This is recorded in the audit trail.`, confirmLabel: 'Retire asset', danger: true })) {
                          retire.mutate(r.id);
                        }
                      }} />
                  </div>
                ),
              }] : []),
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      {edit && <AssetModal asset={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {service && <ServiceModal asset={service} onClose={() => setService(null)} />}
    </Page>
  );
}

function AssetModal({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const campuses = useCampusOptions();
  const staff = useStaffOptions();
  const facilities = useApiQuery<{ id: string; name: string; campusId: string }[]>('/facilities');
  const f = useForm({
    campusId: asset?.campusId ?? campuses.defaultId,
    name: asset?.name ?? '',
    category: asset?.category ?? '',
    location: asset?.location ?? '',
    facilityId: asset?.facilityId ?? '',
    assignedTo: asset?.assignedTo ?? '',
    purchasedOn: asset?.purchasedOn ?? '',
    purchaseValue: asset?.purchaseValue != null ? String(asset.purchaseValue) : '',
    nextServiceOn: asset?.nextServiceOn ?? '',
    status: asset?.storedStatus ?? 'Active',
  });
  const save = useApiMutation<Record<string, unknown>>(asset ? 'put' : 'post', asset ? `/assets/${asset.id}` : '/assets',
    { invalidate: ['/assets'], success: asset ? 'Asset updated' : 'Asset added' });
  const v = f.values;
  const submit = async () => {
    const ok = f.validate({
      campusId: req(v.campusId, 'Campus'), name: req(v.name, 'Name') ?? (v.name.trim().length < 2 ? 'Name is too short' : null),
      category: req(v.category, 'Category'),
      purchaseValue: v.purchaseValue && !(Number(v.purchaseValue) >= 0) ? 'Enter a valid amount' : null,
      purchasedOn: v.purchasedOn && v.purchasedOn > todayIso() ? 'Purchase date cannot be in the future' : null,
    });
    if (!ok) return;
    try {
      await save.mutateAsync({
        ...v, facilityId: v.facilityId || null, assignedTo: v.assignedTo || null, purchasedOn: v.purchasedOn || null,
        nextServiceOn: v.nextServiceOn || null, purchaseValue: v.purchaseValue === '' ? null : Number(v.purchaseValue), location: v.location || null,
      });
      onClose();
    } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title={asset ? `Edit ${asset.code}` : 'Add asset'} sub="Every change is recorded in the audit trail." busy={save.isPending} size="wide"
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>{asset ? 'Save changes' : 'Add asset'}</Button></>}>
      <FormSection title="Asset">
        <FormGrid>
          <TextField label="Asset name" required value={v.name} onChange={(x) => f.set('name', x)} error={f.errors.name} maxLength={160} />
          <SelectField label="Category" required value={v.category} onChange={(x) => f.set('category', x)} options={CATEGORIES} placeholder="Choose…" error={f.errors.category} />
          <SelectField label="Campus" required value={v.campusId} onChange={(x) => f.set('campusId', x)} options={campuses.options} error={f.errors.campusId} />
          <SelectField label="Status" value={v.status} onChange={(x) => f.set('status', x)} options={STATUSES.filter((s) => s !== 'Retired')} />
        </FormGrid>
      </FormSection>
      <FormSection title="Location and custodian">
        <FormGrid>
          <SelectField label="Facility" value={v.facilityId} onChange={(x) => f.set('facilityId', x)} placeholder="None"
            options={(facilities.data ?? []).filter((x) => x.campusId === v.campusId).map((x) => ({ value: x.id, label: x.name }))} />
          <TextField label="Location" value={v.location} onChange={(x) => f.set('location', x)} maxLength={120} placeholder="e.g. Block B, room 204" />
          <SelectField label="Assigned to" value={v.assignedTo} onChange={(x) => f.set('assignedTo', x)} options={staff} placeholder="Unassigned" />
        </FormGrid>
      </FormSection>
      <FormSection title="Purchase and service">
        <FormGrid>
          <TextField label="Purchased on" type="date" value={v.purchasedOn} max={todayIso()} onChange={(x) => f.set('purchasedOn', x)} error={f.errors.purchasedOn} />
          <TextField label="Purchase value (₹)" type="number" min={0} step="1" value={v.purchaseValue} onChange={(x) => f.set('purchaseValue', x)} error={f.errors.purchaseValue} />
          <TextField label="Next service" type="date" value={v.nextServiceOn} onChange={(x) => f.set('nextServiceOn', x)} error={f.errors.nextServiceOn} />
        </FormGrid>
      </FormSection>
      <FormError error={save.error} />
    </Modal>
  );
}

function ServiceModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const f = useForm({ servicedOn: todayIso(), nextServiceOn: addDaysIso(180), note: '' });
  const save = useApiMutation<Record<string, unknown>>('post', `/assets/${asset.id}/service`, { invalidate: ['/assets'], success: 'Service recorded' });
  const v = f.values;
  const submit = async () => {
    if (!f.validate({
      servicedOn: req(v.servicedOn, 'Service date') ?? (v.servicedOn > todayIso() ? 'Cannot be in the future' : null),
      nextServiceOn: req(v.nextServiceOn, 'Next service') ?? (v.nextServiceOn <= v.servicedOn ? 'Must be after the service date' : null),
    })) return;
    try { await save.mutateAsync({ ...v, note: v.note || null }); onClose(); } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title={`Log service — ${asset.code}`} sub={asset.name} busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Record service</Button></>}>
      <FormGrid>
        <TextField label="Serviced on" type="date" required max={todayIso()} value={v.servicedOn} onChange={(x) => f.set('servicedOn', x)} error={f.errors.servicedOn} />
        <TextField label="Next service due" type="date" required value={v.nextServiceOn} onChange={(x) => f.set('nextServiceOn', x)} error={f.errors.nextServiceOn} />
      </FormGrid>
      <div className="mt-3"><TextField label="Note" value={v.note} onChange={(x) => f.set('note', x)} maxLength={300} placeholder="Work done, vendor, invoice ref." /></div>
      <FormError error={save.error} />
    </Modal>
  );
}
