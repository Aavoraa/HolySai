import { useState } from 'react';
import {
  Badge, Banner, Button, Card, DataTable, Dl, ErrorState, FilterSelect, Flow, Icon, InlineError, Modal, Page, PageHead, PageSkeleton, Pagination, SearchInput,
  SelectField, Status, StudentLink, TextArea, Toolbar, useConfirm,
} from '@/components/ui';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { fmt } from '@/lib/format';
import { StudentPicker, req, useForm, type StudentPick } from '../operations/shared';

interface Transfer {
  id: string; status: string; reason: string; requestedOn: string; decidedAt: string | null; decisionNote: string | null; completedAt: string | null;
  fromCampusId: string; fromCampus: string; toCampusId: string; toCampus: string; studentId: string; studentName: string; admissionNo: string;
  grade: string | null; gradeLevel: number | null; section: string | null; currentCampus: string; requestedBy: string | null; decidedBy: string | null; completedBy: string | null;
  toSection: string | null; toGrade: string | null;
}
interface Detail extends Transfer {
  checks: { key: string; label: string; passed: boolean; detail: string }[];
  sections: { id: string; name: string; grade: string; gradeLevel: number; capacity: number; enrolled: number; room: string | null; classTeacher: string | null }[];
}
interface Summary { submitted: number; underReview: number; approved: number; completed: number; rejected: number; thisTerm: number }

