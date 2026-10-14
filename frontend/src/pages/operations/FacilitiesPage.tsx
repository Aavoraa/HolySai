import { useMemo, useState } from 'react';
import {
  Badge, Banner, Button, Card, DataTable, Empty, ErrorState, Grid, Kpi, Meter, Modal, Page, PageHead, SearchInput, SelectField, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { fmt } from '@/lib/format';
import { FormError, FormGrid, addDaysIso, req, todayIso, useCampusOptions, useForm } from './shared';

interface Facility {
  id: string; name: string; facilityType: string; capacity: number | null; status: string; campusId: string; campusName: string;
  bookedHours: number; utilisation: number; today: { id: string; purpose: string; startsAt: string; endsAt: string }[]; openRequests: number;
}
interface Booking { id: string; bookedOn: string; startsAt: string; endsAt: string; purpose: string; bookedBy: string | null; bookedById: string | null }

const TYPES = ['Classroom', 'Lab', 'Hall', 'Field', 'Library', 'Studio', 'Other'];
const STATUSES = ['Available', 'In use', 'Maintenance', 'Closed'];
/** Facility statuses read differently from workflow statuses (a closed room is not a "done" item). */
const facilityTone = (s: string) => (s === 'Available' ? 'success' : s === 'In use' ? 'info' : s === 'Maintenance' ? 'warning' : 'neutral');
const isBookable = (f: Facility) => f.status !== 'Closed' && f.status !== 'Maintenance';

export default function FacilitiesPage() {
  const { campusParam } = useSchool();
  const { can } = useAuth();
  const manage = can('operations.manage');
  const [q, setQ] = useState('');
  const list = useApiQuery<Facility[]>('/facilities', { ...campusParam, q: q || undefined });
  const [book, setBook] = useState<Facility | null>(null);
  const [edit, setEdit] = useState<Facility | 'new' | null>(null);
  const stats = useMemo(() => {
    const rows = list.data ?? [];
    const util = rows.length ? Math.round(rows.reduce((a, r) => a + r.utilisation, 0) / rows.length) : null;
    return {
      total: rows.length,
      available: rows.filter((r) => r.status === 'Available').length,
      blocked: rows.filter((r) => !isBookable(r)).length,
      requests: rows.reduce((a, r) => a + r.openRequests, 0),
      util,
      busy: rows.filter((r) => r.utilisation > 80).length,
    };
  }, [list.data]);
  const firstBookable = list.data?.find((f) => f.status === 'Available') ?? list.data?.find(isBookable);
  return (
    <Page>
      <PageHead title="Facilities" sub="Rooms, capacity, bookings and how heavily each space is used."
        actions={<>
          {manage && <Button icon="plus" onClick={() => setEdit('new')}>Add space</Button>}
          <Button variant="primary" icon="calendar" disabled={!firstBookable} onClick={() => firstBookable && setBook(firstBookable)}>Book a room</Button>
        </>} />
      <Grid cols="g-4col" className="mb-4">
        <Kpi label="Spaces" icon="building" value={fmt.n(stats.total)} loading={list.isLoading} foot={q ? 'Matching your search' : undefined} />
        <Kpi label="Available now" icon="door" value={fmt.n(stats.available)} tone="teal" loading={list.isLoading} />
        <Kpi label="Closed or in maintenance" icon="wrench" value={fmt.n(stats.blocked)} tone="amber" loading={list.isLoading}
          foot={stats.requests ? `${stats.requests} open maintenance request${stats.requests === 1 ? '' : 's'}` : undefined} />
        <Kpi label="Average utilisation" icon="activity" value={stats.util != null ? `${stats.util}%` : '—'} tone="info" loading={list.isLoading}
          foot={stats.busy ? `${stats.busy} space${stats.busy === 1 ? '' : 's'} above 80%` : 'Booked hours of a 40-hour week'} />
      </Grid>
      <Card flush>
        <Toolbar>
          <SearchInput value={q} onSearch={setQ} placeholder="Search spaces" />
          {q && <Button variant="quiet" size="sm" icon="x" onClick={() => setQ('')}>Clear</Button>}
        </Toolbar>
        {list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : !list.isLoading && list.data && !list.data.length && !q ? (
          <Empty icon="building" title="No spaces recorded for this campus"
            sub="Add classrooms, labs, halls and fields to take bookings and track how heavily each one is used."
            action={manage ? <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Add space</Button> : undefined} />
        ) : (
          <DataTable<Facility>
            rows={list.data} loading={list.isLoading} rowKey={(r) => r.id} emptyText="No spaces match your search."
            columns={[
              { key: 'name', label: 'Space', render: (r) => <><span className="t-bold">{r.name}</span><div className="t-micro t-muted">{r.facilityType} · {r.campusName}</div></> },
              { key: 'capacity', label: 'Capacity', className: 'num', render: (r) => <span className="t-num">{r.capacity ?? '—'}</span> },
              { key: 'today', label: 'Today', render: (r) => r.today.length
                ? <span className="t-sm">{r.today.map((b) => `${b.purpose} (${b.startsAt}–${b.endsAt})`).join(', ')}</span>
                : <span className="t-faint">No bookings</span> },
              { key: 'status', label: 'Status', render: (r) => <><Badge tone={facilityTone(r.status)}>{r.status}</Badge>
                {r.openRequests > 0 && <div className="t-micro t-warning mt-1">{r.openRequests} open request{r.openRequests === 1 ? '' : 's'}</div>}</> },
              { key: 'util', label: 'Weekly utilisation', render: (r) => (
                <Meter label={`${fmt.n(r.bookedHours)} h of 40 h`} value={r.utilisation} tone={r.utilisation > 80 ? 'critical' : r.utilisation > 60 ? 'amber' : 'teal'} />
              ) },
              { key: 'a', label: '', className: 'num', render: (r) => (
                <div className="row g-2 end">
                  <Button size="sm" icon="calendar" disabled={!isBookable(r)} title={isBookable(r) ? undefined : `${r.status} — bookings are blocked`} onClick={() => setBook(r)}>Book</Button>
                  {manage && <Button size="sm" variant="quiet" icon="edit" aria-label={`Edit ${r.name}`} title="Edit" onClick={() => setEdit(r)} />}
                </div>
              ) },
            ]}
          />
        )}
      </Card>
      {book && list.data && <BookingModal facilities={list.data} initial={book} onClose={() => setBook(null)} />}
      {edit && <FacilityModal facility={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Page>
  );
}

function BookingModal({ facilities, initial, onClose }: { facilities: Facility[]; initial: Facility; onClose: () => void }) {
  const { user, can } = useAuth();
  const confirm = useConfirm();
  const f = useForm({ facilityId: initial.id, bookedOn: todayIso(), startsAt: '09:00', endsAt: '10:00', purpose: '' });
  const v = f.values;
  const bookings = useApiQuery<{ bookings: Booking[] }>(`/facilities/${v.facilityId}/bookings`, { from: todayIso(), to: addDaysIso(13) });
  const save = useApiMutation<Record<string, unknown>>('post', `/facilities/${v.facilityId}/bookings`, { invalidate: ['/facilities'], success: 'Room booked' });
  const cancel = useApiMutation<string>('delete', (id) => `/facility-bookings/${id}`, { invalidate: ['/facilities'], success: 'Booking cancelled' });
  const submit = async () => {
    if (!f.validate({
      bookedOn: req(v.bookedOn, 'Date') ?? (v.bookedOn < todayIso() ? 'Choose today or a later date' : null),
      startsAt: req(v.startsAt, 'Start'),
      endsAt: req(v.endsAt, 'End') ?? (v.endsAt <= v.startsAt ? 'End must be after start' : null),
      purpose: req(v.purpose, 'Purpose') ?? (v.purpose.trim().length < 3 ? 'Describe the booking' : null),
    })) return;
    try { await save.mutateAsync({ bookedOn: v.bookedOn, startsAt: v.startsAt, endsAt: v.endsAt, purpose: v.purpose }); f.set('purpose', ''); } catch (e) { f.fromError(e); }
  };
  const bookable = facilities.filter(isBookable);
  return (
    <Modal open onClose={onClose} title="Book a room" sub="Clashing bookings are refused automatically." size="wide" busy={save.isPending}
      foot={<><Button onClick={onClose}>Close</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Confirm booking</Button></>}>
      <FormGrid>
        <SelectField label="Space" required value={v.facilityId} onChange={(x) => f.set('facilityId', x)}
          options={bookable.map((x) => ({ value: x.id, label: `${x.name} (${x.campusName})` }))} />
        <TextField label="Date" type="date" required min={todayIso()} value={v.bookedOn} onChange={(x) => f.set('bookedOn', x)} error={f.errors.bookedOn} />
        <TextField label="From" type="time" required value={v.startsAt} onChange={(x) => f.set('startsAt', x)} error={f.errors.startsAt} />
        <TextField label="To" type="time" required value={v.endsAt} onChange={(x) => f.set('endsAt', x)} error={f.errors.endsAt} />
      </FormGrid>
      <div className="mt-3"><TextField label="Purpose" required value={v.purpose} maxLength={160} onChange={(x) => f.set('purpose', x)} error={f.errors.purpose} placeholder="e.g. Grade 6C practical, P6" /></div>
      <FormError error={save.error} />
      <div className="eyebrow mt-4 mb-2">Next two weeks</div>
      {bookings.isLoading ? <span className="t-sm t-muted">Loading bookings…</span> : bookings.error ? <ErrorState error={bookings.error} onRetry={bookings.refetch} />
        : !bookings.data?.bookings.length ? <Empty icon="calendar" title="No bookings yet" sub="This space is free for the next two weeks." /> : (
          <DataTable<Booking> compact stack={false} rows={bookings.data.bookings} rowKey={(b) => b.id} columns={[
            { key: 'bookedOn', label: 'Date', render: (b) => <span className="t-num">{fmt.date(b.bookedOn)}</span> },
            { key: 'time', label: 'Time', render: (b) => <span className="t-num">{b.startsAt}–{b.endsAt}</span> },
            { key: 'purpose', label: 'Purpose' },
            { key: 'by', label: 'Booked by', render: (b) => b.bookedBy ?? '—' },
            { key: 'a', label: '', className: 'num', render: (b) => (b.bookedById === user?.id || can('operations.manage')) ? (
              <Button size="sm" variant="quiet" loading={cancel.isPending && cancel.variables === b.id} onClick={async () => {
                if (await confirm({ title: 'Cancel this booking?', body: `${b.purpose} on ${fmt.date(b.bookedOn)}, ${b.startsAt}–${b.endsAt}.`, confirmLabel: 'Cancel booking', danger: true })) cancel.mutate(b.id);
              }}>Cancel</Button>) : null },
          ]} />
        )}
    </Modal>
  );
}

function FacilityModal({ facility, onClose }: { facility: Facility | null; onClose: () => void }) {
  const campuses = useCampusOptions();
  const f = useForm({
    campusId: facility?.campusId ?? campuses.defaultId, name: facility?.name ?? '', facilityType: facility?.facilityType ?? '',
    capacity: facility?.capacity != null ? String(facility.capacity) : '', status: facility?.status ?? 'Available',
  });
  const v = f.values;
  const save = useApiMutation<Record<string, unknown>>(facility ? 'put' : 'post', facility ? `/facilities/${facility.id}` : '/facilities',
    { invalidate: ['/facilities'], success: facility ? 'Space updated' : 'Space added' });
  const submit = async () => {
    if (!f.validate({
      name: req(v.name, 'Name'), facilityType: req(v.facilityType, 'Type'), campusId: req(v.campusId, 'Campus'),
      capacity: v.capacity && !(Number(v.capacity) >= 1) ? 'Enter a capacity of at least 1' : null,
    })) return;
    try { await save.mutateAsync({ ...v, capacity: v.capacity ? Number(v.capacity) : null }); onClose(); } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title={facility ? `Edit ${facility.name}` : 'Add a space'} busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Save</Button></>}>
      <FormGrid>
        <TextField label="Name" required value={v.name} onChange={(x) => f.set('name', x)} error={f.errors.name} maxLength={120} />
        <SelectField label="Type" required value={v.facilityType} onChange={(x) => f.set('facilityType', x)} options={TYPES} placeholder="Choose…" error={f.errors.facilityType} />
        <SelectField label="Campus" required value={v.campusId} onChange={(x) => f.set('campusId', x)} options={campuses.options} error={f.errors.campusId} />
        <TextField label="Capacity" type="number" min={1} value={v.capacity} onChange={(x) => f.set('capacity', x)} error={f.errors.capacity} />
        <SelectField label="Status" value={v.status} onChange={(x) => f.set('status', x)} options={STATUSES} />
      </FormGrid>
      {(v.status === 'Maintenance' || v.status === 'Closed') && (
        <div className="mt-3"><Banner tone="warning" icon="lock">New bookings are blocked while this space is {v.status === 'Closed' ? 'closed' : 'under maintenance'}.</Banner></div>
      )}
      <FormError error={save.error} />
    </Modal>
  );
}
