import { useEffect, useState } from 'react';
import { ApiError } from '@/api/client';
import {
  Badge, Button, Checkbox, Empty, Icon, InlineError, Modal, Person, SearchInput, SelectField, Skeleton, TextArea, TextField,
} from '@/components/ui';
import { useApiMutation, usePagedQuery } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import { fmt } from '@/lib/format';
import type { Audience, AudienceKind, Channel, ChildRef, Communication, DirectoryRow } from './types';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
export const CHANNEL_META: Record<string, { icon: string; tone: string }> = {
  WhatsApp: { icon: 'message', tone: 'success' },
  Email: { icon: 'mail', tone: 'info' },
  SMS: { icon: 'hash', tone: 'caution' },
  Call: { icon: 'phone', tone: 'warning' },
  Note: { icon: 'edit', tone: 'neutral' },
  'In-app': { icon: 'bell', tone: 'info' },
};

export function ChannelBadge({ channel }: { channel: string }) {
  const m = CHANNEL_META[channel] ?? { icon: 'message', tone: 'neutral' };
  return <Badge tone={m.tone} icon={m.icon}>{channel}</Badge>;
}

export function ackTone(ack: number, of: number) {
  return of && ack / of > 0.85 ? 'teal' : 'amber';
}

export function engagementTone(v: number) {
  return v >= 70 ? 'teal' : v >= 50 ? 'amber' : 'critical';
}

/** "WhatsApp · 2 days ago" */
export function lastContact(channel: string | null, at: string | null) {
  if (!at) return 'No contact yet';
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return `${channel ?? 'Contact'} · ${when}`;
}

