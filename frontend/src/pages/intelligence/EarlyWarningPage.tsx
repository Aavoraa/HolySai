import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import { ApiError } from '@/api/client';
import { fmt, todayKey } from '@/lib/format';
import {
  AiNotice, Badge, Banner, Button, Card, DataTable, Dl, Empty, ErrorState, FilterSelect, Flow, Grid, Kpi, Meter, Modal,
  Page, PageHead, Pagination, Risk, SearchInput, Segment, SelectField, Skeleton, Stepper, StudentLink, Tabs, TextArea,
  TextField, Timeline, Toolbar, useConfirm,
} from '@/components/ui';
import {
  RISK_LEVELS, STAGES, STAGE_SHORT, TrendCell, useCsvDownload,
  type EwStudent, type EwSummary, type RunCheckResult, type Signal, type SignalDetail,
} from './shared';

const INTERVENTIONS = ['Review pending', 'Planned', 'Active', 'Monitoring', 'None'];
const SIGNAL_TABS = [
  { id: 'awaiting', label: 'Awaiting review' },
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
  { id: 'dismissed', label: 'Dismissed' },
] as const;
type SignalTab = (typeof SIGNAL_TABS)[number]['id'];

const addDaysKey = (n: number) => {
  const d = new Date(`${todayKey()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function EarlyWarningPage() {
  const { can } = useAuth();
  const canManage = can('earlywarning.manage');
  const { campusParam, campus, scope } = useSchool();
  const { gradeNames } = useLookups();
  const list = useListParams({ sort: 'attendance', dir: 'asc' }, ['grade', 'risk', 'intervention']);
  const { download, busy } = useCsvDownload();

  const summary = useApiQuery<EwSummary>('/early-warning/summary', campusParam);
  const students = usePagedQuery<EwStudent>('/early-warning/students', { ...list.query, ...campusParam });
  const [tab, setTab] = useState<SignalTab>('awaiting');
  const [sigPage, setSigPage] = useState(1);
  const signals = usePagedQuery<Signal>('/early-warning/signals', { status: tab, page: sigPage, pageSize: 10, sort: 'raised', dir: 'desc', ...campusParam });

  const [reviewing, setReviewing] = useState<{ id: string; decision: 'accept' | 'dismiss' } | null>(null);
  const [managing, setManaging] = useState<string | null>(null);
  const [explain, setExplain] = useState(false);
  const [check, setCheck] = useState(false);

  const openFor = (r: { signalId: string | null; decision: string | null }) => {
    if (!r.signalId) return;
    if (!r.decision) setReviewing({ id: r.signalId, decision: 'accept' });
    else setManaging(r.signalId);
  };

  const s = summary.data;
  return (
    <Page>
      <PageHead
        title="Early Warning"
        sub="Early support, not automated labelling. A signal only becomes an intervention after a teacher reviews it."
        actions={<>
          <Button icon="helpCircle" onClick={() => setExplain(true)}>How this works</Button>
          {canManage && <Button variant="primary" icon="zap" onClick={() => setCheck(true)}>Run signal check</Button>}
        </>}
      />

      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : (
        <>
          <Grid cols="g-4col">
            <Kpi label="At Risk" icon="alert" value={s?.bands.atRisk ?? '—'} tone="critical" loading={summary.isLoading} foot="Two or more indicators declining" onClick={() => list.setFilter('risk', 'At Risk')} />
            <Kpi label="Developing Risk" icon="trending" value={s?.bands.developing ?? '—'} tone="amber" loading={summary.isLoading} foot="One indicator slipping" onClick={() => list.setFilter('risk', 'Developing Risk')} />
            <Kpi label="On Track" icon="check" value={s ? fmt.n(s.bands.onTrack + s.bands.watch) : '—'} tone="teal" loading={summary.isLoading} foot={s?.bands.watch ? `No action needed · ${s.bands.watch} on watch` : 'No action needed'} onClick={() => list.setFilter('risk', 'On Track')} />
            <Kpi label="Awaiting review" icon="clock" value={s?.awaitingReview ?? '—'} tone="info" loading={summary.isLoading}
              foot={s?.overdueReviews ? `${s.overdueReviews} reviews overdue` : 'Signals waiting for a teacher'}
              onClick={() => { setTab('awaiting'); setSigPage(1); document.getElementById('ew-signals')?.scrollIntoView({ behavior: 'smooth' }); }} />
          </Grid>
          <div className="mt-4">
            <Card icon="alert" title="Signal to closure" sub={s ? `${s.openInterventions} interventions open · ${s.closedThisTerm} closed this term · ${s.reviewed} signals reviewed${s.overdueReviews ? ` · ${s.overdueReviews} reviews overdue` : ''}` : 'Loading…'}>
              {s ? (
                <Flow steps={s.stages.map((st, i) => ({
                  label: st.label,
                  meta: `${st.count} ${i === 5 ? 'closed this term' : st.count === 1 ? 'student' : 'students'}`,
                  state: i === 0 ? 'done' : i === 1 ? 'active' : undefined,
                }))} />
              ) : <Skeleton height={56} />}
            </Card>
          </div>
        </>
      )}

      <div className="mt-4">
      <Card
        flush
        title="Students needing attention"
        sub={`${scope === 'group' ? 'All campuses' : campus?.name ?? 'All campuses'}${students.data ? ` · ${fmt.n(students.data.meta.total)} students listed` : ''}`}
        actions={<Button size="sm" icon="download" title="Download this review list as a CSV file" loading={busy === 'ew'} onClick={() => download('ew', '/early-warning/export', { ...list.query, page: undefined, pageSize: undefined, ...campusParam }, 'early-warning-review.csv')}>Export</Button>}
      >
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search students" maxWidth={240} />
          <FilterSelect label="Grade" value={list.filters.grade} onChange={(v) => list.setFilter('grade', v)} options={gradeNames} />
          <FilterSelect label="Risk level" value={list.filters.risk} onChange={(v) => list.setFilter('risk', v)} options={RISK_LEVELS} allLabel="Needs attention" />
          <FilterSelect label="Intervention" value={list.filters.intervention} onChange={(v) => list.setFilter('intervention', v)} options={INTERVENTIONS} />
          {list.hasFilters && <Button size="sm" variant="quiet" icon="x" onClick={list.clear}>Clear filters</Button>}
        </Toolbar>
        {students.error ? <ErrorState error={students.error} onRetry={() => students.refetch()} /> : (
          <DataTable<EwStudent>
            rows={students.data?.rows}
            loading={students.isLoading || students.isFetching}
            rowKey={(r) => r.id}
            sort={list.sort}
            onSort={list.setSort}
            emptyText={list.hasFilters ? 'No students match these filters.' : 'No students need attention right now. Every student in this view is on track.'}
            columns={[
              { key: 'name', label: 'Student', render: (r) => <StudentLink id={r.id} name={r.fullName} meta={`${r.grade ?? ''}${r.section ?? ''} · ${r.admissionNo}`} /> },
              { key: 'grade', label: 'Grade', render: (r) => `${r.grade ?? '—'} ${r.section ?? ''}` },
              { key: 'attendance', label: 'Attendance', className: 'num', render: (r) => r.attendance == null ? <span className="t-faint">—</span> : (
                <Meter label="" value={r.attendance} right={`${r.attendance}%`} tone={r.attendance < 85 ? 'critical' : r.attendance < 90 ? 'amber' : 'teal'} />
              ) },
              { key: 'trend', label: 'Academic trend', render: (r) => <><TrendCell value={r.trend} /><div className="t-micro t-muted">avg {r.average ?? '—'}</div></> },
              { key: 'risk', label: 'Risk', render: (r) => <Risk value={r.risk} /> },
              { key: 'intervention', label: 'Intervention', render: (r) => r.intervention === 'None'
                ? <span className="t-faint">—</span>
                : <Badge tone={r.intervention === 'Active' ? 'info' : r.intervention === 'Review pending' ? 'warning' : 'neutral'} title={r.signalCode ?? undefined}>{r.intervention}</Badge> },
              { key: 'owner', label: 'Owner', render: (r) => r.owner ?? <span className="t-faint">—</span> },
              { key: 'act', label: '', sortable: false, className: 'num', render: (r) => r.signalId ? (
                <Button size="sm" onClick={() => openFor({ signalId: r.signalId, decision: r.signalDecision })}>
                  {r.signalDecision ? (canManage ? 'Update' : 'View') : canManage ? 'Review' : 'View'}
                </Button>
              ) : <Button size="sm" variant="quiet" to={`/student-360/${r.id}`}>Open</Button> },
            ]}
          />
        )}
        <Pagination meta={students.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      </div>

      <div className="mt-4">
        <Card icon="alert"
          id="ew-signals"
          title="Signals"
          sub={tab === 'awaiting' ? 'Raised by the system, not yet accepted by a teacher' : tab === 'open' ? 'Every signal that is not yet closed' : tab === 'closed' ? 'Interventions closed with a recorded outcome' : 'Dismissed after teacher review — the reason is in the audit trail'}
          flush
        >
          <Toolbar>
            <Tabs pills items={SIGNAL_TABS.map((t) => ({ id: t.id, label: t.label, count: t.id === 'awaiting' ? s?.awaitingReview : undefined }))} active={tab} onChange={(t) => { setTab(t); setSigPage(1); }} />
          </Toolbar>
          {signals.error ? <ErrorState error={signals.error} onRetry={() => signals.refetch()} /> : (
            <DataTable<Signal>
              rows={signals.data?.rows}
              loading={signals.isLoading}
              rowKey={(r) => r.id}
              emptyText={tab === 'awaiting' ? 'No signals are waiting for review.' : tab === 'open' ? 'No open signals. New ones appear here after a signal check.' : tab === 'closed' ? 'No interventions have been closed yet.' : 'No signals have been dismissed.'}
              columns={[
                { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={`${r.grade ?? ''}${r.section ?? ''} · ${r.code}`} /> },
                { key: 'signal', label: 'Signal', render: (r) => <><div className="t-sm">{r.signal}</div>{r.actionPlan && <div className="t-micro t-muted">{r.actionPlan}</div>}</> },
                { key: 'stage', label: 'Stage', render: (r) => r.decision === 'dismissed' ? <Badge tone="neutral">Dismissed</Badge> : <Stepper steps={STAGE_SHORT} active={r.stage} /> },
                { key: 'owner', label: 'Owner', render: (r) => r.owner ?? <span className="t-faint">Unassigned</span> },
                { key: 'raised', label: 'Raised', render: (r) => <>{fmt.date(r.raisedOn)}{r.nextReviewOn && <div className="t-micro t-muted">Review {fmt.dateShort(r.nextReviewOn)}</div>}</> },
                { key: 'a', label: '', className: 'num', render: (r) => (
                  <div className="row g-2 end">
                    {!r.decision && !r.closedAt && canManage ? <>
                      <Button size="sm" variant="teal" onClick={() => setReviewing({ id: r.id, decision: 'accept' })}>Accept</Button>
                      <Button size="sm" onClick={() => setReviewing({ id: r.id, decision: 'dismiss' })}>Dismiss</Button>
                    </> : r.decision === 'accepted' && !r.closedAt && canManage ? (
                      <Button size="sm" variant="primary" onClick={() => setManaging(r.id)}>Update</Button>
                    ) : (
                      <Button size="sm" variant="quiet" onClick={() => (r.decision ? setManaging(r.id) : setReviewing({ id: r.id, decision: 'accept' }))}>View</Button>
                    )}
                  </div>
                ) },
              ]}
            />
          )}
          <Pagination meta={signals.data?.meta} onPage={setSigPage} />
        </Card>
      </div>

      {reviewing && <ReviewModal id={reviewing.id} initial={reviewing.decision} canManage={canManage} onClose={() => setReviewing(null)} />}
      {managing && <InterventionModal id={managing} canManage={canManage} onClose={() => setManaging(null)} />}
      <ExplainModal open={explain} onClose={() => setExplain(false)} thresholds={s?.thresholds} />
      {check && <RunCheckModal thresholds={s?.thresholds} campusId={campusParam.campusId} onClose={() => setCheck(false)} />}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Evidence panel shared by both dialogs
// ---------------------------------------------------------------------------
function Evidence({ d }: { d: SignalDetail }) {
  const att = d.student?.attendance;
  return (
    <Card icon="alert" title="What the signal is" tight>
      <Dl items={[
        ['Signal', <>{d.signal} <span className="t-micro t-muted">({d.code} · {d.signalType})</span></>],
        ['Attendance', att == null ? '—' : <span className={att < d.thresholds.attendance ? 't-critical t-bold' : undefined}>{att}% (threshold {d.thresholds.attendance}%)</span>],
        ['Academic trend', d.student ? <>{d.student.trend > 0 ? '+' : ''}{d.student.trend} on last term · average {d.student.average ?? '—'}</> : '—'],
        ['Last 30 days', `${d.participation.absent30} absent · ${d.participation.late30} late`],
        ['Participation', `${d.participation.activities} active activities · ${d.participation.positives} positive / ${d.participation.concerns} concern notes (60 days)`],
        ['Band', <Risk value={d.risk} />],
        ['Raised', `${fmt.date(d.raisedOn)}${d.owner ? ` · owner ${d.owner}` : ''}`],
      ]} />
    </Card>
  );
}

function useSignal(id: string) {
  return useApiQuery<SignalDetail>(`/early-warning/signals/${id}`);
}

// ---------------------------------------------------------------------------
// Teacher review (accept / dismiss)
// ---------------------------------------------------------------------------
function ReviewModal({ id, initial, canManage, onClose }: { id: string; initial: 'accept' | 'dismiss'; canManage: boolean; onClose: () => void }) {
  const q = useSignal(id);
  const { lookups } = useLookups();
  const confirm = useConfirm();
  const [decision, setDecision] = useState<'accept' | 'dismiss'>(initial);
  const [form, setForm] = useState({ context: '', actionPlan: '', ownerId: '', nextReviewOn: addDaysKey(7), riskLevel: '', reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => { if (q.data?.ownerId) setForm((f) => (f.ownerId ? f : { ...f, ownerId: q.data!.ownerId! })); }, [q.data]);

  const review = useApiMutation<Record<string, unknown>>('post', `/early-warning/signals/${id}/review`, {
    invalidate: ['/early-warning', '/students', '/dashboard'],
    onSuccess: onClose,
    error: false,
  });
  const staff = useMemo(() => (lookups?.staff ?? []).map((s) => ({ value: s.id, label: `${s.fullName} — ${s.designation}` })), [lookups]);
  const d = q.data;
  const reviewable = d && !d.decision && !d.closedAt && d.stage <= 1;

  const submit = async () => {
    const e: Record<string, string> = {};
    if (decision === 'accept') {
      if (form.actionPlan.trim().length < 5) e.actionPlan = 'Describe the agreed support (at least 5 characters)';
      if (!form.ownerId) e.ownerId = 'Choose who owns this intervention';
      if (!form.nextReviewOn) e.nextReviewOn = 'Choose a review date';
      else if (form.nextReviewOn < todayKey()) e.nextReviewOn = 'Choose today or a later date';
    } else if (form.reason.trim().length < 5) e.reason = 'Record why this signal is being dismissed';
    setErrors(e);
    if (Object.keys(e).length) return;
    if (decision === 'dismiss' && !(await confirm({
      title: `Dismiss ${d?.code}?`, body: 'The reason is kept in the audit trail and the same cause will not be re-raised for 30 days.', confirmLabel: 'Dismiss signal', danger: true,
    }))) return;
    const body = decision === 'accept'
      ? { decision, actionPlan: form.actionPlan.trim(), ownerId: form.ownerId, nextReviewOn: form.nextReviewOn, riskLevel: form.riskLevel || undefined, context: form.context.trim() || undefined }
      : { decision, reason: form.reason.trim(), context: form.context.trim() || undefined };
    review.mutate(body, { onError: (err) => setErrors(err instanceof ApiError ? { ...err.fieldErrors, _: err.message } : { _: String(err) }) });
  };

  return (
    <Modal
      open onClose={onClose} size="wide" busy={review.isPending}
      title="Teacher review"
      sub={d ? `${d.studentName} · ${d.grade ?? ''}${d.section ?? ''} · ${d.admissionNo}` : 'Loading…'}
      foot={<>
        <Button onClick={onClose}>{reviewable && canManage ? 'Cancel' : 'Close'}</Button>
        {reviewable && canManage && (decision === 'accept'
          ? <Button variant="primary" icon="flag" loading={review.isPending} onClick={submit}>Accept and open intervention</Button>
          : <Button variant="danger" loading={review.isPending} onClick={submit}>Dismiss signal</Button>)}
      </>}
    >
      {q.isLoading ? <Skeleton height={220} /> : q.error || !d ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          {!reviewable && <Banner tone="neutral" icon="info">This signal has already been {d.decision ?? 'closed'}{d.reviewedBy ? ` by ${d.reviewedBy}` : ''}.</Banner>}
          <div className="grid g-2col g-4">
            <div><Evidence d={d} /></div>
            <div>
              <Card icon="grid" title="What the teacher knows" tight>
                <p className="t-sm t-muted">The system cannot see context. Record what you know before deciding.</p>
                <div className="mt-3">
                  <TextArea label="Context" value={form.context} onChange={set('context')} rows={4} maxLength={2000} disabled={!reviewable || !canManage}
                    placeholder="For example: family travel in August, recovering from illness, settled again since." hint="Saved as a teacher observation on Student 360." />
                </div>
                {d.observations.length > 0 && (
                  <div className="mt-3">
                    <div className="eyebrow mb-2">Recent observations</div>
                    <Timeline items={d.observations.slice(0, 3).map((o) => ({ time: `${fmt.date(o.date)} · ${o.by}`, title: o.text }))} />
                  </div>
                )}
              </Card>
            </div>
          </div>

          {reviewable && canManage && (
            <div className="mt-4">
              <Segment items={[{ id: 'accept', label: 'Accept — open intervention' }, { id: 'dismiss', label: 'Dismiss with a reason' }]} active={decision} onChange={(v) => { setDecision(v); setErrors({}); }} />
              {decision === 'accept' ? (
                <div className="grid g-2col g-3 mt-3">
                  <TextArea label="Action plan" required value={form.actionPlan} onChange={set('actionPlan')} rows={3} maxLength={1000} error={errors.actionPlan}
                    placeholder="For example: two small-group clinics a week and a parent call on Friday." style={{ gridColumn: '1 / -1' }} />
                  <SelectField label="Owner" required value={form.ownerId} onChange={set('ownerId')} options={staff} placeholder="Choose a member of staff" error={errors.ownerId} />
                  <TextField label="Next review" required type="date" min={todayKey()} value={form.nextReviewOn} onChange={set('nextReviewOn')} error={errors.nextReviewOn} />
                  <SelectField label="Risk level" value={form.riskLevel} onChange={set('riskLevel')} options={RISK_LEVELS}
                    placeholder="Automatic — raise by number of indicators" hint={`Currently ${d.risk}. Automatic never lowers the band.`} />
                </div>
              ) : (
                <div className="mt-3">
                  <TextArea label="Reason for dismissing" required value={form.reason} onChange={set('reason')} rows={3} maxLength={1000} error={errors.reason}
                    placeholder="For example: absences were approved medical leave recorded late." />
                </div>
              )}
              {errors._ && <div className="mt-3"><Banner tone="critical" icon="alert">{errors._}</Banner></div>}
            </div>
          )}
          <div className="mt-4">
            <AiNotice><strong>The system raised this, a person decides it.</strong> Accepting opens an intervention with an owner and a review date. Dismissing records your reason so the signal is not re-raised for the same cause.</AiNotice>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Intervention follow-through (advance / close)
// ---------------------------------------------------------------------------
function InterventionModal({ id, canManage, onClose }: { id: string; canManage: boolean; onClose: () => void }) {
  const q = useSignal(id);
  const confirm = useConfirm();
  const d = q.data;
  const open = d && d.decision === 'accepted' && !d.closedAt;
  const canAdvance = open && d.stage >= 2 && d.stage <= 3;
  const [mode, setMode] = useState<'advance' | 'close'>('advance');
  useEffect(() => { if (d && !(d.stage >= 2 && d.stage <= 3)) setMode('close'); }, [d]);
  const [form, setForm] = useState({ note: '', nextReviewOn: '', outcome: '', riskLevel: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const opts = { invalidate: ['/early-warning', '/students', '/dashboard'], onSuccess: onClose, error: false as const };
  const advance = useApiMutation<Record<string, unknown>>('post', `/early-warning/signals/${id}/advance`, opts);
  const close = useApiMutation<Record<string, unknown>>('post', `/early-warning/signals/${id}/close`, opts);
  const pending = advance.isPending || close.isPending;
  const onErr = (err: Error) => setErrors(err instanceof ApiError ? { ...err.fieldErrors, _: err.message } : { _: err.message });

  const submit = async () => {
    const e: Record<string, string> = {};
    if (mode === 'advance') {
      if (form.note.trim().length < 3) e.note = 'Record what was done';
      if (form.nextReviewOn && form.nextReviewOn < todayKey()) e.nextReviewOn = 'Choose today or a later date';
    } else if (form.outcome.trim().length < 5) e.outcome = 'Record the outcome before closing';
    setErrors(e);
    if (Object.keys(e).length || !d) return;
    if (mode === 'advance') {
      advance.mutate({ note: form.note.trim(), nextReviewOn: form.nextReviewOn || undefined }, { onError: onErr });
    } else if (await confirm({ title: `Close ${d.code}?`, body: 'Closing records the outcome and ends the intervention. This cannot be reopened.', confirmLabel: 'Close intervention', icon: 'check' })) {
      close.mutate({ outcome: form.outcome.trim(), riskLevel: form.riskLevel || undefined }, { onError: onErr });
    }
  };

  return (
    <Modal
      open onClose={onClose} size="wide" busy={pending}
      title={d ? `${d.code} · ${STAGES[d.stage]}` : 'Intervention'}
      sub={d ? `${d.studentName} · ${d.grade ?? ''}${d.section ?? ''} · ${d.admissionNo}` : 'Loading…'}
      foot={<>
        <Button onClick={onClose}>{open && canManage ? 'Cancel' : 'Close'}</Button>
        {open && canManage && (mode === 'advance'
          ? <Button variant="primary" icon="arrowRight" loading={pending} onClick={submit}>Move to {STAGES[(d?.stage ?? 0) + 1]}</Button>
          : <Button variant="teal" icon="check" loading={pending} onClick={submit}>Close with outcome</Button>)}
      </>}
    >
      {q.isLoading ? <Skeleton height={220} /> : q.error || !d ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <Stepper steps={STAGE_SHORT} active={d.decision === 'dismissed' ? 1 : d.stage} />
          <div className="grid g-2col g-4 mt-4">
            <div><Evidence d={d} /></div>
            <div className="col g-4">
              <Card icon="grid" title="Intervention" tight>
                <Dl items={[
                  ['Decision', d.decision === 'dismissed' ? <Badge tone="neutral">Dismissed</Badge> : <Badge tone="success">Accepted</Badge>],
                  ['Action plan', d.actionPlan ?? '—'],
                  ['Owner', d.owner ?? '—'],
                  ['Next review', d.nextReviewOn ? fmt.date(d.nextReviewOn) : '—'],
                  ['Reviewed', d.reviewedAt ? `${fmt.dateTime(d.reviewedAt)} · ${d.reviewedBy ?? ''}` : '—'],
                ]} />
              </Card>
              <Card icon="activity" title="History" tight>
                {d.history.length ? (
                  <Timeline items={d.history.slice(0, 6).map((h) => ({ time: `${fmt.dateTime(h.at)} · ${h.by}`, title: h.description, tone: h.action === 'approve' ? 'teal' : h.action === 'dismiss' ? 'amber' : undefined }))} />
                ) : <Empty icon="clock" title="No actions recorded yet" />}
              </Card>
            </div>
          </div>
          {open && canManage && (
            <div className="mt-4">
              <Segment
                items={[...(canAdvance ? [{ id: 'advance' as const, label: `Record progress → ${STAGES[d.stage + 1]}` }] : []), { id: 'close' as const, label: 'Close with outcome' }]}
                active={mode} onChange={(v) => { setMode(v); setErrors({}); }}
              />
              {mode === 'advance' ? (
                <div className="grid g-2col g-3 mt-3">
                  <TextArea label="What was done" required value={form.note} onChange={set('note')} rows={3} maxLength={1000} error={errors.note} style={{ gridColumn: '1 / -1' }}
                    placeholder="For example: first two clinics held; homework returns up to 70%." />
                  <TextField label="Next review (optional)" type="date" min={todayKey()} value={form.nextReviewOn} onChange={set('nextReviewOn')} error={errors.nextReviewOn} />
                </div>
              ) : (
                <div className="grid g-2col g-3 mt-3">
                  <TextArea label="Outcome" required value={form.outcome} onChange={set('outcome')} rows={3} maxLength={1000} error={errors.outcome} style={{ gridColumn: '1 / -1' }}
                    placeholder="What changed, and how do we know?" />
                  <SelectField label="Risk level after closing" value={form.riskLevel} onChange={set('riskLevel')} options={RISK_LEVELS} placeholder={`Keep current (${d.risk})`} />
                </div>
              )}
              {errors._ && <div className="mt-3"><Banner tone="critical" icon="alert">{errors._}</Banner></div>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function ExplainModal({ open, onClose, thresholds }: { open: boolean; onClose: () => void; thresholds?: { attendance: number; scoreDrop: number } }) {
  return (
    <Modal open={open} onClose={onClose} size="wide" title="How Early Warning works" foot={<Button variant="primary" onClick={onClose}>Close</Button>}>
      <p className="t-sm">Three things are watched: attendance, academic trend and participation. When they move the wrong way over a sustained period, a signal is raised for a teacher to review.</p>
      <div className="mt-4">
        <Flow steps={[
          { label: 'Signal', meta: 'System raises it', state: 'done' },
          { label: 'Teacher Review', meta: 'A person accepts or dismisses', state: 'active' },
          { label: 'Intervention', meta: 'Named owner, agreed support' },
          { label: 'Action', meta: 'What was actually done' },
          { label: 'Follow-up', meta: 'Did it change anything' },
          { label: 'Closed', meta: 'Outcome recorded' },
        ]} />
      </div>
      {thresholds && (
        <div className="mt-4">
          <Dl items={[
            ['Attendance rule', `Below ${thresholds.attendance}% this academic year (school setting early_warning.attendance_threshold)`],
            ['Academic rule', `Latest-term average ${thresholds.scoreDrop} or more points below the previous term (early_warning.score_drop_threshold)`],
            ['Re-raising', 'A dismissed cause is not raised again for 30 days'],
          ]} />
        </div>
      )}
      <div className="mt-4">
        <Banner tone="warning" icon="shield"><strong>Students are not labelled.</strong> Risk bands are a working view for staff. They are never shown to students, never printed on reports, and never shared with other parents.</Banner>
      </div>
    </Modal>
  );
}

function RunCheckModal({ thresholds, campusId, onClose }: { thresholds?: { attendance: number; scoreDrop: number }; campusId?: string; onClose: () => void }) {
  const [result, setResult] = useState<RunCheckResult | null>(null);
  const run = useApiMutation<{ campusId?: string }, RunCheckResult>('post', '/early-warning/run-check', {
    invalidate: ['/early-warning', '/dashboard'],
    onSuccess: (r) => setResult(r.data),
  });
  return (
    <Modal
      open onClose={onClose} size="wide" busy={run.isPending}
      title="Run signal check"
      sub="Deterministic rules on current data — no prediction model is involved"
      foot={result ? <Button variant="primary" onClick={onClose}>Done</Button> : <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="zap" loading={run.isPending} onClick={() => run.mutate({ campusId })}>Run check now</Button>
      </>}
    >
      {!result ? (
        <>
          <p className="t-sm">The check reads current attendance and term results for the students you can see, and raises a <strong>Stage 0 signal</strong> for teacher review when a rule is met.</p>
          <div className="mt-3">
            <Dl items={[
              ['Rule A · attendance', `Attendance this academic year below ${thresholds?.attendance ?? '—'}% (at least 10 marked days)`],
              ['Rule B · academic', `Latest-term average at least ${thresholds?.scoreDrop ?? '—'} points below the previous term`],
              ['Skipped when', 'The student already has an open signal of that type, or one was dismissed in the last 30 days'],
            ]} />
          </div>
          <div className="mt-4"><AiNotice><strong>Nothing is decided automatically.</strong> New signals wait for a teacher to accept or dismiss them. Class teachers are notified.</AiNotice></div>
        </>
      ) : (
        <>
          <Grid cols="g-3col">
            <Kpi icon="users" label="Students checked" value={result.checked} />
            <Kpi icon="alert" label="New signals" value={result.created.length} tone={result.created.length ? 'amber' : 'teal'} />
            <Kpi icon="activity" label="Skipped" value={result.skipped} foot="Already open or recently dismissed" />
          </Grid>
          <div className="mt-4">
            {result.created.length ? (
              <DataTable
                compact rows={result.created} rowKey={(r) => r.id}
                columns={[
                  { key: 'code', label: 'Signal' },
                  { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={r.admissionNo} /> },
                  { key: 'rule', label: 'Rule', render: (r) => <Badge tone="neutral">Rule {r.rule}</Badge> },
                  { key: 'signal', label: 'Detail' },
                ]}
              />
            ) : <Empty icon="check" title="No new signals" sub="Every student who meets a rule already has an open or recently reviewed signal." />}
          </div>
        </>
      )}
    </Modal>
  );
}
