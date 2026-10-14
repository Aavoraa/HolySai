import { useState } from 'react';
import {
  Badge, Banner, Button, Card, Chart, DataTable, Empty, ErrorState, FilterSelect, Grid, Kpi, Legend, Meter, Modal, Page, PageHead, Pagination, Person,
  SearchInput, SelectField, Skeleton, Status, TextArea, TextField, Toolbar, charts,
} from '@/components/ui';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { fmt } from '@/lib/format';
import { FormError, FormGrid, CRITICAL_ROW, addDaysIso, req, todayIso, useCampusOptions, useForm, useStaffOptions } from './shared';

interface Item {
  id: string; item: string; authority: string; dueOn: string; days: number; ownerName: string; ownerId: string | null; ownerRole: string | null;
  status: string; storedStatus: string; completedOn: string | null; notes: string | null; campusId: string; campusName: string;
}
interface Summary {
  overdue: number; dueSoon: number; onSchedule: number; completedThisMonth: number; firstOverdue: { item: string; days: number } | null;
  score: number | null; previousScore: number | null; months: { label: string; due: number; onTime: number }[];
}

export default function CompliancePage() {
  const list = useListParams({ sort: 'due' }, ['status', 'includeCompleted']);
  const { campusParam } = useSchool();
  const { can } = useAuth();
  const manage = can('operations.manage');
  const q = usePagedQuery<Item>('/compliance', { ...list.query, ...campusParam });
  const sum = useApiQuery<Summary>('/compliance/summary', campusParam);
  const [edit, setEdit] = useState<Item | 'new' | null>(null);
  const [complete, setComplete] = useState<Item | null>(null);
  const [escalate, setEscalate] = useState<Item | null>(null);
  const s = sum.data;
  const delta = s?.score != null && s.previousScore != null ? s.score - s.previousScore : null;
  const emptyCalendar = !q.isLoading && !q.error && !!q.data && !q.data.rows.length && !list.hasFilters;
  return (
    <Page>
      <PageHead title="Compliance Calendar" sub="Fire safety, vehicle fitness, child-protection training, staff checks and affiliation requirements — with an owner on every line."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Add requirement</Button>} />
      {!!s?.overdue && (
        <div className="mb-4">
          <Banner tone="critical" icon="alertCircle">
            <div className="row between wrap g-2">
              <span>
                <strong>{s.overdue} requirement{s.overdue === 1 ? ' is' : 's are'} overdue.</strong>
                {s.firstOverdue ? <> The oldest is {s.firstOverdue.item}, {s.firstOverdue.days} days past due.</> : null}
              </span>
              {list.filters.status !== 'Overdue' && <Button size="sm" onClick={() => list.setFilter('status', 'Overdue')}>Show overdue</Button>}
            </div>
          </Banner>
        </div>
      )}
      <Grid cols="g-4col" className="mb-4">
        <Kpi label="Overdue" icon="alertCircle" value={fmt.n(s?.overdue)} tone="critical" loading={sum.isLoading} onClick={() => list.setFilter('status', 'Overdue')}
          foot={s?.firstOverdue ? `${s.firstOverdue.item} — ${s.firstOverdue.days} days` : 'Nothing overdue'} />
        <Kpi label="Due within 14 days" icon="clock" value={fmt.n(s?.dueSoon)} tone="amber" loading={sum.isLoading} onClick={() => list.setFilter('status', 'Due Soon')} />
        <Kpi label="On schedule" icon="calendar" value={fmt.n(s?.onSchedule)} tone="teal" loading={sum.isLoading} onClick={() => list.setFilter('status', 'Scheduled')} />
        <Kpi label="Compliance score" icon="shieldCheck" value={s?.score != null ? `${s.score}%` : '—'} tone="teal" loading={sum.isLoading} delta={delta} deltaUnit=" pts"
          foot="Completed on time, last 12 months" />
      </Grid>
      <Card flush>
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search requirement, authority or owner" />
          <FilterSelect label="Status" allLabel="All open" value={list.filters.status} onChange={(v) => list.setFilter('status', v)}
            options={['Overdue', 'Due Soon', 'In Progress', 'Scheduled', 'Completed']} />
          {!list.filters.status && <FilterSelect label="Show" allLabel="Open only" value={list.filters.includeCompleted}
            onChange={(v) => list.setFilter('includeCompleted', v)} options={[{ value: 'true', label: 'Include completed' }]} />}
          {list.hasFilters && <Button variant="quiet" size="sm" icon="x" onClick={list.clear}>Clear</Button>}
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : emptyCalendar ? (
          <Empty icon="check" title="No open requirements"
            sub="Fire NOCs, vehicle fitness, staff checks and affiliation renewals appear here with their due dates and owners."
            action={manage ? <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Add requirement</Button> : undefined} />
        ) : (
          <DataTable<Item>
            rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            emptyText="No requirements match the current filters."
            rowClassName={(r) => (r.status !== 'Completed' && r.days < 0 ? CRITICAL_ROW : undefined)}
            columns={[
              { key: 'item', label: 'Requirement', render: (r) => <><span className="t-bold">{r.item}</span><div className="t-micro t-muted">{r.authority} · {r.campusName}</div></> },
              { key: 'owner', label: 'Owner', render: (r) => <Person name={r.ownerName} meta={r.ownerRole ?? undefined} /> },
              { key: 'due', label: 'Due', render: (r) => <span className="t-num">{fmt.date(r.dueOn)}</span> },
              { key: 'days', label: 'Time remaining', sortable: false, render: (r) => r.status === 'Completed'
                ? <span className="t-sm t-muted">Done {fmt.date(r.completedOn)}{r.completedOn && r.completedOn > r.dueOn ? ' (late)' : ''}</span>
                : r.days < 0 ? <Badge tone="critical" dot>{Math.abs(r.days)} days overdue</Badge>
                : <Meter label="" value={Math.max(6, 100 - Math.min(100, r.days))} right={`${r.days} days`} tone={r.days < 10 ? 'critical' : r.days < 30 ? 'amber' : 'teal'} /> },
              { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
              { key: 'a', label: '', sortable: false, className: 'num', render: (r) => manage && r.status !== 'Completed' ? (
                <div className="row g-2 end">
                  {r.days < 0 && <Button size="sm" variant="danger" icon="megaphone" onClick={() => setEscalate(r)}>Escalate</Button>}
                  <Button size="sm" variant="teal" icon="check" onClick={() => setComplete(r)}>Complete</Button>
                  <Button size="sm" variant="quiet" icon="edit" aria-label={`Update ${r.item}`} onClick={() => setEdit(r)} />
                </div>
              ) : null },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      <Card icon="grid" title="Compliance over the year" sub="Items completed on time against items due" className="mt-4">
        {sum.error ? <ErrorState error={sum.error} onRetry={sum.refetch} /> : s ? (
          <>
            <Chart svg={charts.bar({
              labels: s.months.map((m) => m.label),
              series: [{ name: 'Due', values: s.months.map((m) => m.due), color: 'var(--border-strong)' },
                { name: 'Completed on time', values: s.months.map((m) => m.onTime), color: 'var(--teal)' }],
              height: 220,
            })} />
            <div className="mt-3"><Legend items={[{ label: 'Due', color: 'var(--border-strong)' }, { label: 'Completed on time', color: 'var(--teal)' }]} /></div>
          </>
        ) : <Skeleton height={220} />}
      </Card>
      {edit && <ItemModal item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {complete && <CompleteModal item={complete} onClose={() => setComplete(null)} />}
      {escalate && <EscalateModal item={escalate} onClose={() => setEscalate(null)} />}
    </Page>
  );
}

function ItemModal({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const campuses = useCampusOptions();
  const staff = useStaffOptions();
  const f = useForm({
    campusId: item?.campusId ?? campuses.defaultId, item: item?.item ?? '', authority: item?.authority ?? '', dueOn: item?.dueOn ?? '',
    ownerId: item?.ownerId ?? '', status: item && ['Scheduled', 'In Progress'].includes(item.storedStatus) ? item.storedStatus : 'Scheduled', notes: item?.notes ?? '',
  });
  const v = f.values;
  const save = useApiMutation<Record<string, unknown>>(item ? 'put' : 'post', item ? `/compliance/${item.id}` : '/compliance',
    { invalidate: ['/compliance'], success: item ? 'Requirement updated' : 'Requirement added' });
  const submit = async () => {
    if (!f.validate({
      item: req(v.item, 'Requirement'), authority: req(v.authority, 'Authority'), dueOn: req(v.dueOn, 'Due date'),
      ownerId: req(v.ownerId, 'Owner'), campusId: item ? null : req(v.campusId, 'Campus'),
    })) return;
    const body = item
      ? { item: v.item, authority: v.authority, dueOn: v.dueOn, ownerId: v.ownerId, status: v.status, notes: v.notes || null }
      : { campusId: v.campusId, item: v.item, authority: v.authority, dueOn: v.dueOn, ownerId: v.ownerId, notes: v.notes || null };
    try { await save.mutateAsync(body); onClose(); } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title={item ? 'Update requirement' : 'Add requirement'} busy={save.isPending} size="wide"
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Save</Button></>}>
      <FormGrid>
        <TextField label="Requirement" required value={v.item} maxLength={160} onChange={(x) => f.set('item', x)} error={f.errors.item} />
        <TextField label="Authority" required value={v.authority} maxLength={120} onChange={(x) => f.set('authority', x)} error={f.errors.authority} placeholder="e.g. TN Fire & Rescue" />
        {!item && <SelectField label="Campus" required value={v.campusId} onChange={(x) => f.set('campusId', x)} options={campuses.options} error={f.errors.campusId} />}
        <TextField label="Due on" type="date" required value={v.dueOn} onChange={(x) => f.set('dueOn', x)} error={f.errors.dueOn} />
        <SelectField label="Owner" required value={v.ownerId} onChange={(x) => f.set('ownerId', x)} options={staff} placeholder="Choose…" error={f.errors.ownerId} />
        {item && <SelectField label="Progress" value={v.status} onChange={(x) => f.set('status', x)} options={['Scheduled', 'In Progress']}
          hint="Overdue and Due Soon are set automatically from the due date." />}
      </FormGrid>
      <div className="mt-3"><TextArea label="Notes" rows={2} maxLength={500} value={v.notes} onChange={(x) => f.set('notes', x)} /></div>
      <FormError error={save.error} />
    </Modal>
  );
}

function CompleteModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const f = useForm({ completedOn: todayIso(), notes: '', repeat: '', nextDueOn: '' });
  const v = f.values;
  const save = useApiMutation<Record<string, unknown>>('post', `/compliance/${item.id}/complete`, { invalidate: ['/compliance'], success: 'Marked completed' });
  const repeatDays: Record<string, number> = { quarterly: 91, halfyearly: 182, yearly: 365 };
  const submit = async () => {
    const next = v.repeat === 'custom' ? v.nextDueOn : v.repeat ? addDaysIso(repeatDays[v.repeat]) : '';
    if (!f.validate({
      completedOn: req(v.completedOn, 'Completion date') ?? (v.completedOn > todayIso() ? 'Cannot be in the future' : null),
      nextDueOn: v.repeat === 'custom' ? (req(v.nextDueOn, 'Next due date') ?? (v.nextDueOn <= v.completedOn ? 'Must be after completion' : null)) : null,
    })) return;
    try { await save.mutateAsync({ completedOn: v.completedOn, notes: v.notes || null, ...(next ? { nextDueOn: next } : {}) }); onClose(); } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title="Mark requirement completed" sub={`${item.item} · due ${fmt.date(item.dueOn)}`} busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Mark completed</Button></>}>
      <FormGrid>
        <TextField label="Completed on" type="date" required max={todayIso()} value={v.completedOn} onChange={(x) => f.set('completedOn', x)} error={f.errors.completedOn} />
        <SelectField label="Schedule the next one" value={v.repeat} onChange={(x) => f.set('repeat', x)} placeholder="Do not repeat"
          options={[{ value: 'quarterly', label: 'In 3 months' }, { value: 'halfyearly', label: 'In 6 months' }, { value: 'yearly', label: 'In 12 months' }, { value: 'custom', label: 'On a date…' }]} />
        {v.repeat === 'custom' && <TextField label="Next due on" type="date" required min={addDaysIso(1)} value={v.nextDueOn} onChange={(x) => f.set('nextDueOn', x)} error={f.errors.nextDueOn} />}
      </FormGrid>
      <div className="mt-3"><TextArea label="Evidence / notes" rows={2} maxLength={500} value={v.notes} onChange={(x) => f.set('notes', x)} placeholder="Certificate number, inspection report reference" /></div>
      <FormError error={save.error} />
    </Modal>
  );
}

function EscalateModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const [note, setNote] = useState('');
  const save = useApiMutation<Record<string, unknown>>('post', `/compliance/${item.id}/escalate`, { success: 'Escalated to the Principal and owner' });
  return (
    <Modal open onClose={onClose} title="Escalate overdue requirement" sub={`${item.item} · ${Math.abs(item.days)} days overdue · owner ${item.ownerName}`} busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" loading={save.isPending} onClick={async () => {
        try { await save.mutateAsync(note.trim() ? { note: note.trim() } : {}); onClose(); } catch { /* toast shown */ }
      }}>Send escalation</Button></>}>
      <p className="t-sm mb-3">A critical notification goes to the Principal, the School Admin and the owner.</p>
      <TextArea label="Message" rows={3} maxLength={300} value={note} onChange={setNote} placeholder="What is needed and by when" />
      <FormError error={save.error} />
    </Modal>
  );
}
