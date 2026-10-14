import { useState } from 'react';
import {
  Badge, Banner, Button, Card, DataTable, Empty, ErrorState, FilterSelect, Grid, Kpi, Meter, Modal, Page, PageHead, Pagination, SearchInput,
  Segment, SelectField, TextField, Toolbar,
} from '@/components/ui';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { fmt } from '@/lib/format';
import { CRITICAL_ROW, FormError, FormGrid, req, useCampusOptions, useForm } from './shared';

interface Item {
  id: string; sku: string; name: string; category: string; unit: string; quantity: number; reorderLevel: number; unitCost: number;
  stockValue: number; status: string; campusId: string; campusName: string; lastMovementAt: string | null;
}
interface Movement { id: number; createdAt: string; movementType: 'in' | 'out' | 'adjust'; quantity: number; note: string | null; itemName: string; sku: string; unit: string; movedBy: string | null }
interface Summary { items: number; belowReorder: number; atMinimum: number; stockValue: number; lowItems: string[]; movements30d: number }

const CATEGORIES = ['Stationery', 'Lab', 'Health', 'Transport', 'Office', 'Housekeeping', 'Uniform', 'Sports'];
const tone = (s: string) => (s === 'Reorder' ? 'critical' : s === 'At minimum' ? 'warning' : 'success');

