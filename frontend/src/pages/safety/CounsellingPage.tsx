import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import {
  Banner, Button, Card, Chart, charts, DataTable, Empty, ErrorState, FilterSelect, Grid, Icon, Kpi, Legend, Page, PageHead, Pagination,
  SearchInput, SelectField, Skeleton, Status, StudentLink, TextArea, TextField,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { SERIES } from '@/lib/tones';
import { FormModal, gradeOf, localInputIn, localToIso, SAFETY_KEYS, StudentPicker, useFieldErrors } from './shared';
import { SESSION_STATUSES, type CounsellingSession, type CounsellingSummary, type StudentOption } from './types';

/** datetime-local value for an ISO timestamp, in browser time. */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function CounsellingPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const manage = can('safety.manage');
  const list = useListParams({ sort: 'date', dir: 'desc', pageSize: 25 }, ['status', 'when']);
  const summary = useApiQuery<CounsellingSummary>('/counselling/summary', campusParam);
  const q = usePagedQuery<CounsellingSession>('/counselling/sessions', { ...list.query, ...campusParam });
  const [modal, setModal] = useState<CounsellingSession | 'new' | null>(null);
  const s = summary.data;
  const reasons = (s?.reasons ?? []).map((r, i) => ({ ...r, color: SERIES[i % SERIES.length] }));
  const reasonTotal = reasons.reduce((a, r) => a + r.value, 0);

  return (
    <Page>
      <PageHead
        title="Counselling"
        sub="Sessions, referrals and follow-up. Individual notes are restricted to the counsellor and the Principal."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setModal('new')}>Book a session</Button>}
      />
      {s && !s.canViewNotes && (
        <div className="mb-4"><Banner tone="warning" icon="lock">Session notes are confidential and hidden for your role. You can see who is supported and when.</Banner></div>
      )}
      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : (
        <Grid cols="g-4col">
          <Kpi icon="users" loading={!s} label="Students supported" value={fmt.n(s?.studentsSupported ?? 0)} foot="This academic year" />
          <Kpi icon="activity" loading={!s} label="Sessions this year" value={fmt.n(s?.sessionsThisYear ?? 0)} tone="info" foot="Completed sessions" />
          <Kpi icon="checkSquare" loading={!s} label="Open cases" value={fmt.n(s?.openCases ?? 0)} tone="amber" foot={s ? `${s.upcoming} upcoming session${s.upcoming === 1 ? '' : 's'}` : undefined}
            onClick={() => list.setFilter('when', 'upcoming')} />
          <Kpi icon="target" loading={!s} label="External referrals" value={fmt.n(s?.referrals ?? 0)} tone="critical" onClick={() => list.setFilter('status', 'Referred')} />
        </Grid>
      )}

      <div className="grid g-main mt-4">
        <Card icon="grid" title="Sessions" flush>
          <div className="toolbar">
            <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search student or reason" />
            <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={SESSION_STATUSES} />
            <FilterSelect label="When" value={list.filters.when} onChange={(v) => list.setFilter('when', v)}
              options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }]} />
            {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear</Button>}
          </div>
          {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <DataTable
              rows={q.data?.rows}
              loading={q.isLoading || q.isFetching}
              rowKey={(r) => r.id}
              sort={list.sort}
              onSort={list.setSort}
              onRowClick={manage || s?.canViewNotes ? setModal : undefined}
              rowClassName={(r) => (r.status === 'Referred' ? 'st-row--critical' : undefined)}
              emptyText="No sessions match these filters."
              columns={[
                { key: 'date', label: 'Date', render: (r) => <span className="t-num">{fmt.dateTime(r.sessionOn)}</span> },
                { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={gradeOf(r.grade, r.section)} /> },
                { key: 'reason', label: 'Reason', sortable: false, render: (r) => r.reason },
                { key: 'counsellor', label: 'Counsellor', render: (r) => r.counsellorName },
                { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
                {
                  key: 'notes', label: 'Notes', sortable: false,
                  render: (r) => !r.hasNotes ? <span className="t-faint">—</span>
                    : r.notes ? <span className="t-xs t-clip st-notes-cell">{r.notes}</span>
                    : <span className="row g-1 t-muted t-xs"><Icon name="lock" size={12} />Restricted</span>,
                },
              ]}
            />
          )}
          <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
        </Card>
        <Card icon="grid" title="Reasons for support" sub="Sessions this year by reason">
          {!s ? <Skeleton height={200} /> : !reasons.length ? <Empty icon="heart" title="No sessions yet this year" /> : (
            <>
              <Chart svg={charts.donut({ size: 190, thickness: 28, center: String(reasonTotal), centerSub: 'sessions', data: reasons })} />
              <div className="mt-4"><Legend items={reasons.map((r) => ({ label: `${r.label} (${r.value})`, color: r.color }))} /></div>
            </>
          )}
        </Card>
      </div>

      {modal && <SessionModal session={modal === 'new' ? null : modal} canManage={manage} canNotes={!!s?.canViewNotes} onClose={() => setModal(null)} />}
    </Page>
  );
}

