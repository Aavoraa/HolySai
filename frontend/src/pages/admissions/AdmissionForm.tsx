/**
 * Admission forms — the filled form behind an application.
 *
 * A lead comes in → the family fills the school's admission form (paper or
 * PDF) → the office types it in (manual), uploads the filled / scanned form,
 * or both. Also: a bulk CSV import of many filled forms.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { api, ApiError } from '@/api/client';
import { useApiMutation, useApiQuery, useInvalidate, usePagedQuery } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import { useSchool } from '@/layouts/SchoolContext';
import { useAuth } from '@/auth/AuthContext';
import {
  Badge, Banner, Button, Card, Checkbox, DataTable, Dl, Empty, ErrorState, Icon, InlineError, Meter, Modal, SearchInput, SelectField, Skeleton,
  Tabs, TextArea, TextField, errorMessage, useToast,
} from '@/components/ui';
import { cx, fmt, todayKey } from '@/lib/format';
import { EMAIL_RE, PHONE_RE } from './shared';
import { GRADES, SOURCES, type AdmissionFormData, type Application, type FormStatus, type Lead } from './types';

const INVALIDATE = ['/enquiries', '/admissions', '/applications', '/visits', '/follow-ups', '/referrals', '/students'];
const CLOSED = ['Enrolled', 'Rejected', 'Withdrawn'];
const MAX_MB = 10;
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp';
const FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

// ---------------------------------------------------------------------------
// Form definition — mirrors the school's printed admission form
// ---------------------------------------------------------------------------
type FieldType = 'text' | 'date' | 'tel' | 'email' | 'select' | 'textarea' | 'bool';
interface FieldDef { key: string; label: string; type?: FieldType; options?: (string | { value: string; label: string })[]; required?: boolean; span?: boolean; max?: number; hint?: string }
type SectionId = 'student' | 'parents' | 'address' | 'previous' | 'health' | 'declaration';

const SECTIONS: { id: SectionId; label: string; sub?: string; fields: FieldDef[] }[] = [
  {
    id: 'student', label: 'Student', sub: 'As on the birth certificate.', fields: [
      { key: 'studentFirstName', label: 'First name', required: true, max: 60 },
      { key: 'studentLastName', label: 'Last name', required: true, max: 60 },
      { key: 'dateOfBirth', label: 'Date of birth', type: 'date', required: true },
      { key: 'gender', label: 'Gender', type: 'select', required: true, options: [{ value: 'F', label: 'Female' }, { value: 'M', label: 'Male' }, { value: 'O', label: 'Other' }] },
      { key: 'gradeApplied', label: 'Grade applied for', type: 'select', options: GRADES },
      { key: 'placeOfBirth', label: 'Place of birth', max: 80 },
      { key: 'nationality', label: 'Nationality', max: 60 },
      { key: 'religion', label: 'Religion', max: 60 },
      { key: 'motherTongue', label: 'Mother tongue', max: 60 },
      { key: 'bloodGroup', label: 'Blood group', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
    ],
  },
  {
    id: 'parents', label: 'Parents / guardian', sub: 'The primary contact receives school communication and becomes the primary guardian on enrolment.', fields: [
      { key: 'primaryContact', label: 'Primary contact', type: 'select', required: true, options: ['Father', 'Mother', 'Guardian'], span: true },
      { key: 'fatherName', label: 'Father’s name', max: 120 },
      { key: 'fatherOccupation', label: 'Father’s occupation', max: 120 },
      { key: 'fatherPhone', label: 'Father’s mobile', type: 'tel' },
      { key: 'fatherEmail', label: 'Father’s email', type: 'email' },
      { key: 'motherName', label: 'Mother’s name', max: 120 },
      { key: 'motherOccupation', label: 'Mother’s occupation', max: 120 },
      { key: 'motherPhone', label: 'Mother’s mobile', type: 'tel' },
      { key: 'motherEmail', label: 'Mother’s email', type: 'email' },
      { key: 'guardianName', label: 'Guardian’s name', max: 120, hint: 'Only if the child lives with a guardian' },
      { key: 'guardianRelationship', label: 'Relationship to the child', max: 60 },
      { key: 'guardianPhone', label: 'Guardian’s mobile', type: 'tel' },
      { key: 'guardianEmail', label: 'Guardian’s email', type: 'email' },
    ],
  },
  {
    id: 'address', label: 'Address & contact', fields: [
      { key: 'address', label: 'Residential address', required: true, span: true, max: 300 },
      { key: 'city', label: 'City', required: true, max: 60 },
      { key: 'state', label: 'State', max: 60 },
      { key: 'pincode', label: 'PIN code', max: 6 },
      { key: 'emergencyContactName', label: 'Emergency contact name', max: 120 },
      { key: 'emergencyContactPhone', label: 'Emergency contact mobile', type: 'tel' },
    ],
  },
  {
    id: 'previous', label: 'Previous schooling', sub: 'Leave blank for children starting school.', fields: [
      { key: 'previousSchool', label: 'Previous school', span: true, max: 160 },
      { key: 'previousBoard', label: 'Board / curriculum', max: 60 },
      { key: 'previousGrade', label: 'Last grade attended', max: 30 },
      { key: 'reasonForLeaving', label: 'Reason for leaving', type: 'textarea', span: true, max: 300 },
    ],
  },
  {
    id: 'health', label: 'Health & other', fields: [
      { key: 'medicalNotes', label: 'Medical conditions', type: 'textarea', span: true, max: 500 },
      { key: 'allergies', label: 'Allergies', max: 300 },
      { key: 'specialNeeds', label: 'Special educational needs', max: 300 },
      { key: 'siblingsInSchool', label: 'Sibling already studies at Holy Sai', type: 'bool' },
      { key: 'siblingDetails', label: 'Sibling name and grade', max: 300 },
      { key: 'transportRequired', label: 'School transport required', type: 'bool' },
    ],
  },
  {
    id: 'declaration', label: 'Declaration', sub: 'The parent’s signed declaration on the last page of the form.', fields: [
      { key: 'declarationSignedBy', label: 'Signed by', required: true, max: 120 },
      { key: 'declarationDate', label: 'Date signed', type: 'date' },
    ],
  },
];
const FIELD_SECTION: Record<string, SectionId> = Object.fromEntries(SECTIONS.flatMap((s) => s.fields.map((f) => [f.key, s.id])));
const CONTACT: Record<string, [string, string]> = { Father: ['fatherName', 'fatherPhone'], Mother: ['motherName', 'motherPhone'], Guardian: ['guardianName', 'guardianPhone'] };

const has = (x: unknown) => x !== undefined && x !== null && x !== '';

/** Same rules as the API: required fields + the primary contact's name and phone. */
export function formCompleteness(form: AdmissionFormData) {
  const missing: Record<string, string> = {};
  for (const s of SECTIONS) for (const f of s.fields) if (f.required && !has(form[f.key])) missing[f.key] = `${f.label} is required`;
  const pc = form.primaryContact as string | undefined;
  if (pc && CONTACT[pc]) {
    const [n, p] = CONTACT[pc];
    if (!has(form[n])) missing[n] = `Enter the ${pc.toLowerCase()}’s name (primary contact)`;
    if (!has(form[p])) missing[p] = `Enter the ${pc.toLowerCase()}’s mobile (primary contact)`;
  }
  const total = SECTIONS.reduce((n, s) => n + s.fields.filter((f) => f.required).length, 0) + 2;
  const missingCount = Object.keys(missing).length + (pc ? 0 : 2);
  return { missing, percent: Math.round(((total - missingCount) / total) * 100) };
}