export default function TransfersPage() {
  const list = useListParams({ sort: 'requested', dir: 'desc' }, ['status']);
  const { campusParam } = useSchool();
  const { can } = useAuth();
  const manage = can('group.manage');
  const q = usePagedQuery<Transfer>('/group/transfers', { ...list.query, ...campusParam });
  const sum = useApiQuery<Summary>('/group/transfers/summary', campusParam);
  const [create, setCreate] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const s = sum.data;
  const st = list.filters.status;
  return (
    <Page>
      <PageHead title="Transfers" sub="Students moving between campuses inside the group. The record moves with them."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setCreate(true)}>New transfer request</Button>} />
      <Card>
        <Flow steps={[
          { label: 'Request raised', meta: s ? `${s.submitted} new` : 'By parent or campus', state: st === 'Submitted' ? 'active' : 'done' },
          { label: 'Records checked', meta: 'Fees, documents, clearance', state: 'done' },
          { label: 'Under Review', meta: s ? `${s.underReview} pending` : '', state: !st || st === 'Under Review' ? 'active' : undefined },
          { label: 'Approved', meta: s ? `${s.approved} awaiting move` : 'Both campus heads', state: st === 'Approved' ? 'active' : undefined },
          { label: 'Record moved', meta: s ? `${s.completed} completed` : 'Student 360 travels intact', state: st === 'Completed' ? 'active' : undefined },
        ]} />
      </Card>
      <Card flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search student or reason" />
          <FilterSelect label="Status" value={st} onChange={(v) => list.setFilter('status', v)}
            options={[{ value: 'open', label: 'All open' }, 'Submitted', 'Under Review', 'Approved', 'Completed', 'Rejected']} />
          {list.hasFilters && <Button size="sm" variant="quiet" icon="x" onClick={list.clear}>Clear filters</Button>}
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
          <DataTable<Transfer>
            rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort} onRowClick={(r) => setOpen(r.id)}
            emptyText={list.hasFilters ? 'No transfers match these filters.' : 'No transfer requests yet. Requests raised by parents or campuses appear here for review.'}
            columns={[
              { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={`${r.grade ?? ''}${r.section ?? ''} · ${r.admissionNo}`} /> },
              { key: 'from', label: 'From', render: (r) => r.fromCampus },
              { key: 'to', label: 'To', render: (r) => <>{r.toCampus}{r.toSection && <div className="t-micro t-muted">{r.toGrade}{r.toSection}</div>}</> },
              { key: 'reason', label: 'Reason', sortable: false, render: (r) => <span className="t-sm t-clamp-2">{r.reason}</span> },
              { key: 'requested', label: 'Raised', render: (r) => <span className="t-num">{fmt.date(r.requestedOn)}</span> },
              { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
              { key: 'a', label: '', sortable: false, className: 'num', render: (r) => (
                <Button size="sm" variant={manage && ['Submitted', 'Under Review', 'Approved'].includes(r.status) ? 'primary' : 'ghost'}
                  onClick={(e) => { e.stopPropagation(); setOpen(r.id); }}>
                  {!manage ? 'View' : r.status === 'Approved' ? 'Complete' : ['Submitted', 'Under Review'].includes(r.status) ? 'Review' : 'View'}
                </Button>
              ) },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      {create && <CreateModal onClose={() => setCreate(false)} />}
      {open && <DetailModal id={open} manage={manage} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function CreateModal({ onClose }: { onClose: () => void }) {
  const { lookups } = useLookups();
  const f = useForm({ student: null as StudentPick | null, toCampusId: '', reason: '' });
  const v = f.values;
  const save = useApiMutation<Record<string, unknown>>('post', '/group/transfers', { invalidate: ['/group'], success: 'Transfer requested' });
  const campuses = (lookups?.campuses ?? []).filter((c) => c.shortName !== v.student?.campusName);
  const submit = async () => {
    if (!f.validate({
      student: !v.student ? 'Choose a student' : null, toCampusId: req(v.toCampusId, 'Destination campus'),
      reason: req(v.reason, 'Reason') ?? (v.reason.trim().length < 5 ? 'Give a short reason' : null),
    })) return;
    try { await save.mutateAsync({ studentId: v.student!.id, toCampusId: v.toCampusId, reason: v.reason.trim() }); onClose(); } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title="New transfer request" sub="The student stays in their current class until the transfer is completed." busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Submit request</Button></>}>
      {save.error && <div className="mb-3"><InlineError error={save.error} /></div>}
      <StudentPicker required value={v.student} onChange={(x) => f.set('student', x)} error={f.errors.student || f.errors.studentId} />
      {v.student && <p className="t-xs t-muted mt-1">Currently at {v.student.campusName}</p>}
      <div className="mt-3"><SelectField label="Move to campus" required value={v.toCampusId} onChange={(x) => f.set('toCampusId', x)} placeholder="Choose…"
        options={campuses.map((c) => ({ value: c.id, label: c.name }))} error={f.errors.toCampusId} /></div>
      <div className="mt-3"><TextArea label="Reason" required rows={3} maxLength={300} value={v.reason} onChange={(x) => f.set('reason', x)} error={f.errors.reason} /></div>
    </Modal>
  );
}

function DetailModal({ id, manage, onClose }: { id: string; manage: boolean; onClose: () => void }) {
  const q = useApiQuery<Detail>(`/group/transfers/${id}`);
  const [note, setNote] = useState('');
  const [noteErr, setNoteErr] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [secErr, setSecErr] = useState('');
  const inv = ['/group', '/students'];
  const confirm = useConfirm();
  const decide = useApiMutation<{ action: string; note?: string }>('post', `/group/transfers/${id}/decision`, {
    invalidate: inv,
    success: (_r, v) => (v.action === 'approve' ? 'Transfer approved' : v.action === 'reject' ? 'Transfer rejected' : 'Review started'),
  });
  const complete = useApiMutation<{ sectionId: string; note?: string }>('post', `/group/transfers/${id}/complete`, {
    invalidate: inv, success: 'Transfer completed — the record has moved',
  });
  const t = q.data;
  const busy = decide.isPending || complete.isPending;
  const run = async (action: string) => {
    if (action === 'reject' && !note.trim()) { setNoteErr('Give a reason for rejecting'); return; }
    if (action === 'reject' && t && !(await confirm({
      title: `Reject the transfer for ${t.studentName}?`,
      body: `${t.studentName} stays at ${t.fromCampus}. The request is closed with your note as the reason.`,
      confirmLabel: 'Reject transfer', danger: true,
    }))) return;
    try { await decide.mutateAsync({ action, note: note.trim() || undefined }); if (action !== 'review') onClose(); else setNote(''); } catch { /* toast */ }
  };
  const doComplete = async () => {
    if (!sectionId) { setSecErr('Choose the class the student joins'); return; }
    try { await complete.mutateAsync({ sectionId, note: note.trim() || undefined }); onClose(); } catch { /* toast */ }
  };
  const open = t && ['Submitted', 'Under Review'].includes(t.status);
  const failing = t?.checks.filter((c) => !c.passed) ?? [];
  const chosen = t?.sections.find((s) => s.id === sectionId);
  return (
    <Modal open onClose={onClose} busy={busy} size="wide" title={t ? `Transfer — ${t.studentName}` : 'Transfer'}
      sub={t ? `${t.fromCampus} → ${t.toCampus} · raised ${fmt.date(t.requestedOn)}${t.requestedBy ? ` by ${t.requestedBy}` : ''}` : ''}
      foot={<>
        <Button onClick={onClose}>Close</Button>
        {manage && open && <>
          <Button variant="danger" loading={decide.isPending && decide.variables?.action === 'reject'} onClick={() => run('reject')}>Reject</Button>
          {t!.status === 'Submitted' && <Button loading={decide.isPending && decide.variables?.action === 'review'} onClick={() => run('review')}>Start review</Button>}
          <Button variant="primary" icon="check" loading={decide.isPending && decide.variables?.action === 'approve'} onClick={() => run('approve')}>Approve</Button>
        </>}
        {manage && t?.status === 'Approved' && <>
          <Button variant="danger" loading={decide.isPending && decide.variables?.action === 'reject'} onClick={() => run('reject')}>Reject</Button>
          <Button variant="primary" icon="refresh" loading={complete.isPending} onClick={doComplete}>Complete transfer</Button>
        </>}
      </>}>
      {q.isLoading ? <PageSkeleton kpis={0} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : t && (
        <>
          {(decide.error || complete.error) && <div className="mb-3"><InlineError error={decide.error ?? complete.error} /></div>}
          <div className="row between g-2 wrap">
            <StudentLink id={t.studentId} name={t.studentName} meta={`${t.admissionNo} · ${t.grade ?? ''}${t.section ?? ''} · now at ${t.currentCampus}`} />
            <Status value={t.status} lg />
          </div>
          <div className="mt-3"><Dl items={[
            ['Reason', t.reason],
            ['Decision', t.decidedAt ? `${t.decidedBy ?? ''} · ${fmt.date(t.decidedAt)}` : 'Not decided yet'],
            ['Note', t.decisionNote ?? '—'],
            ...(t.completedAt ? [['Moved', `${fmt.date(t.completedAt)} to ${t.toGrade ?? ''}${t.toSection ?? ''} by ${t.completedBy ?? ''}`] as [string, string]] : []),
          ]} /></div>
          <div className="eyebrow mt-4 mb-2">Records check</div>
          <div className="card card--tint">
            <DataTable compact stack={false} rows={t.checks} rowKey={(c) => c.key} emptyText="No records checks apply to this transfer." columns={[
              { key: 'label', label: 'Check', render: (c) => <span className="row g-2"><Icon name={c.passed ? 'check' : 'alertCircle'} size={15} className={c.passed ? 't-success' : 't-warning'} />{c.label}</span> },
              { key: 'result', label: 'Result', className: 'num', render: (c) => <Badge tone={c.passed ? 'success' : 'warning'}>{c.passed ? 'Passed' : c.detail}</Badge> },
            ]} />
          </div>
          {failing.length > 0 && t.status !== 'Completed' && t.status !== 'Rejected' && (
            <div className="mt-3"><Banner tone="warning" icon="alert">Resolve or note the open items before approving: {failing.map((c) => c.label.toLowerCase()).join(', ')}.</Banner></div>
          )}
          {manage && t.status === 'Approved' && (
            <div className="mt-4">
              <Banner icon="info">Approval recorded the decision only. Completing the transfer moves {t.studentName} into a class at {t.toCampus} and carries the Student 360 record with them.</Banner>
              <div className="mt-3">
                <SelectField label={`Class at ${t.toCampus}`} required value={sectionId} onChange={(x) => { setSectionId(x); setSecErr(''); }} error={secErr} placeholder="Choose…"
                  options={t.sections.map((s) => ({ value: s.id, label: `${s.grade}${s.name} — ${s.enrolled}/${s.capacity}${s.classTeacher ? ` · ${s.classTeacher}` : ''}${s.enrolled >= s.capacity ? ' (full)' : ''}` }))}
                  hint={t.gradeLevel ? `Closest to the student's current grade listed first` : undefined} />
                {chosen && chosen.enrolled >= chosen.capacity && <p className="t-xs t-critical mt-1">This class is full.</p>}
              </div>
            </div>
          )}
          {manage && (open || t.status === 'Approved') && (
            <div className="mt-3"><TextArea label="Decision note (required to reject)" rows={2} maxLength={500} value={note} onChange={(x) => { setNote(x); setNoteErr(''); }} error={noteErr} /></div>
          )}
        </>
      )}
    </Modal>
  );
}
