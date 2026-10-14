import { useState } from 'react';
import {
  Badge, Banner, Button, Card, DataTable, Empty, ErrorState, FilterSelect, Flow, Icon, Modal, Page, PageHead, Pagination, SearchInput, SelectField,
  Status, StudentLink, TextArea, TextField, Toolbar, useConfirm, useToast,
} from '@/components/ui';
import { api } from '@/api/client';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { fmt } from '@/lib/format';
import { FormError, FormGrid, StudentPicker, req, useForm, type StudentPick } from './shared';

interface Cert {
  id: string; certificateType: string; status: string; purpose: string | null; requestedOn: string; verificationCode: string | null; issuedAt: string | null;
  studentId: string; studentName: string; admissionNo: string; grade: string | null; section: string | null; campusName: string; requestedBy: string | null; approvedBy: string | null;
}
interface Summary { requested: number; underReview: number; approved: number; issued: number; rejected: number; issuedThisMonth: number }
interface Check { key: string; label: string; passed: boolean; detail: string; blocking: boolean }
interface Verification { valid: boolean; verificationCode: string; reason: string; certificateType?: string; status?: string; issuedAt?: string; studentName?: string; admissionNo?: string; grade?: string; campus?: string }

const TYPES = ['Transfer certificate', 'Bonafide certificate', 'Conduct certificate', 'Study certificate', 'Achievement certificate'];

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function printCertificate(c: Cert) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return false;
  const body = `<!doctype html><html><head><title>${esc(c.certificateType)} — ${esc(c.studentName)}</title>
<style>body{font-family:Georgia,serif;margin:48px;color:#1b1b1b}h1{font-size:28px;letter-spacing:.04em;text-align:center;margin:0 0 4px}
.sub{text-align:center;color:#666;margin-bottom:40px}.box{border:2px solid #990033;padding:40px;border-radius:8px}p{font-size:17px;line-height:1.7}
.code{margin-top:40px;display:flex;justify-content:space-between;align-items:flex-end}.qr{border:1px dashed #999;padding:12px 16px;font-family:monospace;font-size:15px}
.sign{text-align:right}</style></head><body><div class="box">
<h1>HOLY SAI INTERNATIONAL SCHOOL</h1><div class="sub">${esc(c.campusName)} campus</div>
<h1 style="font-size:22px">${esc(c.certificateType.toUpperCase())}</h1>
<p>This is to certify that <strong>${esc(c.studentName)}</strong> (admission no. ${esc(c.admissionNo)}) ${c.grade ? `is a student of <strong>${esc(c.grade)}${esc(c.section ?? '')}</strong>` : 'is enrolled'} at Holy Sai International School.
${c.purpose ? `This certificate is issued for the purpose of: ${esc(c.purpose)}.` : ''}</p>
<div class="code"><div class="qr">Verification code<br><strong>${esc(c.verificationCode ?? '')}</strong><br><small>Verify in Holy Sai Smart School 360 → Certificates</small></div>
<div class="sign">Date: ${esc(fmt.date(c.issuedAt ?? new Date()))}<br><br><br>Principal</div></div></div>
<script>window.onload=function(){window.print()}</script></body></html>`;
  w.document.write(body);
  w.document.close();
  return true;
}

