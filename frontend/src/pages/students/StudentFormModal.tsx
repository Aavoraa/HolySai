import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError } from '@/api/client';
import { useApiMutation } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import { useSchool } from '@/layouts/SchoolContext';
import { Banner, Button, Checkbox, InlineError, Modal, SelectField, TextArea, TextField } from '@/components/ui';
import { todayKey } from '@/lib/format';

export interface StudentFormValues {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  bloodGroup: string;
  campusId: string;
  classId: string;
  sectionId: string;
  house: string;
  address: string;
  city: string;
  pincode: string;
  admittedOn: string;
  medicalNotes: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  guardianRelationship: string;
  routeId: string;
  stopId: string;
  enableTracking: boolean;
}

const EMPTY: StudentFormValues = {
  firstName: '', lastName: '', dateOfBirth: '', gender: '', bloodGroup: '', campusId: '', classId: '', sectionId: '',
  house: '', address: '', city: '', pincode: '', admittedOn: todayKey(), medicalNotes: '',
  guardianName: '', guardianPhone: '', guardianEmail: '', guardianRelationship: 'Father', routeId: '', stopId: '', enableTracking: true,
};

const PHONE = /^\+?[0-9 ]{8,16}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Create (with guardian and transport) or edit a student record. */
export function StudentFormModal({ studentId, initial, onClose, onSaved }: {
  studentId?: string;
  initial?: Partial<StudentFormValues>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const editing = !!studentId;
  const { lookups, classOptions, sectionOptions } = useLookups();
  const school = useSchool();
  const [v, setV] = useState<StudentFormValues>({ ...EMPTY, campusId: school.campusId ?? '', ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof StudentFormValues>(k: K, val: StudentFormValues[K]) => {
    setV((s) => ({ ...s, [k]: val }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  // When editing, the class is derived from the student's current section once lookups load.
  useEffect(() => {
    if (v.classId || !v.sectionId || !lookups) return;
    const cls = lookups.classes.find((c) => c.sections.some((x) => x.id === v.sectionId));
    if (cls) setV((s) => ({ ...s, classId: cls.id }));
  }, [lookups, v.classId, v.sectionId]);

  const routes = useMemo(() => (lookups?.routes ?? []).filter((r) => !v.campusId || r.campusId === v.campusId), [lookups, v.campusId]);
  const stops = routes.find((r) => r.id === v.routeId)?.stops ?? [];

  const save = useApiMutation<Record<string, unknown>, { id: string }>(editing ? 'put' : 'post', editing ? `/students/${studentId}` : '/students', {
    invalidate: ['/students', '/tracking', '/dashboard', '/lookups'],
    success: editing ? 'Student updated' : 'Student created',
    error: false,
    onSuccess: (r) => onSaved(r.data.id),
  });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!v.firstName.trim()) e.firstName = 'First name is required';
    if (!v.lastName.trim()) e.lastName = 'Last name is required';
    if (!v.dateOfBirth) e.dateOfBirth = 'Date of birth is required';
    else if (v.dateOfBirth >= todayKey()) e.dateOfBirth = 'Date of birth must be in the past';
    if (!v.gender) e.gender = 'Select a gender';
    if (!v.campusId) e.campusId = 'Select a campus';
    if (!v.sectionId) e.sectionId = 'Select a class and section';
    if (v.pincode && !/^[0-9]{6}$/.test(v.pincode)) e.pincode = 'PIN code must be 6 digits';
    if (!editing) {
      if (!v.guardianName.trim()) e.guardianName = 'Guardian name is required';
      if (!PHONE.test(v.guardianPhone)) e.guardianPhone = 'Enter a valid phone number';
      if (v.guardianEmail && !EMAIL.test(v.guardianEmail)) e.guardianEmail = 'Enter a valid email';
      if (v.routeId && !v.stopId) e.stopId = 'Select the pickup stop';
    }
    setErrors(e);
    return !Object.keys(e).length;
  };

  const errorCount = Object.values(errors).filter(Boolean).length;

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    const opt = (s: string) => (s.trim() ? s.trim() : undefined);
    const body: Record<string, unknown> = {
      firstName: v.firstName.trim(), lastName: v.lastName.trim(), dateOfBirth: v.dateOfBirth, gender: v.gender,
      bloodGroup: opt(v.bloodGroup), campusId: v.campusId, sectionId: v.sectionId, house: opt(v.house),
      address: opt(v.address), city: opt(v.city), pincode: opt(v.pincode), admittedOn: opt(v.admittedOn), medicalNotes: opt(v.medicalNotes),
    };
    if (!editing) {
      body.guardians = [{ fullName: v.guardianName.trim(), phone: v.guardianPhone.trim(), email: opt(v.guardianEmail), relationship: v.guardianRelationship, isPrimary: true }];
      if (v.routeId) body.transport = { routeId: v.routeId, stopId: v.stopId };
      body.enableTracking = v.enableTracking;
    }
    save.mutate(body, {
      onError: (err) => {
        if (err instanceof ApiError) setErrors((e) => ({ ...e, ...err.fieldErrors }));
      },
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={save.isPending}
      size="wide"
      title={editing ? 'Edit student' : 'Add student'}
      sub={editing ? 'Changes are recorded in the audit trail.' : 'Creates the Student Master record, enrolment, guardian and tracking profile.'}
      foot={
        <>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button variant="primary" icon="check" type="submit" form="student-form" loading={save.isPending}>{editing ? 'Save changes' : 'Create student'}</Button>
        </>
      }
    >
      <form id="student-form" onSubmit={submit} noValidate>
        {save.error && !Object.keys((save.error as ApiError).fieldErrors ?? {}).length && <div className="mb-4"><InlineError error={save.error} /></div>}
        {errorCount > 0 && (
          <div className="mb-4">
            <Banner tone="critical" icon="alertCircle">
              {errorCount === 1 ? '1 field needs attention' : `${errorCount} fields need attention`} — check the highlighted fields below.
            </Banner>
          </div>
        )}
        <div className="formsection">
          <div className="formsection__title">Identity</div>
          <div className="form-grid">
            <TextField label="First name" required value={v.firstName} onChange={(x) => set('firstName', x)} error={errors.firstName} maxLength={60} autoFocus />
            <TextField label="Last name" required value={v.lastName} onChange={(x) => set('lastName', x)} error={errors.lastName} maxLength={60} />
            <TextField label="Date of birth" type="date" required value={v.dateOfBirth} max={todayKey()} onChange={(x) => set('dateOfBirth', x)} error={errors.dateOfBirth} />
            <SelectField label="Gender" required value={v.gender} onChange={(x) => set('gender', x)} error={errors.gender} placeholder="Select…"
              options={[{ value: 'F', label: 'Female' }, { value: 'M', label: 'Male' }, { value: 'O', label: 'Other' }]} />
          </div>
        </div>

        <div className="formsection">
          <div className="formsection__title">Class &amp; campus</div>
          <div className="form-grid">
            <SelectField label="Campus" required value={v.campusId} error={errors.campusId} placeholder="Select…"
              onChange={(x) => { setV((s) => ({ ...s, campusId: x, classId: '', sectionId: '', routeId: '', stopId: '' })); setErrors((e) => ({ ...e, campusId: '' })); }}
              options={(lookups?.campuses ?? []).map((c) => ({ value: c.id, label: c.name }))} />
            <TextField label="Admitted on" type="date" value={v.admittedOn} max={todayKey()} onChange={(x) => set('admittedOn', x)} />
            <SelectField label="Class" required value={v.classId} placeholder="Select…" disabled={!v.campusId} hint={!v.campusId ? 'Choose a campus first' : undefined}
              onChange={(x) => setV((s) => ({ ...s, classId: x, sectionId: '' }))} options={classOptions(v.campusId)} />
            <SelectField label="Section" required value={v.sectionId} error={errors.sectionId} placeholder="Select…" disabled={!v.classId}
              onChange={(x) => set('sectionId', x)} options={sectionOptions(v.classId)} />
            <SelectField label="House" value={v.house} onChange={(x) => set('house', x)} placeholder="Not assigned" options={lookups?.houses?.length ? lookups.houses : ['Emerald', 'Sapphire', 'Amber', 'Coral']} />
          </div>
        </div>

        <div className="formsection">
          <div className="formsection__title">Contact &amp; address</div>
          {!editing && <div className="formsection__sub">Primary guardian. An existing parent can be linked later from the parent directory.</div>}
          <div className="form-grid">
            {!editing && (
              <>
                <TextField label="Guardian full name" required value={v.guardianName} onChange={(x) => set('guardianName', x)} error={errors.guardianName} maxLength={120} />
                <SelectField label="Relationship" value={v.guardianRelationship} onChange={(x) => set('guardianRelationship', x)} options={['Father', 'Mother', 'Guardian']} />
                <TextField label="Mobile" required type="tel" value={v.guardianPhone} onChange={(x) => set('guardianPhone', x)} error={errors.guardianPhone} placeholder="+91 98xxxxxxxx" />
                <TextField label="Email" type="email" value={v.guardianEmail} onChange={(x) => set('guardianEmail', x)} error={errors.guardianEmail} />
              </>
            )}
            <TextField className="span-2" label="Address" value={v.address} onChange={(x) => set('address', x)} maxLength={300} />
            <TextField label="City" value={v.city} onChange={(x) => set('city', x)} maxLength={60} />
            <TextField label="PIN code" value={v.pincode} onChange={(x) => set('pincode', x)} error={errors.pincode} maxLength={6} hint="6 digits" />
          </div>
        </div>

        {!editing && (
          <div className="formsection">
            <div className="formsection__title">Transport &amp; tracking</div>
            <div className="form-grid">
              <SelectField label="Bus route" value={v.routeId} placeholder="Own transport" onChange={(x) => setV((s) => ({ ...s, routeId: x, stopId: '' }))}
                options={routes.map((r) => ({ value: r.id, label: `${r.name} · ${r.area}` }))} />
              <SelectField label="Pickup stop" value={v.stopId} error={errors.stopId} placeholder="Select…" disabled={!v.routeId} required={!!v.routeId}
                onChange={(x) => set('stopId', x)} options={stops.map((st) => ({ value: st.id, label: st.name }))} />
              <div className="span-2">
                <Checkbox checked={v.enableTracking} onChange={(x) => set('enableTracking', x)}
                  label="Enable GPS tracking (requires the guardian's consent, recorded when the tag is issued)" />
              </div>
            </div>
          </div>
        )}

        <div className="formsection">
          <div className="formsection__title">Health</div>
          <div className="form-grid">
            <SelectField label="Blood group" value={v.bloodGroup} onChange={(x) => set('bloodGroup', x)} placeholder="Not recorded"
              options={['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']} />
            <TextArea className="span-2" label="Medical notes" hint="Allergies, conditions or medication. Visible only to staff with access to sensitive records." value={v.medicalNotes} onChange={(x) => set('medicalNotes', x)} rows={2} maxLength={1000} />
          </div>
        </div>
      </form>
    </Modal>
  );
}
