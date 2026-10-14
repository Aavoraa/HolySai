import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiMutation } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import { useAuth } from '@/auth/AuthContext';
import {
  Badge, Button, Card, Checkbox, DataTable, Dl, Empty, Flow, SelectField, Status, TextArea, TextField, useConfirm,
} from '@/components/ui';
import { fmt, todayKey } from '@/lib/format';
import { FormModal, useFieldErrors } from './LeadForms';
import { EMAIL_RE, PHONE_RE, localInput, localToIso } from './shared';
import type { Application, LeadProfile } from './types';

const INVALIDATE = ['/enquiries', '/admissions', '/applications', '/visits', '/follow-ups', '/referrals', '/students', '/notifications'];
const FLOW = ['Submitted', 'Under Review', 'Assessment Scheduled', 'Offer Made', 'Accepted', 'Enrolled'];

type Target = 'Submitted' | 'Under Review' | 'Assessment Scheduled' | 'Offer Made' | 'Accepted' | 'Rejected' | 'Withdrawn';

const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return new Intl.DateTimeFormat('en-CA').format(d);
};

/** Application card inside the lead profile: workflow, decision actions and enrolment. */
export function ApplicationCard({ lead }: { lead: LeadProfile }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const manage = can('admissions.manage');
  const app = lead.application;
  const [target, setTarget] = useState<Target | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const open = useApiMutation<Record<string, unknown>>('post', '/applications', { invalidate: INVALIDATE, success: 'Application opened' });

  if (!app) {
    const closed = ['Enrolled', 'Lost'].includes(lead.stage);
    return (
      <Card icon="grid" title="Application" tight>
        <Empty icon="fileText" title="No application yet"
          sub={closed ? 'This lead is closed.' : 'Opening an application requests the standard documents and moves the lead to Application.'}
          action={manage && !closed ? <Button variant="primary" icon="plus" loading={open.isPending} onClick={() => open.mutate({ enquiryId: lead.id })}>Open application</Button> : undefined} />
      </Card>
    );
  }

  const idx = FLOW.indexOf(app.status);
  const terminal = ['Enrolled', 'Rejected', 'Withdrawn'].includes(app.status);
  const docsOut = app.documents.filter((d) => d.status !== 'Verified').length;
  const actions: { label: string; to?: Target; variant?: 'primary' | 'danger' | 'ghost'; icon?: string; enrol?: boolean; disabled?: string }[] = [];
  if (app.status === 'Draft') actions.push({ label: 'Submit', to: 'Submitted', variant: 'primary' });
  if (app.status === 'Submitted') actions.push({ label: 'Start review', to: 'Under Review', variant: 'primary', icon: 'eye' });
  if (app.status === 'Under Review') {
    actions.push({ label: 'Schedule assessment', to: 'Assessment Scheduled', variant: 'primary', icon: 'calendar' });
    actions.push({ label: 'Make offer', to: 'Offer Made', icon: 'award', disabled: docsOut ? `${docsOut} document${docsOut === 1 ? '' : 's'} still to verify` : undefined });
  }
  if (app.status === 'Assessment Scheduled') {
    actions.push({ label: 'Make offer', to: 'Offer Made', variant: 'primary', icon: 'award', disabled: docsOut ? `${docsOut} document${docsOut === 1 ? '' : 's'} still to verify` : undefined });
    actions.push({ label: 'Reschedule', to: 'Assessment Scheduled', icon: 'calendar' });
  }
  if (app.status === 'Offer Made') actions.push({ label: 'Offer accepted', to: 'Accepted', variant: 'primary', icon: 'check' });
  if (app.status === 'Accepted' && can('students.create')) actions.push({ label: 'Enrol student', enrol: true, variant: 'primary', icon: 'userCheck' });
  if (['Submitted', 'Under Review', 'Assessment Scheduled', 'Offer Made'].includes(app.status)) actions.push({ label: 'Reject', to: 'Rejected', variant: 'danger' });
  if (!terminal) actions.push({ label: 'Withdraw', to: 'Withdrawn' });

  return (
    <Card icon="grid" title={`Application ${app.applicationNo}`} sub={`Opened ${fmt.date(app.createdAt)}${app.decidedBy ? ` · last decision by ${app.decidedBy}` : ''}`} tight
      actions={<Status value={app.status} />}>
      {!['Rejected', 'Withdrawn'].includes(app.status) && (
        <div className="mb-4">
          <Flow steps={FLOW.map((s, i) => ({
            label: s,
            state: i < idx || app.status === 'Enrolled' ? 'done' : i === idx ? 'active' : undefined,
            meta: s === 'Under Review' ? `${app.documents.length - docsOut}/${app.documents.length} documents` : s === 'Assessment Scheduled' && app.assessmentAt ? fmt.dateTime(app.assessmentAt)
              : s === 'Offer Made' && app.offerExpiresOn ? `Expires ${fmt.dateShort(app.offerExpiresOn)}` : s === 'Enrolled' && app.admissionNo ? app.admissionNo : undefined,
          }))} />
        </div>
      )}
      <Dl items={[
        ['Applicant', app.studentName],
        ['Date of birth', app.dateOfBirth ? fmt.date(app.dateOfBirth) : '—'],
        ['Previous school', app.previousSchool ?? '—'],
        ['Assessment', app.assessmentAt ? `${fmt.dateTime(app.assessmentAt)}${app.assessmentScore != null ? ` · score ${app.assessmentScore}` : ''}` : '—'],
        ['Offer expires', app.offerExpiresOn ? fmt.date(app.offerExpiresOn) : '—'],
      ]} />
      {manage && actions.length > 0 && (
        <div className="row g-2 wrap mt-4">
          {actions.map((a) => (
            <Button key={a.label} size="sm" variant={a.variant ?? 'ghost'} icon={a.icon} disabled={!!a.disabled} title={a.disabled}
              onClick={() => (a.enrol ? setEnrolling(true) : setTarget(a.to!))}>{a.label}</Button>
          ))}
        </div>
      )}
      {actions.some((a) => a.disabled) && manage && <p className="t-micro t-muted mt-2">Offers need every document verified first.</p>}
      {app.studentId && (
        <div className="mt-4">
          <Button icon="user" onClick={() => navigate(`/student-360/${app.studentId}`)}>Open Student 360 · {app.admissionNo}</Button>
        </div>
      )}
      {target && <StatusModal app={app} target={target} onClose={() => setTarget(null)} />}
      {enrolling && <EnrolModal lead={lead} app={app} onClose={() => setEnrolling(false)} />}
    </Card>
  );
}