/** Format checks that apply to drafts too. */
function formatErrors(form: AdmissionFormData, receivedOn: string) {
  const e: Record<string, string> = {};
  const today = todayKey();
  for (const s of SECTIONS) {
    for (const f of s.fields) {
      const val = form[f.key];
      if (!has(val) || typeof val !== 'string') continue;
      if (f.type === 'tel' && !PHONE_RE.test(val.trim())) e[f.key] = 'Enter a valid phone number';
      if (f.type === 'email' && !EMAIL_RE.test(val.trim())) e[f.key] = 'Enter a valid email';
      if (f.type === 'date' && val > today) e[f.key] = 'Date cannot be in the future';
    }
  }
  if (has(form.pincode) && !/^[0-9]{6}$/.test(String(form.pincode))) e.pincode = 'PIN code must be 6 digits';
  if (receivedOn && receivedOn > today) e.receivedOn = 'Date cannot be in the future';
  return e;
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
const STATUS_TONE: Record<FormStatus, string> = { 'Not received': 'warning', 'Entered manually': 'info', Uploaded: 'info', Both: 'success' };
const STATUS_ICON: Record<FormStatus, string> = { 'Not received': 'alertCircle', 'Entered manually': 'edit', Uploaded: 'upload', Both: 'checkSquare' };

export function FormStatusBadge({ status, complete }: { status: FormStatus; complete?: boolean }) {
  const label = status === 'Entered manually' && complete === false ? 'Draft form' : status;
  return <Badge tone={status === 'Entered manually' && complete === false ? 'warning' : STATUS_TONE[status]} icon={STATUS_ICON[status]}>{label}</Badge>;
}

export const FORM_FILTER_OPTIONS = [
  { value: 'none', label: 'Not received' }, { value: 'manual', label: 'Entered manually' }, { value: 'upload', label: 'Uploaded' },
  { value: 'both', label: 'Entered + uploaded' }, { value: 'received', label: 'Any form received' },
];

const bytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function checkFile(f: File) {
  if (!FILE_TYPES.includes(f.type)) return 'Choose a PDF, JPG, PNG or WebP file';
  if (f.size > MAX_MB * 1024 * 1024) return `Files must be ${MAX_MB} MB or smaller`;
  return null;
}

/** Drag-and-drop or pick a PDF / photo of the filled form. */
export function FileDrop({ file, onFile, error, label = 'Drop the filled form here, or choose a file', disabled }: {
  file: File | null; onFile: (f: File | null, error?: string) => void; error?: string; label?: string; disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (f: File | undefined | null) => {
    if (!f) return;
    const err = checkFile(f);
    onFile(err ? null : f, err ?? undefined);
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer.files?.[0]); };
  return (
    <div className="field">
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        style={{
          border: `1.5px dashed ${error ? 'var(--critical)' : over ? 'var(--brand)' : 'var(--border-soft)'}`, borderRadius: 12,
          padding: 'var(--s-4)', background: over ? 'var(--surface-alt)' : undefined, textAlign: 'center',
        }}>
        <Icon name={file ? 'fileText' : 'upload'} size={22} />
        <div className="t-sm mt-2">{file ? <><strong>{file.name}</strong> · {bytes(file.size)}</> : label}</div>
        <div className="t-micro t-muted">PDF, JPG, PNG or WebP · up to {MAX_MB} MB · scans and phone photos are fine</div>
        <div className="row g-2 mt-3" style={{ justifyContent: 'center' }}>
          <Button size="sm" icon="folder" disabled={disabled} onClick={() => ref.current?.click()}>{file ? 'Choose another file' : 'Choose file'}</Button>
          {file && <Button size="sm" variant="quiet" icon="x" disabled={disabled} onClick={() => onFile(null)}>Remove</Button>}
        </div>
        <input ref={ref} type="file" accept={ACCEPT} hidden aria-label="Admission form file" onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {error && <span className="field__error" role="alert">{error}</span>}
    </div>
  );
}

/** Uploads a file to an admissions endpoint with toasts and cache refresh. */
export function useFileUpload() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState<string | null>(null);
  const upload = async (key: string, path: string, file: File, fields: Record<string, string> = {}, success = 'Uploaded') => {
    const form = new FormData();
    form.append('file', file);
    for (const [k, x] of Object.entries(fields)) if (x) form.append(k, x);
    setBusy(key);
    try {
      const r = await api.upload(path, form, 120_000);
      toast(r.message || success, 'success');
      await invalidate(...INVALIDATE);
      return true;
    } catch (e) {
      toast(errorMessage(e), 'critical');
      return false;
    } finally { setBusy(null); }
  };
  return { upload, busy };
}

