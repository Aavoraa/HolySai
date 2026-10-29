import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { useSchool } from '@/layouts/SchoolContext';
import {
  Badge, Button, Card, Checkbox, DataTable, Empty, ErrorState, FilterSelect, Icon, InlineError, Lotus, Modal, Page, PageHead, PageSkeleton,
  SearchInput, SelectField, Skeleton, TextArea, TextField, Toolbar,
} from '@/components/ui';
import { ApiError } from '@/api/client';
import { fmt } from '@/lib/format';

export type LetterType = 'onboarding' | 'relieving' | 'experience';
export const LETTER_TYPES: { value: LetterType; label: string; sub: string; icon: string }[] = [
  { value: 'onboarding', label: 'Letter of Appointment', sub: 'Onboarding — post, joining date, salary and probation', icon: 'userCheck' },
  { value: 'relieving', label: 'Relieving Letter', sub: 'Confirms the employee has been relieved of duties', icon: 'logout' },
  { value: 'experience', label: 'Experience Letter', sub: 'Certifies the period and role of service', icon: 'award' },
];
const typeLabel = (t: LetterType) => LETTER_TYPES.find((x) => x.value === t)?.label ?? t;

interface LetterRow {
  id: string; type: LetterType; refNo: string; issuedOn: string; createdAt: string;
  employeeId: string; employee: string; code: string; designation: string; campus: string | null; issuedBy: string | null;
}
interface Defaults {
  employee: { id: string; code: string; fullName: string; gender: string | null; designation: string; department: string; joinDate: string | null; employmentStatus: string; campus: string | null };
  monthlyGross: number;
  signatory: { name: string; title: string };
  letters: LetterRow[];
}
interface Letter {
  id: string; type: LetterType; refNo: string; issuedOn: string; title: string; issuedBy: string | null;
  details: {
    signatoryName: string; signatoryTitle: string; joiningDate?: string; designation?: string; department?: string; monthlyGross?: number;
    probationMonths?: number; reportingTo?: string; lastWorkingDay?: string; resignationDate?: string; duesCleared?: boolean;
    conduct?: string; notes?: string;
    employee: { code: string; fullName: string; gender: string | null; designation: string; department: string; joinDate: string | null; campusName: string | null; campusAddress: string | null };
  };
}

const today = () => new Date().toISOString().slice(0, 10);