export function DocumentsCard({ app }: { app: Application | null }) {
  const { can } = useAuth();
  const manage = can('admissions.manage') && !!app && !['Enrolled', 'Rejected', 'Withdrawn'].includes(app.status);
  const save = useApiMutation<{ docId: string; status: string }>('patch', (x) => `/applications/${app?.id}/documents/${x.docId}`, {
    body: (x) => ({ status: x.status }), invalidate: INVALIDATE,
  });
  if (!app) {
    return <Card icon="folder" title="Documents" tight><p className="t-sm t-muted">Birth certificate, previous report card, address proof and a photograph are requested when the application opens.</p></Card>;
  }
  return (
    <Card icon="folder" title="Documents" sub={app.documentsComplete ? 'All documents verified' : `${app.documents.filter((d) => d.status !== 'Verified').length} outstanding`} tight>
      <DataTable compact stack={false} rows={app.documents} rowKey={(d) => d.id}
        columns={[
          { key: 'name', label: 'Document' },
          { key: 'status', label: 'Status', render: (d) => <Status value={d.status} /> },
          ...(manage ? [{
            key: 'act', label: '', className: 'num', render: (d: Application['documents'][number]) => (
              <span className="adm-actions">
                {d.status !== 'Verified' && (
                  <Button size="sm" icon="check" loading={save.isPending && save.variables?.docId === d.id}
                    onClick={() => save.mutate({ docId: d.id, status: 'Verified' })}>Verify</Button>
                )}
                {d.status === 'Pending' && (
                  <Button size="sm" variant="quiet" onClick={() => save.mutate({ docId: d.id, status: 'Submitted' })}>Received</Button>
                )}
                {d.status === 'Verified' && (
                  <Button size="sm" variant="quiet" onClick={() => save.mutate({ docId: d.id, status: 'Pending' })}>Undo</Button>
                )}
              </span>
            ),
          }] : []),
        ]} />
    </Card>
  );
}