export default function InventoryPage() {
  const [tab, setTab] = useState<'stock' | 'movements'>('stock');
  const list = useListParams({ sort: 'name' }, ['category', 'level']);
  const { campusParam } = useSchool();
  const { can } = useAuth();
  const manage = can('operations.manage');
  const q = usePagedQuery<Item>(tab === 'stock' ? '/inventory' : null, { ...list.query, ...campusParam });
  const mv = usePagedQuery<Movement>(tab === 'movements' ? '/inventory/movements' : null, { q: list.query.q, page: list.page, pageSize: list.pageSize, ...campusParam });
  const sum = useApiQuery<Summary>('/inventory/summary', campusParam);
  const [edit, setEdit] = useState<Item | 'new' | null>(null);
  const [move, setMove] = useState<Item | null>(null);
  const [purchase, setPurchase] = useState<Item | null>(null);
  const s = sum.data;
  return (
    <Page>
      <PageHead title="Inventory" sub="Stock levels against reorder points, by category."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Add item</Button>} />
      {s && s.belowReorder > 0 && (
        <div className="mb-4">
          <Banner tone="critical" icon="alertCircle">
            <div className="row between wrap g-2">
              <span>
                <strong>{s.belowReorder} item{s.belowReorder > 1 ? 's' : ''} below the reorder point.</strong>{' '}
                {s.lowItems.join(', ')} {s.belowReorder > 1 ? 'need' : 'needs'} a purchase request this week.
              </span>
              {!(tab === 'stock' && list.filters.level === 'low') && (
                <Button size="sm" onClick={() => { setTab('stock'); list.setFilter('level', 'low'); }}>Show items to reorder</Button>
              )}
            </div>
          </Banner>
        </div>
      )}
      <Grid cols="g-4col" className="mb-4">
        <Kpi label="Items tracked" icon="box" value={fmt.n(s?.items)} loading={sum.isLoading} onClick={() => list.clear()} />
        <Kpi label="Below reorder point" icon="alertCircle" value={fmt.n(s?.belowReorder)} tone="critical" loading={sum.isLoading} onClick={() => { setTab('stock'); list.setFilter('level', 'low'); }} />
        <Kpi label="At minimum" icon="minus" value={fmt.n(s?.atMinimum)} tone="amber" loading={sum.isLoading} onClick={() => { setTab('stock'); list.setFilter('level', 'at_minimum'); }} />
        <Kpi label="Stock value" icon="rupee" value={fmt.money(s?.stockValue, { compact: true })} tone="info" loading={sum.isLoading} foot={s ? `${s.movements30d} movements in 30 days` : undefined} />
      </Grid>
      <Card flush>
        <Toolbar>
          <Segment items={[{ id: 'stock', label: 'Stock levels' }, { id: 'movements', label: 'Stock movements' }]} active={tab} onChange={setTab} />
          <SearchInput value={list.q} onSearch={list.setQ} placeholder={tab === 'stock' ? 'Search item or SKU' : 'Search item or note'} />
          {tab === 'stock' && <>
            <FilterSelect label="Category" value={list.filters.category} onChange={(v) => list.setFilter('category', v)} options={CATEGORIES} />
            <FilterSelect label="Level" value={list.filters.level} onChange={(v) => list.setFilter('level', v)}
              options={[{ value: 'low', label: 'Reorder' }, { value: 'at_minimum', label: 'At minimum' }, { value: 'ok', label: 'In stock' }]} />
          </>}
          {list.hasFilters && <Button variant="quiet" size="sm" icon="x" onClick={list.clear}>Clear</Button>}
        </Toolbar>
        {tab === 'stock' ? (q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.isLoading && q.data && !q.data.rows.length && !list.hasFilters ? (
          <Empty icon="box" title="No stock items yet"
            sub="Add stationery, lab consumables, first-aid and housekeeping supplies with a reorder level, and low stock will be flagged automatically."
            action={manage ? <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Add item</Button> : undefined} />
        ) : (
          <>
            <DataTable<Item>
              rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
              emptyText="No stock items match the current filters."
              rowClassName={(r) => (r.status === 'Reorder' ? CRITICAL_ROW : undefined)}
              columns={[
                { key: 'name', label: 'Item', render: (r) => <><span className="t-bold">{r.name}</span><div className="t-micro t-muted">{r.sku} · {r.category} · {r.campusName}</div></> },
                { key: 'quantity', label: 'In stock', className: 'num', render: (r) => <span className="t-num">{fmt.n(r.quantity)} {r.unit}</span> },
                { key: 'reorder', label: 'Reorder at', className: 'num', render: (r) => <span className="t-num">{fmt.n(r.reorderLevel)}</span> },
                { key: 'level', label: 'Level', render: (r) => <Meter label="" right=" " value={Math.min(100, (r.quantity / Math.max(1, r.reorderLevel * 2)) * 100)}
                  tone={r.quantity < r.reorderLevel ? 'critical' : r.quantity === r.reorderLevel ? 'amber' : 'teal'} /> },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={tone(r.status)}>{r.status}</Badge> },
                ...(manage ? [{ key: 'a', label: '', sortable: false, className: 'num', render: (r: Item) => (
                  <div className="row g-2 end">
                    <Button size="sm" onClick={() => setMove(r)}>Stock in/out</Button>
                    {r.status !== 'In stock' && <Button size="sm" variant="primary" icon="send" onClick={() => setPurchase(r)}>Purchase request</Button>}
                    <Button size="sm" variant="quiet" icon="edit" aria-label={`Edit ${r.name}`} title="Edit" onClick={() => setEdit(r)} />
                  </div>
                ) }] : []),
              ]}
            />
            <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
          </>
        )) : (mv.error ? <ErrorState error={mv.error} onRetry={mv.refetch} /> : (
          <>
            <DataTable<Movement>
              rows={mv.data?.rows} loading={mv.isLoading} rowKey={(r) => String(r.id)}
              emptyText={list.q ? 'No stock movements match your search.' : 'No stock movements recorded yet. Stock in, stock out and count adjustments appear here.'}
              columns={[
                { key: 'createdAt', label: 'When', render: (r) => <span className="t-num">{fmt.dateTime(r.createdAt)}</span> },
                { key: 'item', label: 'Item', render: (r) => <><span className="t-bold">{r.itemName}</span><div className="t-micro t-muted">{r.sku}</div></> },
                { key: 'type', label: 'Movement', render: (r) => <Badge tone={r.movementType === 'in' ? 'success' : r.movementType === 'out' ? 'info' : 'warning'}>
                  {r.movementType === 'in' ? 'Stock in' : r.movementType === 'out' ? 'Stock out' : 'Adjustment'}</Badge> },
                { key: 'qty', label: 'Quantity', className: 'num', render: (r) => <span className={`t-num t-bold ${r.quantity < 0 ? 't-critical' : 't-success'}`}>{r.quantity > 0 ? '+' : ''}{fmt.n(r.quantity)} {r.unit}</span> },
                { key: 'note', label: 'Note', render: (r) => r.note ?? '—' },
                { key: 'by', label: 'By', render: (r) => r.movedBy ?? '—' },
              ]}
            />
            <Pagination meta={mv.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
          </>
        ))}
      </Card>
      {edit && <ItemModal item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {move && <MovementModal item={move} onClose={() => setMove(null)} />}
      {purchase && <PurchaseModal item={purchase} onClose={() => setPurchase(null)} />}
    </Page>
  );
}

