import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '@/api/client';
import { useApiMutation, useApiQuery, useInvalidate } from '@/hooks/useApi';
import {
  AiNotice, Badge, Banner, Button, Card, DataTable, ErrorState, Icon, IconButton, Modal, Page, PageHead, PageSkeleton,
  SelectField, TextArea, TextField, useConfirm, useToast,
} from '@/components/ui';
import { errorMessage } from '@/components/ui/states';
import { cx, fmt } from '@/lib/format';
import {
  AiNotReady, BASE, EV, EvStatus, isBusy, marks, Connecting, NotConnected, ReasonModal, usePcStatus,
  type EvStudent, type Rubric, type SheetRow,
} from './shared';

interface Evaluation {
  id: string; status: string; provider: string; model: string | null; rubric_version: number; prompt_version: string;
  suggested_marks: number | null; requires_review: boolean; review_reasons: string[]; error: string | null; created_at: string;
  checks: { check: string; ok: boolean | null; detail: string }[];
  result: {
    maximum_marks: number; strengths: string[]; missing_concepts: string[]; misconceptions: string[];
    criteria: { criterion_id: string; criterion_name: string; awarded_marks: number; maximum_marks: number; evidence: string; explanation: string }[];
  } | null;
}
interface Answer {
  id: string; original_text: string; corrected_text: string | null; text: string; ocr_status: string; page_refs: number[]; flags: string[];
  final_marks: number | null; criterion_marks: Record<string, number>; mark_status: string; feedback: string; approved_at: string | null;
}
interface QRow {
  question: { id: string; number: string; text: string; qtype: string; max_marks: number; mark_increment: number; unit: string | null; rubric: Rubric | null };
  answer: Answer | null;
  evaluation: Evaluation | null;
}
interface PageText { page_no: number; text: string; warnings: string[]; uncertain: string[]; confidence: number | null }
interface Sheet extends SheetRow {
  exam: { id: string; name: string; subject: string; class_name: string; results_status: string };
  student_full: { name: string; admission_no: string; class_name: string; section: string; roll_no: string };
  page_list: { id: string; page_no: number; quality: { warnings?: string[] } }[];
  active_extraction: { id: string; model: string | null; pages: PageText[]; warnings: string[]; redacted: boolean; name_on_sheet: string | null; unassigned_text: string; duration_ms: number } | null;
  extractions: { id: string; model: string | null; status: string; error: string | null; created_at: string; active: boolean }[];
  questions: QRow[];
}

