import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { fmt } from '@/lib/format';
import {
  Banner, Button, Card, DataTable, ErrorState, FilterSelect, Kpi, Meter, Modal, Page, PageHead, Pagination, SearchInput,
  Segment, SelectField, Status, StudentLink, TextArea, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import type { AccountRow, ConcessionRow, ConcessionSummary } from './types';
import { fieldErrors, ListCount, Money, ReasonModal, StudentPicker, TotalsBar } from './shared';

export const CONCESSION_TYPES = ['Sibling concession', 'Staff ward concession', 'Merit scholarship', 'Need-based support', 'Sports quota'];

/** Approve / reject / review buttons shared by Concessions and Scholarships. */
export function useConcessionDecisions() {
  const confirm = useConfirm();
  const [rejecting, setRejecting] = useState<ConcessionRow | null>(null);
  const opts = { invalidate: ['/finance'], body: () => ({}) };
  const approve = useApiMutation<string>('post', (id) => `/finance/concessions/${id}/approve`, opts);
  const review = useApiMutation<string>('post', (id) => `/finance/concessions/${id}/review`, opts);
  const reject = useApiMutation<{ id: string; reason: string }>('post', (v) => `/finance/concessions/${v.id}/reject`, {
    invalidate: ['/finance'], body: (v) => ({ reason: v.reason }), onSuccess: () => setRejecting(null),
  });
  const actions = (r: ConcessionRow) => (['Submitted', 'Under Review'].includes(r.status) ? (
    <div className="row g-2 end">
      {r.status === 'Submitted' && <Button size="sm" variant="quiet" loading={review.isPending && review.variables === r.id} onClick={() => review.mutate(r.id)}>Review</Button>}
      <Button size="sm" variant="teal" icon="check" loading={approve.isPending && approve.variables === r.id} onClick={async () => {
        if (await confirm({
          title: `Approve ${r.type.toLowerCase()}?`,
          body: `${fmt.money(r.amount)} will be deducted from ${r.studentName}'s outstanding charges (tuition first). This cannot be undone from this screen.`,
          confirmLabel: 'Approve and apply', icon: 'check',
        })) approve.mutate(r.id);
      }}>Approve</Button>
      <Button size="sm" icon="x" onClick={() => setRejecting(r)}>Reject</Button>
    </div>
  ) : null);
  const modal = (
    <ReasonModal open={!!rejecting} title={`Reject ${rejecting?.type.toLowerCase() ?? ''}`} sub={rejecting ? `${rejecting.studentName} · ${fmt.money(rejecting.amount)}` : ''}
      confirmLabel="Reject" danger busy={reject.isPending} onClose={() => setRejecting(null)}
      onSubmit={(reason) => rejecting && reject.mutate({ id: rejecting.id, reason })} />
  );
  return { actions, modal };
}

export default function ConcessionsPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const s = useApiQuery<ConcessionSummary>('/finance/concessions/summary', campusParam);
  const list = useListParams({ sort: 'date', dir: 'desc' }, ['status', 'type']);
  const q = usePagedQuery<ConcessionRow>('/finance/concessions', { ...list.query, ...campusParam });
  const [creating, setCreating] = useState(false);
  const decisions = useConcessionDecisions();
  const types = s.data?.types ?? [];
  const tuition = s.data?.tuitionBilled || 0;

  return (
    <Page>
      <PageHead title="Concessions" sub="Approved reductions, their value and who authorised them."
        actions={can('finance.manage') && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New concession</Button>} />
      {s.error ? <ErrorState error={s.error} onRetry={() => s.refetch()} /> : (
        <div className="statgrid statgrid--card fw-fit" aria-label="Concessions by type">
          {(s.isLoading ? CONCESSION_TYPES.slice(0, 4).map((type) => ({ type, students: 0, value: 0, pending: 0 })) : types.filter((t) => t.type !== 'Sports quota' || t.students || t.pending)).map((c) => (
            <Kpi key={c.type} size="compact" label={c.type} value={c.students} unit="students" tone={c.pending ? 'amber' : 'info'} loading={s.isLoading}
              foot={`${fmt.money(c.value, { compact: true })} this year${c.pending ? ` · ${c.pending} pending` : ''}`}
              onClick={() => list.setFilter('type', c.type)} />
          ))}
        </div>
      )}
      <div className="mt-4">
        <Card icon="checkSquare" title="Concession register" sub="Approved value by type, as a share of tuition billed this year" flush
          foot={types.length ? <TotalsBar items={[
            { label: 'Students', value: fmt.n(types.reduce((a, t) => a + t.students, 0)) },
            { label: 'Annual value', value: fmt.money(types.reduce((a, t) => a + t.value, 0)) },
            { label: 'Share of tuition', value: tuition ? fmt.pct((types.reduce((a, t) => a + t.value, 0) / tuition) * 100, 1) : '—' },
            { label: 'Awaiting decision', value: fmt.n(types.reduce((a, t) => a + t.pending, 0)) },
          ]} /> : undefined}>
          <DataTable rows={types} loading={s.isLoading} rowKey={(r) => r.type}
            columns={[
              { key: 'type', label: 'Concession type' },
              { key: 'students', label: 'Students', className: 'num' },
              { key: 'value', label: 'Annual value', className: 'num', render: (r) => <Money v={r.value} /> },
              {
                key: 'share', label: 'Share of tuition', render: (r) => {
                  const p = tuition ? (r.value / tuition) * 100 : 0;
                  return <Meter label="" value={Math.min(100, p * 10)} right={fmt.pct(p, 1)} tone="info" />;
                },
              },
              { key: 'pending', label: 'Awaiting decision', className: 'num', render: (r) => (r.pending ? <Status value="Pending" label={`${r.pending} pending`} /> : <span className="t-faint">—</span>) },
              { key: 'a', label: '', className: 'num', render: (r) => <Button size="sm" onClick={() => list.setFilter('type', r.type)}>View students</Button> },
            ]} />
        </Card>
      </div>
      <Card flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search student or reason" />
          <FilterSelect label="Type" value={list.filters.type} onChange={(v) => list.setFilter('type', v)} options={CONCESSION_TYPES} />
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={['Submitted', 'Under Review', 'Approved', 'Rejected']} />
          {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
          <div className="spacer" />
          <ListCount total={q.data?.meta.total} noun="requests" />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable rows={q.data?.rows} loading={q.isLoading || q.isPlaceholderData} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            emptyText={list.hasFilters ? 'No concessions match the current filters.' : 'No concessions recorded this year.'}
            columns={[
              { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={`${r.grade ?? ''}${r.section ?? ''} · ${r.admissionNo}`} /> },
              { key: 'type', label: 'Type', render: (r) => <><span>{r.type}</span><div className="t-micro t-muted">{r.reason}</div></> },
              { key: 'amount', label: 'Value', className: 'num', render: (r) => <><Money v={r.amount} strong />{r.percent ? <div className="t-micro t-muted">{r.percent}% of tuition</div> : null}</> },
              { key: 'date', label: 'Requested', render: (r) => <>{fmt.date(r.createdAt)}<div className="t-micro t-muted">{r.requestedBy ?? ''}</div></> },
              { key: 'status', label: 'Status', render: (r) => <><Status value={r.status} />{r.decidedBy && <div className="t-micro t-muted">{r.decidedBy}</div>}</> },
              { key: 'a', label: '', className: 'num', sortable: false, render: (r) => can('finance.approve') && decisions.actions(r) },
            ]} />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      {decisions.modal}
      <ConcessionModal open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}

export function ConcessionModal({ open, onClose, types = CONCESSION_TYPES, title = 'New concession' }: { open: boolean; onClose: () => void; types?: string[]; title?: string }) {
  const { campusParam } = useSchool();
  const [student, setStudent] = useState<AccountRow | null>(null);
  const [type, setType] = useState(types[0]);
  const [mode, setMode] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setStudent(null); setType(types[0]); setMode('percent'); setValue(''); setReason(''); setTouched(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useApiMutation<Record<string, unknown>>('post', '/finance/concessions', { invalidate: ['/finance'], onSuccess: onClose, success: 'Concession submitted for approval' });
  const num = Number(value);
  const errs: Record<string, string> = { ...fieldErrors(save.error) };
  if (touched) {
    if (!student) errs.studentId = 'Choose a student.';
    if (!/^\d+(\.\d{1,2})?$/.test(value) || num <= 0) errs.amount = 'Enter a value greater than zero.';
    else if (mode === 'percent' && num > 100) errs.amount = 'A percentage cannot exceed 100.';
    if (reason.trim().length < 3) errs.reason = 'Explain the basis for this concession.';
  }
  const submit = () => {
    setTouched(true);
    if (!student || !(num > 0) || (mode === 'percent' && num > 100) || reason.trim().length < 3) return;
    save.mutate({ studentId: student.id, type, reason: reason.trim(), ...(mode === 'percent' ? { percent: num } : { amount: num }) });
  };
  return (
    <Modal open={open} onClose={onClose} busy={save.isPending} title={title} sub="Requests go to the principal or finance manager for approval."
      foot={<>
        <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={submit}>Submit for approval</Button>
      </>}>
      <div className="col g-3">
        {student ? (
          <div className="row between card card--tint fw-picked">
            <StudentLink id={student.id} name={student.fullName} meta={`${student.admissionNo} · ${student.grade}${student.section}`} />
            <Button size="sm" variant="quiet" onClick={() => setStudent(null)}>Change</Button>
          </div>
        ) : (
          <div className="field">
            <span className="label">Student<span className="req"> *</span></span>
            <StudentPicker onPick={setStudent} campusId={campusParam.campusId} />
            {errs.studentId && <span className="hint hint--error" role="alert">{errs.studentId}</span>}
          </div>
        )}
        <SelectField label="Type" required value={type} onChange={setType} options={types} />
        <div className="field">
          <span className="label">Value<span className="req"> *</span></span>
          <div className="row g-3">
            <Segment items={[{ id: 'percent', label: '% of tuition' }, { id: 'amount', label: 'Fixed amount' }]} active={mode} onChange={setMode} />
            <TextField type="number" min="0" step="0.01" value={value} onChange={setValue} error={errs.amount ?? errs.percent}
              placeholder={mode === 'percent' ? 'e.g. 10' : 'e.g. 30000'} className="grow" />
          </div>
        </div>
        <TextArea label="Basis / reason" required rows={3} value={reason} onChange={setReason} maxLength={500} error={errs.reason} />
        <Banner tone="neutral" icon="info">On approval the value is deducted from the student's outstanding charges, tuition first. Amounts already paid are never reduced.</Banner>
      </div>
    </Modal>
  );
}
