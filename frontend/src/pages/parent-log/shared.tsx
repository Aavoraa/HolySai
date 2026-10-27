import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/api/client';
import {
  Badge, Banner, Button, DataTable, Dl, Empty, ErrorState, Grid, Kpi, Modal, Person, SearchInput, Segment, SelectField, Skeleton,
  StudentLink, TextArea, TextField,
} from '@/components/ui';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { useAuth } from '@/auth/AuthContext';
import { fmt } from '@/lib/format';
import type { Child, LogRow, ParentHistory, ParentHit, Source, TargetKind, Targets } from './types';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------
export const MANUAL_CHANNELS = ['Walk-in', 'Phone call', 'WhatsApp', 'Email', 'Message', 'Letter', 'Other'];
export const LOG_CHANNELS = [...MANUAL_CHANNELS, 'SMS', 'PTM meeting'];
export const PURPOSES = ['Academic', 'Fees', 'Transport', 'Admission', 'Complaint', 'Behaviour', 'Health', 'Leave', 'Meeting request', 'General', 'Other'];
export const OUTCOMES = ['Met', 'Spoke on call', 'Not available', 'Callback scheduled', 'Message left', 'Resolved', 'Escalated', 'Pending'];
export const LOG_OUTCOMES = [...OUTCOMES, 'Responded', 'Received', 'Scheduled', 'No-show', 'In meeting'];
const CLOSING = ['Met', 'Spoke on call', 'Resolved'];

export const SOURCE_META: Record<Source, { label: string; icon: string; tone: string }> = {
  manual: { label: 'Manual', icon: 'edit', tone: 'neutral' },
  communication: { label: 'Message / call', icon: 'message', tone: 'info' },
  message: { label: 'App thread', icon: 'bell', tone: 'info' },
  visitor: { label: 'Visitor', icon: 'door', tone: 'caution' },
  ptm: { label: 'PTM', icon: 'calendar', tone: 'success' },
};

export const TARGET_LABEL: Record<TargetKind, string> = {
  principal: 'Principal', staff: 'Staff member', office: 'Front office', class_teacher: 'Class teacher', management: 'Management',
};

const OUTCOME_TONE: Record<string, string> = {
  Met: 'success', 'Spoke on call': 'success', Resolved: 'success', Responded: 'success',
  'Not available': 'critical', 'No-show': 'critical', 'Message left': 'warning', 'Callback scheduled': 'warning',
  Escalated: 'caution', Pending: 'warning', Received: 'neutral', Scheduled: 'info', 'In meeting': 'info',
};

export function OutcomeBadge({ outcome, overdue }: { outcome: string; overdue?: boolean }) {
  return (
    <span className="row g-1 wrap">
      <Badge tone={OUTCOME_TONE[outcome] ?? 'neutral'} dot>{outcome}</Badge>
      {overdue && <Badge tone="critical" icon="clock">Follow-up overdue</Badge>}
    </span>
  );
}

export function SourceBadge({ source }: { source: Source }) {
  const m = SOURCE_META[source];
  return <Badge tone={m.tone} icon={m.icon}>{m.label}</Badge>;
}

const CHANNEL_ICON: Record<string, string> = {
  'Walk-in': 'door', 'Phone call': 'phone', WhatsApp: 'message', Email: 'mail', Message: 'bell', Letter: 'fileText', SMS: 'hash', 'PTM meeting': 'calendar', Other: 'more',
};
export const channelIcon = (c: string) => CHANNEL_ICON[c] ?? 'message';

export function childLabel(c: Child) {
  return `${c.fullName}${c.grade ? ` (${c.grade.replace('Grade ', '')}${c.section ?? ''})` : ''}`;
}

function fieldErrorsOf(err: unknown): Record<string, string> {
  return err instanceof ApiError ? err.fieldErrors : {};
}