export function ageLabel(hours: number | null | undefined) {
  if (hours == null) return '';
  if (hours < 1) return '<1 h';
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

export function childLabel(c: ChildRef) {
  return `${c.fullName}${c.grade ? ` (${c.grade.replace('Grade ', '')}${c.section ?? ''})` : ''}`;
}

/** Server field errors → { field: message } (falls back to a banner for others). */
export function fieldErrorsOf(err: unknown): Record<string, string> {
  return err instanceof ApiError ? err.fieldErrors : {};
}

// ---------------------------------------------------------------------------
// Audience picker (circulars and events)
// ---------------------------------------------------------------------------
const KIND_OPTIONS: { value: AudienceKind; label: string }[] = [
  { value: 'all', label: 'All parents' },
  { value: 'grades', label: 'Parents of selected grades' },
  { value: 'transport', label: 'Transport users' },
  { value: 'staff', label: 'All staff' },
];

export function AudiencePicker({ value, onChange, campusId, onCampus, error, allowStaff = true }: {
  value: Audience; onChange: (a: Audience) => void; campusId: string; onCampus: (id: string) => void; error?: string; allowStaff?: boolean;
}) {
  const { lookups } = useLookups();
  const levels = Array.from(new Set((lookups?.classes ?? []).map((c) => c.gradeLevel))).sort((a, b) => a - b);
  const grades = value.grades ?? [];
  const toggle = (g: number) => onChange({ kind: 'grades', grades: grades.includes(g) ? grades.filter((x) => x !== g) : [...grades, g].sort((a, b) => a - b) });
  return (
    <div className="col g-3">
      <div className="form-grid">
        <SelectField label="Audience" required value={value.kind}
          onChange={(k) => onChange(k === 'grades' ? { kind: 'grades', grades } : { kind: k as AudienceKind })}
          options={KIND_OPTIONS.filter((o) => allowStaff || o.value !== 'staff')} />
        <SelectField label="Campus" value={campusId} onChange={onCampus} placeholder="All campuses"
          options={(lookups?.campuses ?? []).map((c) => ({ value: c.id, label: c.name }))} />
      </div>
      {value.kind === 'grades' && (
        <div className="field">
          <span className="label">Grades<span className="req"> *</span></span>
          <div className="row g-3 wrap" role="group" aria-label="Grades">
            {levels.map((g) => <Checkbox key={g} checked={grades.includes(g)} onChange={() => toggle(g)} label={`Grade ${g}`} />)}
          </div>
          {error && <span className="hint hint--error" role="alert">{error}</span>}
        </div>
      )}
      <AudienceCount audience={value} campusId={campusId} />
    </div>
  );
}

function AudienceCount({ audience, campusId }: { audience: Audience; campusId: string }) {
  const [count, setCount] = useState<{ label: string; count: number } | null>(null);
  const m = useApiMutation<{ audience: Audience; campusId: string | null }, { label: string; count: number }>('post', '/circulars/audience-count', {
    success: false, error: false, onSuccess: (r) => setCount(r.data),
  });
  const key = JSON.stringify([audience, campusId]);
  useEffect(() => {
    if (audience.kind === 'grades' && !audience.grades?.length) { setCount(null); return; }
    const t = setTimeout(() => m.mutate({ audience, campusId: campusId || null }), 250);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!count) return null;
  return (
    <div className="t-xs t-muted row g-2">
      <Icon name="users" size={13} />
      <span>{count.label} · reaches <strong className="t-num">{fmt.n(count.count)}</strong> {audience.kind === 'staff' ? 'staff accounts' : 'families'}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parent picker (search the directory)
// ---------------------------------------------------------------------------
export function ParentPicker({ value, onChange, error }: { value: DirectoryRow | null; onChange: (p: DirectoryRow | null) => void; error?: string }) {
  const [q, setQ] = useState('');
  const list = usePagedQuery<DirectoryRow>(q ? '/parent-directory' : null, { q, pageSize: 6 });
  if (value) {
    return (
      <div className="field">
        <span className="label">Parent</span>
        <div className="card adm-picked">
          <Person name={value.fullName} meta={`${value.phone}${value.hasAppAccount ? ' · uses the app' : ' · no app account'}`} />
          <Button size="sm" variant="quiet" onClick={() => onChange(null)}>Change</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="field">
      <span className="label">Parent<span className="req"> *</span></span>
      <SearchInput value={q} onSearch={setQ} placeholder="Search parents by name or phone" maxWidth={9999} />
      {error && <span className="hint hint--error" role="alert">{error}</span>}
      {q && (
        <div className="card adm-picklist">
          {list.isLoading ? <Skeleton height={36} /> : list.data?.rows.length ? list.data.rows.map((p) => (
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

/** The family behind a communication row, in the shape the message form uses. */
function fromCommunication(c: Communication): DirectoryRow {
  return {
    id: c.parentId!, parentCode: '', fullName: c.parentName ?? c.counterpart, phone: c.parentPhone ?? '', email: null, occupation: null,
    preferredChannel: 'whatsapp', engagement: 0, lastContactAt: null, lastContactChannel: null, hasAppAccount: !!c.parentHasApp,
    children: c.studentId ? [{ id: c.studentId, fullName: c.studentName ?? 'Student', grade: c.grade }] : [], ptmBooked: false, openQueries: 0,
  };
}

// ---------------------------------------------------------------------------
// Send a message to a family
// ---------------------------------------------------------------------------
export function SendMessageModal({ open, onClose, parent, replyTo, defaultSubject, onSent }: {
  open: boolean; onClose: () => void; parent?: DirectoryRow | null; replyTo?: Communication | null; defaultSubject?: string;
  onSent?: (c: Communication) => void;
}) {
  const [picked, setPicked] = useState<DirectoryRow | null>(parent ?? null);
  const [studentId, setStudentId] = useState('');
  const [channel, setChannel] = useState<Channel>('WhatsApp');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setPicked(parent ?? (replyTo?.parentId ? fromCommunication(replyTo) : null));
    setStudentId(replyTo?.studentId ?? parent?.children[0]?.id ?? '');
    setChannel(replyTo && ['WhatsApp', 'Email', 'SMS', 'In-app'].includes(replyTo.channel) ? replyTo.channel : parent?.preferredChannel === 'email' ? 'Email' : parent?.preferredChannel === 'sms' ? 'SMS' : 'WhatsApp');
    setSubject(replyTo ? (replyTo.subject.startsWith('Re: ') ? replyTo.subject : `Re: ${replyTo.subject}`) : defaultSubject ?? '');
    setBody('');
    setErrors({});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useApiMutation<Record<string, unknown>, Communication & { queued: boolean }>('post', '/communications/send', {
    invalidate: ['/communications', '/parent-directory', '/communication'],
    onSuccess: (r) => { onSent?.(r.data); onClose(); },
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (!picked) e.parentId = 'Choose a parent';
    if (subject.trim().length < 3) e.subject = 'Enter a subject (at least 3 characters)';
    if (body.trim().length < 2) e.body = 'Write the message';
    setErrors(e);
    if (Object.keys(e).length) return;
    send.mutate(
      { parentId: picked!.id, studentId: studentId || undefined, channel, subject: subject.trim(), body: body.trim(), replyTo: replyTo?.id },
      { onError: (err) => setErrors(fieldErrorsOf(err)) },
    );
  };

  const children = picked?.children ?? [];
  return (
    <Modal open={open} onClose={onClose} busy={send.isPending} size="wide"
      title={replyTo ? `Reply to ${replyTo.counterpart}` : 'New message'}
      sub={replyTo ? `${replyTo.channel} · ${replyTo.subject}` : 'Sent from the school account and recorded in the family’s communication history'}
      foot={<>
        <Button onClick={onClose} disabled={send.isPending}>Cancel</Button>
        <Button variant="primary" icon="send" onClick={submit} loading={send.isPending}>Send</Button>
      </>}>
      <div className="col g-3">
        {replyTo?.body && (
          <div className="bubble bubble--in pe-quote">
            {replyTo.body}
            <div className="bubble__meta">{replyTo.channel} · {fmt.dateTime(replyTo.occurredAt)}</div>
          </div>
        )}
        {parent || replyTo ? (
          picked ? <Person name={picked.fullName} meta={`${picked.phone}${picked.hasAppAccount ? ' · uses the app' : ' · no app account — nothing can be delivered until the family signs up'}`} />
            : <InlineError error={new Error('This message is not linked to a family, so a reply cannot be sent.')} />
        ) : <ParentPicker value={picked} onChange={(p) => { setPicked(p); setStudentId(p?.children[0]?.id ?? ''); }} error={errors.parentId} />}
        <div className="form-grid">
          <SelectField label="Channel" required value={channel} onChange={(v) => setChannel(v as Channel)} error={errors.channel}
            options={['WhatsApp', 'SMS', 'Email', 'In-app']} />
          <SelectField label="About" value={studentId} onChange={setStudentId} placeholder="The family in general"
            options={children.map((c) => ({ value: c.id, label: childLabel(c) }))} />
        </div>
        <TextField label="Subject" required value={subject} onChange={setSubject} error={errors.subject} maxLength={160} />
        <TextArea label="Message" required rows={5} value={body} onChange={setBody} error={errors.body} maxLength={2000}
          placeholder="Write the message the family will receive." hint={`${body.length}/2000`} />
        {picked && !picked.hasAppAccount && (
          <InlineError error={new Error('This family has no app account, so the message will be recorded but cannot be delivered.')} />
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Log a call or an internal note
// ---------------------------------------------------------------------------
export function LogInteractionModal({ open, onClose, parent }: { open: boolean; onClose: () => void; parent?: DirectoryRow | null }) {
  const [kind, setKind] = useState<'Call' | 'Note'>('Call');
  const [picked, setPicked] = useState<DirectoryRow | null>(parent ?? null);
  const [studentId, setStudentId] = useState('');
  const [counterpart, setCounterpart] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState('Connected');
  const [direction, setDirection] = useState<'outbound' | 'inbound'>('outbound');
  const [followUp, setFollowUp] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setKind('Call'); setPicked(parent ?? null); setStudentId(parent?.children[0]?.id ?? ''); setCounterpart('');
    setSubject(''); setBody(''); setStatus('Connected'); setDirection('outbound'); setFollowUp(false); setErrors({});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useApiMutation<Record<string, unknown>>('post', '/communications', {
    invalidate: ['/communications', '/parent-directory'], onSuccess: () => onClose(),
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (kind === 'Call' && !picked) e.parentId = 'Choose the parent you spoke to';
    if (kind === 'Note' && !picked && counterpart.trim().length < 2) e.counterpart = 'Choose a parent or name who the note is about';
    if (subject.trim().length < 3) e.subject = 'Summarise the interaction (at least 3 characters)';
    setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({
      channel: kind, parentId: picked?.id, studentId: studentId || undefined, counterpart: picked ? undefined : counterpart.trim() || undefined,
      subject: subject.trim(), body: body.trim() || undefined, status: kind === 'Call' ? status : undefined,
      direction: kind === 'Call' ? direction : undefined, needsReply: followUp,
    }, { onError: (err) => setErrors(fieldErrorsOf(err)) });
  };

  return (
    <Modal open={open} onClose={onClose} busy={save.isPending} title="Log a call or note" sub="Recorded in the family’s communication history"
      foot={<>
        <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button variant="primary" icon="save" onClick={submit} loading={save.isPending}>Save</Button>
      </>}>
      <div className="col g-3">
        <SelectField label="Type" value={kind} onChange={(v) => setKind(v as 'Call' | 'Note')} options={[{ value: 'Call', label: 'Phone call' }, { value: 'Note', label: 'Internal note' }]} />
        {parent ? <Person name={parent.fullName} meta={parent.phone} />
          : <ParentPicker value={picked} onChange={(p) => { setPicked(p); setStudentId(p?.children[0]?.id ?? ''); }} error={errors.parentId} />}
        {kind === 'Note' && !picked && (
          <TextField label="About (if not a parent)" value={counterpart} onChange={setCounterpart} error={errors.counterpart} placeholder="For example: Front office" />
        )}
        {picked && picked.children.length > 0 && (
          <SelectField label="About" value={studentId} onChange={setStudentId} placeholder="The family in general"
            options={picked.children.map((c) => ({ value: c.id, label: childLabel(c) }))} />
        )}
        {kind === 'Call' && (
          <div className="form-grid">
            <SelectField label="Direction" value={direction} onChange={(v) => setDirection(v as 'outbound' | 'inbound')}
              options={[{ value: 'outbound', label: 'We called the family' }, { value: 'inbound', label: 'The family called us' }]} />
            <SelectField label="Outcome" value={status} onChange={setStatus} options={['Connected', 'No answer', 'Left voicemail']} />
          </div>
        )}
        <TextField label="Summary" required value={subject} onChange={setSubject} error={errors.subject} maxLength={160} />
        <TextArea label="Details" rows={4} value={body} onChange={setBody} maxLength={2000} />
        <Checkbox checked={followUp} onChange={setFollowUp} label="Needs a reply or follow-up (adds it to the unanswered queue)" />
      </div>
    </Modal>
  );
}

export function EmptyHistory() {
  return <Empty icon="message" title="No interactions yet" sub="Messages, calls and notes with this family will appear here. Use “Message” or “Log call” to record the first one." />;
}
