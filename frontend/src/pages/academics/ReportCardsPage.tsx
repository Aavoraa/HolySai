import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import {
  AiNotice, Badge, Banner, Button, Card, DataTable, Empty, ErrorState, Flow, Icon, InlineError, Modal, Page, PageHead, PageSkeleton,
  Skeleton, Stepper, TextArea, useConfirm,
} from '@/components/ui';
import { fmt, todayKey } from '@/lib/format';
import { DueDate } from './shared';

interface BatchRow { id: string; sectionId: string; grade: string; term: string; stage: number; status: string; due: string; releasedAt: string | null; approvedBy: string | null; students: number; drafts: number; approved: number; rejected: number }
interface Overview { stages: string[]; stageCounts: { label: string; count: number }[]; rows: BatchRow[]; awaitingRelease: number }
interface BatchStudent { id: string; admissionNo: string; fullName: string; roll: number | null; commentId: string | null; commentStatus: string | null; aiDrafted: boolean | null }
interface Batch {
  id: string; label: string; term: string; stage: number; status: string; stages: string[]; due: string; releasedAt: string | null; locked: boolean;
  students: BatchStudent[];
  counts: { total: number; drafts: number; approved: number; rejected: number; missing: number };
  selected: null | {
    student: BatchStudent;
    results: { subject: string; score: number; grade: string | null; target: number | null; trend: number; teacher: string | null }[];
    comment: { id: string; comment: string; aiDrafted: boolean; status: string; reviewedBy: string | null; updatedAt: string } | null;
    sources: { assessments: number; observations: number; behaviour: number } | null;
  };
}

const SHORT = ['Marks', 'Mod.', 'AI', 'Review', 'Approve', 'Release'];
const NEXT_LABEL = ['Send for moderation', 'Generate AI draft comments', 'Start teacher review', 'Send for approval', 'Approve and release to parents'];
const COMMENT_TONE: Record<string, string> = { Draft: 'warning', Approved: 'success', Rejected: 'critical' };