export default function SheetPage() {
  const { id } = useParams<{ id: string }>();
  const st = usePcStatus();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [poll, setPoll] = useState(false);
  const q = useApiQuery<Sheet>(st.data?.connected ? `${EV}/submissions/${id}` : null, undefined, { refetchInterval: poll ? 3000 : undefined });
  const s = q.data;
  const busy = isBusy(s?.job);
  useEffect(() => {
    if (poll && !busy) void invalidate('/exam-correction');
    setPoll(busy);
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const [pageIdx, setPageIdx] = useState(0);
  const [openQ, setOpenQ] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'transcript' | 'reassign' | 'order' | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (s && openQ === null) setOpenQ(s.questions.find((r) => r.answer && r.answer.mark_status !== 'approved')?.question.id ?? '');
  }, [s, openQ]);

  if (st.isLoading) return <Page><PageHead title="Answer sheet" /><Connecting /></Page>;
  if (st.data?.connected && q.isLoading) return <Page><PageSkeleton /></Page>;
  if (st.data && !st.data.connected) return <Page><PageHead title="Answer sheet" /><NotConnected status={st.data} onRetry={() => st.refetch()} /></Page>;
  if (q.error || !s) return <Page><PageHead title="Answer sheet" /><ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;
  const ai = st.data?.ai;
  const ext = s.active_extraction;

  const start = async (path: string, body: unknown, msg: string) => {
    setStarting(true);
    try { await api.post(`${EV}/submissions/${s.id}/${path}`, body); toast(msg, 'info'); await invalidate('/exam-correction'); }
    catch (e) { toast(errorMessage(e), 'critical'); } finally { setStarting(false); }
  };
  const confirmIdentity = async () => {
    try { await api.post(`${EV}/submissions/${s.id}/identity`, { verified: true }); toast('Identity confirmed', 'success'); await invalidate('/exam-correction'); }
    catch (e) { toast(errorMessage(e), 'critical'); }
  };
  const nextAfter = (qid: string) => {
    const i = s.questions.findIndex((r) => r.question.id === qid);
    setOpenQ(s.questions.slice(i + 1).find((r) => r.answer && r.answer.mark_status !== 'approved')?.question.id ?? '');
  };

  return (
    <Page>
      <PageHead title={s.student_full.name}
        crumbs={[{ label: 'Paper Correction', to: BASE }, { label: s.exam.name, to: `${BASE}/exams/${s.exam.id}` }, { label: s.student_full.name }]}
        sub={`Admission ${s.student_full.admission_no} · ${s.student_full.class_name}${s.student_full.section ? ` · Section ${s.student_full.section}` : ''} · Roll ${s.student_full.roll_no || '—'}`}
        actions={<div className="pc-total"><span className="pc-total__n">{marks(s.totals.total)} / {marks(s.totals.maximum)}</span>
          <span className="t-xs t-muted">{s.totals.approved ? 'all marks approved' : `${s.totals.marked}/${s.totals.questions} marked`}</span><EvStatus value={s.status} /></div>} />

      <div className="pc-review">
        <PageViewer sheet={s} index={pageIdx} onIndex={setPageIdx} onOrder={() => setDialog('order')} />

        <div className="col g-4 pc-review__side">
          <AiNotReady ai={ai} />
          {s.status_note && <Banner tone="critical" icon="alert">{s.status_note}</Banner>}

          <Card icon="userCheck" title="Student" tight>
            <div className="row g-2 wrap">
              {s.identity_verified ? <Badge tone="success" icon="check">identity confirmed</Badge> : <>
                <Badge tone="warning">identity not confirmed</Badge>
                <Button size="sm" variant="primary" onClick={confirmIdentity}>This sheet is {s.student_full.name}'s</Button>
              </>}
              <Button size="sm" variant="quiet" onClick={() => setDialog('reassign')}>Wrong student?</Button>
            </div>
            {s.name_check && (
              <div className="row g-2 mt-3 t-sm">
                <Badge tone={s.name_check.status === 'match' ? 'success' : s.name_check.status === 'differs' ? 'critical' : 'neutral'}>
                  {s.name_check.status === 'match' ? 'name matches' : s.name_check.status === 'differs' ? 'name differs' : 'no name on sheet'}
                </Badge>
                <span className="t-muted">{s.name_check.detail}</span>
              </div>
            )}
          </Card>

          <Card icon="scan" title="Reading" tight>
            {busy && <Banner tone="neutral" icon="clock">{s.job!.kind} in progress… {s.job!.progress}</Banner>}
            {s.job?.status === 'failed' && <Banner tone="critical" icon="alert">Last job failed: {s.job.error}. You can retry.</Banner>}
            {ext ? (
              <div className="t-sm row g-2 wrap mt-2">
                <span>Read by</span><Badge tone="navy" icon="sparkle">{ext.model || 'Claude'}</Badge><span>in {(ext.duration_ms / 1000).toFixed(1)} s</span>
                {ext.redacted && <Badge>name area blanked before sending</Badge>}
                <Button size="sm" variant="quiet" onClick={() => setDialog('transcript')}>Full transcription</Button>
              </div>
            ) : <p className="t-sm t-muted">Not read yet.</p>}
            <p className="t-xs t-muted mt-2">Claude usage for this sheet: {s.cost.input_tokens + s.cost.output_tokens} tokens · about ${s.cost.cost_usd}</p>
            {ext?.unassigned_text && <details className="mt-2 t-sm"><summary>Writing not under any question</summary><div className="pc-answer">{ext.unassigned_text}</div></details>}
            {ext && ext.warnings.length > 0 && <ul className="pc-list pc-flags">{ext.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            {s.extractions.length > 1 && (
              <details className="mt-2"><summary className="t-sm">{s.extractions.length} readings</summary>
                <Readings sheet={s} />
              </details>
            )}
            <div className="row g-2 wrap mt-3">
              {ai?.reading_available
                ? <Button variant="primary" icon="sparkle" disabled={busy} loading={starting} onClick={() => start('process', {}, 'Claude is reading the sheet…')}>{ext ? 'Read again with Claude' : 'Read & mark with Claude'}</Button>
                : <span className="t-xs t-warning">Reading unavailable: {ai?.reading_reason}</span>}
              {ext && ai?.marking_available && <Button disabled={busy || starting} onClick={() => start('evaluate', { force: false }, 'Marking…')}>Mark unmarked answers</Button>}
            </div>
          </Card>

          <AiNotice />
          {s.questions.map((row) => (
            <QuestionCard key={row.question.id} sheet={s} row={row} open={openQ === row.question.id}
              onToggle={() => setOpenQ(openQ === row.question.id ? '' : row.question.id)}
              onPages={(p) => p.length && setPageIdx(Math.min(p[0] - 1, s.page_list.length - 1))}
              onApproved={() => nextAfter(row.question.id)} />
          ))}
          <div><Button icon="arrowLeft" to={`${BASE}/exams/${s.exam.id}`}>Back to answer sheets</Button></div>
        </div>
      </div>

      {dialog === 'transcript' && ext && (
        <Modal open onClose={() => setDialog(null)} title={`Full transcription (${ext.model || 'Claude'})`} size="wide">
          <div className="col g-3">
            {ext.pages.map((p) => (
              <div key={p.page_no} className="pc-history">
                <div className="row g-2 wrap"><span className="t-bold">Page {p.page_no}</span>{p.warnings.map((w) => <Badge key={w} tone="warning">{w}</Badge>)}
                  {p.uncertain.length > 0 && <Badge tone="critical">{p.uncertain.length} uncertain</Badge>}</div>
                <div className="pc-answer mt-2">{p.text || '(nothing read)'}</div>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {dialog === 'reassign' && <ReassignModal sheet={s} onClose={() => setDialog(null)} />}
      {dialog === 'order' && <PageOrderModal sheet={s} onClose={() => setDialog(null)} />}
    </Page>
  );
}

// ---------------------------------------------------------------------------
function PageViewer({ sheet, index, onIndex, onOrder }: { sheet: Sheet; index: number; onIndex: (i: number) => void; onOrder: () => void }) {
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [version, setVersion] = useState(0);
  const page = sheet.page_list[index];
  useEffect(() => {
    if (!page) return;
    const ctrl = new AbortController();
    let made: string | null = null;
    api.blob(`${EV}/pages/${page.id}/image`, ctrl.signal)
      .then((b) => { made = URL.createObjectURL(b); setUrl(made); })
      .catch((e) => { if ((e as Error).name !== 'AbortError') toast(errorMessage(e), 'critical'); });
    return () => { ctrl.abort(); if (made) URL.revokeObjectURL(made); };
  }, [page?.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const rotate = async () => {
    try { await api.post(`${EV}/pages/${page.id}/rotate`, { degrees: 90 }); setVersion((v) => v + 1); toast('Rotated — read the sheet again to use it', 'info'); }
    catch (e) { toast(errorMessage(e), 'critical'); }
  };
  if (!page) return <Card><p className="t-muted">No pages.</p></Card>;
  return (
    <div className="pc-viewer">
      <div className="pc-viewer__bar">
        <IconButton icon="chevronLeft" label="Previous page" disabled={index === 0} onClick={() => onIndex(index - 1)} />
        <span className="t-sm t-num">Page {page.page_no} / {sheet.page_list.length}</span>
        <IconButton icon="chevronRight" label="Next page" disabled={index >= sheet.page_list.length - 1} onClick={() => onIndex(index + 1)} />
        <IconButton icon="minus" label="Zoom out" onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))} />
        <IconButton icon="plus" label="Zoom in" onClick={() => setZoom((z) => Math.min(3, z + 0.2))} />
        <IconButton icon="refresh" label="Rotate the stored page 90° clockwise" onClick={rotate} />
        {sheet.page_list.length > 1 && <Button size="sm" variant="quiet" onClick={onOrder}>Page order</Button>}
        {(page.quality.warnings ?? []).map((w) => <Badge key={w} tone="warning">{w}</Badge>)}
      </div>
      <div className="pc-viewer__canvas">
        {url ? <img src={url} alt={`Answer sheet page ${page.page_no}`} style={{ width: `${zoom * 100}%` }} /> : <div className="pc-viewer__loading"><Icon name="fileText" size={28} /></div>}
      </div>
    </div>
  );
}

function Readings({ sheet }: { sheet: Sheet }) {
  const confirm = useConfirm();
  const activate = useApiMutation<string>('post', (eid) => `${EV}/submissions/${sheet.id}/extractions/${eid}/activate`, {
    invalidate: ['/exam-correction'], success: 'Reading switched', body: () => ({}),
  });
  return (
    <DataTable compact stack={false} rows={sheet.extractions} rowKey={(e) => e.id}
      columns={[
        { key: 'm', label: 'Model', render: (e) => <span className="t-xs">{e.model ?? ''}</span> },
        { key: 's', label: 'Status', render: (e) => <EvStatus value={e.status} /> },
        { key: 'w', label: 'When', render: (e) => <span className="t-xs">{fmt.dateTime(e.created_at)}</span> },
        {
          key: 'a', label: '', className: 'num', render: (e) => e.active ? <Badge tone="success">in use</Badge> : e.status === 'done'
            ? <Button size="sm" onClick={async () => {
              if (await confirm({ title: 'Use this reading?', body: 'Answers switch to this reading. Teacher corrections and approved marks are kept.', confirmLabel: 'Use this reading' })) activate.mutate(e.id);
            }}>Use this</Button>
            : <span className="t-xs t-critical">{e.error}</span>,
        },
      ]} />
  );
}

// ---------------------------------------------------------------------------
function QuestionCard({ sheet, row, open, onToggle, onPages, onApproved }: {
  sheet: Sheet; row: QRow; open: boolean; onToggle: () => void; onPages: (p: number[]) => void; onApproved: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const { question: q, answer: a, evaluation: ev } = row;
  const crits = q.rubric?.criteria ?? [];
  const approved = a?.mark_status === 'approved';
  const [text, setText] = useState(a?.text ?? '');
  const [entered, setEntered] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState(a?.feedback ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<'reopen' | 'review' | null>(null);
  const [history, setHistory] = useState(false);

  useEffect(() => {
    setText(a?.text ?? '');
    setFeedback(a?.feedback ?? '');
    setEntered(Object.fromEntries(crits.map((c) => [c.id, a?.criterion_marks?.[c.id] == null ? '' : String(a.criterion_marks[c.id])])));
    setReason('');
  }, [a?.id, a?.text, a?.feedback, a?.final_marks, a?.mark_status]); // eslint-disable-line react-hooks/exhaustive-deps

  const head = (
    <button type="button" className="pc-qhead" onClick={onToggle} aria-expanded={open}>
      <span className="pc-qnum">Q{q.number}</span>
      <span className="t-xs t-muted">{marks(q.max_marks)} marks</span>
      {a ? <EvStatus value={a.mark_status} /> : <Badge>not read yet</Badge>}
      {ev?.requires_review && !approved && <Badge tone="warning">review flagged</Badge>}
      <span className="grow" />
      <span className="t-bold t-num">{marks(a?.final_marks)} / {marks(q.max_marks)}</span>
      <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} />
    </button>
  );
  if (!a) return <div className="pc-qcard">{head}</div>;

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok, 'success'); await invalidate('/exam-correction'); return true; }
    catch (e) { toast(errorMessage(e), 'critical'); return false; } finally { setBusy(null); }
  };
  const total = crits.reduce((t, c) => t + (Number(entered[c.id]) || 0), 0);
  const changed = crits.some((c) => entered[c.id] !== (a.criterion_marks?.[c.id] == null ? '' : String(a.criterion_marks[c.id]))) || feedback !== (a.feedback ?? '');
  const saveMarks = async () => {
    const criterion_marks = Object.fromEntries(crits.map((c) => [c.id, Number(entered[c.id])]));
    if (crits.some((c) => entered[c.id] === '' || !Number.isFinite(criterion_marks[c.id]))) { toast('Enter marks for every criterion.', 'warning'); return false; }
    return act('save', () => api.put(`${EV}/answers/${a.id}/marks`, { criterion_marks, reason, feedback }), 'Marks saved');
  };
  const approve = async () => {
    if (changed && !(await saveMarks())) return;
    if (await act('approve', () => api.post(`${EV}/answers/${a.id}/approve`, {}), `Q${q.number} approved`)) onApproved();
  };

  return (
    <div className={cx('pc-qcard', open && 'is-open')}>
      {head}
      {open && (
        <div className="pc-qbody">
          <p className="pc-text">{q.text}</p>
          <div className="row g-2 wrap mb-2 t-sm">
            <span className="t-bold">Student's answer</span><EvStatus value={a.ocr_status} />
            {a.page_refs.length > 0 && <Button size="sm" variant="quiet" onClick={() => onPages(a.page_refs)}>page {a.page_refs.join(', ')}</Button>}
            {a.corrected_text !== null && <Badge tone="navy">corrected by teacher</Badge>}
          </div>
          <TextArea label="Transcription" value={text} onChange={setText} rows={5} disabled={approved} />
          {a.corrected_text !== null && <details className="t-sm"><summary>Original reading</summary><div className="pc-answer">{a.original_text || '(empty)'}</div></details>}
          {!approved && (
            <div className="row g-2 wrap mt-2">
              <Button size="sm" icon="save" disabled={text === a.text} loading={busy === 'text'}
                onClick={() => act('text', () => api.patch(`${EV}/answers/${a.id}/text`, { text }), 'Transcription saved')}>Save corrected text</Button>
              {a.ocr_status !== 'verified' && <Button size="sm" icon="check" loading={busy === 'verify'}
                onClick={() => act('verify', () => api.post(`${EV}/answers/${a.id}/verify`, {}), 'Transcription verified')}>Transcription is correct</Button>}
            </div>
          )}
          {a.flags.length > 0 && <ul className="pc-list pc-flags">{a.flags.map((f) => <li key={f}>{f}</li>)}</ul>}
          {ev && <AiSuggestion ev={ev} />}

          {!q.rubric ? <div className="mt-3"><Banner tone="warning" icon="alert">This question has no rubric yet. Define it under Questions & rubrics.</Banner></div> : (
            <div className="pc-marks">
              <div className="row g-2"><span className="t-bold">{approved ? 'Approved marks' : 'Teacher marks'}</span><span className="grow" />
                <span className="t-sm">Total</span><span className="t-bold t-num">{marks(approved ? a.final_marks : total)}</span><span className="t-muted t-num">/ {marks(q.max_marks)}</span></div>
              <div className="col g-2 mt-2">
                {crits.map((c) => (
                  <div key={c.id} className="pc-mark-row">
                    <span className="t-sm"><span className="t-bold">{c.id}</span> {c.name}</span>
                    <span className="pc-mark-field">
                      <input className="input marks-input" type="number" inputMode="decimal" min={0} max={c.max_marks} step={q.mark_increment}
                        value={entered[c.id] ?? ''} disabled={approved} aria-label={`${c.id} marks out of ${c.max_marks}`}
                        onChange={(e) => setEntered((x) => ({ ...x, [c.id]: e.target.value }))} />
                      <span className="t-muted t-xs">/ {marks(c.max_marks)}</span>
                    </span>
                  </div>
                ))}
              </div>
              {approved ? (a.feedback && <p className="t-sm mt-2"><span className="t-bold">Feedback: </span>{a.feedback}</p>) : (
                <div className="col g-2 mt-3">
                  <TextField label="Reason for changing the AI suggestion" value={reason} onChange={setReason} placeholder="Required when you change the marks" maxLength={300} />
                  <TextArea label="Feedback for the student" value={feedback} onChange={setFeedback} rows={2} />
                </div>
              )}
              <div className="row g-2 wrap mt-3">
                {approved ? <>
                  <Badge tone="success" icon="check">approved</Badge><span className="t-xs t-muted">{fmt.dateTime(a.approved_at)}</span>
                  <Button size="sm" onClick={() => setAsk('reopen')}>Reopen</Button>
                </> : <>
                  <Button size="sm" icon="save" disabled={!changed} loading={busy === 'save'} onClick={saveMarks}>Save marks</Button>
                  <Button size="sm" variant="teal" icon="check" disabled={!sheet.identity_verified} loading={busy === 'approve'} onClick={approve}
                    title={sheet.identity_verified ? undefined : 'Confirm the student first'}>Approve</Button>
                  <Button size="sm" icon="sparkle" loading={busy === 'reeval'}
                    onClick={() => act('reeval', () => api.post(`${EV}/answers/${a.id}/evaluate`, {}), 'Re-evaluating…')}>Re-evaluate</Button>
                  <Button size="sm" variant="quiet" onClick={() => setAsk('review')}>Request review</Button>
                </>}
                <span className="grow" />
                <Button size="sm" variant="quiet" onClick={() => setHistory(true)}>History</Button>
              </div>
            </div>
          )}
        </div>
      )}
      {ask && (
        <ReasonModal title={ask === 'reopen' ? `Reopen Q${q.number}?` : `Request review of Q${q.number}`}
          label={ask === 'reopen' ? 'Why reopen these approved marks?' : 'What needs further review?'}
          confirmLabel={ask === 'reopen' ? 'Reopen' : 'Flag for review'} busy={busy === ask} onClose={() => setAsk(null)}
          onSubmit={async (why) => {
            const ok = await act(ask, () => api.post(`${EV}/answers/${a.id}/${ask === 'reopen' ? 'reopen' : 'request-review'}`, { reason: why }), ask === 'reopen' ? 'Reopened' : 'Flagged for review');
            if (ok) setAsk(null);
          }} />
      )}
      {history && <HistoryModal answerId={a.id} onClose={() => setHistory(false)} />}
    </div>
  );
}

function AiSuggestion({ ev }: { ev: Evaluation }) {
  if (ev.status !== 'ok' || !ev.result) {
    return <div className="mt-3"><Banner tone="critical" icon="alert">AI marking {ev.status}: {ev.error ?? ''}{ev.review_reasons.length ? ` — ${ev.review_reasons.join('; ')}` : ''}</Banner></div>;
  }
  const r = ev.result;
  const checks = ev.checks.filter((c) => c.check !== 'total' || !c.ok);
  return (
    <div className="pc-ai">
      <div className="row g-2 wrap">
        <Icon name="sparkle" size={15} /><span className="t-bold">AI suggestion — not final</span><span className="grow" />
        <Badge tone="navy">{marks(ev.suggested_marks)} / {marks(r.maximum_marks)}</Badge>
        <span className="t-micro t-muted">{ev.model ?? ev.provider} · rubric v{ev.rubric_version}</span>
      </div>
      <div className="col g-2 mt-2">
        {r.criteria.map((c) => (
          <div key={c.criterion_id} className="pc-ai__crit">
            <div className="grow">
              <span className="t-bold">{c.criterion_id}</span> <span className="t-sm">{c.criterion_name}</span>
              <div className="t-xs">{c.explanation}</div>
              {c.evidence && <div className="t-xs t-muted pc-evidence">Evidence: “{c.evidence}”</div>}
            </div>
            <span className="t-num t-sm"><span className="t-bold">{marks(c.awarded_marks)}</span> / {marks(c.maximum_marks)}</span>
          </div>
        ))}
      </div>
      {r.strengths.length > 0 && <p className="t-xs mt-2"><span className="t-bold">Strengths: </span>{r.strengths.join('; ')}</p>}
      {r.missing_concepts.length > 0 && <p className="t-xs"><span className="t-bold">Missing: </span>{r.missing_concepts.join('; ')}</p>}
      {r.misconceptions.length > 0 && <p className="t-xs t-critical"><span className="t-bold">Misconceptions: </span>{r.misconceptions.join('; ')}</p>}
      {checks.length > 0 && (
        <ul className="pc-list mt-2">{checks.map((c, i) => (
          <li key={i} className="t-xs"><Badge tone={c.ok === true ? 'success' : c.ok === false ? 'critical' : 'neutral'}>{c.ok === true ? 'check ok' : c.ok === false ? 'check failed' : 'check'}</Badge> {c.detail}</li>
        ))}</ul>
      )}
      {ev.review_reasons.length > 0 && <div className="mt-2"><Banner tone="warning" icon="eye">Review: {ev.review_reasons.join('; ')}</Banner></div>}
    </div>
  );
}

function HistoryModal({ answerId, onClose }: { answerId: string; onClose: () => void }) {
  const h = useApiQuery<{
    overrides: { original_marks: number | null; new_marks: number; reason: string; by: string; at: string }[];
    evaluations: Evaluation[];
  }>(`${EV}/answers/${answerId}/history`);
  return (
    <Modal open onClose={onClose} title="Marking history" size="wide">
      {h.isLoading ? <PageSkeleton kpis={0} /> : h.error ? <ErrorState error={h.error} /> : h.data && (
        <div className="col g-4">
          <Card title="Teacher overrides" flush>
            <DataTable compact rows={h.data.overrides} rowKey={(o) => o.at} emptyText="None."
              columns={[
                { key: 'at', label: 'When', render: (o) => <span className="t-xs">{fmt.dateTime(o.at)}</span> },
                { key: 'by', label: 'By', render: (o) => o.by },
                { key: 'f', label: 'From', className: 'num', render: (o) => marks(o.original_marks) },
                { key: 't', label: 'To', className: 'num', render: (o) => marks(o.new_marks) },
                { key: 'r', label: 'Reason', render: (o) => <span className="t-sm">{o.reason}</span> },
              ]} />
          </Card>
          <Card title="AI evaluations" flush>
            <DataTable compact rows={h.data.evaluations} rowKey={(e) => e.id} emptyText="None."
              columns={[
                { key: 's', label: 'Status', render: (e) => <EvStatus value={e.status} /> },
                { key: 'at', label: 'When', render: (e) => <span className="t-xs">{fmt.dateTime(e.created_at)}</span> },
                { key: 'm', label: 'Model', render: (e) => <span className="t-xs">{e.model ?? e.provider} · rubric v{e.rubric_version}</span> },
                { key: 'k', label: 'Marks', className: 'num', render: (e) => marks(e.suggested_marks) },
                { key: 'e', label: '', render: (e) => <span className="t-xs t-critical">{e.error}</span> },
              ]} />
          </Card>
        </div>
      )}
    </Modal>
  );
}

function ReassignModal({ sheet, onClose }: { sheet: Sheet; onClose: () => void }) {
  const students = useApiQuery<EvStudent[]>(`${EV}/students`, { class_name: sheet.student_full.class_name });
  const [studentId, setStudentId] = useState(sheet.student.id);
  const save = useApiMutation<{ verified: boolean; student_id: string }>('post', `${EV}/submissions/${sheet.id}/identity`, {
    invalidate: ['/exam-correction'], success: 'Student updated', onSuccess: onClose,
  });
  return (
    <Modal open onClose={onClose} title="Assign this sheet to a student" busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ verified: true, student_id: studentId })}>Save and confirm</Button></>}>
      <SelectField label="Student" value={studentId} onChange={setStudentId}
        options={(students.data ?? []).map((x) => ({ value: x.id, label: `${x.name} (${x.admission_no})` }))} />
    </Modal>
  );
}

function PageOrderModal({ sheet, onClose }: { sheet: Sheet; onClose: () => void }) {
  const [order, setOrder] = useState(sheet.page_list);
  const save = useApiMutation<{ page_ids: string[] }>('post', `${EV}/submissions/${sheet.id}/pages/order`, {
    invalidate: ['/exam-correction'], success: 'Page order saved — read the sheet again so answers follow it', onSuccess: onClose,
  });
  const move = (i: number, d: number) => setOrder((o) => { const n = [...o]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  return (
    <Modal open onClose={onClose} title="Page order" busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ page_ids: order.map((p) => p.id) })}>Save</Button></>}>
      <ol className="pc-list pc-list--num">
        {order.map((p, i) => (
          <li key={p.id} className="row g-2">
            <span className="grow t-sm">Uploaded page {p.page_no}</span>
            <IconButton icon="arrowUp" label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton icon="arrowDown" label="Move down" disabled={i === order.length - 1} onClick={() => move(i, 1)} />
          </li>
        ))}
      </ol>
    </Modal>
  );
}

