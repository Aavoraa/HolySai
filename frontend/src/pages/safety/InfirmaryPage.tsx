import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import {
  Badge, Button, Card, Chart, charts, Checkbox, DataTable, Empty, ErrorState, FilterSelect, Grid, Kpi, Page, PageHead, Pagination,
  SearchInput, SelectField, Skeleton, StudentLink, TextField,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { SERIES } from '@/lib/tones';
import { FormModal, gradeOf, localInputIn, localToIso, SAFETY_KEYS, StudentPicker, todayIso, useFieldErrors } from './shared';
import { OUTCOMES, type InfirmarySummary, type InfirmaryVisit, type StudentOption } from './types';

const outcomeTone = (o: string) => (o === 'Returned to class' ? 'success' : o === 'Under observation' ? 'info' : o === 'Referred to hospital' ? 'critical' : 'warning');

export default function InfirmaryPage() {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const manage = can('safety.manage');
  const list = useListParams({ sort: 'time', dir: 'desc', pageSize: 25 }, ['date', 'outcome']);
  const date = list.filters.date || todayIso();
  const summary = useApiQuery<InfirmarySummary>('/infirmary/summary', campusParam);
  const q = usePagedQuery<InfirmaryVisit>('/infirmary/visits', { ...list.query, date, ...campusParam });
  const [modal, setModal] = useState<InfirmaryVisit | 'new' | null>(null);
  const s = summary.data;
  const isToday = date === todayIso();

  return (
    <Page>
      <PageHead
        title="Health & Infirmary"
        sub="Visits, actions taken and the parents informed. Health notes feed the restricted Wellbeing tab on each profile."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setModal('new')}>Log a visit</Button>}
      />
      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : (
        <Grid cols="g-4col">
          <Kpi icon="target" loading={!s} label="Visits today" value={fmt.n(s?.today ?? 0)} foot={s?.parentNotInformed ? `${s.parentNotInformed} parent${s.parentNotInformed === 1 ? '' : 's'} not yet informed` : 'All parents informed'} />
          <Kpi icon="activity" loading={!s} label="Sent home" value={fmt.n(s?.sentHome ?? 0)} tone="amber" foot={s ? `${s.awaitingPickup} awaiting pickup` : undefined} />
          <Kpi icon="target" loading={!s} label="Visits this month" value={fmt.n(s?.thisMonth ?? 0)} tone="info" delta={s?.monthDeltaPct ?? null} inverse foot="vs same point last month" />
          <Kpi icon="fileText" loading={!s} label="Medical notes on file" value={fmt.n(s?.medicalOnFile ?? 0)} unit="students" tone="critical" foot="Allergy or condition flagged" />
        </Grid>
      )}

      <div className="grid g-main mt-4">
        <Card title={isToday ? 'Today’s visits' : `Visits on ${fmt.date(date)}`} flush>
          <div className="toolbar">
            <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search student or reason" />
            <input className="input st-date" type="date" aria-label="Date" value={date} max={todayIso()}
              onChange={(e) => list.setFilter('date', e.target.value === todayIso() ? '' : e.target.value)} />
            <FilterSelect label="Outcome" value={list.filters.outcome} onChange={(v) => list.setFilter('outcome', v)} options={OUTCOMES} />
          </div>
          {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <DataTable
              rows={q.data?.rows}
              loading={q.isLoading || q.isFetching}
              rowKey={(r) => r.id}
              sort={list.sort}
              onSort={list.setSort}
              rowClassName={(r) => (r.outcome === 'Referred to hospital' ? 'st-row--critical' : undefined)}
              emptyText="No infirmary visits for this day."
              columns={[
                { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={gradeOf(r.grade, r.section)} /> },
                { key: 'time', label: 'Time', render: (r) => <span className="t-num">{fmt.time(r.visitedAt)}</span> },
                { key: 'reason', label: 'Reason' },
                { key: 'action', label: 'Action taken', sortable: false, render: (r) => <>{r.actionTaken ?? '—'}<div className={`t-micro ${r.parentInformed ? 't-muted' : 't-warning'}`}>{r.parentInformed ? 'Parent informed' : 'Parent not yet informed'}</div></> },
                { key: 'outcome', label: 'Outcome', render: (r) => <Badge tone={outcomeTone(r.outcome)} icon={r.outcome === 'Referred to hospital' ? 'alert' : undefined}>{r.outcome}</Badge> },
                ...(manage ? [{
                  key: 'a', label: '', sortable: false, className: 'num',
                  render: (r: InfirmaryVisit) => <Button size="sm" onClick={() => setModal(r)}>Update</Button>,
                }] : []),
              ]}
            />
          )}
          <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
        </Card>
        <Card icon="grid" title="Reasons this term" sub="Most common reasons for a visit">
          {!s ? <Skeleton height={180} /> : !s.reasons.length ? <Empty icon="stethoscope" title="No visits this term" /> : (
            <Chart svg={charts.hbar({ rows: s.reasons.map((r, i) => ({ label: r.label, value: r.value, color: SERIES[i % SERIES.length] })), labelW: 150, rowH: 30 })} />
          )}
        </Card>
      </div>

      {modal === 'new' && <VisitModal onClose={() => setModal(null)} />}
      {modal && modal !== 'new' && <OutcomeModal visit={modal} onClose={() => setModal(null)} />}
    </Page>
  );
}