function StatusModal({ app, target, onClose }: { app: Application; target: Target; onClose: () => void }) {
  const fe = useFieldErrors();
  const [note, setNote] = useState('');
  const [assessmentAt, setAssessmentAt] = useState(app.assessmentAt ? '' : localInput(3, '09:30'));
  const [score, setScore] = useState(app.assessmentScore != null ? String(app.assessmentScore) : '');
  const [expires, setExpires] = useState(app.offerExpiresOn ?? addDays(14));
  const save = useApiMutation<Record<string, unknown>>('post', `/applications/${app.id}/status`, { invalidate: INVALIDATE, error: false, onSuccess: onClose });
  const destructive = target === 'Rejected' || target === 'Withdrawn';
  const title = {
    Submitted: 'Submit application', 'Under Review': 'Start review', 'Assessment Scheduled': 'Schedule assessment', 'Offer Made': 'Make an offer',
    Accepted: 'Record offer acceptance', Rejected: 'Reject application', Withdrawn: 'Withdraw application',
  }[target];
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (note.trim().length < 3) e.note = 'Add a short note — it is kept in the audit trail';
    if (target === 'Assessment Scheduled') {
      if (!assessmentAt) e.assessmentAt = 'Choose the assessment date and time';
      else if (new Date(assessmentAt).getTime() < Date.now()) e.assessmentAt = 'Choose a future date and time';
    }
    if (score && (Number.isNaN(Number(score)) || Number(score) < 0 || Number(score) > 100)) e.assessmentScore = 'Score is 0–100';
    if (target === 'Offer Made' && (!expires || expires < todayKey())) e.offerExpiresOn = 'Choose a date from today onwards';
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({
      status: target, note: note.trim(),
      assessmentAt: target === 'Assessment Scheduled' ? localToIso(assessmentAt) : undefined,
      assessmentScore: score ? Number(score) : undefined,
      offerExpiresOn: target === 'Offer Made' ? expires : undefined,
    }, { onError: fe.fromServer });
  };
  return (
    <FormModal title={title} sub={`${app.applicationNo} · ${app.studentName} · currently ${app.status}`} onClose={onClose} busy={save.isPending}
      error={save.error} fieldErrors={fe.errors} submitLabel={title} danger={destructive} formId="app-status" submitIcon={destructive ? 'x' : 'check'}>
      <form id="app-status" onSubmit={submit} noValidate className="col g-4">
        {destructive && <p className="t-sm">This closes the application and marks the lead as Lost. It cannot be reopened.</p>}
        {target === 'Assessment Scheduled' && (
          <TextField label="Assessment date and time" type="datetime-local" required value={assessmentAt}
            onChange={(x) => { setAssessmentAt(x); fe.clear('assessmentAt'); }} error={fe.errors.assessmentAt} />
        )}
        {target === 'Offer Made' && (
          <div className="form-grid">
            <TextField label="Assessment score" type="number" min={0} max={100} value={score} onChange={(x) => { setScore(x); fe.clear('assessmentScore'); }} error={fe.errors.assessmentScore} />
            <TextField label="Offer valid until" type="date" required min={todayKey()} value={expires} onChange={(x) => { setExpires(x); fe.clear('offerExpiresOn'); }} error={fe.errors.offerExpiresOn} />
          </div>
        )}
        <TextArea label={destructive ? 'Reason' : 'Note'} required rows={3} value={note} maxLength={500}
          onChange={(x) => { setNote(x); fe.clear('note'); }} error={fe.errors.note} />
      </form>
    </FormModal>
  );
}