function SessionModal({ session, canManage, canNotes, onClose }: { session: CounsellingSession | null; canManage: boolean; canNotes: boolean; onClose: () => void }) {
  const { lookups } = useLookups();
  const counsellors = (lookups?.staff ?? []).filter((x) => /counsel/i.test(x.designation));
  const [student, setStudent] = useState<StudentOption | null>(null);
  const [f, setF] = useState({
    counsellorId: session?.counsellorId ?? counsellors[0]?.id ?? '',
    sessionOn: session ? toLocalInput(session.sessionOn) : localInputIn(24 * 60),
    reason: session?.reason ?? '',
    status: session?.status ?? 'Scheduled',
    notes: session?.notes ?? '',
  });
  const fe = useFieldErrors();
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); fe.clear(k); };
  const save = useApiMutation<Record<string, unknown>>(session ? 'patch' : 'post', session ? `/counselling/sessions/${session.id}` : '/counselling/sessions', {
    invalidate: SAFETY_KEYS, onSuccess: onClose,
  });
  const submit = () => {
    if (!canManage) return onClose();
    const e: Record<string, string> = {};
    if (!session && !student) e.studentId = 'Choose the student';
    if (!session && !f.counsellorId) e.counsellorId = 'Choose the counsellor';
    if (!session && f.reason.trim().length < 3) e.reason = 'Enter the reason';
    if (!f.sessionOn) e.sessionOn = 'Choose a date and time';
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    const notes = canNotes && f.notes.trim() && f.notes.trim() !== (session?.notes ?? '') ? { notes: f.notes.trim() } : {};
    if (session) {
      const body: Record<string, unknown> = { ...notes };
      if (f.status !== session.status) body.status = f.status;
      if (localToIso(f.sessionOn) !== new Date(session.sessionOn).toISOString()) body.sessionOn = localToIso(f.sessionOn);
      if (!Object.keys(body).length) return onClose();
      save.mutate(body, { onError: fe.fromServer });
    } else {
      save.mutate({ studentId: student!.id, counsellorId: f.counsellorId, sessionOn: localToIso(f.sessionOn), reason: f.reason.trim(), status: f.status, ...notes }, { onError: fe.fromServer });
    }
  };
  return (
    <FormModal title={session ? `Session — ${session.studentName}` : 'Book a counselling session'} sub={session ? session.reason : undefined}
      onClose={onClose} busy={save.isPending} error={save.error} fieldErrors={fe.errors} onSubmit={submit}
      submitLabel={canManage ? (session ? 'Save session' : 'Book session') : 'Close'}>
      <div className="col g-4">
        {!session && <StudentPicker value={student} onChange={(x) => { setStudent(x); fe.clear('studentId'); }} required error={fe.errors.studentId} />}
        <div className="form-grid">
          {!session && (
            <SelectField label="Counsellor" required value={f.counsellorId} onChange={set('counsellorId')} placeholder="Choose" error={fe.errors.counsellorId}
              options={(counsellors.length ? counsellors : lookups?.staff ?? []).map((x) => ({ value: x.id, label: x.fullName }))} />
          )}
          <TextField label="Date and time" type="datetime-local" required value={f.sessionOn} onChange={set('sessionOn')} error={fe.errors.sessionOn} disabled={!canManage} />
          {!session && <TextField label="Reason" required value={f.reason} onChange={set('reason')} maxLength={200} error={fe.errors.reason} />}
          <SelectField label="Status" required value={f.status} onChange={set('status')} options={SESSION_STATUSES} disabled={!canManage} />
          {canNotes ? (
            <TextArea className="span-2" label="Confidential notes" rows={4} maxLength={4000} value={f.notes} onChange={set('notes')}
              hint="Visible only to counsellors and the Principal. Every view is audited." />
          ) : (
            <div className="span-2"><Banner tone="neutral" icon="lock">Notes can only be recorded and read by the counsellor or the Principal.</Banner></div>
          )}
        </div>
      </div>
    </FormModal>
  );
}