export default function CertificatesPage() {
  const list = useListParams({ sort: 'requested', dir: 'desc' }, ['status', 'type']);
  const { campusParam } = useSchool();
  const { can } = useAuth();
  const manage = can('documents.manage');
  const q = usePagedQuery<Cert>('/certificates', { ...list.query, ...campusParam });
  const sum = useApiQuery<Summary>('/certificates/summary', campusParam);
  const [issue, setIssue] = useState(false);
  const [decide, setDecide] = useState<Cert | null>(null);
  const [verify, setVerify] = useState(false);
  const confirm = useConfirm();
  const act = useApiMutation<{ id: string; action: string }, { status: string }>('post', (v) => `/certificates/${v.id}/decision`,
    { invalidate: ['/certificates'], body: (v) => ({ action: v.action }) });
  const toast = useToast();
  const print = (c: Cert) => { if (!printCertificate(c)) toast('Allow pop-ups for this site to open the print view.', 'warning'); };
  const s = sum.data;
  const st = list.filters.status;
  return (
    <Page>
      <PageHead title="Certificates" sub="Transfer, bonafide and conduct certificates, each issued with a QR code that verifies it independently."
        actions={<>
          <Button icon="qr" onClick={() => setVerify(true)}>Verify a code</Button>
          {manage && <Button variant="primary" icon="plus" onClick={() => setIssue(true)}>Issue a certificate</Button>}
        </>} />
      <Card>
        <Flow steps={[
          { label: 'Requested', meta: s ? `${s.requested} waiting` : 'By parent or office', state: st === 'Submitted' ? 'active' : 'done' },
          { label: 'Records checked', meta: 'Fees, documents, clearance', state: 'done' },
          { label: 'Under Review', meta: s ? `${s.underReview} pending` : '', state: !st || st === 'Under Review' ? 'active' : undefined },
          { label: 'Approved', meta: s ? `${s.approved} ready to issue` : 'By the Principal', state: st === 'Approved' ? 'active' : undefined },
          { label: 'Issued with QR', meta: s ? `${s.issued} issued · verifiable` : 'Verifiable by anyone', state: st === 'Issued' ? 'active' : undefined },
        ]} />
      </Card>
      <Card flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search student or code" />
          <FilterSelect label="Status" value={st} onChange={(v) => list.setFilter('status', v)} options={['Submitted', 'Under Review', 'Approved', 'Issued', 'Rejected']} />
          <FilterSelect label="Type" value={list.filters.type} onChange={(v) => list.setFilter('type', v)} options={TYPES} />
          {list.hasFilters && <Button variant="quiet" size="sm" icon="x" onClick={list.clear}>Clear</Button>}
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.isLoading && q.data && !q.data.rows.length && !list.hasFilters ? (
          <Empty icon="award" title="No certificate requests yet"
            sub="Requests from parents or the office appear here. Each certificate is checked, approved by the Principal and issued with a verification code."
            action={manage ? <Button variant="primary" icon="plus" onClick={() => setIssue(true)}>Issue a certificate</Button> : undefined} />
        ) : (
          <DataTable<Cert>
            rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            emptyText="No certificate requests match the current filters."
            columns={[
              { key: 'type', label: 'Certificate', render: (r) => <><span className="t-bold">{r.certificateType}</span>{r.purpose && <div className="t-micro t-muted">{r.purpose}</div>}</> },
              { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={`${r.grade ?? ''}${r.section ?? ''} · ${r.admissionNo}`} /> },
              { key: 'requested', label: 'Requested', render: (r) => <><span className="t-num">{fmt.date(r.requestedOn)}</span><div className="t-micro t-muted">{r.requestedBy ?? ''}</div></> },
              { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
              { key: 'code', label: 'Verification code', sortable: false, render: (r) => r.verificationCode
                ? <span className="row g-2"><Icon name="qr" size={15} className="t-muted" /><span className="t-num t-xs">{r.verificationCode}</span></span>
                : <span className="t-faint">—</span> },
              { key: 'a', label: '', sortable: false, className: 'num', render: (r) => {
                if (r.status === 'Issued') return <Button size="sm" icon="printer" onClick={() => print(r)}>Print</Button>;
                if (!manage) return null;
                if (r.status === 'Approved') return <Button size="sm" variant="primary" icon="printer" loading={act.isPending && act.variables?.id === r.id} onClick={async () => {
                  if (!(await confirm({ title: `Issue ${r.certificateType.toLowerCase()}?`, body: `Issuing ${r.verificationCode} for ${r.studentName} makes it verifiable and opens the print view.`, confirmLabel: 'Issue and print' }))) return;
                  try {
                    await act.mutateAsync({ id: r.id, action: 'issue' });
                    print({ ...r, issuedAt: new Date().toISOString() });
                  } catch { /* error toast already shown */ }
                }}>Issue &amp; print</Button>;
                if (r.status === 'Submitted' || r.status === 'Under Review') return <Button size="sm" variant="primary" onClick={() => setDecide(r)}>Review</Button>;
                return null;
              } },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      {issue && <IssueModal onClose={() => setIssue(false)} />}
      {decide && <DecisionModal cert={decide} onClose={() => setDecide(null)} />}
      {verify && <VerifyModal onClose={() => setVerify(false)} />}
    </Page>
  );
}

function ChecksList({ studentId, type }: { studentId: string; type: string }) {
  const checks = useApiQuery<Check[]>(`/certificates/checks/${studentId}`, { type });
  if (checks.isLoading) return <span className="t-sm t-muted">Running checks…</span>;
  if (checks.error) return <ErrorState error={checks.error} onRetry={checks.refetch} />;
  return (
    <div className="col g-2">
      {checks.data!.map((c) => (
        <div key={c.key} className="row between wrap g-2 card card--tint oi-ops-tile">
          <span className="t-sm">{c.label}{!c.blocking && <span className="t-micro t-muted"> · advisory for this type</span>}</span>
          <Badge tone={c.passed ? 'success' : c.blocking ? 'critical' : 'warning'} icon={c.passed ? 'check' : undefined}>{c.passed ? 'Passed' : c.detail}</Badge>
        </div>
      ))}
    </div>
  );
}

function useBlocking(studentId: string | undefined, type: string) {
  const checks = useApiQuery<Check[]>(studentId && type ? `/certificates/checks/${studentId}` : null, { type });
  return checks.data?.some((c) => c.blocking && !c.passed) ?? false;
}

function IssueModal({ onClose }: { onClose: () => void }) {
  const f = useForm({ certificateType: '', student: null as StudentPick | null, purpose: '' });
  const v = f.values;
  const blocking = useBlocking(v.student?.id, v.certificateType);
  const save = useApiMutation<Record<string, unknown>>('post', '/certificates', { invalidate: ['/certificates'], success: 'Certificate sent for approval' });
  const submit = async () => {
    if (!f.validate({ certificateType: req(v.certificateType, 'Certificate type'), student: !v.student ? 'Choose a student' : null })) return;
    try { await save.mutateAsync({ certificateType: v.certificateType, studentId: v.student!.id, purpose: v.purpose || null }); onClose(); } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title="Issue a certificate" size="wide" busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={blocking} loading={save.isPending} onClick={submit}>Send for approval</Button></>}>
      <FormGrid>
        <SelectField label="Certificate type" required value={v.certificateType} onChange={(x) => f.set('certificateType', x)} options={TYPES} placeholder="Choose…" error={f.errors.certificateType} />
        <StudentPicker required value={v.student} onChange={(x) => f.set('student', x)} error={f.errors.student || f.errors.studentId} />
      </FormGrid>
      <div className="mt-3"><TextField label="Purpose" value={v.purpose} maxLength={200} onChange={(x) => f.set('purpose', x)} placeholder="e.g. Passport application" /></div>
      {v.student && v.certificateType && (
        <div className="mt-4">
          <div className="eyebrow mb-2">Automatic checks</div>
          <ChecksList studentId={v.student.id} type={v.certificateType} />
        </div>
      )}
      <div className="mt-4"><Banner tone="warning" icon="lock">A certificate cannot be issued while a check is failing. Finance can waive a fee check with a recorded reason.</Banner></div>
      <FormError error={save.error} />
    </Modal>
  );
}

function DecisionModal({ cert, onClose }: { cert: Cert; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const blocking = useBlocking(cert.studentId, cert.certificateType);
  const act = useApiMutation<{ action: string; note?: string }, { status: string; verificationCode: string | null }>('post', `/certificates/${cert.id}/decision`, { invalidate: ['/certificates'] });
  const run = async (action: string) => {
    if (action === 'reject' && !note.trim()) { setErr('Give a reason for rejecting'); return; }
    try { await act.mutateAsync({ action, note: note.trim() || undefined }); onClose(); } catch { /* toast shown */ }
  };
  return (
    <Modal open onClose={onClose} title={`Review ${cert.certificateType.toLowerCase()}`} sub={`${cert.studentName} · ${cert.grade ?? ''}${cert.section ?? ''} · requested ${fmt.date(cert.requestedOn)}`} size="wide" busy={act.isPending}
      foot={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={act.isPending && act.variables?.action === 'reject'} onClick={() => run('reject')}>Reject</Button>
        {cert.status === 'Submitted' && <Button loading={act.isPending && act.variables?.action === 'review'} onClick={() => run('review')}>Mark under review</Button>}
        <Button variant="primary" disabled={blocking} loading={act.isPending && act.variables?.action === 'approve'} onClick={() => run('approve')}>Approve</Button>
      </>}>
      <div className="eyebrow mb-2">Automatic checks</div>
      <ChecksList studentId={cert.studentId} type={cert.certificateType} />
      {blocking && <div className="mt-3"><Banner tone="critical" icon="lock">Approval is blocked until the failing checks are resolved.</Banner></div>}
      <div className="mt-4"><TextArea label="Note (required to reject)" rows={2} maxLength={300} value={note} onChange={(x) => { setNote(x); setErr(''); }} error={err} /></div>
      <p className="t-xs t-muted mt-2">Approving assigns the QR verification code. The certificate becomes verifiable once issued.</p>
      <FormError error={act.error} />
    </Modal>
  );
}

function VerifyModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Verification | null>(null);
  const check = async () => {
    const c = code.trim().toUpperCase();
    if (!/^[A-Z]{2}-\d{4}-\d{3,6}$/.test(c)) { setErr('Codes look like TC-2026-0341'); return; }
    setBusy(true);
    try { setResult(await api.get<Verification>(`/certificates/verify/${encodeURIComponent(c)}`)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Verify a certificate" sub="Enter the code printed beside the QR mark."
      foot={<><Button onClick={onClose}>Close</Button><Button variant="primary" loading={busy} onClick={check}>Verify</Button></>}>
      <TextField label="Verification code" required value={code} onChange={(x) => { setCode(x); setErr(''); setResult(null); }} error={err} placeholder="TC-2026-0341" autoFocus />
      {result && (
        <div className="mt-4">
          <Banner tone={result.valid ? 'success' : 'critical'} icon={result.valid ? 'shieldCheck' : 'alert'}>
            <strong>{result.valid ? 'Genuine certificate' : 'Not verified'}</strong> — {result.reason}
          </Banner>
          {result.certificateType && (
            <dl className="dl mt-3">
              <dt>Certificate</dt><dd>{result.certificateType}</dd>
              <dt>Student</dt><dd>{result.studentName} ({result.admissionNo})</dd>
              <dt>Class</dt><dd>{result.grade ?? '—'}</dd>
              <dt>Campus</dt><dd>{result.campus}</dd>
              <dt>Status</dt><dd><Status value={result.status} /></dd>
              <dt>Issued</dt><dd>{fmt.date(result.issuedAt)}</dd>
            </dl>
          )}
        </div>
      )}
    </Modal>
  );
}