/** Local datetime-local value for "now". */
function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// ---------------------------------------------------------------------------
// Parent search (scoped by the API)
// ---------------------------------------------------------------------------
function ParentSearch({ value, onChange, error }: { value: ParentHit | null; onChange: (p: ParentHit | null) => void; error?: string }) {
  const [q, setQ] = useState('');
  const hits = useApiQuery<ParentHit[]>(q ? '/parent-log/parent-search' : null, { q, limit: 8 });
  if (value) {
    return (
      <div className="field">
        <span className="label">Parent</span>
        <div className="card adm-picked">
          <Person name={value.fullName} meta={`${value.phone} · ${value.children.map(childLabel).join(', ') || 'No children linked'}`} />
          <Button size="sm" variant="quiet" onClick={() => onChange(null)}>Change</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="field">
      <span className="label">Parent<span className="req"> *</span></span>
      <SearchInput value={q} onSearch={setQ} placeholder="Search by parent name, phone, child or admission no." maxWidth={9999} />
      {error && <span className="hint hint--error" role="alert">{error}</span>}
      {q && (
        <div className="card adm-picklist">
          {hits.isLoading ? <Skeleton height={36} /> : hits.error ? <ErrorState error={hits.error} onRetry={hits.refetch} />
            : hits.data?.length ? hits.data.map((p) => (
              <button key={p.id} type="button" className="alert-item" onClick={() => onChange(p)}>
                <span className="pe-inbox__main">
                  <span className="alert-item__title pe-inbox__meta">{p.fullName}</span>
                  <span className="alert-item__meta pe-inbox__meta">{p.phone} · {p.children.map(childLabel).join(', ') || 'No children linked'}</span>
                </span>
              </button>
            )) : <div className="t-sm t-muted card__body">No parents match “{q}”.</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log a contact
// ---------------------------------------------------------------------------
type Who = 'parent' | 'staff' | 'other';

export function LogContactModal({ open, onClose, campusId }: { open: boolean; onClose: () => void; campusId?: string }) {
  const targets = useApiQuery<Targets>(open ? '/parent-log/targets' : null, campusId ? { campusId } : undefined, { staleTime: 5 * 60_000 });
  const [who, setWho] = useState<Who>('parent');
  const [parent, setParent] = useState<ParentHit | null>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [studentId, setStudentId] = useState('');
  const [targetKind, setTargetKind] = useState<TargetKind>('principal');
  const [targetEmployeeId, setTargetEmployeeId] = useState('');
  const [channel, setChannel] = useState('Walk-in');
  const [purpose, setPurpose] = useState('');
  const [summary, setSummary] = useState('');
  const [outcome, setOutcome] = useState('Pending');
  const [followUpOn, setFollowUpOn] = useState('');
  const [occurredAt, setOccurredAt] = useState(nowLocal());
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setWho('parent'); setParent(null); setEmployeeId(''); setContactName(''); setContactPhone(''); setStudentId('');
    setTargetKind('principal'); setTargetEmployeeId(''); setChannel('Walk-in'); setPurpose(''); setSummary('');
    setOutcome('Pending'); setFollowUpOn(''); setOccurredAt(nowLocal()); setErrors({});
  }, [open]);

  const staff = targets.data?.staff ?? [];
  const staffOptions = useMemo(() => staff.map((s) => ({ value: s.id, label: `${s.fullName} — ${s.designation}` })), [staff]);
  const save = useApiMutation<Record<string, unknown>, LogRow>('post', '/parent-log', {
    invalidate: ['/parent-log'], success: (r) => `Contact ${r.data.code ?? ''} logged`, onSuccess: () => onClose(),
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (who === 'parent' && !parent) e.parentId = 'Choose the parent who approached';
    if (who === 'staff' && !employeeId) e.employeeId = 'Choose the teacher or staff member';
    if (who === 'other' && contactName.trim().length < 2) e.contactName = 'Enter the name of the person';
    if (contactPhone && !/^[0-9+()\-\s]{6,30}$/.test(contactPhone)) e.contactPhone = 'Enter a valid phone number';
    if (targetKind === 'staff' && !targetEmployeeId) e.targetEmployeeId = 'Choose the staff member they wanted to reach';
    if (targetKind === 'class_teacher' && !targetEmployeeId && !studentId) e.targetEmployeeId = 'Choose the class teacher, or pick the child';
    if (!purpose) e.purpose = 'Choose the purpose';
    if (summary.trim().length < 3) e.summary = 'Describe what they wanted (at least 3 characters)';
    const at = occurredAt ? new Date(occurredAt) : null;
    if (at && at.getTime() > Date.now() + 60_000) e.occurredAt = 'The contact time cannot be in the future';
    setErrors(e);
    if (Object.keys(e).length) return;
    const emp = staff.find((s) => s.id === employeeId);
    save.mutate({
      contactKind: who === 'parent' ? 'parent' : who === 'other' ? 'other' : emp?.employeeType === 'non_teaching' ? 'staff' : 'teacher',
      parentId: who === 'parent' ? parent!.id : undefined,
      employeeId: who === 'staff' ? employeeId : undefined,
      contactName: who === 'other' ? contactName.trim() : undefined,
      contactPhone: contactPhone.trim() || undefined,
      studentId: studentId || undefined,
      targetKind,
      targetEmployeeId: (targetKind === 'staff' || targetKind === 'class_teacher') && targetEmployeeId ? targetEmployeeId : undefined,
      channel, purpose, summary: summary.trim(), outcome,
      followUpOn: followUpOn || undefined,
      occurredAt: at ? at.toISOString() : undefined,
      campusId: campusId || undefined,
    }, { onError: (err) => setErrors(fieldErrorsOf(err)) });
  };

  const children = parent?.children ?? [];
  return (
    <Modal open={open} onClose={onClose} busy={save.isPending} size="wide" title="Log a contact"
      sub="Record a walk-in, call or message from someone trying to reach the Principal or staff"
      foot={<>
        <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button variant="primary" icon="save" onClick={submit} loading={save.isPending}>Save contact</Button>
      </>}>
      <div className="col g-3">
        <div className="field">
          <span className="label">Who approached</span>
          <Segment items={[{ id: 'parent', label: 'Parent' }, { id: 'staff', label: 'Teacher / staff' }, { id: 'other', label: 'Someone else' }]}
            active={who} onChange={(v) => { setWho(v); setStudentId(''); }} />
        </div>
        {who === 'parent' && <ParentSearch value={parent} onChange={(p) => { setParent(p); setStudentId(p?.children.length === 1 ? p.children[0].id : ''); }} error={errors.parentId} />}
        {who === 'staff' && (
          <SelectField label="Teacher or staff member" required value={employeeId} onChange={setEmployeeId} error={errors.employeeId}
            placeholder={targets.isLoading ? 'Loading staff…' : 'Choose…'} options={staffOptions.filter((o) => o.value !== targets.data?.principal?.employeeId)} />
        )}
        {who === 'other' && (
          <div className="form-grid">
            <TextField label="Name" required value={contactName} onChange={setContactName} error={errors.contactName} maxLength={120} placeholder="For example: Alumni association" />
            <TextField label="Phone" value={contactPhone} onChange={setContactPhone} error={errors.contactPhone} maxLength={30} type="tel" />
          </div>
        )}
        {who === 'parent' && children.length > 0 && (
          <SelectField label="About which child" value={studentId} onChange={setStudentId} error={errors.studentId} placeholder="The family in general"
            options={children.map((c) => ({ value: c.id, label: childLabel(c) }))} />
        )}

        <div className="form-grid">
          <SelectField label="Wanted to reach" required value={targetKind} onChange={(v) => { setTargetKind(v as TargetKind); setTargetEmployeeId(''); }}
            options={[
              { value: 'principal', label: `Principal${targets.data?.principal ? ` (${targets.data.principal.fullName})` : ''}` },
              { value: 'class_teacher', label: 'Class teacher' },
              { value: 'staff', label: 'A specific staff member' },
              { value: 'office', label: 'Front office' },
              { value: 'management', label: 'Management' },
            ]} />
          {(targetKind === 'staff' || targetKind === 'class_teacher') && (
            <SelectField label={targetKind === 'class_teacher' ? 'Class teacher' : 'Staff member'} required={targetKind === 'staff'}
              value={targetEmployeeId} onChange={setTargetEmployeeId} error={errors.targetEmployeeId}
              placeholder={targetKind === 'class_teacher' ? 'Find from the child’s class' : 'Choose…'}
              options={staffOptions.filter((o) => o.value !== targets.data?.principal?.employeeId)} />
          )}
        </div>
        <div className="form-grid">
          <SelectField label="Channel" required value={channel} onChange={setChannel} options={MANUAL_CHANNELS} />
          <SelectField label="Purpose" required value={purpose} onChange={setPurpose} error={errors.purpose} placeholder="Choose…" options={PURPOSES} />
        </div>
        <TextArea label="What they wanted" required rows={3} value={summary} onChange={setSummary} error={errors.summary} maxLength={1000}
          placeholder="For example: wanted to meet the Principal about the evening bus arriving late" hint={`${summary.length}/1000`} />
        <div className="form-grid">
          <SelectField label="Outcome" required value={outcome} onChange={setOutcome} options={OUTCOMES} />
          <TextField label="Follow up on" type="date" value={followUpOn} onChange={setFollowUpOn} error={errors.followUpOn} />
        </div>
        <TextField label="When" type="datetime-local" value={occurredAt} onChange={setOccurredAt} error={errors.occurredAt} max={nowLocal()}
          hint="Defaults to now — change it when logging an earlier walk-in or call" />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Update a manual entry (outcome / resolve / follow-up)
// ---------------------------------------------------------------------------
export function UpdateEntryModal({ row, onClose }: { row: LogRow | null; onClose: () => void }) {
  const [outcome, setOutcome] = useState('');
  const [followUpOn, setFollowUpOn] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!row) return;
    setOutcome(row.outcome); setFollowUpOn(row.followUpOn ?? ''); setNote(row.details ?? '');
  }, [row]);
  const save = useApiMutation<{ id: string; body: Record<string, unknown> }, LogRow>('patch', (v) => `/parent-log/${v.id}`, {
    invalidate: ['/parent-log'], body: (v) => v.body, success: 'Contact updated', onSuccess: () => onClose(),
  });
  if (!row) return null;
  const submit = (resolve?: boolean) => save.mutate({
    id: row.sourceId,
    body: {
      outcome: resolve ? undefined : outcome !== row.outcome ? outcome : undefined,
      resolved: resolve ? true : undefined,
      followUpOn: followUpOn !== (row.followUpOn ?? '') ? (followUpOn || null) : undefined,
      resolutionNote: note !== (row.details ?? '') ? (note.trim() || null) : undefined,
    },
  });
  const unchanged = outcome === row.outcome && followUpOn === (row.followUpOn ?? '') && note === (row.details ?? '');
  return (
    <Modal open={!!row} onClose={onClose} busy={save.isPending} title={`Update ${row.code ?? 'contact'}`}
      sub={`${row.contactName} → ${row.targetName} · ${row.channel} · ${fmt.dateTime(row.occurredAt)}`}
      foot={<>
        <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
        {row.isOpen && <Button icon="checkSquare" onClick={() => submit(true)} loading={save.isPending}>Mark resolved</Button>}
        <Button variant="primary" icon="save" onClick={() => submit()} loading={save.isPending} disabled={unchanged}>Save</Button>
      </>}>
      <div className="col g-3">
        <div className="t-sm">{row.summary}</div>
        <div className="form-grid">
          <SelectField label="Outcome" value={outcome} onChange={setOutcome} options={OUTCOMES} />
          <TextField label="Follow up on" type="date" value={followUpOn} onChange={setFollowUpOn} />
        </div>
        <TextArea label="Resolution / follow-up note" rows={3} value={note} onChange={setNote} maxLength={1000} />
        {CLOSING.includes(outcome) && !row.resolvedAt && <span className="t-xs t-muted">Saving with this outcome closes the contact.</span>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Timeline table shared by the main log and the parent history
// ---------------------------------------------------------------------------
export function LogTable({ rows, loading, sort, onSort, emptyText, onEdit, onParent, compact }: {
  rows: LogRow[] | undefined; loading?: boolean; sort?: { key: string; dir: 'asc' | 'desc' }; onSort?: (s: { key: string; dir: 'asc' | 'desc' }) => void;
  emptyText?: string; onEdit?: (r: LogRow) => void; onParent?: (parentId: string) => void; compact?: boolean;
}) {
  const { can, user } = useAuth();
  const canEdit = can('parentlog.manage');
  const fullView = can('parentlog.read');
  return (
    <DataTable<LogRow>
      rows={rows} loading={loading} rowKey={(r) => r.id} sort={sort} onSort={onSort} compact={compact}
      emptyText={emptyText ?? 'No contacts match the current filters.'}
      columns={[
        { key: 'occurredAt', label: 'When', render: (r) => <span className="t-sm" title={fmt.dateTime(r.occurredAt)}>{fmt.dateTime(r.occurredAt)}</span> },
        ...(compact ? [] : [{
          key: 'contact', label: 'Who', render: (r: LogRow) => (
            <span className="col g-1">
              <Person size="xs" name={r.contactName}
                meta={`${r.contactKind === 'parent' ? 'Parent' : r.contactKind === 'other' ? 'Other' : r.employeeDesignation ?? 'Staff'}${r.contactPhone ? ` · ${r.contactPhone}` : ''}`}
                onClick={r.parentId && onParent ? () => onParent(r.parentId!) : undefined} />
              {r.studentId && r.studentName ? <StudentLink id={r.studentId} name={r.studentName} meta={r.grade ?? undefined} /> : null}
            </span>
          ),
        }]),
        {
          key: 'target', label: 'Wanted to reach', render: (r) => (
            <span className="col">
              <span className="t-sm">{r.targetName}</span>
              <span className="t-micro t-muted">{TARGET_LABEL[r.targetKind]}</span>
            </span>
          ),
        },
        { key: 'channel', label: 'Channel', render: (r) => <Badge tone="neutral" icon={channelIcon(r.channel)}>{r.channel}</Badge> },
        {
          key: 'purpose', label: 'Purpose', render: (r) => (
            <span className="pe-subject">
              <span className="t-sm t-bold">{r.purpose}</span>
              <span className="t-micro t-muted t-clip" title={r.summary}>{r.summary}</span>
            </span>
          ),
        },
        {
          key: 'outcome', label: 'Outcome', render: (r) => (
            <span className="col g-1">
              <OutcomeBadge outcome={r.outcome} overdue={r.followUpOverdue} />
              {r.followUpOn && r.isOpen && !r.followUpOverdue && <span className="t-micro t-muted">Follow up {fmt.date(r.followUpOn)}</span>}
            </span>
          ),
        },
        { key: 'source', label: 'Source', render: (r) => <SourceBadge source={r.source} /> },
        {
          key: 'a', label: '', sortable: false, className: 'num', render: (r) => {
            const mine = fullView || r.loggedBy === user?.id || r.targetUserId === user?.id;
            return r.source === 'manual' && canEdit && onEdit && mine
              ? <Button size="sm" variant="quiet" icon="edit" onClick={() => onEdit(r)}>{r.isOpen ? 'Update' : 'Edit'}</Button>
              : null;
          },
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// One parent's contact history
// ---------------------------------------------------------------------------
export function ParentHistoryModal({ parentId, onClose, onEdit }: { parentId: string | null; onClose: () => void; onEdit?: (r: LogRow) => void }) {
  const q = useApiQuery<ParentHistory>(parentId ? `/parent-log/parents/${parentId}` : null);
  const d = q.data;
  return (
    <Modal open={!!parentId} onClose={onClose} size="full" title={d ? `${d.parent.fullName} — contact history` : 'Contact history'}
      sub={d ? `${d.parent.parentCode} · ${d.parent.phone}${d.parent.children.length ? ` · ${d.parent.children.map(childLabel).join(', ')}` : ''}` : undefined}
      foot={<Button onClick={onClose}>Close</Button>}>
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !d ? <Skeleton height={240} /> : (
        <div className="col g-4">
          {d.scope === 'mine' && <Banner icon="info">Showing only contacts you logged or that were addressed to you.</Banner>}
          <Grid cols="g-4col">
            <Kpi size="compact" icon="activity" label="All contacts" value={fmt.n(d.counts.total)} foot={d.counts.firstAt ? `Since ${fmt.date(d.counts.firstAt)}` : 'None recorded'} />
            <Kpi size="compact" icon="user" label="To the Principal" value={fmt.n(d.counts.toPrincipal)} tone={d.counts.toPrincipal ? 'violet' : undefined} />
            <Kpi size="compact" icon="clock" label="Open" value={fmt.n(d.counts.open)} tone={d.counts.open ? 'amber' : 'teal'} foot={d.counts.open ? 'Waiting for a response' : 'Nothing pending'} />
            <Kpi size="compact" icon="calendar" label="Last 14 days" value={fmt.n(d.counts.last14Days)} tone={d.counts.last14Days >= 3 ? 'critical' : undefined}
              foot={`${fmt.n(d.counts.last30Days)} in 30 days`} />
          </Grid>
          <Dl items={[
            ['By source', Object.entries(d.counts.bySource).map(([k, n]) => `${SOURCE_META[k as Source]?.label ?? k} ${n}`).join(' · ') || '—'],
            ['By channel', Object.entries(d.counts.byChannel).map(([k, n]) => `${k} ${n}`).join(' · ') || '—'],
            ['Last contact', d.counts.lastAt ? fmt.dateTime(d.counts.lastAt) : '—'],
          ]} />
          {d.rows.length ? <LogTable rows={d.rows} compact onEdit={onEdit} />
            : <Empty icon="phone" title="No contacts recorded" sub="Walk-ins, calls, messages, PTM bookings and gate visits from this parent appear here." />}
        </div>
      )}
    </Modal>
  );
}