function VisitModal({ onClose }: { onClose: () => void }) {
  const [student, setStudent] = useState<StudentOption | null>(null);
  const [f, setF] = useState({ reason: '', actionTaken: '', outcome: 'Under observation', parentInformed: false, visitedAt: localInputIn(0) });
  const fe = useFieldErrors();
  const set = (k: keyof typeof f) => (v: string | boolean) => { setF((x) => ({ ...x, [k]: v })); fe.clear(k); };
  const save = useApiMutation<Record<string, unknown>>('post', '/infirmary/visits', { invalidate: SAFETY_KEYS, onSuccess: onClose });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!student) e.studentId = 'Choose the student';
    if (f.reason.trim().length < 2) e.reason = 'Enter the reason for the visit';
    if (!f.visitedAt || new Date(f.visitedAt).getTime() > Date.now() + 60_000) e.visitedAt = 'The time cannot be in the future';
    fe.setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({
      studentId: student!.id, reason: f.reason.trim(), outcome: f.outcome, parentInformed: f.parentInformed, visitedAt: localToIso(f.visitedAt),
      ...(f.actionTaken.trim() ? { actionTaken: f.actionTaken.trim() } : {}),
    }, { onError: fe.fromServer });
  };
  return (
    <FormModal title="Log an infirmary visit" onClose={onClose} busy={save.isPending} error={save.error} fieldErrors={fe.errors} onSubmit={submit} submitLabel="Log visit">
      <div className="formsection">
        <div className="formsection__title">Student</div>
        <StudentPicker value={student} onChange={(s) => { setStudent(s); fe.clear('studentId'); }} required error={fe.errors.studentId} />
      </div>
      <div className="formsection">
        <div className="formsection__title">Visit</div>
        <div className="form-grid">
          <TextField label="Reason" required value={f.reason} onChange={set('reason')} maxLength={200} placeholder="Headache, minor cut…" error={fe.errors.reason} />
          <TextField label="Time" type="datetime-local" required value={f.visitedAt} onChange={set('visitedAt')} error={fe.errors.visitedAt} />
          <TextField className="span-2" label="Action taken" value={f.actionTaken} onChange={set('actionTaken')} maxLength={500} />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Outcome</div>
        <div className="form-grid">
          <SelectField label="Outcome" required value={f.outcome} onChange={set('outcome')} options={OUTCOMES} />
          <div className="st-checkcell">
            <Checkbox checked={f.parentInformed} onChange={set('parentInformed')} label="Inform parents now" />
          </div>
        </div>
      </div>
    </FormModal>
  );
}

function OutcomeModal({ visit, onClose }: { visit: InfirmaryVisit; onClose: () => void }) {
  const [f, setF] = useState({ outcome: visit.outcome, actionTaken: visit.actionTaken ?? '', parentInformed: visit.parentInformed });
  const save = useApiMutation<Record<string, unknown>>('patch', `/infirmary/visits/${visit.id}`, { invalidate: SAFETY_KEYS, onSuccess: onClose });
  const submit = () => save.mutate({
    outcome: f.outcome, parentInformed: f.parentInformed,
    ...(f.actionTaken.trim() && f.actionTaken.trim() !== (visit.actionTaken ?? '') ? { actionTaken: f.actionTaken.trim() } : {}),
  });
  return (
    <FormModal title={`Update visit — ${visit.studentName}`} sub={`${visit.reason} · ${fmt.time(visit.visitedAt)}`} onClose={onClose}
      busy={save.isPending} error={save.error} onSubmit={submit} submitLabel="Save">
      <div className="form-grid">
        <SelectField label="Outcome" required value={f.outcome} onChange={(v) => setF((x) => ({ ...x, outcome: v }))} options={OUTCOMES} />
        <div className="st-checkcell">
          <Checkbox checked={f.parentInformed} disabled={visit.parentInformed} onChange={(v) => setF((x) => ({ ...x, parentInformed: v }))}
            label={visit.parentInformed ? 'Parents already informed' : 'Inform parents now'} />
        </div>
        <TextField className="span-2" label="Action taken" value={f.actionTaken} maxLength={500} onChange={(v) => setF((x) => ({ ...x, actionTaken: v }))} />
      </div>
    </FormModal>
  );
}
