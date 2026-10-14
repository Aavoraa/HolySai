import { useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import { useSchool } from '@/layouts/SchoolContext';
import {
  Badge, Banner, Button, Card, DataTable, Dl, Empty, ErrorState, InlineError, Modal, Page, PageHead, SelectField, Skeleton,
  Status, TextField, useConfirm,
} from '@/components/ui';
import { fmt, todayKey } from '@/lib/format';
import { addDays, dayName, fieldErrors, useEmployeeModal } from './shared';
import type { Roster, RosterEntry, Shift } from './types';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ShiftsPage() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const { campusParam } = useSchool();
  const [week, setWeek] = useState<string | undefined>(undefined);
  const q = useApiQuery<Roster>('/workforce/roster', { ...campusParam, weekStart: week });
  const [entry, setEntry] = useState<RosterEntry | null>(null);
  const [adding, setAdding] = useState<{ date?: string; group?: string } | null>(null);
  const [managing, setManaging] = useState(false);
  const [openEmployee, employeeModal] = useEmployeeModal();
  const r = q.data;
  const manage = can('hr.manage');
  const publish = useApiMutation<void>('post', '/workforce/roster/publish', {
    invalidate: ['/workforce/roster'], body: () => ({ weekStart: r?.weekStart, ...campusParam }),
  });

  const grid = useMemo(() => {
    if (!r) return [];
    return r.groups.map((g) => ({
      group: g,
      cells: r.days.map((d) => r.entries.filter((e) => e.group === g && e.date === d)),
    }));
  }, [r]);
  const firstGap = r?.gaps[0];

  return (
    <Page>
      <PageHead title="Shifts & Rosters" sub="Who is on which post, which day. Gaps are visible before they become a problem."
        actions={<>
          {manage && <Button icon="clock" onClick={() => setManaging(true)}>Shifts</Button>}
          {manage && <Button icon="plus" onClick={() => setAdding({})}>Add to roster</Button>}
          {manage && (
            <Button variant="primary" icon="check" loading={publish.isPending} disabled={!r?.entries.length} onClick={async () => {
              if (await confirm({ title: 'Publish roster?', body: `Everyone rostered for the week of ${fmt.date(r!.weekStart)} is notified in the staff app.`, confirmLabel: 'Publish' })) publish.mutate();
            }}>Publish roster</Button>
          )}
        </>} />

      <div className="filterbar">
        <Button size="sm" icon="chevronLeft" aria-label="Previous week" onClick={() => setWeek(addDays(r?.weekStart ?? todayKey(), -7))} />
        <span className="t-bold" aria-live="polite">{r ? `Week of ${fmt.date(r.weekStart)}` : 'This week'}</span>
        <Button size="sm" icon="chevronRight" aria-label="Next week" onClick={() => setWeek(addDays(r?.weekStart ?? todayKey(), 7))} />
        {week && <Button size="sm" variant="quiet" onClick={() => setWeek(undefined)}>This week</Button>}
      </div>

      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading || !r ? (
        <Skeleton height={320} />
      ) : (
        <>
          {r.gaps.length ? (
            <Banner tone="warning" icon="alert">
              <strong>{r.gaps.length} gap{r.gaps.length === 1 ? '' : 's'} this week.</strong>{' '}
              {firstGap && <>{firstGap.group} on {dayName(firstGap.date)} has no named cover — {firstGap.employeeName} ({firstGap.duty ?? firstGap.designation}) is {firstGap.attendance?.toLowerCase() ?? 'unavailable'}.</>}
            </Banner>
          ) : r.entries.length ? (
            <Banner tone="success" icon="check">No gaps this week — every post has a named person.</Banner>
          ) : null}
          {r.attention.length > 0 && (
            <div className="mt-3">
              <Banner tone="neutral" icon="info">
                {r.attention.length} rostered colleague{r.attention.length === 1 ? ' is' : 's are'} absent or on leave without a cover request:{' '}
                {r.attention.map((a) => `${a.employeeName} (${DAYS[r.days.indexOf(a.date)]})`).join(', ')}.
              </Banner>
            </div>
          )}

          <div className="mt-4">
            <Card flush>
              {grid.length ? (
                <div className="table-wrap">
                  <table className="table table--compact fw-roster">
                    <thead>
                      <tr>
                        <th>Post</th>
                        {r.days.map((d, i) => <th key={d} className={d === r.today ? 'is-today' : undefined} aria-current={d === r.today ? 'date' : undefined}>{DAYS[i]} <span className="t-micro t-muted">{d.slice(8)}</span></th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {grid.map((row) => (
                        <tr key={row.group}>
                          <td className="t-bold">{row.group}</td>
                          {row.cells.map((cell, i) => (
                            <td key={i}>
                              {cell.length === 0 ? (
                                manage && r.days[i] >= r.today
                                  ? <button type="button" className="fw-linkbtn t-faint t-xs" title={`Add someone to ${row.group}`} onClick={() => setAdding({ date: r.days[i], group: row.group })}>Off</button>
                                  : <span className="t-faint">Off</span>
                              ) : (
                                <div className="col g-1">
                                  {cell.map((e) => (
                                    <button key={e.id} type="button" className="fw-linkbtn" onClick={() => setEntry(e)} title={`${e.employeeName} · ${e.shiftName}${e.duty ? ` · ${e.duty}` : ''}`}>
                                      {e.status === 'Cover needed' ? <Badge tone="critical">No cover</Badge>
                                        : e.status === 'Covered' ? <span className="t-xs">{e.coveredByName} <span className="t-micro t-muted">for {e.employeeName}</span></span>
                                        : <span className={`t-xs${['Absent', 'On Leave'].includes(e.attendance ?? '') ? ' t-critical' : ''}`}>{e.employeeName}</span>}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="Nothing rostered this week" icon="clock" sub="Add people to posts to build the roster."
                  action={manage ? <Button variant="primary" icon="plus" onClick={() => setAdding({})}>Add to roster</Button> : undefined} />
              )}
            </Card>
          </div>

          {r.gaps.length > 0 && (
            <div className="mt-4">
              <Card title={<span className="fw-queue">Cover needed <Badge tone="critical">{r.gaps.length}</Badge></span>} sub="Posts with no named person — assign a colleague before the shift starts" flush>
                <DataTable compact rows={r.gaps} rowKey={(g) => g.id}
                  columns={[
                    { key: 'date', label: 'Day', render: (g) => `${dayName(g.date)}, ${fmt.dateShort(g.date)}` },
                    { key: 'post', label: 'Post', render: (g) => <>{g.group}<div className="t-micro t-muted">{g.duty} · {g.shiftName}</div></> },
                    { key: 'emp', label: 'Rostered', render: (g) => <button type="button" className="person person--link" onClick={() => openEmployee(g.employeeId)}>{g.employeeName}</button> },
                    { key: 'att', label: 'Attendance', render: (g) => <Status value={g.attendance ?? 'Not marked'} /> },
                    { key: 'a', label: '', className: 'num', render: (g) => manage && g.date >= r.today ? <Button size="sm" variant="primary" onClick={() => setEntry(g)}>Assign cover</Button> : null },
                  ]} />
              </Card>
            </div>
          )}
        </>
      )}
      {entry && r && <EntryModal entry={entry} today={r.today} manage={manage} onClose={() => setEntry(null)} onOpenEmployee={openEmployee} />}
      {adding && <AddModal initial={adding} days={r?.days ?? []} groups={r?.groups ?? []} onClose={() => setAdding(null)} />}
      {managing && <ShiftsModal onClose={() => setManaging(false)} />}
      {employeeModal}
    </Page>
  );
}

function EntryModal({ entry: e, today, manage, onClose, onOpenEmployee }: {
  entry: RosterEntry; today: string; manage: boolean; onClose: () => void; onOpenEmployee: (id: string) => void;
}) {
  const confirm = useConfirm();
  const { lookups } = useLookups();
  const [cover, setCover] = useState('');
  const [touched, setTouched] = useState(false);
  const editable = manage && e.date >= today;
  const assign = useApiMutation<void>('post', `/workforce/roster/${e.id}/assign-cover`, { invalidate: ['/workforce'], body: () => ({ coverEmployeeId: cover }), onSuccess: onClose });
  const flag = useApiMutation<void>('post', `/workforce/roster/${e.id}/flag-cover`, { invalidate: ['/workforce'], body: () => ({}), onSuccess: onClose });
  const remove = useApiMutation<void>('delete', `/workforce/roster/${e.id}`, { invalidate: ['/workforce'], onSuccess: onClose });
  const candidates = (lookups?.staff ?? []).filter((s) => s.id !== e.employeeId && s.employeeType === 'non_teaching');
  return (
    <Modal open onClose={onClose} busy={assign.isPending || flag.isPending || remove.isPending}
      title={e.group} sub={`${dayName(e.date)}, ${fmt.date(e.date)} · ${e.shiftName}`}
      foot={<>
        <Button onClick={onClose}>Close</Button>
        {editable && <Button variant="danger" icon="trash" loading={remove.isPending} onClick={async () => {
          if (await confirm({ title: 'Remove this roster line?', body: `${e.employeeName} will no longer be rostered on ${fmt.date(e.date)}.`, confirmLabel: 'Remove', danger: true })) remove.mutate();
        }}>Remove</Button>}
        {editable && e.status === 'Scheduled' && <Button loading={flag.isPending} onClick={async () => {
          if (await confirm({ title: 'Flag cover needed?', body: 'HR is notified and the post shows as a gap until someone is assigned.', confirmLabel: 'Flag cover needed' })) flag.mutate();
        }}>Flag cover needed</Button>}
        {editable && e.status !== 'Completed' && <Button variant="primary" loading={assign.isPending} onClick={() => { setTouched(true); if (cover) assign.mutate(); }}>Assign cover</Button>}
      </>}>
      <Dl items={[
        ['Rostered', <button key="p" type="button" className="person person--link" onClick={() => { onClose(); onOpenEmployee(e.employeeId); }}>{e.employeeName}</button>],
        ['Role', e.designation],
        ['Duty', e.duty ?? '—'],
        ['Status', <Status key="s" value={e.status} />],
        ['Attendance', <Status key="a" value={e.attendance ?? 'Not marked'} />],
        ...(e.coveredByName ? [['Covered by', e.coveredByName] as [string, string]] : []),
      ]} />
      {editable && e.status !== 'Completed' && (
        <div className="mt-4">
          <SelectField label={e.status === 'Covered' ? 'Change cover' : 'Cover by'} value={cover} onChange={setCover} placeholder="Choose a colleague"
            error={touched && !cover ? 'Choose who will cover' : undefined}
            options={candidates.map((s) => ({ value: s.id, label: `${s.fullName} — ${s.designation}` }))} />
          <p className="t-xs t-muted mt-2">Colleagues who are absent or on approved leave that day cannot be assigned. The colleague is notified in the staff app.</p>
          {(assign.error || flag.error) && <div className="mt-3"><InlineError error={assign.error ?? flag.error} /></div>}
        </div>
      )}
    </Modal>
  );
}

function AddModal({ initial, days, groups, onClose }: { initial: { date?: string; group?: string }; days: string[]; groups: string[]; onClose: () => void }) {
  const { lookups } = useLookups();
  const shifts = useApiQuery<Shift[]>('/workforce/shifts');
  const [f, setF] = useState({ employeeId: '', shiftId: '', date: initial.date ?? days.find((d) => d >= todayKey()) ?? todayKey(), group: initial.group ?? '', duty: '' });
  const [touched, setTouched] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const errors: Record<string, string> = {};
  if (!f.employeeId) errors.employeeId = 'Choose an employee';
  if (!f.shiftId) errors.shiftId = 'Choose a shift';
  if (!f.date) errors.date = 'Choose a date';
  if (!f.group.trim()) errors.group = 'Name the post';
  const save = useApiMutation<void>('post', '/workforce/roster', {
    invalidate: ['/workforce'], success: 'Added to the roster', onSuccess: onClose,
    body: () => ({ employeeId: f.employeeId, shiftId: f.shiftId, date: f.date, post: f.duty.trim() ? `${f.group.trim()} · ${f.duty.trim()}` : f.group.trim() }),
  });
  const server = fieldErrors(save.error);
  const err = (k: string) => (touched ? errors[k] : undefined) ?? server[k];
  return (
    <Modal open onClose={onClose} busy={save.isPending} title="Add to roster" sub="Replaces any existing line for that person on that day"
      foot={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={() => { setTouched(true); if (!Object.keys(errors).length) save.mutate(); }}>Save</Button>
      </>}>
      {save.error && !Object.keys(server).length && <div className="mb-3"><InlineError error={save.error} /></div>}
      <div className="grid g-2col g-3">
        <SelectField label="Employee" required value={f.employeeId} onChange={(v) => set('employeeId', v)} placeholder="Choose employee" error={err('employeeId')}
          options={(lookups?.staff ?? []).map((s) => ({ value: s.id, label: `${s.fullName} — ${s.designation}` }))} />
        <SelectField label="Shift" required value={f.shiftId} onChange={(v) => set('shiftId', v)} placeholder="Choose shift" error={err('shiftId')}
          options={(shifts.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <TextField label="Date" type="date" required min={todayKey()} value={f.date} onChange={(v) => set('date', v)} error={err('date')} />
        <div className="field">
          <label className="label" htmlFor="roster-post">Post <span className="req">*</span></label>
          <input id="roster-post" className="input" list="roster-posts" value={f.group} onChange={(e) => set('group', e.target.value)} maxLength={80}
            aria-invalid={!!err('group') || undefined} />
          <datalist id="roster-posts">{groups.map((g) => <option key={g} value={g} />)}</datalist>
          {err('group') && <span className="hint hint--error" role="alert">{err('group')}</span>}
        </div>
        <TextField label="Duty / location" value={f.duty} onChange={(v) => set('duty', v)} placeholder="e.g. Rear Gate, Route 12" maxLength={80} />
      </div>
    </Modal>
  );
}

function ShiftsModal({ onClose }: { onClose: () => void }) {
  const { campusParam } = useSchool();
  const q = useApiQuery<Shift[]>('/workforce/shifts', campusParam);
  const [edit, setEdit] = useState<Partial<Shift> | null>(null);
  const [touched, setTouched] = useState(false);
  const errors: Record<string, string> = {};
  if (edit) {
    if (!edit.name?.trim()) errors.name = 'Name the shift';
    if (!edit.startsAt) errors.startsAt = 'Required';
    if (!edit.endsAt) errors.endsAt = 'Required';
    if (!!edit.splitStartsAt !== !!edit.splitEndsAt) errors.splitEndsAt = 'Give both split times or neither';
  }
  const save = useApiMutation<void>(edit?.id ? 'put' : 'post', edit?.id ? `/workforce/shifts/${edit.id}` : '/workforce/shifts', {
    invalidate: ['/workforce'], success: edit?.id ? 'Shift updated' : 'Shift created', onSuccess: () => { setEdit(null); setTouched(false); },
    body: () => ({ name: edit!.name!.trim(), startsAt: edit!.startsAt, endsAt: edit!.endsAt, splitStartsAt: edit!.splitStartsAt || null, splitEndsAt: edit!.splitEndsAt || null }),
  });
  const err = (k: string) => (touched ? errors[k] : undefined) ?? fieldErrors(save.error)[k];
  const set = (k: keyof Shift, v: string) => setEdit((x) => ({ ...x, [k]: v }));
  return (
    <Modal open onClose={onClose} size="wide" title="Shifts" sub="Shift patterns used by employee records and the roster"
      foot={<><Button onClick={onClose}>Close</Button>{!edit && <Button variant="primary" icon="plus" onClick={() => setEdit({})}>New shift</Button>}</>}>
      {edit && (
        <div className="card card--tint card__body mb-4">
          <div className="grid g-3col g-3">
            <TextField label="Name" required value={edit.name} onChange={(v) => set('name', v)} error={err('name')} placeholder="Evening 14:00–22:00" />
            <TextField label="Starts" type="time" required value={edit.startsAt} onChange={(v) => set('startsAt', v)} error={err('startsAt')} />
            <TextField label="Ends" type="time" required value={edit.endsAt} onChange={(v) => set('endsAt', v)} error={err('endsAt')} />
            <div />
            <TextField label="Split starts" type="time" value={edit.splitStartsAt ?? ''} onChange={(v) => set('splitStartsAt', v)} />
            <TextField label="Split ends" type="time" value={edit.splitEndsAt ?? ''} onChange={(v) => set('splitEndsAt', v)} error={err('splitEndsAt')} />
          </div>
          {save.error && !Object.keys(fieldErrors(save.error)).length && <div className="mt-3"><InlineError error={save.error} /></div>}
          <div className="row g-2 end mt-3">
            <Button onClick={() => { setEdit(null); setTouched(false); }}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => { setTouched(true); if (!Object.keys(errors).length) save.mutate(); }}>Save shift</Button>
          </div>
        </div>
      )}
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <DataTable compact rows={q.data} loading={q.isLoading} rowKey={(s) => s.id} emptyText="No shifts defined."
          columns={[
            { key: 'name', label: 'Shift' },
            { key: 'hours', label: 'Hours', render: (s) => `${s.startsAt}–${s.endsAt}${s.splitStartsAt ? ` / ${s.splitStartsAt}–${s.splitEndsAt}` : ''}` },
            { key: 'employees', label: 'Employees', className: 'num' },
            { key: 'rosteredToday', label: 'Rostered today', className: 'num' },
            { key: 'a', label: '', className: 'num', render: (s) => <Button size="sm" icon="edit" onClick={() => { setEdit(s); setTouched(false); }}>Edit</Button> },
          ]} />
      )}
    </Modal>
  );
}
