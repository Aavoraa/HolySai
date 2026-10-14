import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import {
  Badge, Banner, Button, Card, DataTable, Empty, ErrorState, FilterSelect, Grid, Icon, Kpi, Page, PageHead, Pagination, Person,
  SearchInput, SelectField, Skeleton, Status, StudentLink, TextField, Timeline, useConfirm,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { FormModal, gradeOf, PHONE_RE, SAFETY_KEYS, StudentPicker, UnauthorisedModal, useFieldErrors } from './shared';
import { GATES, PICKUP_METHODS, type PickupAuth, type PickupSummary, type StudentOption } from './types';

const METHODS = [
  ['QR code', 'Parent app shows a rotating code. Scanned at the gate.', 'qr'],
  ['One-time password', 'For anyone without the app. Sent to the registered parent number; valid for 10 minutes.', 'key'],
  ['Photo ID capture', 'Stored against the collection record for the audit trail.', 'camera'],
  ['Unauthorised alert', 'Collection is held, front office and parent alerted immediately.', 'alert'],
];

export default function PickupPage() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const { campusParam } = useSchool();
  const manage = can('safety.manage');
  const list = useListParams({ sort: 'student', pageSize: 25 }, ['status', 'studentId']);
  const [studentName, setStudentName] = useState<string | null>(null);
  const summary = useApiQuery<PickupSummary>('/pickup/summary', campusParam);
  const q = usePagedQuery<PickupAuth>('/pickup/authorisations', { ...list.query, ...campusParam });
  const [modal, setModal] = useState<{ kind: 'add' | 'unauthorised' } | { kind: 'otp' | 'collect'; auth: PickupAuth } | null>(null);
  const revoke = useApiMutation<string>('post', (id) => `/pickup/authorisations/${id}/revoke`, { invalidate: SAFETY_KEYS, body: () => ({}) });

  const filtered = list.filters.studentId;
  const rows = q.data?.rows;
  useEffect(() => {
    if (filtered && rows?.length) setStudentName(rows[0].studentName);
    if (!filtered) setStudentName(null);
  }, [filtered, rows]);

  const doRevoke = async (a: PickupAuth) => {
    const ok = await confirm({
      title: `Revoke ${a.personName}?`, danger: true, icon: 'x', confirmLabel: 'Revoke',
      body: `${a.personName} will no longer be able to collect ${a.studentName}. The parents are informed.`,
    });
    if (ok) revoke.mutate(a.id);
  };

  const s = summary.data;
  return (
    <Page>
      <PageHead
        title="Pickup Authorisation"
        sub="Who may collect each child, how they are verified, and what happens when someone is not on the list."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setModal({ kind: 'add' })}>Add authorised person</Button>}
      />
      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : (
        <Grid cols="g-4col">
          <Kpi icon="activity" loading={!s} label="Authorised persons" value={fmt.n(s?.authorisedPersons ?? 0)} foot={s ? `Average ${s.averagePerStudent} per child · ${s.pendingConfirmation} pending` : undefined} />
          <Kpi icon="activity" loading={!s} label="Verified by QR" value={fmt.pct(s?.verifiedByQrPct ?? 0)} tone="teal" foot="Of verified persons" />
          <Kpi icon="activity" loading={!s} label="OTP verifications today" value={fmt.n(s?.otpVerificationsToday ?? 0)} tone="amber" foot={s ? `${s.collectedToday} collections recorded today` : undefined} />
          <Kpi icon="wallet" loading={!s} label="Held collections today" value={fmt.n(s?.heldToday ?? 0)} tone="critical"
            foot={s ? (s.heldToday ? `${s.heldResolved} resolved` : 'None today') : undefined} />
        </Grid>
      )}

      <div className="grid g-main mt-4">
        <Card title={`Authorised persons — ${filtered ? studentName ?? 'selected student' : 'all students'}`} flush
          actions={filtered ? <Button size="sm" variant="quiet" icon="x" onClick={() => list.setFilter('studentId', '')}>Show all</Button> : undefined}>
          <div className="toolbar">
            <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search person or student" />
            <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={['Verified', 'Pending', 'Revoked']} />
          </div>
          {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <DataTable
              rows={rows}
              loading={q.isLoading || q.isFetching}
              rowKey={(r) => r.id}
              sort={list.sort}
              onSort={list.setSort}
              emptyText={filtered ? 'No authorised persons for this student yet.' : 'No authorised persons match these filters.'}
              columns={[
                { key: 'person', label: 'Person', render: (r) => <Person name={r.personName} meta={[r.relation, r.phone].filter(Boolean).join(' · ')} /> },
                ...(filtered ? [] : [{
                  key: 'student', label: 'Student',
                  render: (r: PickupAuth) => <StudentLink id={r.studentId} name={r.studentName} meta={gradeOf(r.grade, r.section)} />,
                }]),
                { key: 'method', label: 'Verification', sortable: false, render: (r) => <Badge>{r.method}</Badge> },
                {
                  key: 'status', label: 'Status',
                  render: (r) => (
                    <span className="col">
                      <Status value={r.status} />
                      {r.status === 'Pending' && <span className="t-micro t-muted">{r.otpExpiresAt ? `Code sent · expires ${fmt.time(r.otpExpiresAt)}` : r.parentApproved ? 'Added by parent' : 'Awaiting parent confirmation'}</span>}
                    </span>
                  ),
                },
                { key: 'last', label: 'Last collection', render: (r) => r.lastPickupAt ? fmt.dateTime(r.lastPickupAt) : <span className="t-faint">—</span> },
                ...(manage ? [{
                  key: 'actions', label: '', sortable: false, className: 'num',
                  render: (r: PickupAuth) => r.status === 'Revoked' ? null : (
                    <span className="row g-1 end">
                      {r.status === 'Pending'
                        ? <Button size="sm" icon="key" onClick={() => setModal({ kind: 'otp', auth: r })}>Verify</Button>
                        : <Button size="sm" icon="userCheck" onClick={() => setModal({ kind: 'collect', auth: r })}>Release</Button>}
                      <Button size="sm" variant="quiet" onClick={() => doRevoke(r)} aria-label={`Revoke ${r.personName}`}>Revoke</Button>
                    </span>
                  ),
                }] : []),
              ]}
            />
          )}
          <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
        </Card>

        <div className="col g-4">
          <Card title="Today at the gate" sub="Collections and held attempts"
            actions={manage && <Button size="sm" variant="danger" icon="alert" onClick={() => setModal({ kind: 'unauthorised' })}>Report attempt</Button>}>
            {!s ? <Skeleton height={80} /> : !s.recentEvents.length
              ? <Empty icon="userCheck" title="No collections yet today" sub="Released and held collections appear here." />
              : (
                <>
                {/* Held collections still awaiting a parent are critical: pinned above the routine timeline. */}
                {s.recentEvents.some((e) => e.outcome === 'held' && !e.resolved) && (
                  <div className="st-critical-list" role="region" aria-label="Held collections awaiting a parent">
                    {s.recentEvents.filter((e) => e.outcome === 'held' && !e.resolved).map((e) => (
                      <div className="st-alertrow" key={e.id}>
                        <Icon name="alert" size={16} />
                        <div className="st-alertrow__body">
                          <strong>Held:</strong> {e.personName} for {e.studentName}
                          <div className="st-alertrow__meta">{[e.gate, e.incidentCode, 'awaiting parent'].filter(Boolean).join(' · ')}</div>
                        </div>
                        <span className="st-alertrow__time">{fmt.time(e.occurredAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <Timeline items={s.recentEvents.filter((e) => !(e.outcome === 'held' && !e.resolved)).map((e) => ({
                  time: fmt.time(e.occurredAt),
                  tone: e.outcome === 'held' ? (e.resolved ? 'amber' : 'critical') : 'teal',
                  title: e.outcome === 'held' ? `Held: ${e.personName} for ${e.studentName}` : `${e.studentName} collected by ${e.personName}`,
                  body: e.outcome === 'held'
                    ? `${e.gate} · ${e.incidentCode ?? ''}${e.resolved ? ' · resolved' : ' · awaiting parent'}`
                    : `${e.gate}${e.method ? ` · ${e.method}` : ''}`,
                }))} />
                </>
              )}
          </Card>
          <Card icon="creditCard" title="Verification methods">
            <div className="col g-4">
              {METHODS.map(([t, d, i]) => (
                <div className="row-top g-3" key={t}>
                  <span className="avatar none"><Icon name={i} size={17} /></span>
                  <span className="col"><span className="t-sm t-bold">{t}</span><span className="t-xs t-muted">{d}</span></span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {modal?.kind === 'add' && <AddPersonModal onClose={() => setModal(null)} onAdded={(sid) => list.setFilter('studentId', sid)} />}
      {modal?.kind === 'unauthorised' && <UnauthorisedModal onClose={() => setModal(null)} />}
      {modal?.kind === 'otp' && <OtpModal auth={modal.auth} onClose={() => setModal(null)} />}
      {modal?.kind === 'collect' && <CollectModal auth={modal.auth} onClose={() => setModal(null)} />}
    </Page>
  );
}

function AddPersonModal({ onClose, onAdded }: { onClose: () => void; onAdded: (studentId: string) => void }) {
  const [student, setStudent] = useState<StudentOption | null>(null);
  const [f, setF] = useState({ personName: '', relation: '', phone: '', method: 'OTP' });
  const fe = useFieldErrors();
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); fe.clear(k); };
  const save = useApiMutation<Record<string, string>>('post', '/pickup/authorisations', {
    invalidate: SAFETY_KEYS, onSuccess: (_r, v) => { onAdded(v.studentId); onClose(); },
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!student) e.studentId = 'Choose the child';
    if (f.personName.trim().length < 2) e.personName = 'Enter the full name';
    if (f.relation.trim().length < 2) e.relation = 'Enter the relationship';
    if (f.phone && !PHONE_RE.test(f.phone.trim())) e.phone = 'Enter a valid phone number';
    if (/OTP/.test(f.method) && !f.phone.trim()) e.phone = 'A phone number is needed for OTP verification';
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({
      studentId: student!.id, personName: f.personName.trim(), relation: f.relation.trim(), method: f.method,
      ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
    }, { onError: fe.fromServer });
  };
  return (
    <FormModal title="Add authorised person" sub="The person stays 'Pending' until verified by OTP or confirmed by a parent."
      onClose={onClose} busy={save.isPending} error={save.error} fieldErrors={fe.errors} onSubmit={submit} submitLabel="Add person" submitIcon="plus">
      <div className="formsection">
        <div className="formsection__title">Child</div>
        <StudentPicker value={student} onChange={(s) => { setStudent(s); fe.clear('studentId'); }} required error={fe.errors.studentId} />
      </div>
      <div className="formsection">
        <div className="formsection__title">Authorised person</div>
        <div className="form-grid">
          <TextField label="Full name" required value={f.personName} onChange={set('personName')} maxLength={120} error={fe.errors.personName} />
          <TextField label="Relationship" required value={f.relation} onChange={set('relation')} maxLength={40} placeholder="Grandfather, driver…" error={fe.errors.relation} />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Verification</div>
        <div className="form-grid">
          <SelectField label="Verification method" required value={f.method} onChange={set('method')} options={PICKUP_METHODS} />
          <TextField label="Phone" type="tel" value={f.phone} onChange={set('phone')} maxLength={16} placeholder="+91 98400 00000" error={fe.errors.phone}
            required={/OTP/.test(f.method)} hint={/OTP/.test(f.method) ? 'Needed to send the one-time code' : undefined} />
        </div>
      </div>
    </FormModal>
  );
}

function OtpModal({ auth, onClose }: { auth: PickupAuth; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<{ expiresAt: string; sentTo: number; devCode?: string } | null>(
    auth.otpExpiresAt ? { expiresAt: auth.otpExpiresAt, sentTo: 0 } : null,
  );
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const fe = useFieldErrors();
  const send = useApiMutation<void, { expiresAt: string; sentTo: number; devCode?: string }>('post', `/pickup/authorisations/${auth.id}/otp`, {
    invalidate: ['/pickup'], body: () => ({}), onSuccess: (r) => { setSent(r.data); setCode(''); fe.setErrors({}); },
  });
  const verify = useApiMutation<{ code: string }>('post', `/pickup/authorisations/${auth.id}/verify`, {
    invalidate: SAFETY_KEYS, onSuccess: onClose, error: false,
  });
  const left = sent ? Math.max(0, Math.floor((new Date(sent.expiresAt).getTime() - now) / 1000)) : 0;
  const submit = () => {
    if (!/^\d{6}$/.test(code)) return fe.setErrors({ code: 'Enter the 6-digit code' });
    verify.mutate({ code }, { onError: fe.fromServer });
  };
  return (
    <FormModal title={`Verify ${auth.personName}`} sub={`${auth.relation} · collecting ${auth.studentName}`}
      onClose={onClose} busy={verify.isPending} error={verify.error} fieldErrors={fe.errors} onSubmit={submit}
      submitLabel="Verify code" submitIcon="shieldCheck">
      <div className="col g-4">
        <p className="t-sm">A one-time code is sent to the child's registered parents. The person at the gate reads it out only if the parent has sent them.</p>
        {sent && left > 0 ? (
          <Banner tone="success" icon="key">
            Code sent{sent.sentTo ? ` to ${sent.sentTo} parent account${sent.sentTo === 1 ? '' : 's'}` : ''} · expires in <strong className="t-num">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</strong>
            {sent.devCode && <div className="t-micro mt-2">Development only (no SMS provider configured): code <strong className="t-num">{sent.devCode}</strong></div>}
          </Banner>
        ) : (
          <Banner tone={sent ? 'warning' : 'neutral'} icon="clock">{sent ? 'The code has expired. Send a new one.' : 'No code has been sent yet.'}</Banner>
        )}
        <div className="st-scanrow g-3">
          <TextField label="6-digit code" value={code} maxLength={6} autoComplete="one-time-code" pattern="[0-9]*"
            onChange={(v) => { setCode(v.replace(/\D/g, '')); fe.clear('code'); }} error={fe.errors.code} disabled={!sent || left === 0} style={{ maxWidth: 200 }} />
          <Button icon="send" onClick={() => send.mutate()} loading={send.isPending}>{sent ? 'Send a new code' : 'Send code to parent'}</Button>
        </div>
      </div>
    </FormModal>
  );
}

function CollectModal({ auth, onClose }: { auth: PickupAuth; onClose: () => void }) {
  const [gate, setGate] = useState('Main Gate');
  const [notes, setNotes] = useState('');
  const save = useApiMutation<{ gate: string; notes?: string }>('post', `/pickup/authorisations/${auth.id}/collect`, { invalidate: SAFETY_KEYS, onSuccess: onClose });
  return (
    <FormModal title={`Release ${auth.studentName}`} sub={`To ${auth.personName} (${auth.relation}) · verified by ${auth.method}`}
      onClose={onClose} busy={save.isPending} error={save.error} submitLabel="Confirm release" submitIcon="userCheck"
      onSubmit={() => save.mutate({ gate, ...(notes.trim() ? { notes: notes.trim() } : {}) })}>
      <div className="col g-4">
        <Banner icon="shieldCheck">Check the person's face or photo ID against the record before releasing the child. Parents are notified immediately.</Banner>
        <div className="form-grid">
          <SelectField label="Gate" required value={gate} onChange={setGate} options={GATES} />
          <TextField label="Notes" value={notes} onChange={setNotes} maxLength={500} placeholder="Optional" />
        </div>
      </div>
    </FormModal>
  );
}
