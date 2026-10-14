import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import {
  Avatar, Badge, Banner, Button, Card, Chart, charts, Empty, ErrorState, Icon, InlineError, Modal, Page, PageHead, PageSkeleton,
  Segment, SelectField, Skeleton, Switch, TextField, useConfirm,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { plural, schoolClock, useSections } from './shared';

interface Entry {
  id: string; sectionId: string; sectionLabel: string; day: number; periodNo: number; startsAt: string; endsAt: string;
  subjectId: string | null; subject: string | null; activity: string | null; employeeId: string | null; teacher: string | null;
  substituteId: string | null; substitute: string | null; room: string | null; needsSubstitute: boolean;
}
interface Timetable {
  title: string; campusId: string; days: string[];
  periods: { id: string; periodNo: number; startsAt: string; endsAt: string }[];
  entries: Entry[];
  conflicts: (Entry & { teacherStatus: string | null; date: string })[];
  today: { date: string; day: number };
}
interface Insights { teacherLoad: { id: string; name: string; periods: number; maxPeriods: number }[]; agreedLoad: number; utilisation: { filled: number; slots: number; pct: number } }
interface Suggestions {
  entry: { id: string; day: string; date: string; periodNo: number; section: string; subject: string | null; room: string | null; teacherStatus: string | null };
  suggestions: { id: string; name: string; reason: string; match: string; hasAccount: boolean }[];
}

const shortName = (n: string | null) => {
  if (!n) return '';
  const parts = n.replace(/^(Dr|Mr|Ms|Mrs)\.?\s+/, '').split(' ');
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : parts[0];
};

export default function TimetablePage() {
  const { can, user } = useAuth();
  const { campusParam, campusId } = useSchool();
  const confirm = useConfirm();
  const [sp, setSp] = useSearchParams();
  const schoolLevel = can('students.read') && user?.role.scope !== 'class';
  const sections = useSections(schoolLevel ? campusId : undefined);
  const mode = sp.get('view') === 'mine' && user?.employeeId ? 'mine' : 'class';
  const list = sections.data ?? [];
  const sectionId = sp.get('section') && list.some((s) => s.id === sp.get('section'))
    ? sp.get('section')!
    : (list.find((s) => s.isClassTeacher) ?? list[0])?.id;
  const setParam = (k: string, v: string | null) => setSp((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });

  const tt = useApiQuery<Timetable>(mode === 'mine' ? '/academics/timetable' : sectionId ? '/academics/timetable' : null, mode === 'mine' ? {} : { sectionId });
  const insights = useApiQuery<Insights>('/academics/timetable/insights', campusParam);
  const [subFor, setSubFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const publish = useApiMutation<{ sectionId: string }, { notified: number }>('post', '/academics/timetable/publish', {
    success: (r) => `Timetable changes published — ${r.data.notified} teacher${r.data.notified === 1 ? '' : 's'} notified`,
  });

  const d = tt.data;
  const grid = useMemo(() => {
    const m = new Map<string, Entry>();
    for (const e of d?.entries ?? []) m.set(`${e.day}:${e.periodNo}`, e);
    return m;
  }, [d]);
  const conflict = d?.conflicts[0];

  // Highlight the period running now (school clock), refreshed every minute.
  const [clock, setClock] = useState(schoolClock);
  useEffect(() => {
    const t = setInterval(() => setClock(schoolClock()), 60_000);
    return () => clearInterval(t);
  }, []);
  const nowPeriod = d && d.today.day >= 1 && d.today.day <= d.days.length
    ? d.periods.find((p) => p.startsAt.slice(0, 5) <= clock && clock < p.endsAt.slice(0, 5))?.periodNo
    : undefined;
  const canManage = can('academics.manage');

  const doPublish = async () => {
    if (!sectionId || !d) return;
    const ok = await confirm({ title: `Publish timetable changes for ${d.title}?`, body: 'Every teacher on this timetable is notified to check their periods.', confirmLabel: 'Publish changes', icon: 'check' });
    if (ok) publish.mutate({ sectionId });
  };

  if (sections.isLoading) return <Page><PageSkeleton kpis={0} /></Page>;
  if (sections.error) return <Page><ErrorState error={sections.error} onRetry={() => sections.refetch()} /></Page>;

  return (
    <Page>
      <PageHead
        title="Timetable"
        sub="Days by periods, with teacher, room, conflicts and substitute suggestions."
        actions={<>
          {user?.employeeId && (
            <Segment items={[{ id: 'class', label: 'Class' }, { id: 'mine', label: 'My timetable' }]} active={mode} onChange={(v) => setParam('view', v === 'mine' ? v : null)} />
          )}
          {mode === 'class' && list.length > 0 && (
            <select className="select" aria-label="Class" value={sectionId ?? ''} style={{ width: 'auto', minWidth: 140 }} onChange={(e) => setParam('section', e.target.value)}>
              {list.map((s) => <option key={s.id} value={s.id}>{s.label}{schoolLevel && !campusParam.campusId ? ` · ${s.campusName}` : ''}</option>)}
            </select>
          )}
          {schoolLevel && canManage && mode === 'class' && sectionId && (
            <Button variant="primary" icon="check" onClick={doPublish} loading={publish.isPending}>Publish changes</Button>
          )}
        </>}
      />

      {mode === 'class' && list.length === 0 ? (
        <Card><Empty icon="calendar" title="No classes to show" sub="You are not assigned to any section yet." /></Card>
      ) : tt.error ? <ErrorState error={tt.error} onRetry={() => tt.refetch()} /> : !d ? <Skeleton height={420} /> : (
        <>
          {conflict ? (
            <Banner tone="warning" icon="alert">
              <strong>{d.conflicts.length} conflict{d.conflicts.length === 1 ? '' : 's'}.</strong>{' '}
              {conflict.day ? `${d.days[conflict.day - 1]} Period ${conflict.periodNo}` : ''}, {conflict.sectionLabel} {conflict.subject ?? conflict.activity} has no teacher
              {conflict.teacher ? ` — ${conflict.teacher} is ${conflict.teacherStatus ? conflict.teacherStatus.toLowerCase() : 'unavailable'}` : ''}.
              {canManage ? ' A substitute suggestion is ready.' : ''}
            </Banner>
          ) : (
            <Banner tone="success" icon="check">No conflicts. Every period {mode === 'mine' ? 'on your timetable' : `for ${d.title}`} has a teacher.</Banner>
          )}

          <div className="mt-4">
            <Card flush title={mode === 'mine' ? `My timetable — ${d.title}` : d.title}
              sub={`${plural(d.entries.length, 'period')} a week · today is ${d.days[d.today.day - 1] ?? fmt.date(d.today.date)}, ${fmt.date(d.today.date)}`}
              actions={mode === 'class' && sectionId ? (
                <span className="ac-links">
                  {can('attendance.read') && <Button size="sm" icon="checkSquare" to={`/attendance?section=${sectionId}`}>Attendance</Button>}
                  <Button size="sm" icon="edit" to={`/homework?sectionId=${sectionId}`}>Homework</Button>
                </span>
              ) : undefined}>
              {d.periods.length === 0 ? <Empty icon="clock" title="No periods configured for this campus" sub="Periods and bell times are set up by the academic office for each campus." /> : (
                <>
                  <div className="tt-scroll" role="region" aria-label="Weekly timetable" tabIndex={0}>
                    <table className="tt">
                      <thead>
                        <tr>
                          <th className="tt__corner" scope="col">Period</th>
                          {d.days.map((day, i) => {
                            const isToday = i + 1 === d.today.day;
                            return (
                              <th key={day} scope="col" className={isToday ? 'tt__day--today' : undefined} aria-current={isToday ? 'date' : undefined}>
                                {day}{isToday && <span className="tt__todaytag">Today</span>}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {d.periods.map((p) => {
                          const isNow = nowPeriod === p.periodNo;
                          return (
                            <tr key={p.id} className={isNow ? 'tt__row--now' : undefined}>
                              <th scope="row" className="tt__axis">
                                <span className="tt__pno">Period {p.periodNo}</span>
                                <span className="tt__time">{p.startsAt}–{p.endsAt}</span>
                                {isNow && <span className="tt__nowtag"><span className="dot dot--info dot--pulse" />Now</span>}
                              </th>
                              {d.days.map((day, di) => {
                                const e = grid.get(`${di + 1}:${p.periodNo}`);
                                const isToday = di + 1 === d.today.day;
                                const conflictCell = !!e && e.needsSubstitute && !e.substituteId;
                                const label = e ? e.subject ?? e.activity ?? '—' : 'Free';
                                const teacher = e ? (e.substituteId ? shortName(e.substitute) : shortName(e.teacher) || 'Various') : '';
                                const clickable = !!e && canManage && (conflictCell || !!e.substituteId || schoolLevel);
                                const cls = [
                                  'tt-cell',
                                  !e && 'tt-cell--free',
                                  conflictCell && 'tt-cell--conflict',
                                  e?.substituteId && 'tt-cell--cover',
                                  clickable && 'tt-cell--link',
                                  isToday && isNow && 'tt-cell--now',
                                ].filter(Boolean).join(' ');
                                const meta = [mode === 'mine' && e ? e.sectionLabel : null, conflictCell ? 'Substitute needed' : e?.substituteId ? `Cover: ${teacher}` : teacher, e?.room ? `Room ${e.room}` : null].filter(Boolean).join(', ');
                                return (
                                  <td key={day} className={isToday ? 'tt__slot tt__slot--today' : 'tt__slot'}>
                                    <button type="button" className={cls} disabled={!clickable}
                                      aria-label={`${day} period ${p.periodNo}, ${p.startsAt} to ${p.endsAt}: ${label}${meta ? `, ${meta}` : ''}`}
                                      onClick={() => { if (!e) return; if (conflictCell || e.substituteId) setSubFor(e.id); else setEditing(e); }}>
                                      <span className="tt-cell__subject">{label}</span>
                                      {e && mode === 'mine' && <span className="tt-cell__line"><Icon name="users" size={11} /><span>{e.sectionLabel}</span></span>}
                                      {e && (conflictCell
                                        ? <span className="tt-cell__flag">Substitute needed</span>
                                        : <span className="tt-cell__line">
                                            <Icon name={e.substituteId ? 'refresh' : 'user'} size={11} />
                                            <span>{e.substituteId ? <><span className="tt-cell__flag">Cover</span> {teacher}</> : teacher}</span>
                                          </span>)}
                                      {e?.room && <span className="tt-cell__line"><Icon name="door" size={11} /><span>{e.room}</span></span>}
                                    </button>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="tt-legend" aria-label="Legend">
                    <span className="tt-legend__item"><span className="tt-legend__sw tt-legend__sw--today" />Today</span>
                    <span className="tt-legend__item"><span className="tt-legend__sw tt-legend__sw--now" />Current period</span>
                    <span className="tt-legend__item"><span className="tt-legend__sw tt-legend__sw--conflict" />Needs a substitute</span>
                    <span className="tt-legend__item"><span className="tt-legend__sw tt-legend__sw--cover" />Cover arranged</span>
                    <span className="tt-legend__item"><span className="tt-legend__sw tt-legend__sw--free" />Free period</span>
                    {canManage && schoolLevel && <span className="tt-legend__item t-faint">Select a period to edit it or arrange cover.</span>}
                  </div>
                </>
              )}
            </Card>
          </div>
        </>
      )}

      <div className="grid g-3col g-4 mt-4">
        <Card icon="grid" title="Teacher load" sub="Periods per week">
          {insights.error ? <ErrorState error={insights.error} onRetry={() => insights.refetch()} /> : !insights.data ? <Skeleton height={180} /> : insights.data.teacherLoad.length === 0 ? (
            <Empty icon="users" title="No timetabled teachers" />
          ) : (
            <>
              <Chart svg={charts.hbar({
                rows: insights.data.teacherLoad.map((t) => ({ label: shortName(t.name), value: t.periods, color: t.periods > t.maxPeriods ? 'var(--critical)' : t.periods >= t.maxPeriods - 2 ? 'var(--amber)' : 'var(--navy)' })),
                labelW: 110, rowH: 28,
              })} />
              <p className="t-micro t-muted mt-3">Above {insights.data.agreedLoad} periods is over the agreed load.</p>
            </>
          )}
        </Card>
        <Card icon="clock" title="Timetable utilisation" sub="Scheduled periods across timetabled classes">
          {!insights.data ? <Skeleton height={160} /> : (
            <div className="row center">
              <Chart svg={charts.donut({
                size: 160, thickness: 22, center: `${insights.data.utilisation.pct}%`, centerSub: 'Scheduled',
                data: [
                  { label: 'Scheduled', value: insights.data.utilisation.filled, color: 'var(--teal)' },
                  { label: 'Free', value: Math.max(0, insights.data.utilisation.slots - insights.data.utilisation.filled), color: 'var(--bg-sunken)' },
                ],
              })} />
            </div>
          )}
        </Card>
        <Card icon="grid" title="Substitute suggestions" sub={conflict ? `For ${d?.days[conflict.day - 1]} Period ${conflict.periodNo}` : 'No open conflicts'}>
          {conflict && canManage ? <SuggestionList entryId={conflict.id} onAssigned={() => undefined} compact /> : (
            <Empty icon="shieldCheck" title={conflict ? 'Cover is arranged by the academic office' : 'Nothing needs cover'} />
          )}
        </Card>
      </div>

      {subFor && d && <SubstituteModal entry={d.entries.find((e) => e.id === subFor)!} dayName={d.days[(d.entries.find((e) => e.id === subFor)?.day ?? 1) - 1]} onClose={() => setSubFor(null)} />}
      {editing && <EditEntryModal entry={editing} dayName={d?.days[editing.day - 1] ?? ''} onClose={() => setEditing(null)} />}
    </Page>
  );
}

// ---------------------------------------------------------------------------
function SuggestionList({ entryId, onAssigned, compact, selected, onSelect }: {
  entryId: string; onAssigned: () => void; compact?: boolean; selected?: string; onSelect?: (id: string) => void;
}) {
  const confirm = useConfirm();
  const q = useApiQuery<Suggestions>(`/academics/timetable/entries/${entryId}/substitutes`);
  const assign = useApiMutation<{ substituteId: string }>('post', `/academics/timetable/entries/${entryId}/substitute`, {
    invalidate: ['/academics/timetable', '/academics/teacher-dashboard'], onSuccess: onAssigned,
  });
  if (q.isLoading) return <div className="col g-2">{[0, 1, 2].map((i) => <Skeleton key={i} height={48} />)}</div>;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data!;
  if (!s.suggestions.length) return <Empty icon="users" title="No free teachers in this period" sub="Consider merging the class for this period." />;
  return (
    <div className="col g-2">
      {s.suggestions.map((x) => {
        const content = (
          <>
            <Avatar name={x.name} size="sm" />
            <span className="sub-option__body">
              <span className="t-sm t-bold">{x.name}</span>
              <span className="t-micro t-muted">{x.reason}</span>
            </span>
          </>
        );
        if (compact) {
          return (
            <button key={x.id} type="button" className="card card--link sub-option" disabled={assign.isPending}
              onClick={async () => {
                const ok = await confirm({ title: `Assign ${x.name} as cover?`, body: `${s.entry.day} Period ${s.entry.periodNo} · ${s.entry.section} ${s.entry.subject ?? ''}. ${x.hasAccount ? `${x.name} will be notified.` : ''}`, confirmLabel: 'Assign cover' });
                if (ok) assign.mutate({ substituteId: x.id });
              }}>
              {content}
              <Badge tone={x.match}>Assign</Badge>
            </button>
          );
        }
        return (
          <label key={x.id} className="card card--tint sub-option sub-option--pick">
            <input type="radio" name="substitute" checked={selected === x.id} onChange={() => onSelect?.(x.id)} />
            {content}
            <Badge tone={x.match}>{x.match === 'success' ? 'Best match' : x.match === 'info' ? 'Good match' : 'Available'}</Badge>
          </label>
        );
      })}
    </div>
  );
}

function SubstituteModal({ entry, dayName, onClose }: { entry: Entry; dayName: string; onClose: () => void }) {
  const confirm = useConfirm();
  const [selected, setSelected] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const covered = !!entry.substituteId;
  const assign = useApiMutation<{ substituteId: string; note?: string }>('post', `/academics/timetable/entries/${entry.id}/substitute`, {
    invalidate: ['/academics/timetable', '/academics/teacher-dashboard'], onSuccess: onClose,
  });
  const remove = useApiMutation<void>('delete', `/academics/timetable/entries/${entry.id}/substitute`, {
    invalidate: ['/academics/timetable', '/academics/teacher-dashboard'], onSuccess: onClose,
  });
  const q = useApiQuery<Suggestions>(`/academics/timetable/entries/${entry.id}/substitutes`);
  const what = `${entry.sectionLabel} ${entry.subject ?? entry.activity ?? ''}`.trim();

  return (
    <Modal open onClose={onClose} busy={assign.isPending || remove.isPending} size="wide"
      title={covered ? 'Cover arranged' : 'Timetable conflict'}
      sub={`${dayName} · Period ${entry.periodNo} · ${what} · Room ${entry.room ?? '—'}`}
      foot={<>
        <Button onClick={onClose}>Cancel</Button>
        {covered ? (
          <Button variant="danger" loading={remove.isPending} onClick={async () => {
            const ok = await confirm({ title: 'Remove this cover?', body: `${entry.substitute} will no longer cover ${what}. The period is flagged as needing a substitute again.`, confirmLabel: 'Remove cover', danger: true });
            if (ok) remove.mutate();
          }}>Remove cover</Button>
        ) : (
          <Button variant="primary" loading={assign.isPending} onClick={() => {
            if (!selected) { setError('Choose a teacher to cover this period'); return; }
            if (note.length > 200) { setError('Keep the note under 200 characters'); return; }
            assign.mutate({ substituteId: selected, note: note.trim() || undefined });
          }}>Assign cover</Button>
        )}
      </>}>
      {covered ? (
        <Banner tone="success" icon="check">{entry.substitute} is covering this period{entry.teacher ? ` for ${entry.teacher}` : ''}.</Banner>
      ) : (
        <>
          <Banner tone="critical" icon="alert">
            {entry.teacher ? `${entry.teacher} is ${q.data?.entry.teacherStatus?.toLowerCase() ?? 'unavailable'} on ${q.data ? fmt.date(q.data.entry.date) : dayName}.` : 'No teacher is assigned.'} No teacher is covering this period.
          </Banner>
          <div className="mt-4">
            <div className="eyebrow mb-2">Suggested cover</div>
            <SuggestionList entryId={entry.id} onAssigned={onClose} selected={selected} onSelect={(id) => { setSelected(id); setError(''); }} />
            {error && <p className="ac-err mt-2" role="alert"><Icon name="alertCircle" size={13} />{error}</p>}
          </div>
          <div className="mt-4">
            <TextField label="Note for the substitute" value={note} onChange={setNote} maxLength={200} placeholder="e.g. Worksheet 3 is on the desk" />
          </div>
          {assign.error && <div className="mt-3"><InlineError error={assign.error} /></div>}
        </>
      )}
    </Modal>
  );
}

function EditEntryModal({ entry, dayName, onClose }: { entry: Entry; dayName: string; onClose: () => void }) {
  const { lookups } = useLookups();
  const [f, setF] = useState({ subjectId: entry.subjectId ?? '', activity: entry.activity ?? '', employeeId: entry.employeeId ?? '', room: entry.room ?? '', needsSubstitute: entry.needsSubstitute });
  const [error, setError] = useState('');
  const [activityError, setActivityError] = useState('');
  const save = useApiMutation<Record<string, unknown>>('put', `/academics/timetable/entries/${entry.id}`, {
    invalidate: ['/academics/timetable', '/academics/teacher-dashboard'], success: 'Timetable updated', onSuccess: onClose, error: false,
  });
  useEffect(() => { if (save.error) setError((save.error as Error).message); }, [save.error]);
  const submit = () => {
    if (!f.subjectId && !f.activity.trim()) { setActivityError('Choose a subject or enter an activity'); return; }
    save.mutate({ subjectId: f.subjectId || null, activity: f.subjectId ? null : f.activity.trim(), employeeId: f.employeeId || null, room: f.room.trim() || null, needsSubstitute: f.needsSubstitute });
  };
  return (
    <Modal open onClose={onClose} busy={save.isPending} title={`Edit ${dayName} Period ${entry.periodNo}`} sub={entry.sectionLabel}
      foot={<><Button onClick={onClose} disabled={save.isPending}>Cancel</Button><Button variant="primary" onClick={submit} loading={save.isPending}>Save</Button></>}>
      {error && <div className="mb-3"><Banner tone="critical" icon="alert">{error}</Banner></div>}
      <div className="formsection">
      <div className="formsection__title">Lesson</div>
      <div className="grid g-2col g-3">
        <SelectField label="Subject" value={f.subjectId} onChange={(v) => { setF((x) => ({ ...x, subjectId: v })); setActivityError(''); }} placeholder="Activity (no subject)"
          options={(lookups?.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <TextField label="Activity" value={f.activity} onChange={(v) => { setF((x) => ({ ...x, activity: v })); setActivityError(''); }} disabled={!!f.subjectId} placeholder="Games, Library, Club…" maxLength={40}
          error={activityError} hint={f.subjectId ? 'Clear the subject to use an activity instead.' : undefined} />
        <SelectField label="Teacher" value={f.employeeId} onChange={(v) => setF((x) => ({ ...x, employeeId: v }))} placeholder="No teacher"
          options={(lookups?.staff ?? []).filter((s) => s.employeeType === 'teaching').map((s) => ({ value: s.id, label: s.fullName }))} />
        <TextField label="Room" value={f.room} onChange={(v) => setF((x) => ({ ...x, room: v }))} maxLength={40} />
      </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Cover</div>
        <Switch checked={f.needsSubstitute} onChange={(v) => setF((x) => ({ ...x, needsSubstitute: v }))} label="This period needs a substitute" />
      </div>
    </Modal>
  );
}
