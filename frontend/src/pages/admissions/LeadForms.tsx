import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import { useSchool } from '@/layouts/SchoolContext';
import { Button, Checkbox, InlineError, Modal, SearchInput, SelectField, TextArea, TextField } from '@/components/ui';
import { EMAIL_RE, PHONE_RE, localInput, localToIso, useCounsellors } from './shared';
import { FOLLOW_UP_TYPES, GRADES, SOURCES, STAGES, type FollowUp, type Lead } from './types';

const INVALIDATE = ['/enquiries', '/admissions', '/applications', '/visits', '/follow-ups', '/referrals'];

/** Shared modal shell for the small admissions forms: submit button, busy state, server errors. */
export function FormModal({ title, sub, open = true, onClose, busy, error, fieldErrors, submitLabel, submitIcon = 'check', danger, children, size, formId }: {
  title: string; sub?: ReactNode; open?: boolean; onClose: () => void; busy: boolean; error: unknown; fieldErrors: Record<string, string>;
  submitLabel: string; submitIcon?: string; danger?: boolean; children: ReactNode; size?: 'wide' | 'full'; formId: string;
}) {
  const showGeneral = error && !(error instanceof ApiError && Object.keys(error.fieldErrors).length && Object.keys(fieldErrors).length);
  return (
    <Modal open={open} onClose={onClose} busy={busy} title={title} sub={sub} size={size}
      foot={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} icon={submitIcon} type="submit" form={formId} loading={busy}>{submitLabel}</Button>
        </>
      }>
      {showGeneral ? <div className="mb-4"><InlineError error={error} /></div> : null}
      {children}
    </Modal>
  );
}

export function useFieldErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  return {
    errors,
    setErrors,
    clear: (k: string) => setErrors((e) => (e[k] ? { ...e, [k]: '' } : e)),
    fromServer: (err: unknown) => { if (err instanceof ApiError) setErrors((e) => ({ ...e, ...err.fieldErrors })); },
  };
}