export default function ReportCardsPage() {
  const { can, user } = useAuth();
  const { campusParam } = useSchool();
  const confirm = useConfirm();
  const q = useApiQuery<Overview>('/academics/report-cards', campusParam);
  const [open, setOpen] = useState<string | null>(null);
  const schoolLevel = can('academics.manage') && can('students.read') && user?.role.scope !== 'class';
  const release = useApiMutation<Record<string, unknown>>('post', '/academics/report-cards/release', { invalidate: ['/academics/report-cards'] });

  const doRelease = async () => {
    const n = q.data?.awaitingRelease ?? 0;
    const ok = await confirm({
      title: `Approve and release ${n} class${n === 1 ? '' : 'es'}?`,
      body: 'Report cards become visible to parents in Parent 360 and parents are notified. Your name is recorded as the approver. This cannot be undone.',
      confirmLabel: 'Release to parents', icon: 'send',
    });
    if (ok) release.mutate({ ...campusParam });
  };

  return (
    <Page>
      <PageHead
        title="Report Cards"
        sub="Marks → Moderation → AI draft comments → Teacher review → Approval → Parent release. Nothing reaches a parent without a named approval."
        actions={schoolLevel && <Button variant="primary" icon="send" onClick={doRelease} disabled={!q.data?.awaitingRelease} loading={release.isPending}>Release approved{q.data?.awaitingRelease ? ` (${q.data.awaitingRelease})` : ''}</Button>}
      />
      {q.isLoading ? <PageSkeleton kpis={0} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (() => {
        const d = q.data!;
        const minStage = d.rows.length ? Math.min(...d.rows.map((r) => r.stage)) : 0;
        return (
          <>
            <Card>
              <Flow steps={d.stageCounts.map((s, i) => ({
                label: s.label,
                meta: `${s.count} class${s.count === 1 ? '' : 'es'}`,
                state: i < minStage ? 'done' : i === minStage && d.rows.length ? 'active' : undefined,
              }))} />
            </Card>
            <div className="mt-4">
              <Card flush>
                <DataTable
                  rows={d.rows}
                  rowKey={(r) => r.id}
                  onRowClick={(r) => setOpen(r.id)}
                  rowClassName={(r) => (!r.releasedAt && r.due < todayKey() ? 'ac-row--overdue' : undefined)}
                  emptyText="No report card batches for your classes this year."
                  columns={[
                    { key: 'grade', label: 'Class', render: (r) => <><span className="t-bold">{r.grade}</span><div className="t-micro t-muted">{r.term}</div></> },
                    { key: 'students', label: 'Students', className: 'num', render: (r) => <span className="t-num">{r.students}</span> },
                    { key: 'stage', label: 'Progress', render: (r) => <Stepper steps={SHORT} active={r.stage === 5 ? 6 : r.stage} /> },
                    { key: 'status', label: 'Status', render: (r) => <Badge tone={r.stage >= 5 ? 'success' : r.stage >= 4 ? 'info' : 'warning'}>{r.status}</Badge> },
                    { key: 'due', label: 'Due', render: (r) => (r.releasedAt ? <span className="t-micro t-muted">Released {fmt.dateShort(r.releasedAt)}</span> : <DueDate date={r.due} />) },
                    { key: 'a', label: '', className: 'num', render: (r) => <Button size="sm" variant={r.drafts > 0 && r.stage >= 2 && r.stage <= 3 ? 'primary' : 'ghost'} onClick={(e) => { e.stopPropagation(); setOpen(r.id); }}>{r.drafts > 0 && r.stage >= 2 && r.stage <= 3 ? `Review ${r.drafts}` : 'Open'}</Button> },
                  ]}
                />
              </Card>
            </div>
          </>
        );
      })()}
      {open && <BatchModal id={open} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function BatchModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { can, user } = useAuth();
  const confirm = useConfirm();
  const [studentId, setStudentId] = useState<string | undefined>();
  const q = useApiQuery<Batch>(`/academics/report-cards/${id}`, { studentId });
  const [text, setText] = useState('');
  const [textError, setTextError] = useState('');
  const b = q.data;
  const sel = b?.selected;
  useEffect(() => { setText(sel?.comment?.comment ?? ''); setTextError(''); }, [sel?.comment?.id, sel?.comment?.comment]);

  const inv = ['/academics/report-cards'];
  const review = useApiMutation<{ commentId: string; action: string; comment?: string }, { status: string }>('post', (v) => `/academics/report-card-comments/${v.commentId}/review`, {
    invalidate: inv, body: (v) => ({ action: v.action, comment: v.comment }),
  });
  const advance = useApiMutation<{ toStage: number }>('post', `/academics/report-cards/${id}/advance`, { invalidate: [...inv, '/notifications'] });
  const draftMissing = useApiMutation<void>('post', `/academics/report-cards/${id}/draft-missing`, { invalidate: inv });

  const manage = can('academics.manage');
  const schoolLevel = manage && can('students.read') && user?.role.scope !== 'class';
  const reviewable = !!b && manage && b.stage >= 2 && b.stage <= 3;
  const busy = review.isPending || advance.isPending || draftMissing.isPending;

  const approveComment = () => {
    if (!sel?.comment) return;
    if (text.trim().length < 10) { setTextError('Write at least a sentence'); return; }
    review.mutate({ commentId: sel.comment.id, action: 'approve', comment: text.trim() !== sel.comment.comment ? text.trim() : undefined }, {
      onSuccess: () => {
        const next = b!.students.find((s) => s.commentStatus === 'Draft' && s.id !== sel.student.id);
        if (next) setStudentId(next.id);
      },
    });
  };

  const doAdvance = async () => {
    if (!b) return;
    const to = b.stage + 1;
    if (to === 5 || to === 4) {
      const ok = await confirm({
        title: to === 5 ? `Release ${b.label} report cards to parents?` : `Send ${b.label} for approval?`,
        body: to === 5
          ? 'Parents are notified and can read the report cards in Parent 360. Your name is recorded as the approver. This cannot be undone.'
          : 'Comments are locked once the class is sent for approval. The principal is notified.',
        confirmLabel: to === 5 ? 'Approve and release' : 'Send for approval', icon: 'send',
      });
      if (!ok) return;
    }
    advance.mutate({ toStage: to });
  };

  const canAdvance = !!b && manage && b.stage < 5 && (b.stage < 4 || schoolLevel);
  const advanceBlocked = !!b && ((b.stage === 2 && b.counts.missing > 0) || (b.stage === 3 && b.counts.approved < b.counts.total));

  return (
    <Modal open onClose={onClose} busy={busy} size="full"
      title={b ? `Report card review — ${b.label}` : 'Report card review'}
      sub={b ? `${sel ? `${sel.student.fullName} · ` : ''}${b.label} · ${b.term} · due ${fmt.date(b.due)}` : undefined}
      foot={<>
        <Button onClick={onClose}>Close</Button>
        {b && manage && b.counts.missing > 0 && (b.stage === 2 || b.stage === 3) && (
          <Button icon="sparkle" onClick={() => draftMissing.mutate()} loading={draftMissing.isPending}>Draft {b.counts.missing} missing comment{b.counts.missing === 1 ? '' : 's'}</Button>
        )}
        {canAdvance && (
          <Button variant="primary" icon="send" onClick={doAdvance} loading={advance.isPending} disabled={advanceBlocked}
            title={advanceBlocked ? 'Every student needs an approved comment first' : undefined}>
            {NEXT_LABEL[b!.stage]}
          </Button>
        )}
      </>}>
      {q.isLoading && !b ? <Skeleton height={380} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : b && (
        <>
          <div className="mb-4 row between wrap g-3">
            <Stepper steps={b.stages} active={b.stage === 5 ? 6 : b.stage} />
            <span className="row g-2 t-xs">
              <Badge tone="warning">{b.counts.drafts} to review</Badge>
              <Badge tone="success">{b.counts.approved} approved</Badge>
              {b.counts.rejected > 0 && <Badge tone="critical">{b.counts.rejected} rejected</Badge>}
              {b.counts.missing > 0 && <Badge>{b.counts.missing} without a comment</Badge>}
            </span>
          </div>
          {(advance.error || draftMissing.error) && <div className="mb-3"><InlineError error={advance.error ?? draftMissing.error} /></div>}
          {b.stage < 2 && <div className="mb-3"><Banner tone="neutral" icon="info">Comments are drafted once marks are moderated. Move the class to “AI draft comments” to generate them.</Banner></div>}
          {b.locked && <div className="mb-3"><Banner tone="success" icon="check">Released to parents {fmt.dateTime(b.releasedAt)}.</Banner></div>}
          {advanceBlocked && canAdvance && (
            <div className="mb-3"><Banner tone="warning" icon="alert">{b.stage === 2 ? 'Some students do not have a draft comment yet.' : `${b.counts.total - b.counts.approved} comment(s) still need your approval before the class can be sent for approval.`}</Banner></div>
          )}
          {b.students.length === 0 ? <Empty icon="users" title="No students in this class" /> : (
            <div className="rc-split">
              <Card icon="users" title="Students" tight flush>
                <div className="rule-list rc-students">
                  {b.students.map((s) => (
                    <button key={s.id} type="button" className="rc-student hoverable"
                      aria-pressed={sel?.student.id === s.id}
                      onClick={() => setStudentId(s.id)}>
                      <span className="rc-student__body">
                        <span className="t-sm t-clip">{s.fullName}</span>
                        <span className="t-micro t-muted">{s.admissionNo}</span>
                      </span>
                      {s.commentStatus ? <Badge tone={COMMENT_TONE[s.commentStatus]}>{s.commentStatus}</Badge> : <Badge>None</Badge>}
                    </button>
                  ))}
                </div>
              </Card>
              {sel && (
                <div className="rc-detail">
                  <Card icon="trending" title="Marks and grades" sub={sel.student.fullName} tight flush>
                    {sel.results.length === 0 ? <Empty icon="clipboard" title="No results recorded" /> : (
                      <DataTable compact stack={false} rows={sel.results} rowKey={(r) => r.subject} columns={[
                        { key: 'subject', label: 'Subject' },
                        { key: 'score', label: 'Mark', className: 'num', render: (r) => <span className="t-num">{r.score}</span> },
                        { key: 'grade', label: 'Grade', render: (r) => <Badge tone={r.score >= 80 ? 'success' : 'neutral'}>{r.grade ?? '—'}</Badge> },
                        { key: 'target', label: 'Target', className: 'num', render: (r) => <span className="t-num">{r.target ?? '—'}</span> },
                      ]} />
                    )}
                  </Card>
                  <div className="col g-4">
                    <section className="ai-card">
                      <div className="ai-card__head">
                        <span className="ai-badge"><Icon name="sparkle" size={12} />{sel.comment?.aiDrafted === false ? 'Teacher comment' : 'AI draft comment'}</span>
                        {sel.comment ? <Badge tone={COMMENT_TONE[sel.comment.status]}>{sel.comment.status === 'Draft' ? 'Not published' : sel.comment.status}</Badge> : <Badge>No comment</Badge>}
                      </div>
                      <div className="card__body">
                        {!sel.comment ? (
                          <p className="t-sm t-muted">No comment has been drafted for this student yet.</p>
                        ) : (
                          <>
                            <p className="t-sm">{sel.comment.comment}</p>
                            {sel.comment.reviewedBy && <p className="t-micro t-muted mt-2">{sel.comment.status} by {sel.comment.reviewedBy} · {fmt.dateTime(sel.comment.updatedAt)}</p>}
                            <div className="mt-3">
                              <AiNotice>
                                Generated from {sel.sources?.assessments ?? 0} assessment marks, {sel.sources?.observations ?? 0} teacher observations and {sel.sources?.behaviour ?? 0} behaviour notes. Edit freely — your version is what a parent sees.
                              </AiNotice>
                            </div>
                            {reviewable && (
                              <>
                                <div className="mt-3">
                                  <TextArea label="Teacher edit" rows={5} value={text} onChange={(v) => { setText(v); setTextError(''); }} error={textError} maxLength={2000}
                                    placeholder="Adjust the wording, or write your own." />
                                </div>
                                {review.error && <div className="mt-2"><InlineError error={review.error} /></div>}
                                <div className="row g-2 mt-3 wrap">
                                  <Button size="sm" icon="refresh" disabled={busy} onClick={async () => {
                                    if (text !== sel.comment!.comment && !(await confirm({ title: 'Replace your edits with a new draft?', body: 'Your unsaved wording will be lost.', confirmLabel: 'Regenerate' }))) return;
                                    review.mutate({ commentId: sel.comment!.id, action: 'regenerate' });
                                  }}>Regenerate</Button>
                                  {sel.comment.status !== 'Rejected' && (
                                    <Button size="sm" variant="danger" disabled={busy} onClick={() => review.mutate({ commentId: sel.comment!.id, action: 'reject' })}>Reject draft</Button>
                                  )}
                                  <Button size="sm" variant="teal" icon="check" disabled={busy} onClick={approveComment}>
                                    {sel.comment.status === 'Approved' ? 'Save approved comment' : 'Approve comment'}
                                  </Button>
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </section>
                    <Card icon="grid" title="Release" tight>
                      <Flow steps={[
                        { label: 'Teacher review', meta: b.stage === 3 ? 'You are here' : b.stage > 3 ? 'Done' : 'Next', state: b.stage > 3 ? 'done' : b.stage === 3 ? 'active' : undefined },
                        { label: 'Section head approval', meta: b.stage === 4 ? 'Awaiting approval' : b.stage > 4 ? 'Approved' : 'Next', state: b.stage > 4 ? 'done' : b.stage === 4 ? 'active' : undefined },
                        { label: 'Parent release', meta: 'Visible in Parent 360', state: b.stage >= 5 ? 'done' : undefined },
                      ]} />
                    </Card>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