/** Issued letters for one employee, and the form to issue a new one. */
export function LettersModal({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const q = useApiQuery<Defaults>(`/workforce/employees/${employeeId}/letters`);
  const [creating, setCreating] = useState<LetterType | null>(null);
  const d = q.data;
  const e = d?.employee;
  return (
    <Modal open onClose={onClose} size="wide" title={e ? `Letters — ${e.fullName}` : 'Letters'}
      sub={e ? `${e.code} · ${e.designation} · ${e.department}${e.campus ? ` · ${e.campus}` : ''}` : undefined}
      foot={<Button onClick={onClose}>Close</Button>}>
      {q.isLoading ? <Skeleton height={200} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : d && e ? (
        creating ? (
          <LetterForm type={creating} d={d} onBack={() => setCreating(null)} onIssued={(id) => navigate(`/hr-letters/${id}`)} />
        ) : (
          <div className="col g-4">
            {can('hr.manage') && (
              <div className="grid g-3col g-3">
                {LETTER_TYPES.map((t) => (
                  <button key={t.value} type="button" className="optioncard" onClick={() => setCreating(t.value)}>
                    <span className="avatar"><Icon name={t.icon} size={18} /></span>
                    <span className="col grow" style={{ minWidth: 0 }}>
                      <span className="t-sm t-bold">{t.label}</span>
                      <span className="t-xs t-muted">{t.sub}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div>
              <div className="eyebrow mb-2">Issued letters</div>
              {d.letters.length ? (
                <DataTable compact rows={d.letters} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/hr-letters/${r.id}`)}
                  columns={[
                    { key: 'type', label: 'Letter', render: (r) => <span className="t-bold">{typeLabel(r.type)}</span> },
                    { key: 'ref', label: 'Reference', render: (r) => <span className="t-num">{r.refNo}</span> },
                    { key: 'date', label: 'Issued', render: (r) => fmt.date(r.issuedOn) },
                    { key: 'by', label: 'By', render: (r) => r.issuedBy ?? '—' },
                    { key: 'open', label: '', className: 'num', render: (r) => <Button size="sm" icon="printer" onClick={(ev) => { ev.stopPropagation(); navigate(`/hr-letters/${r.id}`); }}>Open</Button> },
                  ]} />
              ) : <Empty icon="fileText" title="No letters issued yet" sub={can('hr.manage') ? 'Choose a letter above to issue the first one.' : undefined} />}
            </div>
          </div>
        )
      ) : null}
    </Modal>
  );
}

function LetterForm({ type, d, onBack, onIssued }: { type: LetterType; d: Defaults; onBack: () => void; onIssued: (id: string) => void }) {
  const e = d.employee;
  const leaving = type !== 'onboarding';
  const [f, setF] = useState({
    issuedOn: today(), signatoryName: d.signatory.name, signatoryTitle: d.signatory.title,
    joiningDate: e.joinDate ?? today(), designation: e.designation, department: e.department, monthlyGross: String(d.monthlyGross || ''),
    probationMonths: '6', reportingTo: '', lastWorkingDay: today(), resignationDate: '', duesCleared: true,
    conduct: defaultConduct(e.gender), notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((x) => ({ ...x, [k]: '' })); };
  const issue = useApiMutation<Record<string, unknown>, { id: string; refNo: string }>('post', `/workforce/employees/${e.id}/letters`, {
    invalidate: ['/workforce'], error: false, success: (r) => r.message, onSuccess: (r) => onIssued(r.data.id),
  });
  useEffect(() => {
    if (issue.error instanceof ApiError) setErrors((x) => ({ ...x, ...issue.error instanceof ApiError ? issue.error.fieldErrors : {} }));
  }, [issue.error]);

  const submit = () => {
    const err: Record<string, string> = {};
    if (f.signatoryName.trim().length < 2) err.signatoryName = 'Who signs the letter?';
    if (f.signatoryTitle.trim().length < 2) err.signatoryTitle = 'Their title, e.g. Principal';
    if (!leaving && !f.joiningDate) err.joiningDate = 'Enter the date of joining';
    if (leaving && !f.lastWorkingDay) err.lastWorkingDay = 'Enter the last working day';
    if (leaving && e.joinDate && f.lastWorkingDay < e.joinDate) err.lastWorkingDay = 'Before the date of joining';
    if (leaving && f.resignationDate && f.resignationDate > f.lastWorkingDay) err.resignationDate = 'After the last working day';
    setErrors(err);
    if (Object.keys(err).length) return;
    const body: Record<string, unknown> = { type, issuedOn: f.issuedOn, signatoryName: f.signatoryName.trim(), signatoryTitle: f.signatoryTitle.trim() };
    if (f.notes.trim()) body.notes = f.notes.trim();
    if (!leaving) {
      Object.assign(body, {
        joiningDate: f.joiningDate, designation: f.designation.trim(), department: f.department.trim(),
        monthlyGross: f.monthlyGross ? Number(f.monthlyGross) : undefined, probationMonths: Number(f.probationMonths) || 0,
        reportingTo: f.reportingTo.trim() || undefined,
      });
    } else {
      Object.assign(body, { lastWorkingDay: f.lastWorkingDay, resignationDate: f.resignationDate || undefined });
      if (type === 'relieving') body.duesCleared = f.duesCleared;
      if (type === 'experience') body.conduct = f.conduct.trim() || undefined;
    }
    issue.mutate(body);
  };

  return (
    <div className="col g-4">
      <div className="row between wrap g-2">
        <div><div className="t-bold">{typeLabel(type)}</div><div className="t-xs t-muted">Filled in from {e.fullName}'s record — check and adjust before issuing.</div></div>
        <Button size="sm" variant="quiet" icon="arrowLeft" onClick={onBack} disabled={issue.isPending}>Back to letters</Button>
      </div>
      {issue.error && !(issue.error instanceof ApiError && Object.keys(issue.error.fieldErrors).length) ? <InlineError error={issue.error} /> : null}
      <div className="form-grid">
        {!leaving ? (
          <>
            <TextField label="Post (designation)" required value={f.designation} onChange={set('designation')} maxLength={80} />
            <TextField label="Department" required value={f.department} onChange={set('department')} maxLength={60} />
            <TextField label="Date of joining" required type="date" value={f.joiningDate} onChange={set('joiningDate')} error={errors.joiningDate} />
            <TextField label="Monthly gross salary (₹)" type="number" min="0" step="100" value={f.monthlyGross} onChange={set('monthlyGross')}
              hint="From the current salary — basic plus approved allowances." />
            <SelectField label="Probation" value={f.probationMonths} onChange={set('probationMonths')}
              options={[{ value: '0', label: 'No probation' }, ...[3, 6, 12].map((m) => ({ value: String(m), label: `${m} months` }))]} />
            <TextField label="Reports to" value={f.reportingTo} onChange={set('reportingTo')} maxLength={120} placeholder="e.g. Head of Academics" />
          </>
        ) : (
          <>
            <TextField label="Date of joining" value={e.joinDate ? fmt.date(e.joinDate) : 'Not recorded'} onChange={() => undefined} disabled />
            <TextField label="Last working day" required type="date" value={f.lastWorkingDay} onChange={set('lastWorkingDay')} error={errors.lastWorkingDay} />
            <TextField label="Resignation dated" type="date" value={f.resignationDate} onChange={set('resignationDate')} error={errors.resignationDate}
              hint="Optional — mentioned in the letter when given." />
            {type === 'relieving' && (
              <div style={{ alignSelf: 'end' }}><Checkbox checked={f.duesCleared} onChange={set('duesCleared')} label="All dues settled — no dues pending" /></div>
            )}
            {type === 'experience' && (
              <div className="span-2"><TextArea label="Remarks on conduct" value={f.conduct} onChange={set('conduct')} rows={2} maxLength={400} /></div>
            )}
          </>
        )}
        <TextField label="Signed by" required value={f.signatoryName} onChange={set('signatoryName')} error={errors.signatoryName} maxLength={120} />
        <TextField label="Signatory's title" required value={f.signatoryTitle} onChange={set('signatoryTitle')} error={errors.signatoryTitle} maxLength={80} />
        <TextField label="Date of issue" required type="date" value={f.issuedOn} onChange={set('issuedOn')} />
        <div className="span-2"><TextArea label="Additional note (optional)" value={f.notes} onChange={set('notes')} rows={2} maxLength={1000}
          hint="Printed as an extra paragraph." /></div>
      </div>
      <div className="row end g-2">
        <Button onClick={onBack} disabled={issue.isPending}>Cancel</Button>
        <Button variant="primary" icon="fileText" loading={issue.isPending} onClick={submit}>Issue and open letter</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HR Letters page: every letter issued, and a quick way to issue one
// ---------------------------------------------------------------------------
export function HrLettersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { campusParam } = useSchool();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [picking, setPicking] = useState(false);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const list = useApiQuery<LetterRow[]>('/workforce/letters', { ...campusParam, q: q || undefined, type: type || undefined });
  return (
    <Page>
      <PageHead title="HR Letters" sub="Appointment, relieving and experience letters issued to staff, each with its reference number."
        actions={can('hr.manage') && <Button variant="primary" icon="plus" onClick={() => setPicking(true)}>New letter</Button>} />
      <Card flush>
        <Toolbar>
          <SearchInput value={q} onSearch={setQ} placeholder="Search name, code or reference" />
          <FilterSelect label="Letter" value={type} onChange={setType} options={LETTER_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
        </Toolbar>
        {list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : (
          <DataTable rows={list.data} loading={list.isLoading} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/hr-letters/${r.id}`)}
            emptyText={q || type ? 'No letter matches this search.' : 'No letters issued yet — use “New letter”.'}
            columns={[
              { key: 'ref', label: 'Reference', render: (r) => <span className="t-num t-bold">{r.refNo}</span> },
              { key: 'type', label: 'Letter', render: (r) => <Badge tone={r.type === 'onboarding' ? 'success' : r.type === 'relieving' ? 'warning' : 'info'}>{typeLabel(r.type)}</Badge> },
              { key: 'employee', label: 'Employee', render: (r) => <><span className="t-bold">{r.employee}</span><div className="t-micro t-muted">{r.code} · {r.designation}{r.campus ? ` · ${r.campus}` : ''}</div></> },
              { key: 'issued', label: 'Issued', render: (r) => <>{fmt.date(r.issuedOn)}{r.issuedBy && <div className="t-micro t-muted">{r.issuedBy}</div>}</> },
              { key: 'open', label: '', className: 'num', render: (r) => <Button size="sm" icon="printer" onClick={(ev) => { ev.stopPropagation(); navigate(`/hr-letters/${r.id}`); }}>Open</Button> },
            ]} />
        )}
      </Card>
      {picking && <PickEmployee onClose={() => setPicking(false)} onPick={(id) => { setPicking(false); setEmployeeId(id); }} />}
      {employeeId && <LettersModal employeeId={employeeId} onClose={() => setEmployeeId(null)} />}
    </Page>
  );
}

function PickEmployee({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const { campusParam } = useSchool();
  const [id, setId] = useState('');
  // Everyone on the books, including those on notice or who have left (for relieving and experience letters).
  const staff = useApiQuery<{ id: string; code: string; fullName: string; designation: string; employmentStatus: string }[]>(
    '/workforce/employees', { ...campusParam, pageSize: 200, sort: 'name' });
  return (
    <Modal open onClose={onClose} title="New letter" sub="Choose the employee the letter is for."
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!id} onClick={() => onPick(id)}>Continue</Button></>}>
      <SelectField label="Employee" required value={id} onChange={setId} placeholder={staff.isLoading ? 'Loading…' : 'Choose…'}
        options={(staff.data ?? []).map((s) => ({ value: s.id, label: `${s.fullName} · ${s.code} · ${s.designation}${s.employmentStatus !== 'active' ? ` (${s.employmentStatus.replace('_', ' ')})` : ''}` }))} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Printable letter: /hr-letters/:id
// ---------------------------------------------------------------------------
/** Default remark, worded from the employee's recorded gender. */
function defaultConduct(g: string | null) {
  const p = pronouns(g);
  return `${cap(p.p)} conduct was good and ${p.s} carried out ${p.p} duties sincerely.`;
}

const pronouns = (g: string | null) => (g === 'M' ? { s: 'he', o: 'him', p: 'his' } : g === 'F' ? { s: 'she', o: 'her', p: 'her' } : { s: 'they', o: 'them', p: 'their' });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function tenure(from: string | null, to?: string) {
  if (!from || !to) return null;
  const a = new Date(`${from}T00:00:00`), b = new Date(`${to}T00:00:00`);
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  const y = Math.floor(months / 12), m = months % 12;
  return [y && `${y} year${y === 1 ? '' : 's'}`, m && `${m} month${m === 1 ? '' : 's'}`].filter(Boolean).join(' and ') || 'less than a month';
}

export function LetterPrintPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const valid = /^[0-9a-f-]{36}$/i.test(id);
  const q = useApiQuery<Letter>(valid ? `/workforce/letters/${id}` : null);
  const l = q.data;
  return (
    <Page className="payslip-print">
      <div className="pagehead">
        <div className="grow">
          <h1 className="pagehead__title">{l?.title ?? 'Letter'}</h1>
          {l && <p className="pagehead__sub">{l.details.employee.fullName} · {l.details.employee.code} · Ref. {l.refNo}</p>}
        </div>
        <div className="pagehead__actions">
          <Button icon="arrowLeft" onClick={() => navigate(-1)}>Back</Button>
          <Button variant="primary" icon="printer" disabled={!l} onClick={() => window.print()}>Print / save as PDF</Button>
        </div>
      </div>
      {!valid ? <ErrorState error={new Error('This letter link is not valid.')} /> : q.isLoading ? <PageSkeleton kpis={0} /> : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : l ? <LetterDocument l={l} /> : null}
    </Page>
  );
}

function LetterDocument({ l }: { l: Letter }) {
  const d = l.details;
  const e = d.employee;
  const p = pronouns(e.gender);
  const school = e.campusName ?? 'Holy Sai International School';
  const body: React.ReactNode[] = [];
  let subject = '';
  let salutation = `Dear ${e.fullName},`;

  if (l.type === 'onboarding') {
    subject = `Appointment as ${d.designation ?? e.designation}`;
    body.push(<>We are pleased to appoint you as <strong>{d.designation ?? e.designation}</strong> in the {d.department ?? e.department} department at {school}, with effect from <strong>{fmt.date(d.joiningDate)}</strong>.</>);
    if (d.monthlyGross) body.push(<>Your gross monthly salary will be <strong>{fmt.money(d.monthlyGross)}</strong>, made up of basic pay and allowances as per the school's salary structure, subject to statutory deductions (provident fund, professional tax and income tax).</>);
    if (d.probationMonths) body.push(<>You will be on probation for {d.probationMonths} months from the date of joining. On satisfactory completion, your appointment will be confirmed in writing.</>);
    body.push(<>{d.reportingTo ? <>You will report to the {d.reportingTo}. </> : null}Please report to the school office on your date of joining with your original certificates, identity proof and two passport-size photographs. You will be bound by the school's service rules and code of conduct as amended from time to time.</>);
    body.push(<>Kindly sign and return the duplicate copy of this letter as a token of your acceptance. We welcome you to the Holy Sai family and wish you a rewarding career with us.</>);
  } else if (l.type === 'relieving') {
    subject = 'Relieving letter';
    body.push(<>{d.resignationDate ? <>With reference to your resignation dated {fmt.date(d.resignationDate)}, this </> : 'This '}is to inform you that you have been relieved of your duties as <strong>{e.designation}</strong> in the {e.department} department at {school} with effect from the close of working hours on <strong>{fmt.date(d.lastWorkingDay)}</strong>.</>);
    if (d.duesCleared) body.push(<>We confirm that all dues between you and the school have been settled and nothing is pending from either side.</>);
    body.push(<>We thank you for your contribution to the school and wish you every success in your future endeavours.</>);
  } else {
    subject = 'Experience certificate';
    salutation = 'To whom it may concern,';
    const span = tenure(e.joinDate, d.lastWorkingDay);
    body.push(<>This is to certify that <strong>{e.fullName}</strong> (Employee code {e.code}) worked with {school} as <strong>{e.designation}</strong> in the {e.department} department from <strong>{fmt.date(e.joinDate)}</strong> to <strong>{fmt.date(d.lastWorkingDay)}</strong>{span ? <>, a period of {span}</> : null}.</>);
    if (d.conduct) body.push(<>{d.conduct}</>);
    body.push(<>We wish {p.o} every success in {p.p} future career.</>);
  }
  if (d.notes) body.push(<>{d.notes}</>);

  return (
    <Card>
      <div className="payslip-head">
        <div className="row g-3">
          <Lotus size={40} />
          <div>
            <div className="serif payslip-head__school">{school}</div>
            <div className="t-xs t-muted">{e.campusAddress}</div>
          </div>
        </div>
        <div className="payslip-head__month" style={{ textAlign: 'right' }}>
          <div className="eyebrow">Ref. {l.refNo}</div>
          <div className="t-bold">{fmt.date(l.issuedOn)}</div>
        </div>
      </div>
      <div className="hrletter">
        {l.type !== 'experience' && (
          <p>To<br /><strong>{e.fullName}</strong><br />{e.code}{l.type === 'relieving' ? <><br />{e.designation}, {e.department}</> : null}</p>
        )}
        <p className="hrletter__subject"><strong>Subject: {subject}</strong></p>
        <p>{salutation}</p>
        {body.map((para, i) => <p key={i}>{para}</p>)}
        <div className="hrletter__sign">
          <p>For <strong>{school}</strong></p>
          <div className="hrletter__signline" />
          <p><strong>{d.signatoryName}</strong><br />{d.signatoryTitle}</p>
        </div>
        {l.type === 'onboarding' && (
          <div className="hrletter__accept">
            <p className="t-bold">Acceptance</p>
            <p>I have read and understood the terms of this appointment and accept them.</p>
            <div className="row between g-5 wrap mt-4">
              <span>Signature: ______________________</span><span>Date: ______________</span>
            </div>
          </div>
        )}
        <p className="t-micro t-muted mt-5">{cap(`issued by ${l.issuedBy ?? 'the school office'}.`)} Sample data for demonstration.</p>
      </div>
    </Card>
  );
}
