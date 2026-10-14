import { useEffect, useMemo, useState } from 'react';
import {
  Badge, Banner, Button, Card, Dl, Empty, ErrorState, FilterSelect, Grid, Kpi, Modal, Page, PageHead, Pagination, SearchInput,
  Segment, SelectField, Skeleton, Status, TextArea, TextField, useConfirm,
} from '@/components/ui';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useSchool } from '@/layouts/SchoolContext';
import { useAuth } from '@/auth/AuthContext';
import { cx, fmt, todayKey } from '@/lib/format';
import { AudiencePicker, fieldErrorsOf } from './shared';
import type { Audience, EventSummary, EventType, SchoolEvent } from './types';

const TYPES: EventType[] = ['School', 'Academic', 'Sports', 'Cultural', 'PTM', 'Holiday'];
const TYPE_TONE: Record<string, string> = { School: 'neutral', Academic: 'info', Sports: 'success', Cultural: 'caution', PTM: 'warning', Holiday: 'critical' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function when(e: SchoolEvent) {
  const range = e.endsOn && e.endsOn !== e.startsOn ? `${fmt.dateShort(e.startsOn)} – ${fmt.date(e.endsOn)}` : fmt.date(e.startsOn);
  return `${range}${e.startsAt ? ` · ${e.startsAt}` : ''}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export default function EventsPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const list = useListParams({ sort: 'date', pageSize: 20 }, ['when', 'type', 'status', 'view']);
  const period = list.filters.when || 'upcoming';
  const view = list.filters.view || 'list';
  const [detail, setDetail] = useState<SchoolEvent | null>(null);
  const [form, setForm] = useState<{ open: boolean; event?: SchoolEvent | null; date?: string }>({ open: false });
  const today = todayKey();
  const [month, setMonth] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));

  const summary = useApiQuery<EventSummary>('/events/summary', campusParam);
  const listQ = usePagedQuery<SchoolEvent>(view === 'list' ? '/events' : null, {
    ...list.query, sort: undefined, dir: undefined, when: period, ...campusParam,
  });
  const monthStart = ymd(month.y, month.m, 1);
  const monthEnd = ymd(month.y, month.m, new Date(month.y, month.m + 1, 0).getDate());
  const calQ = usePagedQuery<SchoolEvent>(view === 'calendar' ? '/events' : null, {
    when: 'all', from: monthStart, to: monthEnd, pageSize: 200, type: list.filters.type || undefined, status: list.filters.status || undefined, q: list.query.q, ...campusParam,
  });
  const s = summary.data;
  const canSend = can('communication.send');

  return (
    <Page>
      <PageHead title="Events" sub="The school calendar as parents see it."
        actions={canSend && <Button variant="primary" icon="plus" onClick={() => setForm({ open: true, event: null })}>Add event</Button>} />
      {s && (
        <Grid cols="g-4col" className="mb-4">
          <Kpi icon="calendar" label="Upcoming" value={fmt.n(s.upcoming)} foot="On the school calendar" />
          <Kpi icon="clock" label="Next 30 days" value={fmt.n(s.next30Days)} tone="teal" foot="On the parent calendar soon" />
          <Kpi icon="edit" label="Drafts" value={fmt.n(s.drafts)} tone={s.drafts ? 'amber' : undefined} foot="Not yet visible to families" onClick={() => list.setFilter('status', 'Draft')} />
          <Kpi icon="x" label="Cancelled" value={fmt.n(s.cancelled)} foot="Still listed, struck through" onClick={() => list.setFilter('status', 'Cancelled')} />
        </Grid>
      )}
      <div className="filterbar">
        <Segment items={[{ id: 'list', label: 'List' }, { id: 'calendar', label: 'Calendar' }]} active={view} onChange={(v) => list.setFilter('view', v === 'list' ? '' : v)} />
        {view === 'list' && (
          <Segment items={[{ id: 'upcoming', label: 'Upcoming' }, { id: 'past', label: 'Past' }, { id: 'all', label: 'All' }]} active={period}
            onChange={(v) => list.setFilter('when', v === 'upcoming' ? '' : v)} />
        )}
        <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search events" />
        <FilterSelect label="Type" value={list.filters.type} onChange={(v) => list.setFilter('type', v)} options={TYPES} />
        <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={['Published', 'Draft', 'Cancelled']} />
      </div>

      {view === 'list' ? (
        listQ.error ? <ErrorState error={listQ.error} onRetry={listQ.refetch} />
          : listQ.isLoading ? <div className="grid g-2col g-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={120} />)}</div>
            : !listQ.data?.rows.length ? (
              <Card><Empty icon="calendar" title={period === 'past' ? 'No past events' : 'No events scheduled'}
                sub={list.hasFilters ? 'Try clearing the filters.' : 'Add an event so families can plan ahead.'}
                action={canSend && period !== 'past' ? <Button variant="primary" icon="plus" onClick={() => setForm({ open: true, event: null })}>Add event</Button> : undefined} /></Card>
            ) : (
              <>
                <div className={cx('grid g-2col g-4', listQ.isFetching && 'pe-fetching')}>
                  {listQ.data.rows.map((e) => <EventCard key={e.id} e={e} onOpen={() => setDetail(e)} />)}
                </div>
                <Card flush className="mt-4"><Pagination meta={listQ.data.meta} onPage={list.setPage} /></Card>
              </>
            )
      ) : (
        <Card
          title={`${MONTHS[month.m]} ${month.y}`}
          actions={<>
            <Button size="sm" icon="chevronLeft" aria-label="Previous month" onClick={() => setMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))} />
            <Button size="sm" onClick={() => setMonth({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })}>Today</Button>
            <Button size="sm" icon="chevronRight" aria-label="Next month" onClick={() => setMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))} />
          </>}
        >
          {calQ.error ? <ErrorState error={calQ.error} onRetry={calQ.refetch} /> : (
            <MonthGrid y={month.y} m={month.m} events={calQ.data?.rows ?? []} loading={calQ.isLoading} today={today}
              onOpen={setDetail} onAdd={canSend ? (date) => setForm({ open: true, event: null, date }) : undefined} />
          )}
        </Card>
      )}

      <EventDetail event={detail} onClose={() => setDetail(null)} onEdit={(e) => { setDetail(null); setForm({ open: true, event: e }); }} onChanged={setDetail} />
      <EventForm open={form.open} event={form.event ?? null} date={form.date} onClose={() => setForm({ open: false })} />
    </Page>
  );
}

function EventCard({ e, onOpen }: { e: SchoolEvent; onOpen: () => void }) {
  const d = new Date(`${e.startsOn}T00:00:00`);
  const notify = useNotify();
  const { can } = useAuth();
  return (
    <Card>
      <div className={cx('pe-event', e.status === 'Cancelled' && 'pe-event--cancelled')}>
        <span className="pe-event__date" aria-hidden="true">
          <span className="t-micro t-muted">{MONTHS[d.getMonth()]}</span>
          <span className="pe-event__day">{d.getDate()}</span>
        </span>
        <span className="pe-event__body">
          <span className="row g-2 wrap">
            <span className="t-bold pe-event__title">{e.title}</span>
            <Badge tone={TYPE_TONE[e.eventType]}>{e.eventType}</Badge>
            {e.status !== 'Published' && <Status value={e.status} />}
          </span>
          <span className="t-xs t-muted mt-1">{when(e)}</span>
          <span className="t-xs t-muted">{[e.venue, e.audience, e.campus].filter(Boolean).join(' · ')}</span>
          <span className="row g-2 mt-3 wrap">
            <Button size="sm" onClick={onOpen}>Details</Button>
            {can('communication.send') && e.status === 'Published' && (e.endsOn ?? e.startsOn) >= todayKey() && (
              <Button size="sm" icon="megaphone" onClick={() => notify.run(e)} disabled={notify.pending}>
                {e.notifiedAt ? 'Notify again' : 'Notify parents'}
              </Button>
            )}
            {e.notifiedAt && <span className="t-micro t-muted">Notified {fmt.relative(e.notifiedAt)}</span>}
          </span>
        </span>
      </div>
    </Card>
  );
}

function useNotify(onDone?: (e: SchoolEvent) => void) {
  const confirm = useConfirm();
  const m = useApiMutation<string, SchoolEvent>('post', (id) => `/events/${id}/notify`, { invalidate: ['/events'], body: () => ({}), onSuccess: (r) => onDone?.(r.data) });
  return {
    pending: m.isPending,
    run: async (e: SchoolEvent) => {
      if (await confirm({
        title: e.notifiedAt ? 'Notify families again?' : 'Notify families?',
        body: `${e.audience} will get an app notification and a WhatsApp message about “${e.title}” on ${when(e)}.${e.notifiedAt ? ` They were last notified ${fmt.relative(e.notifiedAt)}.` : ''}`,
        confirmLabel: 'Send notification', icon: 'send',
      })) m.mutate(e.id);
    },
  };
}

function MonthGrid({ y, m, events, loading, today, onOpen, onAdd }: {
  y: number; m: number; events: SchoolEvent[]; loading: boolean; today: string; onOpen: (e: SchoolEvent) => void; onAdd?: (date: string) => void;
}) {
  const days = new Date(y, m + 1, 0).getDate();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
  const cells = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const byDay = useMemo(() => {
    const map = new Map<string, SchoolEvent[]>();
    for (const e of events) {
      const end = e.endsOn ?? e.startsOn;
      for (let d = 1; d <= days; d++) {
        const k = ymd(y, m, d);
        if (k >= e.startsOn && k <= end) map.set(k, [...(map.get(k) ?? []), e]);
      }
    }
    return map;
  }, [events, y, m, days]);
  return (
    <div className="pe-cal" aria-busy={loading || undefined}>
      <div className="pe-cal__grid" role="grid" aria-label={`${MONTHS[m]} ${y}`}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="pe-cal__dow" role="columnheader">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const k = ymd(y, m, d);
          const list = byDay.get(k) ?? [];
          return (
            <div key={k} role="gridcell" className={cx('pe-cal__day', k === today && 'pe-cal__day--today')}>
              <div className="row between">
                <span className={cx('t-xs', k === today ? 't-bold' : 't-muted')}>{d}</span>
                {onAdd && k >= today && (
                  <button type="button" className="pe-cal__add" aria-label={`Add event on ${fmt.date(k)}`} onClick={() => onAdd(k)}>+</button>
                )}
              </div>
              {loading ? null : list.slice(0, 3).map((e) => (
                <button key={e.id} type="button" onClick={() => onOpen(e)} title={e.title}
                  className={cx('pe-cal__ev', TYPE_TONE[e.eventType] !== 'neutral' && `pe-cal__ev--${TYPE_TONE[e.eventType]}`, e.status === 'Cancelled' && 'pe-cal__ev--cancelled', e.status === 'Draft' && 'pe-cal__ev--draft')}>
                  {e.startsOn === k && e.startsAt ? `${e.startsAt} ` : ''}{e.title}
                </button>
              ))}
              {list.length > 3 && <span className="t-micro t-muted">+{list.length - 3} more</span>}
            </div>
          );
        })}
      </div>
      {!loading && events.length === 0 && <p className="t-sm t-muted mt-3">No events this month.{onAdd ? ' Use + on a day to add one.' : ''}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
function EventDetail({ event, onClose, onEdit, onChanged }: { event: SchoolEvent | null; onClose: () => void; onEdit: (e: SchoolEvent) => void; onChanged: (e: SchoolEvent) => void }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const notify = useNotify(onChanged);
  const cancel = useApiMutation<string, SchoolEvent>('post', (id) => `/events/${id}/cancel`, { invalidate: ['/events'], body: () => ({}), onSuccess: (r) => onChanged(r.data) });
  const e = event;
  const upcoming = e ? (e.endsOn ?? e.startsOn) >= todayKey() : false;
  const canSend = can('communication.send');
  const doCancel = async () => {
    if (!e) return;
    if (await confirm({
      title: 'Cancel this event?', danger: true, confirmLabel: 'Cancel event',
      body: e.status === 'Published' && upcoming ? `${e.audience} will be notified that “${e.title}” is cancelled. This cannot be undone.` : `“${e.title}” will be marked as cancelled. This cannot be undone.`,
    })) cancel.mutate(e.id);
  };
  return (
    <Modal open={!!e} onClose={onClose} title={e?.title ?? ''} sub={e ? when(e) : undefined}
      foot={e && <>
        {canSend && e.status !== 'Cancelled' && <Button variant="danger" onClick={doCancel} loading={cancel.isPending}>Cancel event</Button>}
        {canSend && e.status !== 'Cancelled' && <Button icon="edit" onClick={() => onEdit(e)}>Edit</Button>}
        {canSend && e.status === 'Published' && upcoming && <Button variant="primary" icon="megaphone" onClick={() => notify.run(e)} loading={notify.pending}>Notify parents</Button>}
      </>}>
      {e && (
        <div className="col g-3">
          {e.status === 'Cancelled' && <Banner tone="critical" icon="x">This event has been cancelled.</Banner>}
          {e.status === 'Draft' && <Banner tone="neutral">Draft — families cannot see this event until it is published.</Banner>}
          {e.description && <p className="t-sm">{e.description}</p>}
          <Dl items={[
            ['Type', <Badge key="t" tone={TYPE_TONE[e.eventType]}>{e.eventType}</Badge>],
            ['When', when(e)],
            ['Venue', e.venue ?? '—'],
            ['Audience', e.audience],
            ['Campus', e.campus ?? 'All campuses'],
            ['Status', <Status key="s" value={e.status} />],
            ['Families notified', e.notifiedAt ? fmt.dateTime(e.notifiedAt) : 'Not yet'],
            ['Created by', `${e.createdBy ?? '—'} · ${fmt.date(e.createdAt)}`],
          ]} />
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function EventForm({ open, event, date, onClose }: { open: boolean; event: SchoolEvent | null; date?: string; onClose: () => void }) {
  const { campusId: headerCampus } = useSchool();
  const blank = { title: '', description: '', eventType: 'School', startsOn: '', endsOn: '', startsAt: '', venue: '', status: 'Published' };
  const [v, setV] = useState(blank);
  const [audience, setAudience] = useState<Audience>({ kind: 'all' });
  const [campusId, setCampusId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setV(event ? {
      title: event.title, description: event.description ?? '', eventType: event.eventType, startsOn: event.startsOn, endsOn: event.endsOn ?? '',
      startsAt: event.startsAt ?? '', venue: event.venue ?? '', status: event.status === 'Draft' ? 'Draft' : 'Published',
    } : { ...blank, startsOn: date ?? '' });
    setAudience(event?.audienceFilter?.kind ? event.audienceFilter : { kind: 'all' });
    setCampusId(event ? event.campusId ?? '' : headerCampus ?? '');
  }, [open, event]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof blank) => (x: string) => setV((o) => ({ ...o, [k]: x }));
  const save = useApiMutation<Record<string, unknown>>(event ? 'put' : 'post', event ? `/events/${event.id}` : '/events', {
    invalidate: ['/events'], success: event ? 'Event updated' : 'Event created', onSuccess: () => onClose(),
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (v.title.trim().length < 3) e.title = 'Enter a title (at least 3 characters)';
    if (!v.startsOn) e.startsOn = 'Choose a date';
    else if (!event && v.startsOn < todayKey()) e.startsOn = 'New events cannot start in the past';
    if (v.endsOn && v.startsOn && v.endsOn < v.startsOn) e.endsOn = 'End date must be on or after the start date';
    if (audience.kind === 'grades' && !audience.grades?.length) e.audience = 'Choose at least one grade';
    setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({
      title: v.title.trim(), description: v.description.trim() || (event ? null : undefined), eventType: v.eventType,
      startsOn: v.startsOn, endsOn: v.endsOn || null, startsAt: v.startsAt || null, venue: v.venue.trim() || (event ? null : undefined),
      audience, campusId: campusId || null, status: v.status,
    }, { onError: (err) => setErrors(fieldErrorsOf(err)) });
  };
  return (
    <Modal open={open} onClose={onClose} busy={save.isPending} size="wide" title={event ? 'Edit event' : 'Add event'}
      sub="Published events appear in the parent app calendar"
      foot={<>
        <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button variant="primary" icon="save" onClick={submit} loading={save.isPending}>{event ? 'Save changes' : v.status === 'Draft' ? 'Save draft' : 'Publish event'}</Button>
      </>}>
      <div className="formsection">
        <div className="formsection__title">Event</div>
        <div className="form-grid">
          <TextField label="Title" required value={v.title} onChange={set('title')} error={errors.title} maxLength={160} autoFocus className="span-2" />
          <SelectField label="Type" value={v.eventType} onChange={set('eventType')} options={TYPES} />
          <TextField label="Venue" value={v.venue} onChange={set('venue')} placeholder="Auditorium" maxLength={120} />
          <TextField label="Starts on" required type="date" value={v.startsOn} onChange={set('startsOn')} error={errors.startsOn} min={event ? undefined : todayKey()} />
          <TextField label="Ends on" type="date" value={v.endsOn} onChange={set('endsOn')} error={errors.endsOn} min={v.startsOn || undefined} hint="Leave empty for a one-day event" />
          <TextField label="Start time" type="time" value={v.startsAt} onChange={set('startsAt')} error={errors.startsAt} hint="Optional" />
          <SelectField label="Status" value={v.status} onChange={set('status')} options={[{ value: 'Published', label: 'Published — visible to families' }, { value: 'Draft', label: 'Draft — staff only' }]} />
          <TextArea className="span-2" label="Description" rows={3} value={v.description} onChange={set('description')} maxLength={2000} />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Audience</div>
        <AudiencePicker value={audience} onChange={setAudience} campusId={campusId} onCampus={setCampusId} error={errors.audience} />
      </div>
    </Modal>
  );
}