/** Enrol an accepted applicant → Student Master record (student, enrolment, guardian, tracking profile). */
function EnrolModal({ lead, app, onClose }: { lead: LeadProfile; app: Application; onClose: () => void }) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { lookups, sectionOptions } = useLookups();
  const fe = useFieldErrors();
  const [first, ...rest] = (app.studentName || lead.studentName).split(' ');
  const cls = useMemo(
    () => lookups?.classes.find((c) => c.campusId === app.campusId && c.name === app.grade),
    [lookups, app.campusId, app.grade],
  );
  const routes = (lookups?.routes ?? []).filter((r) => r.campusId === app.campusId);
  const [v, setV] = useState({
    firstName: first ?? '', lastName: rest.join(' '), dateOfBirth: app.dateOfBirth ?? lead.studentDob ?? '', gender: app.gender ?? '',
    sectionId: '', admittedOn: todayKey(), address: '', city: '', pincode: '',
    guardianName: lead.parentName, guardianPhone: lead.phone, guardianEmail: lead.email ?? '', relationship: 'Father',
    useTransport: lead.transportRequired && routes.length > 0, routeId: '', stopId: '',
  });
  const set = (k: keyof typeof v, val: string | boolean) => { setV((s) => ({ ...s, [k]: val })); fe.clear(k); };
  const stops = routes.find((r) => r.id === v.routeId)?.stops ?? [];
  const save = useApiMutation<Record<string, unknown>, { studentId: string; admissionNo: string; section: string }>('post', `/applications/${app.id}/enrol`, {
    invalidate: INVALIDATE, error: false,
    onSuccess: (r) => {
      onClose();
      navigate(`/student-360/${r.data.studentId}`);
    },
  });
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!v.firstName.trim()) e.firstName = 'First name is required';
    if (!v.lastName.trim()) e.lastName = 'Last name is required';
    if (!v.dateOfBirth) e.dateOfBirth = 'Date of birth is required';
    else if (v.dateOfBirth >= todayKey()) e.dateOfBirth = 'Date of birth must be in the past';
    if (!v.gender) e.gender = 'Select a gender';
    if (!v.sectionId) e.sectionId = 'Choose a section';
    if (v.pincode && !/^[0-9]{6}$/.test(v.pincode)) e.pincode = 'PIN code must be 6 digits';
    if (v.guardianName.trim().length < 2) e['guardian.fullName'] = 'Enter the guardian’s name';
    if (!PHONE_RE.test(v.guardianPhone.trim())) e['guardian.phone'] = 'Enter a valid phone number';
    if (v.guardianEmail && !EMAIL_RE.test(v.guardianEmail)) e['guardian.email'] = 'Enter a valid email';
    if (v.useTransport && !v.routeId) e['transport.routeId'] = 'Choose a route or untick transport';
    if (v.useTransport && v.routeId && !v.stopId) e['transport.stopId'] = 'Choose the pickup stop';
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    const section = sectionOptions(cls?.id).find((s) => s.value === v.sectionId)?.label;
    const ok = await confirm({
      title: 'Enrol and create the Student Master record?',
      body: `${v.firstName} ${v.lastName} will be admitted to ${app.grade}${section ? ` ${section}` : ''}. An admission number is issued, the guardian is linked, and the lead is closed as Enrolled.`,
      confirmLabel: 'Enrol student', icon: 'userCheck',
    });
    if (!ok) return;
    const opt = (s: string) => s.trim() || undefined;
    save.mutate({
      sectionId: v.sectionId, firstName: v.firstName.trim(), lastName: v.lastName.trim(), dateOfBirth: v.dateOfBirth, gender: v.gender,
      admittedOn: opt(v.admittedOn), address: opt(v.address), city: opt(v.city), pincode: opt(v.pincode),
      guardian: { fullName: v.guardianName.trim(), phone: v.guardianPhone.trim(), email: opt(v.guardianEmail), relationship: v.relationship },
      transport: v.useTransport && v.routeId ? { routeId: v.routeId, stopId: v.stopId || undefined } : undefined,
    }, { onError: fe.fromServer });
  };
  return (
    <FormModal title="Enrol student" sub={`${app.applicationNo} · ${app.grade} · creates the Student Master record`} size="wide"
      onClose={onClose} busy={save.isPending} error={save.error} fieldErrors={fe.errors} submitLabel="Enrol" submitIcon="userCheck" formId="enrol-form">
      <form id="enrol-form" onSubmit={submit} noValidate>
        <div className="formsection">
          <div className="formsection__title">Student</div>
          <div className="form-grid">
            <TextField label="First name" required value={v.firstName} onChange={(x) => set('firstName', x)} error={fe.errors.firstName} maxLength={60} autoFocus />
            <TextField label="Last name" required value={v.lastName} onChange={(x) => set('lastName', x)} error={fe.errors.lastName} maxLength={60} />
            <TextField label="Date of birth" type="date" required max={todayKey()} value={v.dateOfBirth} onChange={(x) => set('dateOfBirth', x)} error={fe.errors.dateOfBirth} />
            <SelectField label="Gender" required value={v.gender} onChange={(x) => set('gender', x)} error={fe.errors.gender} placeholder="Select…"
              options={[{ value: 'F', label: 'Female' }, { value: 'M', label: 'Male' }, { value: 'O', label: 'Other' }]} />
          </div>
        </div>
        <div className="formsection">
          <div className="formsection__title">Placement</div>
          <p className="formsection__sub">{`${lead.campusName} · ${app.grade}`}</p>
          <div className="form-grid">
            <SelectField label="Section" required value={v.sectionId} onChange={(x) => set('sectionId', x)} error={fe.errors.sectionId}
              placeholder={cls ? 'Select…' : 'No class for this grade on the campus'} disabled={!cls} options={sectionOptions(cls?.id)} />
            <TextField label="Admitted on" type="date" max={todayKey()} value={v.admittedOn} onChange={(x) => set('admittedOn', x)} />
            <TextField className="span-2" label="Address" value={v.address} onChange={(x) => set('address', x)} maxLength={300} />
            <TextField label="City" value={v.city} onChange={(x) => set('city', x)} maxLength={60} />
            <TextField label="PIN code" value={v.pincode} onChange={(x) => set('pincode', x)} error={fe.errors.pincode} maxLength={6} />
          </div>
        </div>
        <div className="formsection">
          <div className="formsection__title">Primary guardian</div>
          <p className="formsection__sub">An existing parent with the same phone number is linked instead of creating a duplicate.</p>
          <div className="form-grid">
            <TextField label="Full name" required value={v.guardianName} onChange={(x) => set('guardianName', x)} error={fe.errors['guardian.fullName']} maxLength={120} />
            <SelectField label="Relationship" value={v.relationship} onChange={(x) => set('relationship', x)} options={['Father', 'Mother', 'Guardian']} />
            <TextField label="Mobile" required type="tel" value={v.guardianPhone} onChange={(x) => set('guardianPhone', x)} error={fe.errors['guardian.phone']} />
            <TextField label="Email" type="email" value={v.guardianEmail} onChange={(x) => set('guardianEmail', x)} error={fe.errors['guardian.email']} />
          </div>
        </div>
        <div className="formsection">
          <div className="formsection__title">Transport</div>
          <p className="formsection__sub">GPS tracking starts disabled; it is enabled when the ID tag is issued with the guardian's consent.</p>
          <div className="col g-3">
            <Checkbox checked={v.useTransport} onChange={(x) => set('useTransport', x)} label={`School transport${lead.transportRequired ? ' (requested on the enquiry)' : ''}`} disabled={!routes.length} />
            {v.useTransport && (
              <div className="form-grid">
                <SelectField label="Bus route" required value={v.routeId} onChange={(x) => { set('routeId', x); set('stopId', ''); }} error={fe.errors['transport.routeId']} placeholder="Select…"
                  options={routes.map((r) => ({ value: r.id, label: `${r.name} · ${r.area}` }))} />
                <SelectField label="Pickup stop" required value={v.stopId} onChange={(x) => set('stopId', x)} error={fe.errors['transport.stopId']} placeholder="Select…" disabled={!v.routeId}
                  options={stops.map((s) => ({ value: s.id, label: s.name }))} />
              </div>
            )}
          </div>
        </div>
        {!app.feePaid && <p className="t-xs t-muted mt-4"><Badge tone="warning">Fee not marked paid</Badge> Enrolment can still proceed.</p>}
      </form>
    </FormModal>
  );
}