// ---------------------------------------------------------------------------
// New lead
// ---------------------------------------------------------------------------
export function LeadFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const { lookups } = useLookups();
  const school = useSchool();
  const counsellors = useCounsellors();
  const fe = useFieldErrors();
  const [v, setV] = useState({
    campusId: school.campusId ?? '', parentName: '', phone: '', email: '', studentName: '', studentDob: '', gradeApplied: '',
    curriculum: '', source: '', campaign: '', leadScore: '50', counsellorId: '', transportRequired: false, notes: '',
  });
  const set = (k: keyof typeof v, val: string | boolean) => { setV((s) => ({ ...s, [k]: val })); fe.clear(k); };
  const save = useApiMutation<Record<string, unknown>, { id: string; code: string }>('post', '/enquiries', {
    invalidate: INVALIDATE, success: (r) => `Lead ${r.data.code} created`, error: false, onSuccess: (r) => onCreated(r.data.code),
  });
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!v.campusId) e.campusId = 'Choose a campus';
    if (v.parentName.trim().length < 2) e.parentName = 'Enter the parent’s name';
    if (!PHONE_RE.test(v.phone.trim())) e.phone = 'Enter a valid phone number';
    if (v.email && !EMAIL_RE.test(v.email)) e.email = 'Enter a valid email';
    if (v.studentName.trim().length < 2) e.studentName = 'Enter the child’s name';
    if (!v.gradeApplied) e.gradeApplied = 'Choose a grade';
    if (!v.source) e.source = 'Choose the source';
    const score = Number(v.leadScore);
    if (!Number.isInteger(score) || score < 0 || score > 100) e.leadScore = 'Score is 0–100';
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    const opt = (s: string) => s.trim() || undefined;
    save.mutate({
      campusId: v.campusId, parentName: v.parentName.trim(), phone: v.phone.trim(), email: opt(v.email), studentName: v.studentName.trim(),
      studentDob: opt(v.studentDob), gradeApplied: v.gradeApplied, curriculum: opt(v.curriculum), source: v.source, campaign: opt(v.campaign),
      leadScore: score, counsellorId: v.counsellorId || null, transportRequired: v.transportRequired, notes: opt(v.notes),
    }, { onError: fe.fromServer });
  };
  return (
    <FormModal title="New enquiry" sub="Creates a lead at New Lead with a first-contact follow-up for tomorrow." onClose={onClose} busy={save.isPending}
      error={save.error} fieldErrors={fe.errors} submitLabel="Create lead" formId="lead-form" size="wide">
      <form id="lead-form" onSubmit={submit} noValidate>
        <div className="formsection">
          <div className="formsection__title">Parent</div>
          <div className="form-grid">
            <TextField label="Parent name" required value={v.parentName} onChange={(x) => set('parentName', x)} error={fe.errors.parentName} maxLength={120} autoFocus />
            <TextField label="Phone" required type="tel" value={v.phone} onChange={(x) => set('phone', x)} error={fe.errors.phone} placeholder="+91 98xxx xxxxx" />
            <TextField label="Email" type="email" value={v.email} onChange={(x) => set('email', x)} error={fe.errors.email} />
            <SelectField label="Preferred campus" required value={v.campusId} onChange={(x) => set('campusId', x)} error={fe.errors.campusId} placeholder="Select…"
              options={(lookups?.campuses ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          </div>
        </div>
        <div className="formsection">
          <div className="formsection__title">Child</div>
          <div className="form-grid">
            <TextField label="Student name" required value={v.studentName} onChange={(x) => set('studentName', x)} error={fe.errors.studentName} maxLength={120} />
            <TextField label="Date of birth" type="date" value={v.studentDob} onChange={(x) => set('studentDob', x)} error={fe.errors.studentDob} />
            <SelectField label="Grade applied" required value={v.gradeApplied} onChange={(x) => set('gradeApplied', x)} error={fe.errors.gradeApplied} placeholder="Select…" options={GRADES} />
            <SelectField label="Curriculum" value={v.curriculum} onChange={(x) => set('curriculum', x)} placeholder="Not specified"
              options={['Cambridge Primary', 'Cambridge Lower Secondary', 'IGCSE', 'AS Level', 'A Level']} />
            <div className="span-2"><Checkbox checked={v.transportRequired} onChange={(x) => set('transportRequired', x)} label="School transport required" /></div>
          </div>
        </div>
        <div className="formsection">
          <div className="formsection__title">Source and ownership</div>
          <div className="form-grid">
            <SelectField label="Source" required value={v.source} onChange={(x) => set('source', x)} error={fe.errors.source} placeholder="Select…" options={[...SOURCES]} />
            <TextField label="Campaign" value={v.campaign} onChange={(x) => set('campaign', x)} maxLength={80} placeholder="e.g. Sep Admissions" />
            <SelectField label="Counsellor" value={v.counsellorId} onChange={(x) => set('counsellorId', x)} error={fe.errors.counsellorId} placeholder="Assign later"
              hint="Open-lead counts help balance the workload"
              options={(counsellors.data ?? []).map((c) => ({ value: c.id, label: `${c.fullName} · ${c.openLeads} open` }))} />
            <TextField label="Lead score" type="number" min={0} max={100} value={v.leadScore} onChange={(x) => set('leadScore', x)} error={fe.errors.leadScore} hint="0–100; 80+ is a hot lead" />
            <TextArea className="span-2" label="Notes" rows={2} value={v.notes} onChange={(x) => set('notes', x)} maxLength={1000} placeholder="What did the parent ask about?" />
          </div>
        </div>
      </form>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Stage change (with note → enquiry_stage_history)
// ---------------------------------------------------------------------------
export function StageModal({ lead, initial, onClose }: { lead: { code: string; stage: string; studentName: string }; initial?: string; onClose: () => void }) {
  const fe = useFieldErrors();
  const options = [...STAGES.filter((s) => s !== 'Enrolled' && s !== lead.stage), ...(lead.stage === 'Lost' ? [] : ['Lost'])];
  const [stage, setStage] = useState(initial && options.includes(initial) ? initial : '');
  const [note, setNote] = useState('');
  const [lostReason, setLostReason] = useState('');
  const save = useApiMutation<Record<string, unknown>>('post', `/enquiries/${lead.code}/stage`, { invalidate: INVALIDATE, error: false, onSuccess: onClose });
  const backwards = stage && stage !== 'Lost' && STAGES.indexOf(stage as never) < STAGES.indexOf(lead.stage as never);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!stage) e.stage = 'Choose the new stage';
    if (note.trim().length < 3) e.note = 'Add a short note — it is kept in the stage history';
    if (stage === 'Lost' && lostReason.trim().length < 3) e.lostReason = 'Give a reason for closing the lead';
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({ stage, note: note.trim(), lostReason: stage === 'Lost' ? lostReason.trim() : undefined }, { onError: fe.fromServer });
  };
  return (
    <FormModal title={`Change stage — ${lead.studentName}`} sub={`${lead.code} · currently ${lead.stage}`} onClose={onClose} busy={save.isPending}
      error={save.error} fieldErrors={fe.errors} submitLabel={stage === 'Lost' ? 'Close lead' : 'Move lead'} danger={stage === 'Lost'} formId="stage-form"
      submitIcon={stage === 'Lost' ? 'x' : 'arrowRight'}>
      <form id="stage-form" onSubmit={submit} noValidate className="col g-4">
        <SelectField label="New stage" required value={stage} onChange={(x) => { setStage(x); fe.clear('stage'); }} error={fe.errors.stage} placeholder="Select…" options={options} />
        {backwards && <p className="t-xs t-muted">Moving a lead backwards is allowed; the reason is recorded in the stage history.</p>}
        {(stage === 'Application' || stage === 'Assessment' || stage === 'Offer') && !['Application', 'Assessment', 'Offer'].includes(lead.stage) && (
          <p className="t-xs t-muted">An application with the standard document checklist is opened automatically if the lead does not have one.</p>
        )}
        {stage === 'Lost' && (
          <SelectField label="Reason" required value={lostReason} onChange={(x) => { setLostReason(x); fe.clear('lostReason'); }} error={fe.errors.lostReason} placeholder="Select…"
            options={['Fee structure above budget', 'Chose a school closer to home', 'Chose another school', 'Transport route not available', 'Postponed to next academic year', 'No response after three attempts', 'Duplicate enquiry', 'Other']} />
        )}
        <TextArea label="Note" required rows={3} value={note} onChange={(x) => { setNote(x); fe.clear('note'); }} error={fe.errors.note} maxLength={500} placeholder="What changed?" />
      </form>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------
export function FollowUpModal({ leadCode, leadName, counsellorId, type: fixedType, onClose }: {
  leadCode?: string; leadName?: string; counsellorId?: string | null; type?: string; onClose: () => void;
}) {
  const counsellors = useCounsellors();
  const fe = useFieldErrors();
  const [lead, setLead] = useState<Lead | null>(null);
  const [v, setV] = useState({ type: fixedType ?? 'Call', when: localInput(1, fixedType === 'Campus Visit' ? '10:00' : '11:00'), notes: '', assignedTo: counsellorId ?? '' });
  const code = leadCode ?? lead?.code;
  const isVisit = v.type === 'Campus Visit';
  const save = useApiMutation<{ path: string; body: Record<string, unknown> }>('post', (x) => x.path, {
    body: (x) => x.body, invalidate: INVALIDATE, success: isVisit ? 'Campus visit scheduled' : 'Follow-up scheduled', error: false, onSuccess: onClose,
  });
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!code) e.enquiryId = 'Choose a lead';
    if (!v.when) e.scheduledAt = 'Choose a date and time';
    else if (new Date(v.when).getTime() < Date.now()) e.scheduledAt = 'Choose a future date and time';
    if (!isVisit && v.notes.trim().length < 2) e.notes = 'Say what the follow-up is for';
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    const body = isVisit && !leadCode
      ? { enquiryId: lead!.id, scheduledAt: localToIso(v.when), hostId: v.assignedTo || null, notes: v.notes.trim() || undefined }
      : { type: v.type, scheduledAt: localToIso(v.when), notes: v.notes.trim() || (isVisit ? 'Campus tour and counsellor meeting' : ''), assignedTo: v.assignedTo || null };
    save.mutate({ path: isVisit && !leadCode ? '/visits' : `/enquiries/${code}/follow-ups`, body }, { onError: fe.fromServer });
  };
  return (
    <FormModal title={isVisit ? 'Schedule campus visit' : 'Schedule follow-up'} sub={leadName ? `${leadName} · ${leadCode}` : 'Visits move the lead to Visit Scheduled.'}
      onClose={onClose} busy={save.isPending} error={save.error} fieldErrors={fe.errors} submitLabel={isVisit ? 'Schedule visit' : 'Schedule'} submitIcon="calendar" formId="fu-form">
      <form id="fu-form" onSubmit={submit} noValidate className="col g-4">
        {!leadCode && (
          <LeadPicker value={lead} onChange={(l) => { setLead(l); fe.clear('enquiryId'); if (l?.counsellorId && !v.assignedTo) setV((s) => ({ ...s, assignedTo: l.counsellorId! })); }} error={fe.errors.enquiryId} />
        )}
        {!fixedType && (
          <SelectField label="Type" value={v.type} onChange={(x) => setV((s) => ({ ...s, type: x }))} options={FOLLOW_UP_TYPES.filter((t) => t !== 'Note')} />
        )}
        <div className="form-grid">
          <TextField label="When" required type="datetime-local" value={v.when} onChange={(x) => { setV((s) => ({ ...s, when: x })); fe.clear('scheduledAt'); }} error={fe.errors.scheduledAt} />
          <SelectField label={isVisit ? 'Host' : 'Assigned to'} value={v.assignedTo} onChange={(x) => setV((s) => ({ ...s, assignedTo: x }))} placeholder="Not assigned"
            error={fe.errors.assignedTo ?? fe.errors.hostId} options={(counsellors.data ?? []).map((c) => ({ value: c.id, label: c.fullName }))} />
        </div>
        <div className="row g-1 wrap" role="group" aria-label="Quick dates">
          <span className="t-xs t-muted">Quick pick:</span>
          {([['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7]] as const).map(([label, days]) => (
            <Button key={label} size="sm" variant="quiet"
              onClick={() => { setV((s) => ({ ...s, when: localInput(days, isVisit ? '10:00' : '11:00') })); fe.clear('scheduledAt'); }}>{label}</Button>
          ))}
        </div>
        <TextArea label={isVisit ? 'Notes for the host' : 'What is it for?'} required={!isVisit} rows={2} value={v.notes} maxLength={500}
          onChange={(x) => { setV((s) => ({ ...s, notes: x })); fe.clear('notes'); }} error={fe.errors.notes}
          placeholder={isVisit ? 'e.g. Parent prefers a weekend visit' : 'e.g. Share fee structure'} />
      </form>
    </FormModal>
  );
}

function LeadPicker({ value, onChange, error }: { value: Lead | null; onChange: (l: Lead | null) => void; error?: string }) {
  const { campusParam } = useSchool();
  const [q, setQ] = useState('');
  const res = useApiQuery<Lead[]>(q.length >= 2 ? '/enquiries' : null, { q, open: true, pageSize: 8, ...campusParam });
  if (value) {
    return (
      <div className="field">
        <span className="label">Lead</span>
        <div className="card card--tint adm-picked">
          <span className="t-sm"><strong>{value.studentName}</strong> · {value.grade} · {value.parentName} <span className="t-muted">({value.code}, {value.stage})</span></span>
          <Button size="sm" variant="quiet" onClick={() => onChange(null)}>Change</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="field">
      <span className="label">Lead <span className="req">*</span></span>
      <SearchInput value={q} onSearch={setQ} placeholder="Search student, parent or LD- reference" maxWidth={9999} />
      {error && <span className="hint hint--error" role="alert">{error}</span>}
      {q.length >= 2 && (
        <div className="adm-picklist" role="listbox" aria-label="Matching leads">
          {res.isLoading && <span className="t-xs t-muted">Searching…</span>}
          {res.data && !res.data.length && <span className="t-xs t-muted">No open leads match.</span>}
          {res.data?.map((l) => (
            <button key={l.id} type="button" role="option" aria-selected={false} className="btn btn--quiet" onClick={() => onChange(l)}>
              <strong>{l.studentName}</strong>&nbsp;· {l.grade} · {l.parentName} <span className="t-muted">&nbsp;{l.code} · {l.stage}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Complete / no-show / cancel an open follow-up. */
export function CloseFollowUpModal({ followUp, status, onClose }: { followUp: Pick<FollowUp, 'id' | 'type' | 'scheduledAt'>; status: 'Completed' | 'Missed' | 'Cancelled'; onClose: () => void }) {
  const fe = useFieldErrors();
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const save = useApiMutation<Record<string, unknown>>('patch', `/follow-ups/${followUp.id}`, { invalidate: INVALIDATE, error: false, onSuccess: onClose });
  const label = status === 'Completed' ? 'Mark completed' : status === 'Missed' ? (followUp.type === 'Campus Visit' ? 'Record no-show' : 'Mark missed') : 'Cancel follow-up';
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (status === 'Completed' && outcome.trim().length < 2) { fe.setErrors({ outcome: 'Record what happened' }); return; }
    save.mutate({ status, outcome: outcome.trim() || undefined, notes: notes.trim() || undefined }, { onError: fe.fromServer });
  };
  return (
    <FormModal title={label} sub={`${followUp.type} · ${new Date(followUp.scheduledAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`}
      onClose={onClose} busy={save.isPending} error={save.error} fieldErrors={fe.errors} submitLabel={label} danger={status !== 'Completed'} formId="close-fu">
      <form id="close-fu" onSubmit={submit} noValidate className="col g-4">
        <TextField label="Outcome" required={status === 'Completed'} value={outcome} maxLength={300} autoFocus
          onChange={(x) => { setOutcome(x); fe.clear('outcome'); }} error={fe.errors.outcome}
          placeholder={status === 'Completed' ? (followUp.type === 'Campus Visit' ? 'e.g. Toured labs; keen to apply' : 'e.g. Parent will decide by Friday') : 'Optional'} />
        <TextArea label="Notes" rows={2} value={notes} onChange={setNotes} maxLength={500} />
        {status === 'Completed' && followUp.type === 'Campus Visit' && <p className="t-xs t-muted">The lead moves to Visit Completed.</p>}
      </form>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Log a call / message / note
// ---------------------------------------------------------------------------
export function CommunicationModal({ leadCode, channel: initial = 'Call', onClose }: { leadCode: string; channel?: string; onClose: () => void }) {
  const fe = useFieldErrors();
  const [channel, setChannel] = useState(initial);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState('');
  const save = useApiMutation<Record<string, unknown>>('post', `/enquiries/${leadCode}/communications`, { invalidate: INVALIDATE, error: false, onSuccess: onClose });
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (subject.trim().length < 2) { fe.setErrors({ subject: 'Summarise the conversation' }); return; }
    save.mutate({ channel, subject: subject.trim(), body: body.trim() || undefined, status: status || undefined }, { onError: fe.fromServer });
  };
  return (
    <FormModal title={channel === 'Call' ? 'Log a call' : 'Log communication'} sub="Recorded in the lead's communication history. Nothing is sent from here."
      onClose={onClose} busy={save.isPending} error={save.error} fieldErrors={fe.errors} submitLabel="Save" formId="comm-form">
      <form id="comm-form" onSubmit={submit} noValidate className="col g-4">
        <div className="form-grid">
          <SelectField label="Channel" value={channel} onChange={setChannel} options={['Call', 'WhatsApp', 'Email', 'SMS', 'Note']} />
          {channel === 'Call' && <SelectField label="Outcome" value={status} onChange={setStatus} placeholder="Connected" options={[{ value: 'Completed', label: 'Connected' }, { value: 'No answer', label: 'No answer' }]} />}
        </div>
        <TextField label="Summary" required value={subject} maxLength={200} autoFocus onChange={(x) => { setSubject(x); fe.clear('subject'); }} error={fe.errors.subject}
          placeholder="e.g. Discussed transport and fee structure" />
        <TextArea label="Details" rows={3} value={body} onChange={setBody} maxLength={2000} />
      </form>
    </FormModal>
  );
}
