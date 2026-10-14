import { useEffect, useMemo, useState } from 'react';
import {
  Badge, Button, Card, DataTable, Empty, ErrorState, Grid, Kpi, Meter, Modal, Page, PageHead, Pagination,
  Person, SearchInput, Segment, SelectField, Skeleton, Status, StudentLink, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import { useSchool } from '@/layouts/SchoolContext';
import { useAuth } from '@/auth/AuthContext';
import { cx, fmt, todayKey } from '@/lib/format';
import { fieldErrorsOf } from './shared';
import type { PtmSession, PtmSessionDetail, PtmSummary } from './types';

function dateRange(a: string | null, b: string | null) {
  if (!a) return '';
  if (!b || a === b) return fmt.date(a);
  const [da, db] = [new Date(`${a}T00:00:00`), new Date(`${b}T00:00:00`)];
  if (da.getMonth() === db.getMonth()) return `${da.getDate()}–${fmt.date(b)}`;
  return `${fmt.dateShort(a)} – ${fmt.date(b)}`;
}

export default function PtmPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const list = useListParams({ sort: 'date', dir: 'asc' }, ['when']);
  const when = list.filters.when || 'upcoming';
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const summary = useApiQuery<PtmSummary>('/ptm/summary', campusParam);
  const q = usePagedQuery<PtmSession>('/ptm/sessions', { ...list.query, when, ...campusParam });
  const s = summary.data;
  const filled = s && s.totalSlots ? Math.round((s.booked / s.totalSlots) * 100) : 0;
  const sub = s?.sessions
    ? [s.grades.join(', '), dateRange(s.firstDate, s.lastDate), s.venues.length === 1 ? s.venues[0] : s.venues.length ? `${s.venues.length} rooms` : ''].filter(Boolean).join(' · ')
    : 'No upcoming sessions are scheduled.';

  return (
    <Page>
      <PageHead
        title="Parent–Teacher Meetings"
        sub={summary.isLoading ? 'Loading sessions…' : sub}
        actions={can('communication.send') && <Button variant="primary" icon="calendar" onClick={() => setCreating(true)}>New session</Button>}
      />
      {summary.error ? <ErrorState error={summary.error} onRetry={summary.refetch} /> : (
        <Grid cols="g-4col">
          <Kpi icon="calendar" label="Slots available" loading={summary.isLoading} value={fmt.n(s?.totalSlots)} foot={`${fmt.n(s?.sessions)} upcoming sessions`} />
          <Kpi icon="checkSquare" label="Booked" tone="teal" loading={summary.isLoading} value={fmt.n(s?.booked)} unit={`${filled}% filled`} foot={`${fmt.n((s?.totalSlots ?? 0) - (s?.booked ?? 0))} slots still free`} />
          <Kpi icon="users" label="Unbooked families" tone="amber" loading={summary.isLoading} value={fmt.n(s?.unbookedFamilies)} foot={`${fmt.n(s?.unbookedStudents)} children without any booking`} />
          <Kpi icon="flag" label="Families to prioritise" tone="critical" loading={summary.isLoading} value={fmt.n(s?.prioritiseFamilies)} foot="Unbooked children flagged At Risk or Developing Risk" />
        </Grid>
      )}

      <Card flush className="mt-4">
        <Toolbar>
        <Segment items={[{ id: 'upcoming', label: 'Upcoming' }, { id: 'past', label: 'Past' }, { id: 'all', label: 'All' }]} active={when}
          onChange={(v) => list.setFilter('when', v === 'upcoming' ? '' : v)} />
        <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search teacher or subject" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
          <DataTable<PtmSession>
            rows={q.data?.rows}
            loading={q.isLoading || q.isFetching}
            rowKey={(r) => r.id}
            sort={list.sort}
            onSort={list.setSort}
            onRowClick={(r) => setOpenId(r.id)}
            emptyText={when === 'upcoming' ? 'No upcoming sessions. Use “New session” to open booking to the families of a section.' : 'No sessions match.'}
            columns={[
              { key: 'teacher', label: 'Teacher', render: (r) => <Person name={r.teacher} meta={r.subjectLabel} /> },
              {
                key: 'date', label: 'Date', render: (r) => (
                  <span className="col"><span className="t-sm">{fmt.date(r.sessionDate)}</span>
                    <span className="t-micro t-muted">{r.startsAt} · {r.slotMinutes} min slots{r.venue ? ` · ${r.venue}` : ''}</span></span>
                ),
              },
              {
                key: 'booked', label: 'Bookings', sortable: false, width: '200px', render: (r) => (
                  <Meter label="" value={(r.booked / r.totalSlots) * 100} right={`${r.booked}/${r.totalSlots}`}
                    tone={r.booked >= r.totalSlots ? 'critical' : r.booked / r.totalSlots > 0.7 ? 'teal' : 'amber'} />
                ),
              },
              {
                key: 'a', label: '', sortable: false, className: 'num', render: (r) => (
                  <Button size="sm" variant={r.booked >= r.totalSlots && !r.past && can('communication.send') ? 'primary' : undefined} onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>
                    {r.booked >= r.totalSlots && !r.past && can('communication.send') ? 'Add slots' : 'View slots'}
                  </Button>
                ),
              },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>

      <SessionModal id={openId} onClose={() => setOpenId(null)} />
      <NewSessionModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => setOpenId(id)} />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Slots and bookings for one session
// ---------------------------------------------------------------------------
function SessionModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const q = useApiQuery<PtmSessionDetail>(id ? `/ptm/sessions/${id}` : null);
  const d = q.data;
  const [slots, setSlots] = useState('');
  const [slotError, setSlotError] = useState('');
  useEffect(() => { setSlots(''); setSlotError(''); }, [id]);
  const inv = ['/ptm'];
  const status = useApiMutation<{ bookingId: string; status: string }>('post', (v) => `/ptm/bookings/${v.bookingId}/status`, {
    invalidate: inv, body: (v) => ({ status: v.status }), success: (_r, v) => `Booking marked ${v.status}`,
  });
  const patch = useApiMutation<{ totalSlots: number }>('patch', `/ptm/sessions/${id}`, { invalidate: inv, success: 'Slots updated', onSuccess: () => setSlots('') });
  const notify = useApiMutation<void, { notified: number }>('post', `/ptm/sessions/${id}/notify`, { invalidate: inv, body: () => ({}) });
  const editable = can('communication.send') && d && !d.past;

  const setStatus = async (bookingId: string, next: string, who: string) => {
    if (next === 'Cancelled' && !(await confirm({ title: 'Cancel this booking?', body: `${who}’s slot will be released for other families. The family is not notified automatically.`, confirmLabel: 'Cancel booking', danger: true }))) return;
    status.mutate({ bookingId, status: next });
  };
  const addSlots = () => {
    const n = Number(slots);
    if (!Number.isInteger(n) || n < 1 || n > 30) { setSlotError('Enter between 1 and 30 slots'); return; }
    if (d!.totalSlots + n > 60) { setSlotError('A session can have at most 60 slots'); return; }
    patch.mutate({ totalSlots: d!.totalSlots + n });
  };
  const sendReminder = async () => {
    if (await confirm({ title: 'Remind unbooked families?', body: `Families in ${d!.grade ?? ''}${d!.section ?? ''} without a booking in this session will get an app and WhatsApp reminder.`, confirmLabel: 'Send reminder', icon: 'send' })) notify.mutate();
  };

  return (
    <Modal open={!!id} onClose={onClose} size="wide" title={d ? `${d.teacher}` : 'PTM session'}
      sub={d ? `${d.subjectLabel} · ${fmt.date(d.sessionDate)} from ${d.startsAt}${d.venue ? ` · ${d.venue}` : ''}` : undefined}
      foot={<>
        {editable && d.unbooked.length > 0 && <Button icon="megaphone" onClick={sendReminder} loading={notify.isPending}>Remind {d.unbooked.length} unbooked</Button>}
        <Button variant="primary" onClick={onClose}>Done</Button>
      </>}>
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !d ? <Skeleton height={260} /> : (
        <div className="col g-4">
          <Meter label={`${d.booked} of ${d.totalSlots} slots booked`} value={(d.booked / d.totalSlots) * 100} right={`${d.free} free`}
            tone={d.free === 0 ? 'critical' : 'teal'} lg />
          <div className="pe-slots">
            {d.slots.map((sl) => (
              <div key={sl.slotNo} className={cx('card pe-slot', sl.booking && 'pe-slot--booked')}>
                <div className="row between">
                  <span className="t-sm t-bold t-num">{sl.time}</span>
                  {sl.booking ? <Status value={sl.booking.status} /> : <Badge tone="success">Free</Badge>}
                </div>
                {sl.booking ? (
                  <div className="col mt-1">
                    <span className="t-xs t-clip">{sl.booking.studentName}</span>
                    <span className="t-micro t-muted t-clip">{sl.booking.parentName}</span>
                    {can('communication.send') && (
                      <select className="select" aria-label={`Status for slot ${sl.slotNo}`} value={sl.booking.status}
                        disabled={status.isPending} onChange={(e) => setStatus(sl.booking!.id, e.target.value, sl.booking!.parentName)}>
                        {['Booked', 'Attended', 'No-show', 'Cancelled'].map((x) => <option key={x}>{x}</option>)}
                      </select>
                    )}
                  </div>
                ) : <span className="t-micro t-muted">Slot {sl.slotNo}</span>}
              </div>
            ))}
          </div>

          {editable && (
            <div className="pe-addslots">
              <TextField label="Add slots" type="number" min={1} max={30} value={slots} onChange={(v) => { setSlots(v); setSlotError(''); }} error={slotError} />
              <Button icon="plus" onClick={addSlots} loading={patch.isPending}>Add</Button>
              <span className="t-micro t-muted">New slots continue after {d.slots[d.slots.length - 1]?.time}.</span>
            </div>
          )}

          <div>
            <div className="eyebrow mb-2">Families without a booking ({d.unbooked.length})</div>
            {d.unbooked.length ? (
              <div className="col g-2">
                {d.unbooked.map((u) => (
                  <div key={u.studentId} className="row between wrap g-2">
                    <StudentLink id={u.studentId} name={u.studentName} meta={`${u.parentName ?? 'No guardian'}${u.parentPhone ? ` · ${u.parentPhone}` : ''}${u.hasAppAccount ? '' : ' · no app'}`} />
                    {u.risk !== 'On Track' && <Status value={u.risk} />}
                  </div>
                ))}
              </div>
            ) : <Empty icon="checkSquare" title="Every family has booked" sub="All families in this section have a slot." />}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Create a session
// ---------------------------------------------------------------------------
function NewSessionModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { user } = useAuth();
  const { lookups, sectionOptions } = useLookups();
  const { campusId } = useSchool();
  const teacherOnly = !!user?.employeeId && user.role.scope === 'class';
  const blank = { employeeId: '', classId: '', sectionId: '', subject: '', sessionDate: '', startsAt: '09:00', slotMinutes: '10', totalSlots: '18', venue: '' };
  const [v, setV] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setV({ ...blank, employeeId: teacherOnly ? user!.employeeId! : '' });
    setErrors({});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof blank) => (x: string) => setV((o) => ({ ...o, [k]: x, ...(k === 'classId' ? { sectionId: '' } : {}) }));
  const teachers = useMemo(() => (lookups?.staff ?? []).filter((s) => s.employeeType === 'teaching'), [lookups]);
  const cls = lookups?.classes.find((c) => c.id === v.classId);
  const sec = cls?.sections.find((x) => x.id === v.sectionId);
  const classChoices = (lookups?.classes ?? []).filter((c) => !campusId || c.campusId === campusId).map((c) => ({
    value: c.id,
    label: campusId ? c.name : `${c.name} · ${lookups?.campuses.find((x) => x.id === c.campusId)?.shortName ?? ''}`,
  }));
  const label = v.subject && cls && sec ? `${v.subject} · ${cls.name}${sec.name}` : '';

  const create = useApiMutation<Record<string, unknown>, PtmSession>('post', '/ptm/sessions', {
    invalidate: ['/ptm'], success: 'PTM session created', onSuccess: (r) => { onClose(); onCreated(r.data.id); },
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!v.employeeId) e.employeeId = 'Choose a teacher';
    if (!v.sectionId) e.sectionId = 'Choose a class and section';
    if (v.subject.trim().length < 3) e.subjectLabel = 'Enter the subject';
    if (!v.sessionDate) e.sessionDate = 'Choose a date';
    else if (v.sessionDate < todayKey()) e.sessionDate = 'Choose today or a later date';
    if (!/^\d{2}:\d{2}$/.test(v.startsAt)) e.startsAt = 'Enter a start time';
    const total = Number(v.totalSlots);
    if (!Number.isInteger(total) || total < 1 || total > 60) e.totalSlots = 'Between 1 and 60 slots';
    setErrors(e);
    if (Object.keys(e).length) return;
    create.mutate({
      employeeId: v.employeeId, sectionId: v.sectionId, subjectLabel: label, sessionDate: v.sessionDate, startsAt: v.startsAt,
      slotMinutes: Number(v.slotMinutes), totalSlots: total, venue: v.venue.trim() || undefined,
    }, { onError: (err) => setErrors(fieldErrorsOf(err)) });
  };
  const ends = (() => {
    const [h, m] = v.startsAt.split(':').map(Number);
    const t = h * 60 + m + Number(v.slotMinutes) * Number(v.totalSlots || 0);
    return Number.isFinite(t) ? `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` : '';
  })();

  return (
    <Modal open={open} onClose={onClose} busy={create.isPending} size="wide" title="New PTM session" sub="Families of the chosen section can book slots from the parent app"
      foot={<>
        <Button onClick={onClose} disabled={create.isPending}>Cancel</Button>
        <Button variant="primary" icon="calendar" onClick={submit} loading={create.isPending}>Create session</Button>
      </>}>
      <div className="formsection">
        <div className="formsection__title">Who</div>
        <div className="form-grid">
        <SelectField label="Teacher" required value={v.employeeId} onChange={set('employeeId')} error={errors.employeeId} disabled={teacherOnly}
          placeholder="Choose a teacher" options={teachers.map((t) => ({ value: t.id, label: `${t.fullName} — ${t.designation}` }))} />
        <TextField label="Subject" required value={v.subject} onChange={set('subject')} error={errors.subjectLabel} placeholder="Mathematics" maxLength={80}
          hint={label ? `Shown to families as “${label}”` : undefined} />
        <SelectField label="Class" required value={v.classId} onChange={set('classId')} placeholder="Choose a class" options={classChoices} />
        <SelectField label="Section" required value={v.sectionId} onChange={set('sectionId')} error={errors.sectionId} placeholder="Choose a section"
          options={sectionOptions(v.classId)} disabled={!v.classId} />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">When and where</div>
        <div className="form-grid">
        <TextField label="Date" required type="date" min={todayKey()} value={v.sessionDate} onChange={set('sessionDate')} error={errors.sessionDate} />
        <TextField label="Starts at" required type="time" value={v.startsAt} onChange={set('startsAt')} error={errors.startsAt} />
        <SelectField label="Slot length" value={v.slotMinutes} onChange={set('slotMinutes')} options={['5', '10', '15', '20', '30'].map((x) => ({ value: x, label: `${x} minutes` }))} />
        <TextField label="Number of slots" required type="number" min={1} max={60} value={v.totalSlots} onChange={set('totalSlots')} error={errors.totalSlots}
          hint={ends ? `Last slot ends at ${ends}` : undefined} />
        <TextField label="Venue" value={v.venue} onChange={set('venue')} placeholder="Academic Block · R-204" maxLength={120} className="span-2" />
        </div>
      </div>
    </Modal>
  );
}