/** Opens a protected file (PDF / image) in a new tab; the API audits the read. */
export async function viewFile(path: string, onError: (e: unknown) => void) {
  const w = window.open('', '_blank');
  try {
    const blob = await api.blob(path);
    const url = URL.createObjectURL(blob);
    if (w) w.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    w?.close();
    onError(e);
  }
}

// ---------------------------------------------------------------------------
// Admission form card (inside the lead profile)
// ---------------------------------------------------------------------------
interface FormResponse {
  id: string; applicationNo: string; status: string; formSource: string | null; receivedOn: string | null; form: AdmissionFormData;
  enteredAt: string | null; enteredBy: string | null; completedAt: string | null; formStatus: FormStatus;
  completeness: { filled: number; total: number; percent: number; missing: { field: string; message: string }[] };
  file: { id: string; name: string; mimeType: string; sizeBytes: number; uploadedAt: string; uploadedBy: string | null } | null;
}

export function AdmissionFormCard({ app }: { app: Application }) {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can('admissions.manage') && !CLOSED.includes(app.status);
  const canFiles = can('documents.read');
  const q = useApiQuery<FormResponse>(`/applications/${app.id}/form`);
  const [editing, setEditing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileErr, setFileErr] = useState<string>();
  const { upload, busy } = useFileUpload();
  const d = q.data;
  const c = useMemo(() => formCompleteness(app.formData ?? {}), [app.formData]);
  const typed = !!d?.enteredAt;
  const send = async () => {
    if (!file) return;
    if (await upload('form', `/applications/${app.id}/form/upload`, file, {}, 'Admission form uploaded')) { setFile(null); q.refetch(); }
  };
  const f = app.formData ?? {};
  const contact = f.primaryContact as string | undefined;

  return (
    <Card icon="clipboard" title="Admission form" tight
      sub={d ? (d.receivedOn ? `Received ${fmt.date(d.receivedOn)}${d.formSource ? ` · ${d.formSource === 'Upload' ? 'paper form uploaded' : d.formSource === 'Manual' ? 'entered by the office' : 'online'}` : ''}` : 'Not received yet') : undefined}
      actions={d ? <FormStatusBadge status={d.formStatus} complete={!!d.completedAt} /> : undefined}>
      {q.isLoading ? <Skeleton height={120} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : d && (
        <div className="col g-4">
          {/* Typed form */}
          <div>
            <Meter label={typed ? (d.completedAt ? 'Form complete' : 'Draft — required fields filled') : 'Typed form — not entered yet'} value={typed ? c.percent : 0}
              tone={c.percent === 100 ? 'teal' : undefined}
              hint={typed && !d.completedAt && Object.keys(c.missing).length ? `${Object.keys(c.missing).length} required field${Object.keys(c.missing).length === 1 ? '' : 's'} still empty` : undefined} />
            {typed && (
              <div className="mt-3">
                <Dl items={[
                  ['Student', [f.studentFirstName, f.studentLastName].filter(Boolean).join(' ') || '—'],
                  ['Date of birth', f.dateOfBirth ? fmt.date(String(f.dateOfBirth)) : '—'],
                  ['Father', [f.fatherName, f.fatherPhone].filter(Boolean).join(' · ') || '—'],
                  ['Mother', [f.motherName, f.motherPhone].filter(Boolean).join(' · ') || '—'],
                  ['Primary contact', contact ?? '—'],
                  ['Address', [f.address, f.city, f.pincode].filter(Boolean).join(', ') || '—'],
                  ['Entered by', d.enteredBy ? `${d.enteredBy} · ${fmt.relative(d.enteredAt!)}` : '—'],
                ]} />
              </div>
            )}
            <div className="row g-2 wrap mt-3">
              {manage && <Button size="sm" variant={typed ? undefined : 'primary'} icon="edit" onClick={() => setEditing(true)}>{typed ? (d.completedAt ? 'Edit form' : 'Continue form') : 'Enter form manually'}</Button>}
              {!manage && typed && <Button size="sm" icon="eye" onClick={() => setEditing(true)}>View form</Button>}
            </div>
          </div>
          {/* Uploaded scan */}
          <div>
            <div className="t-sm t-bold mb-2">Uploaded form</div>
            {d.file ? (
              <div className="row g-3 wrap" style={{ alignItems: 'center' }}>
                <Icon name="fileText" size={20} />
                <span className="grow">
                  <span className="t-sm t-semi">{d.file.name}</span>
                  <span className="t-micro t-muted" style={{ display: 'block' }}>{bytes(d.file.sizeBytes)} · uploaded {fmt.relative(d.file.uploadedAt)}{d.file.uploadedBy ? ` by ${d.file.uploadedBy}` : ''}</span>
                </span>
                {canFiles && (
                  <>
                    <Button size="sm" icon="eye" onClick={() => viewFile(`/applications/${app.id}/documents/${d.file!.id}/download`, (e) => toast(errorMessage(e), 'critical'))}>View</Button>
                    <Button size="sm" variant="quiet" icon="download" onClick={() => api.download(`/applications/${app.id}/documents/${d.file!.id}/download`, d.file!.name).catch((e) => toast(errorMessage(e), 'critical'))}>Download</Button>
                  </>
                )}
              </div>
            ) : !manage ? <p className="t-sm t-muted">No scan of the filled form has been uploaded.</p> : null}
            {manage && (
              <div className={cx(d.file && 'mt-3')}>
                {d.file && !file && <p className="t-micro t-muted mb-2">Replacing keeps the earlier scan in the audit trail.</p>}
                <FileDrop file={file} error={fileErr} disabled={busy === 'form'} label={d.file ? 'Drop a new scan here to replace it' : undefined}
                  onFile={(x, err) => { setFile(x); setFileErr(err); }} />
                {file && (
                  <div className="row end mt-2">
                    <Button size="sm" variant="primary" icon="upload" loading={busy === 'form'} onClick={send}>{d.file ? 'Replace uploaded form' : 'Upload form'}</Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {editing && <AdmissionFormModal app={app} readOnly={!manage} onClose={() => { setEditing(false); q.refetch(); }} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The form itself — tabbed like the printed form
// ---------------------------------------------------------------------------
export function AdmissionFormModal({ app, readOnly, onClose, prefill }: {
  app: Pick<Application, 'id' | 'applicationNo' | 'studentName' | 'grade' | 'dateOfBirth' | 'gender' | 'previousSchool' | 'status'>;
  readOnly?: boolean; onClose: () => void; prefill?: AdmissionFormData;
}) {
  const q = useApiQuery<FormResponse>(`/applications/${app.id}/form`);
  const [tab, setTab] = useState<SectionId>('student');
  const [v, setV] = useState<AdmissionFormData | null>(null);
  const [receivedOn, setReceivedOn] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useApiMutation<{ form: AdmissionFormData; receivedOn?: string; submit: boolean }, { status: string }>('put', `/applications/${app.id}/form`, {
    invalidate: INVALIDATE, error: false,
  });

  // Initialise once from the saved form (or from the application / lead for a new form).
  useEffect(() => {
    if (!q.data || v) return;
    const saved = q.data.form ?? {};
    const [first, ...rest] = (app.studentName ?? '').split(' ');
    const base: AdmissionFormData = Object.keys(saved).length ? saved : {
      studentFirstName: first, studentLastName: rest.join(' '), dateOfBirth: app.dateOfBirth ?? undefined, gender: app.gender ?? undefined,
      gradeApplied: app.grade, previousSchool: app.previousSchool ?? undefined, nationality: 'Indian', ...prefill,
    };
    setV(base);
    setReceivedOn(q.data.receivedOn ?? todayKey());
  }, [q.data, v, app, prefill]);

  const form = v ?? {};
  const completed = !!q.data?.completedAt;
  const comp = formCompleteness(form);
  const missingBySection = (id: SectionId) => Object.keys(comp.missing).filter((k) => FIELD_SECTION[k] === id).length;
  const set = (k: string, x: string | boolean) => { setV((s) => ({ ...(s ?? {}), [k]: x })); setErrors((e) => (e[k] ? { ...e, [k]: '' } : e)); };

  const submit = (final: boolean) => {
    const fmtErr = formatErrors(form, receivedOn);
    const e = final || completed ? { ...comp.missing, ...fmtErr } : fmtErr;
    setErrors(e);
    const firstBad = Object.keys(e).find((k) => e[k]);
    if (firstBad) {
      if (FIELD_SECTION[firstBad]) setTab(FIELD_SECTION[firstBad]);
      return;
    }
    const clean = Object.fromEntries(Object.entries(form).filter(([, x]) => x !== '' && x !== undefined).map(([k, x]) => [k, typeof x === 'string' ? x.trim() : x]));
    save.mutate({ form: clean, receivedOn: receivedOn || undefined, submit: final }, {
      onSuccess: () => onClose(),
      onError: (err) => {
        if (err instanceof ApiError) {
          const fe = Object.fromEntries(Object.entries(err.fieldErrors).map(([k, m]) => [k.replace(/^form\./, ''), m]));
          setErrors(fe);
          const k = Object.keys(fe).find((x) => FIELD_SECTION[x]);
          if (k) setTab(FIELD_SECTION[k]);
        }
      },
    });
  };

  const section = SECTIONS.find((s) => s.id === tab)!;
  const field = (f: FieldDef): ReactNode => {
    const val = form[f.key];
    const common = { label: f.label, required: !!(f.required || (form.primaryContact && CONTACT[String(form.primaryContact)]?.includes(f.key))), error: errors[f.key], className: f.span ? 'span-2' : undefined, hint: f.hint };
    if (f.type === 'bool') return <div key={f.key} className={f.span ? 'span-2' : undefined} style={{ alignSelf: 'end' }}><Checkbox checked={val === true} disabled={readOnly} onChange={(x) => set(f.key, x)} label={f.label} /></div>;
    if (f.type === 'select') return <SelectField key={f.key} {...common} value={(val as string) ?? ''} disabled={readOnly} placeholder="Select…" options={f.options ?? []} onChange={(x) => set(f.key, x)} />;
    if (f.type === 'textarea') return <TextArea key={f.key} {...common} rows={2} disabled={readOnly} value={(val as string) ?? ''} maxLength={f.max} onChange={(x) => set(f.key, x)} />;
    return <TextField key={f.key} {...common} type={f.type ?? 'text'} value={(val as string) ?? ''} maxLength={f.max} disabled={readOnly}
      max={f.type === 'date' ? todayKey() : undefined} onChange={(x) => set(f.key, x)} />;
  };

  return (
    <Modal open onClose={onClose} size="wide" busy={save.isPending}
      title={`Admission form · ${app.applicationNo}`}
      sub={readOnly ? 'Read only' : completed ? 'Submitted form — required fields must stay filled' : 'Type in the family’s filled form. Save a draft any time; submit once every required field is in.'}
      foot={readOnly ? <Button onClick={onClose}>Close</Button> : (
        <>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          {!completed && <Button icon="save" loading={save.isPending && !save.variables?.submit} disabled={save.isPending} onClick={() => submit(false)}>Save draft</Button>}
          <Button variant="primary" icon="check" loading={save.isPending && (completed || !!save.variables?.submit)} disabled={save.isPending}
            onClick={() => submit(!completed)}>{completed ? 'Save changes' : 'Submit form'}</Button>
        </>
      )}>
      {q.isLoading || !v ? (q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <Skeleton height={320} />) : (
        <div className="col g-4">
          {save.error && !(save.error instanceof ApiError && Object.keys(save.error.fieldErrors).length) ? <InlineError error={save.error} /> : null}
          <Meter label={`Required fields · ${app.studentName}`} value={comp.percent} tone={comp.percent === 100 ? 'teal' : undefined}
            hint={comp.percent < 100 ? 'Tabs with a number still have required fields to fill.' : 'Every required field is filled.'} />
          <Tabs pills items={SECTIONS.map((s) => ({ id: s.id, label: s.label, count: missingBySection(s.id) || undefined }))} active={tab} onChange={setTab} />
          <div className="formsection" style={{ marginTop: 0 }}>
            {section.sub && <p className="formsection__sub">{section.sub}</p>}
            <div className="form-grid">
              {section.fields.map(field)}
              {tab === 'declaration' && (
                <TextField label="Form received at the office on" type="date" value={receivedOn} max={todayKey()} disabled={readOnly}
                  error={errors.receivedOn} onChange={(x) => { setReceivedOn(x); setErrors((e) => ({ ...e, receivedOn: '' })); }} />
              )}
            </div>
          </div>
          <div className="row g-2" style={{ justifyContent: 'space-between' }}>
            <Button size="sm" variant="quiet" icon="chevronLeft" disabled={tab === SECTIONS[0].id}
              onClick={() => setTab(SECTIONS[Math.max(0, SECTIONS.findIndex((s) => s.id === tab) - 1)].id)}>Previous</Button>
            <Button size="sm" variant="quiet" iconRight="chevronRight" disabled={tab === SECTIONS[SECTIONS.length - 1].id}
              onClick={() => setTab(SECTIONS[Math.min(SECTIONS.length - 1, SECTIONS.findIndex((s) => s.id === tab) + 1)].id)}>Next</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// New application — pick a lead or a walk-in family, then enter / upload the form
// ---------------------------------------------------------------------------
type How = 'manual' | 'upload' | 'both';
interface Created { id: string; applicationNo: string; leadCode: string; status: string }

export function NewApplicationModal({ lead: presetLead, onClose, onDone }: {
  lead?: Pick<Lead, 'id' | 'code' | 'studentName' | 'parentName' | 'grade' | 'stage' | 'studentDob' | 'applicationId' | 'applicationNo' | 'applicationStatus' | 'campusName'>;
  onClose: () => void; onDone: (leadCode: string) => void;
}) {
  const school = useSchool();
  const { lookups } = useLookups();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [who, setWho] = useState<'lead' | 'walkin'>('lead');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(presetLead ?? null);
  const [w, setW] = useState({ campusId: school.campusId ?? '', parentName: '', phone: '', email: '', studentName: '', gradeApplied: '', source: 'Walk-in' });
  const [how, setHow] = useState<How>('manual');
  const [file, setFile] = useState<File | null>(null);
  const [receivedOn, setReceivedOn] = useState(todayKey());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [formFor, setFormFor] = useState<(Created & { prefill: AdmissionFormData; studentName: string; grade: string }) | null>(null);
  const search = usePagedQuery<Lead>(!presetLead && who === 'lead' && q.trim().length >= 2 ? '/enquiries' : null, { q, open: true, pageSize: 8, ...school.campusParam });
  const existing = picked?.applicationId && !['Rejected', 'Withdrawn'].includes(picked.applicationStatus ?? '') ? picked : null;

  const setWalk = (k: keyof typeof w, x: string) => { setW((s) => ({ ...s, [k]: x })); setErrors((e) => ({ ...e, [`walkIn.${k}`]: '' })); };

  const go = async () => {
    const e: Record<string, string> = {};
    if (who === 'lead' && !picked) e.lead = 'Search for the lead and choose it';
    if (who === 'walkin') {
      if (!w.campusId) e['walkIn.campusId'] = 'Choose a campus';
      if (w.studentName.trim().length < 2) e['walkIn.studentName'] = 'Enter the child’s name';
      if (!w.gradeApplied) e['walkIn.gradeApplied'] = 'Choose a grade';
      if (w.parentName.trim().length < 2) e['walkIn.parentName'] = 'Enter the parent’s name';
      if (!PHONE_RE.test(w.phone.trim())) e['walkIn.phone'] = 'Enter a valid phone number';
      if (w.email && !EMAIL_RE.test(w.email.trim())) e['walkIn.email'] = 'Enter a valid email';
    }
    if (how !== 'manual' && !file) e.file = 'Choose the filled form to upload';
    if (receivedOn > todayKey()) e.receivedOn = 'Date cannot be in the future';
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;

    setBusy(true);
    setError(null);
    const studentName = who === 'lead' ? picked!.studentName : w.studentName.trim();
    const [first, ...rest] = studentName.split(' ');
    const prefill: AdmissionFormData = {
      studentFirstName: first, studentLastName: rest.join(' ') || undefined,
      gradeApplied: who === 'lead' ? picked!.grade : w.gradeApplied,
      dateOfBirth: who === 'lead' ? picked!.studentDob ?? undefined : undefined,
      declarationSignedBy: who === 'lead' ? picked!.parentName : w.parentName.trim(),
    };
    try {
      let app: Created;
      if (existing) {
        app = { id: existing.applicationId!, applicationNo: existing.applicationNo!, leadCode: existing.code, status: existing.applicationStatus ?? '' };
      } else {
        const opt = (s: string) => s.trim() || undefined;
        const r = await api.post<Created>('/applications', {
          ...(who === 'lead' ? { enquiryId: picked!.id } : {
            walkIn: { campusId: w.campusId, parentName: w.parentName.trim(), phone: w.phone.trim(), email: opt(w.email), studentName, gradeApplied: w.gradeApplied, source: w.source },
          }),
          formSource: how === 'manual' ? 'Manual' : 'Upload',
          receivedOn,
          // A typed form starts as a Draft application until the form is submitted.
          ...(how !== 'upload' ? { form: Object.fromEntries(Object.entries(prefill).filter(([, x]) => x)) } : {}),
        });
        app = r.data;
        toast(r.message, 'success');
      }
      if (file && how !== 'manual') {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('receivedOn', receivedOn);
        await api.upload(`/applications/${app.id}/form/upload`, fd, 120_000);
        toast('Admission form uploaded', 'success');
      }
      await invalidate(...INVALIDATE);
      if (how === 'upload') onDone(app.leadCode);
      else setFormFor({ ...app, prefill, studentName, grade: (who === 'lead' ? picked!.grade : w.gradeApplied) });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      setError(err);
    } finally { setBusy(false); }
  };

  if (formFor) {
    return (
      <AdmissionFormModal prefill={formFor.prefill} onClose={() => onDone(formFor.leadCode)}
        app={{ id: formFor.id, applicationNo: formFor.applicationNo, studentName: formFor.studentName, grade: formFor.grade, dateOfBirth: null, gender: null, previousSchool: null, status: formFor.status }} />
    );
  }

  return (
    <Modal open onClose={onClose} busy={busy} size="wide"
      title={presetLead ? `Admission form · ${presetLead.studentName}` : 'New application'}
      sub="Record the family’s filled admission form — type it in, upload the filled / scanned form, or both."
      foot={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" icon={how === 'upload' ? 'upload' : 'arrowRight'} loading={busy} onClick={go}>
            {existing ? (how === 'upload' ? 'Upload form' : 'Continue') : how === 'upload' ? 'Create and upload' : 'Create and enter form'}
          </Button>
        </>
      }>
      <div className="col g-4">
        {error && !(error instanceof ApiError && Object.keys(error.fieldErrors).length) ? <InlineError error={error} /> : null}
        <div className="formsection" style={{ marginTop: 0 }}>
          <div className="formsection__title">1 · Family</div>
          {presetLead ? (
            <p className="t-sm">{presetLead.studentName} · {presetLead.grade} · {presetLead.parentName} · lead {presetLead.code}</p>
          ) : (
            <>
              <Tabs pills items={[{ id: 'lead', label: 'Existing lead / enquiry' }, { id: 'walkin', label: 'Walk-in / new family' }]} active={who} onChange={(x) => { setWho(x); setErrors({}); }} />
              {who === 'lead' ? (
                <div className="mt-3">
                  {picked ? (
                    <div className="row g-3 wrap" style={{ alignItems: 'center' }}>
                      <Icon name="user" />
                      <span className="grow t-sm"><strong>{picked.studentName}</strong> · {picked.grade} · {picked.parentName} · {picked.code} · {picked.stage}</span>
                      <Button size="sm" variant="quiet" onClick={() => setPicked(null)}>Change</Button>
                    </div>
                  ) : (
                    <>
                      <SearchInput value={q} onSearch={setQ} placeholder="Search student, parent, phone or LD- code" maxWidth={520} />
                      {errors.lead && <span className="field__error" role="alert">{errors.lead}</span>}
                      {q.trim().length >= 2 && (
                        <div className="col g-1 mt-2" role="listbox" aria-label="Matching leads">
                          {search.isLoading ? <Skeleton height={80} /> : search.data?.rows.length ? search.data.rows.map((l) => (
                            <button type="button" key={l.id} className="btn btn--ghost" style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                              onClick={() => { setPicked(l); setErrors({}); }}>
                              <span className="t-sm"><strong>{l.studentName}</strong> · {l.grade} · {l.parentName} · {l.phone} · <span className="t-muted">{l.code} · {l.stage}{l.applicationNo ? ` · ${l.applicationNo}` : ''}</span></span>
                            </button>
                          )) : <p className="t-sm t-muted">No open lead matches. Use “Walk-in / new family” to create one with the application.</p>}
                        </div>
                      )}
                    </>
                  )}
                  {existing && <div className="mt-3"><Banner icon="info">This lead already has application {existing.applicationNo} ({existing.applicationStatus}) — the form is added to it.</Banner></div>}
                </div>
              ) : (
                <div className="form-grid mt-3">
                  <TextField label="Student’s full name" required value={w.studentName} onChange={(x) => setWalk('studentName', x)} error={errors['walkIn.studentName']} maxLength={120} />
                  <SelectField label="Grade applied for" required value={w.gradeApplied} onChange={(x) => setWalk('gradeApplied', x)} error={errors['walkIn.gradeApplied']} placeholder="Select…" options={GRADES} />
                  <TextField label="Parent’s name" required value={w.parentName} onChange={(x) => setWalk('parentName', x)} error={errors['walkIn.parentName']} maxLength={120} />
                  <TextField label="Mobile" type="tel" required value={w.phone} onChange={(x) => setWalk('phone', x)} error={errors['walkIn.phone']} />
                  <TextField label="Email" type="email" value={w.email} onChange={(x) => setWalk('email', x)} error={errors['walkIn.email']} />
                  <SelectField label="Campus" required value={w.campusId} onChange={(x) => setWalk('campusId', x)} error={errors['walkIn.campusId']} placeholder="Select…"
                    options={(lookups?.campuses ?? []).map((c) => ({ value: c.id, label: c.name }))} />
                  <SelectField label="How did the family come to us?" value={w.source} onChange={(x) => setWalk('source', x)} options={[...SOURCES]} />
                  <p className="t-micro t-muted span-2">A lead is created at the Application stage, so the enquiry pipeline and conversion reports stay complete. Families who already enquired should be picked from “Existing lead”.</p>
                </div>
              )}
            </>
          )}
        </div>
        <div className="formsection" style={{ marginTop: 0 }}>
          <div className="formsection__title">2 · The filled admission form</div>
          <Tabs pills items={[{ id: 'manual', label: 'Enter form manually' }, { id: 'upload', label: 'Upload filled form' }, { id: 'both', label: 'Both' }]} active={how}
            onChange={(x) => { setHow(x); setErrors((e) => ({ ...e, file: '' })); }} />
          <p className="t-micro t-muted mt-2">
            {how === 'manual' ? 'The form opens next, in the same sections as the printed form. You can save a draft and finish later.'
              : how === 'upload' ? 'Upload a PDF or a phone photo of the filled form. You can type it in later from the application.'
                : 'Upload the scan now, then type the form in from it.'}
          </p>
          <div className="form-grid mt-3">
            {how !== 'manual' && (
              <div className="span-2">
                <FileDrop file={file} error={errors.file} disabled={busy} onFile={(x, err) => { setFile(x); setErrors((e) => ({ ...e, file: err ?? '' })); }} />
              </div>
            )}
            <TextField label="Form received on" type="date" value={receivedOn} max={todayKey()} onChange={(x) => { setReceivedOn(x); setErrors((e) => ({ ...e, receivedOn: '' })); }} error={errors.receivedOn} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Bulk import — CSV of filled forms
// ---------------------------------------------------------------------------
interface ImportResult {
  dryRun: boolean; rows: number; imported: number; valid: number; failed: number;
  results: { row: number; studentName: string; ok: boolean; applicationNo?: string; leadCode?: string; errors?: { field: string; message: string }[] }[];
}

export function ImportFormsModal({ onClose }: { onClose: () => void }) {
  const school = useSchool();
  const { lookups } = useLookups();
  const toast = useToast();
  const invalidate = useInvalidate();
  const ref = useRef<HTMLInputElement>(null);
  const [campusId, setCampusId] = useState(school.campusId ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);

  const run = async (dryRun: boolean) => {
    const e: Record<string, string> = {};
    if (!campusId) e.campusId = 'Choose the campus the families applied to';
    if (!file) e.file = 'Choose the CSV file';
    else if (!/\.csv$/i.test(file.name)) e.file = 'Save the spreadsheet as CSV first';
    else if (file.size > 2 * 1024 * 1024) e.file = 'The file must be 2 MB or smaller';
    setErrors(e);
    if (Object.keys(e).length) return;
    const fd = new FormData();
    fd.append('file', file!);
    fd.append('campusId', campusId);
    fd.append('dryRun', String(dryRun));
    setBusy(dryRun ? 'check' : 'import');
    setError(null);
    try {
      const r = await api.upload<ImportResult>('/applications/import', fd, 300_000);
      setResult(r.data);
      toast(r.message, r.data.failed ? 'warning' : 'success');
      if (!dryRun && r.data.imported) await invalidate(...INVALIDATE);
    } catch (err) {
      setError(err);
    } finally { setBusy(null); }
  };

  return (
    <Modal open onClose={onClose} size="wide" busy={!!busy} title="Import filled admission forms"
      sub="One row per application. Each row creates a lead at the Application stage with the typed form; rows with problems are listed and skipped."
      foot={
        <>
          <Button onClick={onClose} disabled={!!busy}>{result && !result.dryRun ? 'Done' : 'Cancel'}</Button>
          <Button icon="checkSquare" loading={busy === 'check'} disabled={!!busy} onClick={() => run(true)}>Check file</Button>
          <Button variant="primary" icon="upload" loading={busy === 'import'} disabled={!!busy} onClick={() => run(false)}>Import</Button>
        </>
      }>
      <div className="col g-4">
        {error ? <InlineError error={error} /> : null}
        <Banner icon="info">
          <span>Download the template, fill one row per child (or export your spreadsheet with the same column names) and save it as CSV.
            Required: studentName, gradeApplied (e.g. “Grade 4”), parentName, phone. Rows with every required form field are marked submitted; others stay as drafts.</span>
        </Banner>
        <div className="row g-2 wrap">
          <Button size="sm" icon="download" onClick={() => api.download('/applications/import/template', 'admission-forms-template.csv').catch((e) => toast(errorMessage(e), 'critical'))}>Download CSV template</Button>
        </div>
        <div className="form-grid">
          <SelectField label="Campus" required value={campusId} onChange={(x) => { setCampusId(x); setErrors((e) => ({ ...e, campusId: '' })); }} error={errors.campusId}
            placeholder="Select…" options={(lookups?.campuses ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          <div className="field">
            <span className="label">CSV file<span className="req"> *</span></span>
            <div className="row g-2" style={{ alignItems: 'center' }}>
              <Button size="sm" icon="folder" onClick={() => ref.current?.click()}>{file ? 'Choose another' : 'Choose file'}</Button>
              <span className="t-sm t-clip">{file ? `${file.name} · ${bytes(file.size)}` : 'No file chosen'}</span>
            </div>
            <input ref={ref} type="file" accept=".csv,text/csv" hidden aria-label="CSV file"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setErrors((x) => ({ ...x, file: '' })); e.target.value = ''; }} />
            {errors.file && <span className="field__error" role="alert">{errors.file}</span>}
          </div>
        </div>
        {result && (
          <Card flush title={result.dryRun ? `Check: ${result.valid} of ${result.rows} rows ready` : `${result.imported} imported · ${result.failed} skipped`}>
            {result.results.length ? (
              <DataTable compact stack={false} rows={result.results} rowKey={(r) => String(r.row)}
                columns={[
                  { key: 'row', label: 'Row', className: 'num', render: (r) => r.row },
                  { key: 'student', label: 'Student', render: (r) => r.studentName || '—' },
                  {
                    key: 'result', label: 'Result', render: (r) => r.ok
                      ? <Badge tone="success" icon="check">{r.applicationNo ? `${r.applicationNo} · ${r.leadCode}` : 'Ready'}</Badge>
                      : <span className="t-xs t-critical">{(r.errors ?? []).map((x) => (x.field ? `${x.field}: ${x.message}` : x.message)).join(' · ')}</span>,
                  },
                ]} />
            ) : <Empty title="No rows" />}
          </Card>
        )}
      </div>
    </Modal>
  );
}