function ItemModal({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const campuses = useCampusOptions();
  const f = useForm({
    campusId: item?.campusId ?? campuses.defaultId, name: item?.name ?? '', category: item?.category ?? '', unit: item?.unit ?? 'pcs',
    quantity: '0', reorderLevel: item ? String(item.reorderLevel) : '', unitCost: item ? String(item.unitCost) : '0',
  });
  const v = f.values;
  const save = useApiMutation<Record<string, unknown>>(item ? 'put' : 'post', item ? `/inventory/${item.id}` : '/inventory',
    { invalidate: ['/inventory'], success: item ? 'Item updated' : 'Item added' });
  const int = (x: string, label: string) => req(x, label) ?? (!/^\d+$/.test(x) ? `${label} must be a whole number` : null);
  const submit = async () => {
    if (!f.validate({
      name: req(v.name, 'Name'), category: req(v.category, 'Category'), unit: req(v.unit, 'Unit'),
      quantity: item ? null : int(v.quantity, 'Opening stock'), reorderLevel: int(v.reorderLevel, 'Reorder level'),
      unitCost: !(Number(v.unitCost) >= 0) ? 'Enter a valid cost' : null,
    })) return;
    const body: Record<string, unknown> = { campusId: v.campusId, name: v.name, category: v.category, unit: v.unit, reorderLevel: Number(v.reorderLevel), unitCost: Number(v.unitCost) };
    if (!item) body.quantity = Number(v.quantity);
    try { await save.mutateAsync(body); onClose(); } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title={item ? `Edit ${item.sku}` : 'Add inventory item'} busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Save</Button></>}>
      <FormGrid>
        <TextField label="Item name" required value={v.name} onChange={(x) => f.set('name', x)} error={f.errors.name} maxLength={120} />
        <SelectField label="Category" required value={v.category} onChange={(x) => f.set('category', x)} options={CATEGORIES} placeholder="Choose…" error={f.errors.category} />
        <SelectField label="Campus" required value={v.campusId} onChange={(x) => f.set('campusId', x)} options={campuses.options} error={f.errors.campusId} />
        <TextField label="Unit" required value={v.unit} onChange={(x) => f.set('unit', x)} error={f.errors.unit} maxLength={20} placeholder="pcs, kits, reams" />
        {!item && <TextField label="Opening stock" type="number" min={0} required value={v.quantity} onChange={(x) => f.set('quantity', x)} error={f.errors.quantity} />}
        <TextField label="Reorder level" type="number" min={0} required value={v.reorderLevel} onChange={(x) => f.set('reorderLevel', x)} error={f.errors.reorderLevel} />
        <TextField label="Unit cost (₹)" type="number" min={0} step="0.01" value={v.unitCost} onChange={(x) => f.set('unitCost', x)} error={f.errors.unitCost} />
      </FormGrid>
      {item && <p className="t-xs t-muted mt-3">Stock quantity changes only through stock movements, so every change is traceable.</p>}
      <FormError error={save.error} />
    </Modal>
  );
}

function MovementModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const f = useForm({ movementType: 'out' as 'in' | 'out' | 'adjust', quantity: '', note: '' });
  const v = f.values;
  const save = useApiMutation<Record<string, unknown>>('post', `/inventory/${item.id}/movements`, { invalidate: ['/inventory'], success: 'Stock movement recorded' });
  const n = Number(v.quantity);
  const after = v.movementType === 'in' ? item.quantity + n : v.movementType === 'out' ? item.quantity - n : n;
  const submit = async () => {
    if (!f.validate({
      quantity: req(v.quantity, 'Quantity') ?? (!/^\d+$/.test(v.quantity) ? 'Whole numbers only'
        : v.movementType !== 'adjust' && n < 1 ? 'Quantity must be at least 1'
        : v.movementType === 'out' && n > item.quantity ? `Only ${item.quantity} ${item.unit} in stock` : null),
      note: v.movementType === 'adjust' ? req(v.note, 'A reason') : null,
    })) return;
    try { await save.mutateAsync({ movementType: v.movementType, quantity: n, note: v.note || null }); onClose(); } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title={`Stock movement — ${item.name}`} sub={`${item.quantity} ${item.unit} in stock · reorder at ${item.reorderLevel}`} busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Record movement</Button></>}>
      <Segment items={[{ id: 'in', label: 'Stock in' }, { id: 'out', label: 'Stock out' }, { id: 'adjust', label: 'Adjust to count' }]}
        active={v.movementType} onChange={(x) => f.set('movementType', x)} />
      <div className="mt-3">
        <FormGrid>
          <TextField label={v.movementType === 'adjust' ? 'Counted quantity' : 'Quantity'} type="number" min={0} required value={v.quantity}
            onChange={(x) => f.set('quantity', x)} error={f.errors.quantity} hint={v.quantity && after >= 0 ? `Stock after: ${after} ${item.unit}` : undefined} />
          <TextField label={v.movementType === 'adjust' ? 'Reason' : 'Note'} required={v.movementType === 'adjust'} value={v.note} maxLength={200}
            onChange={(x) => f.set('note', x)} error={f.errors.note} placeholder={v.movementType === 'in' ? 'Supplier / invoice' : 'Issued to…'} />
        </FormGrid>
      </div>
      {v.quantity && after < item.reorderLevel && after >= 0 && <div className="mt-3"><Banner tone="warning" icon="alert">This leaves the item below its reorder point. Office and the Principal will be notified.</Banner></div>}
      <FormError error={save.error} />
    </Modal>
  );
}

function PurchaseModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const f = useForm({ quantity: String(Math.max(1, item.reorderLevel * 2 - item.quantity)), note: '' });
  const v = f.values;
  const save = useApiMutation<Record<string, unknown>>('post', `/inventory/${item.id}/purchase-request`, { success: 'Purchase request sent to Finance' });
  const submit = async () => {
    if (!f.validate({ quantity: req(v.quantity, 'Quantity') ?? (!/^\d+$/.test(v.quantity) || Number(v.quantity) < 1 ? 'Enter at least 1' : null) })) return;
    try { await save.mutateAsync({ quantity: Number(v.quantity), note: v.note || null }); onClose(); } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title="Raise purchase request" sub={`${item.name} · ${item.quantity} ${item.unit} in stock`} busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Send to Finance</Button></>}>
      <FormGrid>
        <TextField label={`Quantity (${item.unit})`} type="number" min={1} required value={v.quantity} onChange={(x) => f.set('quantity', x)} error={f.errors.quantity}
          hint={`Estimated ${fmt.money(Number(v.quantity || 0) * item.unitCost)}`} />
        <TextField label="Note" value={v.note} onChange={(x) => f.set('note', x)} maxLength={300} placeholder="Preferred vendor, urgency" />
      </FormGrid>
      <FormError error={save.error} />
    </Modal>
  );
}
