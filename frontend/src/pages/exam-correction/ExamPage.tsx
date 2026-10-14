import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/api/client';
import { useApiMutation, useApiQuery, useInvalidate, usePagedQuery } from '@/hooks/useApi';
import {
  AiNotice, Badge, Banner, Button, Card, Checkbox, DataTable, Dl, Empty, ErrorState, Grid, InlineError, Kpi, Modal, Page, PageHead,
  PageSkeleton, SelectField, StatStrip, Tabs, TextArea, TextField, useConfirm, useToast,
} from '@/components/ui';
import { errorMessage } from '@/components/ui/states';
import { fmt } from '@/lib/format';
import { ExamModal } from './ExamsPage';
import {
  AiNotReady, BASE, EV, EvStatus, isBusy, marks, Connecting, NotConnected, QTYPES, usePcStatus,
  type AiStatus, type Criterion, type EvStudent, type Exam, type Question, type Rubric, type SheetRow,
} from './shared';

type Tab = 'sheets' | 'questions' | 'results' | 'setup';

const NEXT: Record<Exam['results_status'], { to: string; label: string; variant?: 'primary' | 'teal' }[]> = {
  draft: [{ to: 'reviewed', label: 'Mark as reviewed', variant: 'primary' }],
  reviewed: [{ to: 'approved', label: 'Approve results', variant: 'primary' }, { to: 'draft', label: 'Back to draft' }],
  approved: [{ to: 'published', label: 'Publish', variant: 'teal' }, { to: 'draft', label: 'Back to draft' }],
  published: [{ to: 'draft', label: 'Unpublish' }],
};

export default function ExamPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'sheets';
  const st = usePcStatus();
  const confirm = useConfirm();
  const q = useApiQuery<Exam>(st.data?.connected ? `${EV}/exams/${id}` : null);
  const role = st.data?.role;
  const manager = role === 'admin' || role === 'coordinator';
  const step = useApiMutation<string, Exam>('post', (to) => `${EV}/exams/${id}/results/${to}`, {
    invalidate: ['/exam-correction'], success: (r) => `Results are now ${r.data.results_status}`, body: () => ({}),
  });

  if (st.isLoading) return <Page><PageHead title="Paper Correction" /><Connecting /></Page>;
  if (st.data?.connected && q.isLoading) return <Page><PageSkeleton /></Page>;
  if (st.data && !st.data.connected) return <Page><PageHead title="Paper Correction" /><NotConnected status={st.data} onRetry={() => st.refetch()} /></Page>;
  if (q.error || !q.data) return <Page><PageHead title="Examination" /><ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;
  const exam = q.data;

  const move = async (to: string) => {
    if (to === 'published' && !(await confirm({ title: 'Publish results?', body: 'Results become final for this examination. Send them to the marks register from Results & reports so students and parents see them in Holy Sai.', confirmLabel: 'Publish' }))) return;
    step.mutate(to);
  };
  const tabs = [
    { id: 'sheets' as Tab, label: 'Answer sheets', count: exam.counts.submissions },
    { id: 'questions' as Tab, label: 'Questions & rubrics', count: exam.question_count },
    { id: 'results' as Tab, label: 'Results & reports' },
    ...(manager ? [{ id: 'setup' as Tab, label: 'Settings' }] : []),
  ];

  return (
    <Page>
      <PageHead title={exam.name}
        sub={`${exam.class_name}${exam.section ? ` · Section ${exam.section}` : ''} · ${exam.subject} · ${exam.question_count} questions · ${marks(exam.maximum)} marks · ${exam.academic_year}`}
        actions={<>
          <span className="row g-2"><span className="t-xs t-muted">Results</span><EvStatus value={exam.results_status} /></span>
          {manager && NEXT[exam.results_status].map((n) => (
            <Button key={n.to} variant={n.variant ?? 'ghost'} loading={step.isPending && step.variables === n.to} onClick={() => move(n.to)}>{n.label}</Button>
          ))}
        </>} />
      <Tabs items={tabs} active={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      <div className="mt-4">
        {tab === 'sheets' && <SheetsTab exam={exam} ai={st.data?.ai} />}
        {tab === 'questions' && <QuestionsTab exam={exam} manager={manager} />}
        {tab === 'results' && <ResultsTab exam={exam} />}
        {tab === 'setup' && manager && <SetupTab exam={exam} />}
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Answer sheets
// ---------------------------------------------------------------------------
function SheetsTab({ exam, ai }: { exam: Exam; ai?: AiStatus }) {
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [busyPoll, setBusyPoll] = useState(false);
  const subs = useApiQuery<SheetRow[]>(`${EV}/exams/${exam.id}/submissions`, undefined, { refetchInterval: busyPoll ? 3000 : undefined });
  const students = useApiQuery<EvStudent[]>(`${EV}/students`, { class_name: exam.class_name });
  const anyBusy = (subs.data ?? []).some((s) => isBusy(s.job));
  useEffect(() => {
    if (busyPoll && !anyBusy) void invalidate('/exam-correction'); // jobs finished: refresh the exam's counts too
    setBusyPoll(anyBusy);
  }, [anyBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  const classStudents = (students.data ?? []).filter((s) => !exam.section || !s.section || s.section === exam.section);
  const bySheet = new Map((subs.data ?? []).map((s) => [s.student.id, s]));
  // The whole class, one row per student: their sheet if uploaded, an upload button if not.
  // Sheets of students no longer in the roster (moved class) are kept at the end.
  const rows: RosterRow[] = [
    ...[...classStudents].sort((a, b) => (Number(a.roll_no) || 999) - (Number(b.roll_no) || 999) || a.name.localeCompare(b.name))
      .map((st) => ({ id: st.id, name: st.name, admissionNo: st.admission_no, rollNo: st.roll_no, sheet: bySheet.get(st.id) })),
    ...(subs.data ?? []).filter((s) => !classStudents.some((c) => c.id === s.student.id))
      .map((s) => ({ id: s.student.id, name: s.student.name, admissionNo: s.student.admission_no, rollNo: s.student.roll_no, sheet: s })),
  ];
  const withSheet = rows.filter((r) => r.sheet).length;

  const [uploadFor, setUploadFor] = useState<RosterRow | null>(null);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulking, setBulking] = useState(false);
  const [bulkOut, setBulkOut] = useState<{ file: string; ok: boolean; student?: string; error?: string }[] | null>(null);
  const [inputKey, setInputKey] = useState(0);

  const uploadBulk = async () => {
    if (!bulkFiles.length) return toast('Choose files named with admission numbers.', 'warning');
    const fd = new FormData();
    fd.append('auto_process', 'true');
    bulkFiles.forEach((f) => fd.append('files', f));
    setBulking(true);
    try {
      const r = await api.upload<{ results: { file: string; ok: boolean; student?: string; error?: string }[] }>(`${EV}/exams/${exam.id}/submissions/bulk`, fd);
      setBulkOut(r.data.results); setBulkFiles([]); setInputKey((k) => k + 1);
      await invalidate('/exam-correction');
    } catch (e) { toast(errorMessage(e), 'critical'); } finally { setBulking(false); }
  };

  const classLabel = `${exam.class_name}${exam.section ? ` · Section ${exam.section}` : ''}`;
  return (
    <div className="col g-4">
      <AiNotReady ai={ai} />
      <Card icon="users" title={`${classLabel} — ${withSheet} of ${classStudents.length} answer sheets`} flush
        sub={anyBusy ? 'Claude is working — this list refreshes by itself.' : 'Upload each student’s sheet from their row. Identity comes from the row, never from what the AI reads.'}>
        {subs.error || students.error ? <ErrorState error={subs.error ?? students.error} onRetry={() => { subs.refetch(); students.refetch(); }} /> : (
          <DataTable rows={rows} loading={subs.isLoading || students.isLoading} rowKey={(r) => r.id}
            onRowClick={(r) => (r.sheet ? navigate(`${BASE}/sheets/${r.sheet.id}`) : setUploadFor(r))}
            emptyText={`No students in ${classLabel}. Students come from Holy Sai — use "Sync students & staff" if a new admission is missing.`}
            columns={[
              { key: 'roll', label: 'Roll', width: '60px', render: (r) => <span className="t-num">{r.rollNo || '—'}</span> },
              { key: 'student', label: 'Student', render: (r) => <><span className="t-bold">{r.name}</span><div className="t-micro t-muted">{r.admissionNo}</div></> },
              { key: 'status', label: 'Status', render: (r) => !r.sheet ? <Badge>No sheet yet</Badge> : <><EvStatus value={r.sheet.status} />{r.sheet.status_note && <div className="t-micro t-critical pc-note">{r.sheet.status_note}</div>}</> },
              { key: 'marks', label: 'Marks', className: 'num', render: (r) => !r.sheet ? <span className="t-faint">—</span> : <><span className="t-num t-bold">{marks(r.sheet.totals.total)} / {marks(r.sheet.totals.maximum)}</span><div className="t-micro t-muted">{r.sheet.totals.marked}/{r.sheet.totals.questions} marked</div></> },
              { key: 'pages', label: 'Pages', className: 'num', render: (r) => <span className="t-num">{r.sheet ? r.sheet.pages : '—'}</span> },
              { key: 'id', label: 'Identity', render: (r) => !r.sheet ? '—' : r.sheet.identity_verified ? <Badge tone="success">confirmed</Badge> : <Badge tone="warning">to confirm</Badge> },
              {
                key: 'name', label: 'Name on sheet', render: (r) => !r.sheet?.name_check ? '—' : (
                  <span title={r.sheet.name_check.detail}>
                    <Badge tone={r.sheet.name_check.status === 'match' ? 'success' : r.sheet.name_check.status === 'differs' ? 'critical' : 'neutral'}>
                      {r.sheet.name_check.status === 'match' ? 'matches' : r.sheet.name_check.status === 'differs' ? 'differs' : 'none'}
                    </Badge>
                  </span>
                ),
              },
              {
                key: 'job', label: 'Activity', render: (r) => !r.sheet?.job ? '—' : (
                  <><span className="row g-1"><EvStatus value={r.sheet.job.status} /><span className="t-xs">{r.sheet.job.kind}</span></span>
                    {r.sheet.job.progress && isBusy(r.sheet.job) && <div className="t-micro t-muted">{r.sheet.job.progress}</div>}
                    {r.sheet.job.error && <div className="t-micro t-critical pc-note">{r.sheet.job.error}</div>}</>
                ),
              },
              {
                key: 'go', label: '', sortable: false, className: 'num', render: (r) => r.sheet
                  ? <Button size="sm" iconRight="arrowRight">Review</Button>
                  : <Button size="sm" variant="primary" icon="upload">Upload</Button>,
              },
            ]} />
        )}
      </Card>

      <Card icon="folder" title="Bulk upload" sub="Many sheets at once: one file per student, named with the admission number, e.g. HS-2026-1041.pdf">
        <div className="row g-3 wrap">
          <input key={`bulk${inputKey}`} aria-label="Answer sheet files" className="input pc-file grow" type="file" multiple accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => setBulkFiles(Array.from(e.target.files ?? []))} />
          <Button icon="upload" loading={bulking} onClick={uploadBulk}>Upload all</Button>
        </div>
        {bulkOut && (
          <ul className="pc-list">
            {bulkOut.map((r) => <li key={r.file}><span className="t-sm">{r.file}</span> {r.ok ? <Badge tone="success">{r.student}</Badge> : <Badge tone="critical">{r.error}</Badge>}</li>)}
          </ul>
        )}
      </Card>
      {uploadFor && <UploadSheetModal exam={exam} row={uploadFor} ai={ai} onClose={() => setUploadFor(null)} />}
    </div>
  );
}

interface RosterRow { id: string; name: string; admissionNo: string; rollNo: string; sheet?: SheetRow }

/** Uploads one student's answer sheet; the student is the row it was opened from. */
function UploadSheetModal({ exam, row, ai, onClose }: { exam: Exam; row: RosterRow; ai?: AiStatus; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [files, setFiles] = useState<File[]>([]);
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    if (!files.length) return setError(new Error('Choose the PDF or the photos of the pages.'));
    const fd = new FormData();
    fd.append('student_id', row.id);
    fd.append('auto_process', String(auto));
    files.forEach((f) => fd.append('files', f));
    setBusy(true); setError(null);
    try {
      const r = await api.upload<SheetRow & { note?: string }>(`${EV}/exams/${exam.id}/submissions`, fd);
      toast(r.data.note || `${row.name}’s answer sheet uploaded`, r.data.note ? 'warning' : 'success');
      await invalidate('/exam-correction');
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Upload answer sheet — ${row.name}`} sub={`${row.admissionNo}${row.rollNo ? ` · Roll ${row.rollNo}` : ''} · ${exam.name}`} busy={busy}
      foot={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" icon="upload" loading={busy} onClick={submit}>Upload</Button></>}>
      <div className="col g-3">
        {error ? <InlineError error={error} /> : null}
        <div className="field">
          <label className="label" htmlFor="pc-files">Pages</label>
          <input id="pc-files" className="input pc-file" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          <span className="hint">A PDF, or photos of the pages in order — up to 40 pages.</span>
        </div>
        <Checkbox checked={auto} onChange={setAuto} label={`Read and mark automatically with Claude${ai ? ` (${ai.vision_model} / ${ai.eval_model})` : ''}`} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Questions & rubrics
// ---------------------------------------------------------------------------
function QuestionsTab({ exam, manager }: { exam: Exam; manager: boolean }) {
  const confirm = useConfirm();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState<Question | 'new' | null>(null);
  const [rubricFor, setRubricFor] = useState<Question | null>(null);
  const [historyFor, setHistoryFor] = useState<Question | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [importing, setImporting] = useState(false);
  const reeval = useApiMutation<void, { jobs_queued: number }>('post', `${EV}/exams/${exam.id}/reevaluate`, {
    invalidate: ['/exam-correction'], success: (r) => `${r.data.jobs_queued} sheet(s) queued for re-evaluation`, body: () => ({}),
  });
  const questions = exam.questions ?? [];

  const draftAll = async () => {
    if (!(await confirm({ title: 'Draft missing rubrics with AI?', body: 'Claude drafts and saves a rubric for every question without one. Each is marked "AI draft" — review them before marking.', confirmLabel: 'Draft rubrics' }))) return;
    setDrafting(true);
    try {
      const r = await api.postLong<{ saved: unknown[]; failed: { error: string }[] }>(`${EV}/exams/${exam.id}/rubrics/draft-all`, { only_missing: true });
      toast(`Rubrics drafted for ${r.data.saved.length} question(s)${r.data.failed.length ? `; ${r.data.failed.length} failed: ${r.data.failed[0].error}` : ''}`, r.data.failed.length ? 'warning' : 'success');
      await invalidate('/exam-correction');
    } catch (e) { toast(errorMessage(e), 'critical'); } finally { setDrafting(false); }
  };

  return (
    <div className="col g-4">
      <div className="row g-2 wrap">
        {manager && <Button variant="primary" icon="upload" onClick={() => setImporting(true)}>Upload question paper</Button>}
        {manager && <Button icon="plus" onClick={() => setEditing('new')}>Add question</Button>}
        {questions.some((q) => !q.rubric) && <Button icon="sparkle" loading={drafting} onClick={draftAll}>Draft missing rubrics with AI</Button>}
        {questions.length > 0 && (
          <Button icon="refresh" loading={reeval.isPending} onClick={async () => {
            if (await confirm({ title: 'Re-evaluate unapproved answers?', body: 'Every answer that is not yet approved is marked again with the current rubrics. Approved marks are not touched.', confirmLabel: 'Re-evaluate' })) reeval.mutate();
          }}>Re-evaluate unapproved answers</Button>
        )}
      </div>
      {questions.length === 0 ? (
        <Card><Empty icon="helpCircle" title="No questions yet"
          sub={manager ? 'Upload the question paper — Claude reads the questions and drafts a rubric for each — or add questions one by one.' : 'The exam coordinator adds the questions.'}
          action={manager ? <Button variant="primary" icon="upload" onClick={() => setImporting(true)}>Upload question paper</Button> : undefined} /></Card>
      ) : questions.map((q) => (
        <Card key={q.id} title={<span className="row g-2 wrap"><span className="pc-qnum">Q{q.number}</span><Badge>{q.qtype}</Badge><Badge tone="navy">{marks(q.max_marks)} marks</Badge>
          {q.rubric ? <Badge tone="success">rubric v{q.rubric.version}</Badge> : <Badge tone="critical">no rubric</Badge>}
          {q.rubric?.source === 'ai_draft' && <Badge tone="warning" icon="sparkle">AI draft — review</Badge>}</span>}
          actions={<>
            {manager && <Button size="sm" icon="edit" onClick={() => setEditing(q)}>Question</Button>}
            {q.rubric && <Button size="sm" onClick={() => setHistoryFor(q)}>History</Button>}
            <Button size="sm" variant="primary" onClick={() => setRubricFor(q)}>{q.rubric ? 'Edit rubric' : 'Define rubric'}</Button>
          </>}>
          <p className="pc-text">{q.text}</p>
          {q.numeric_answer && <p className="t-xs t-muted">Checked by code: final answer {q.numeric_answer}{q.unit ? ` ${q.unit}` : ''} (±{q.numeric_tolerance})</p>}
          {q.rubric_problems.length > 0 && <div className="mt-2"><Banner tone="warning" icon="alert">Needs teacher clarification: {q.rubric_problems.join('; ')}</Banner></div>}
          {q.rubric && (
            <div className="mt-3">
              <DataTable compact stack={false} rows={q.rubric.criteria} rowKey={(c) => c.id}
                columns={[
                  { key: 'c', label: 'Criterion', render: (c) => <><span className="t-bold">{c.id}</span> {c.name}{c.description && <div className="t-micro t-muted">{c.description}</div>}</> },
                  { key: 'm', label: 'Marks', className: 'num', render: (c) => <span className="t-num">{marks(c.max_marks)}</span> },
                ]} />
              {q.rubric.reference_answer && <p className="t-sm mt-3"><span className="t-bold">Reference answer: </span>{q.rubric.reference_answer}</p>}
            </div>
          )}
        </Card>
      ))}
      {editing && <QuestionModal exam={exam} question={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {rubricFor && <RubricModal question={rubricFor} onClose={() => setRubricFor(null)} />}
      {historyFor && <RubricHistoryModal question={historyFor} onClose={() => setHistoryFor(null)} />}
      {importing && <ImportPaperModal exam={exam} onClose={() => setImporting(false)} />}
    </div>
  );
}

interface ImportResult {
  created: string[]; skipped: string[]; answer_key_found: boolean; warnings: string[];
  rubrics: { saved: string[]; failed: { question: string; error: string }[] }; default_marks_used: string[];
}

/** Upload the question paper (and answer key, if any): Claude reads the questions and drafts the rubrics. */
function ImportPaperModal({ exam, onClose }: { exam: Exam; onClose: () => void }) {
  const invalidate = useInvalidate();
  const [files, setFiles] = useState<File[]>([]);
  const [marks, setMarks] = useState('1');
  const [rubrics, setRubrics] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const submit = async () => {
    if (!files.length) return setError(new Error('Choose the question paper (PDF or photos).'));
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    fd.append('default_marks', marks);
    fd.append('draft_rubrics', String(rubrics));
    setBusy(true); setError(null);
    try {
      setResult((await api.upload<ImportResult>(`${EV}/exams/${exam.id}/questions/import`, fd, 600_000)).data);
      await invalidate('/exam-correction');
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Upload question paper" size="wide" busy={busy}
      sub="Claude reads the questions; an answer key in the same upload (e.g. a page headed Answers) is used for the rubrics."
      foot={result ? <Button variant="primary" onClick={onClose}>Review questions</Button> : <>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" icon="sparkle" loading={busy} onClick={submit}>Read paper{rubrics ? ' & draft rubrics' : ''}</Button>
      </>}>
      {result ? (
        <div className="col g-3">
          <Banner tone={result.created.length ? 'success' : 'neutral'} icon={result.created.length ? 'check' : 'info'}>
            {result.created.length ? `${result.created.length} question(s) added (Q${result.created.join(', Q')}).` : 'No new questions were added.'}
            {result.rubrics.saved.length > 0 && ` AI-draft rubrics saved for ${result.rubrics.saved.length}.`}
            {result.answer_key_found ? ' The answer key was used.' : ''}
          </Banner>
          {result.skipped.length > 0 && <Banner tone="neutral" icon="info">Already in the exam, skipped: Q{result.skipped.join(', Q')}.</Banner>}
          {result.default_marks_used.length > 0 && <Banner tone="warning" icon="alert">No marks printed for Q{result.default_marks_used.join(', Q')} — given {marks} mark(s) each. Change them with Edit question if needed.</Banner>}
          {result.rubrics.failed.length > 0 && <Banner tone="critical" icon="alert">Rubric drafting failed for Q{result.rubrics.failed.map((f) => f.question).join(', Q')}: {result.rubrics.failed[0].error}</Banner>}
          {result.warnings.map((w) => <Banner key={w} tone="neutral" icon="info">{w}</Banner>)}
          <AiNotice>Check each question and its <strong>AI draft</strong> rubric before marking — they are suggestions.</AiNotice>
        </div>
      ) : (
        <div className="col g-3">
          {error ? <InlineError error={error} /> : null}
          <div className="field">
            <label className="label" htmlFor="pc-paper">Question paper</label>
            <input id="pc-paper" className="input pc-file" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            <span className="hint">A PDF or photos in page order, up to 10 pages. Include the answer key pages if you have them.</span>
          </div>
          <div className="grid g-2col g-3">
            <SelectField label="Marks when none are printed" value={marks} onChange={setMarks}
              options={['1', '2', '3', '4', '5'].map((m) => ({ value: m, label: `${m} mark${m === '1' ? '' : 's'} per question` }))} />
            <div className="field"><span className="label">Rubrics</span><Checkbox checked={rubrics} onChange={setRubrics} label="Draft a rubric for each question with AI" /></div>
          </div>
          {busy && <Banner tone="neutral" icon="clock">Claude is reading the paper{rubrics ? ' and drafting rubrics' : ''} — this takes about a minute.</Banner>}
        </div>
      )}
    </Modal>
  );
}

function QuestionModal({ exam, question: q, onClose }: { exam: Exam; question?: Question; onClose: () => void }) {
  const confirm = useConfirm();
  const [f, setF] = useState({
    number: q?.number ?? String((exam.questions?.length ?? 0) + 1), text: q?.text ?? '', qtype: q?.qtype ?? 'short',
    max_marks: String(q?.max_marks ?? 2), mark_increment: String(q?.mark_increment ?? 0.5),
    numeric_answer: q?.numeric_answer ?? '', numeric_tolerance: String(q?.numeric_tolerance ?? 0.01), unit: q?.unit ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); };
  const save = useApiMutation<Record<string, unknown>>(q ? 'put' : 'post', q ? `${EV}/questions/${q.id}` : `${EV}/exams/${exam.id}/questions`, {
    invalidate: ['/exam-correction'], success: 'Question saved', onSuccess: onClose, error: false,
  });
  const del = useApiMutation<void>('delete', `${EV}/questions/${q?.id}`, { invalidate: ['/exam-correction'], success: 'Question deleted', onSuccess: onClose });

  const submit = () => {
    const e: Record<string, string> = {};
    if (!/^\d{1,2}[a-z]?$/i.test(f.number.trim())) e.number = 'Like 1, 2 or 2a';
    if (!f.text.trim()) e.text = 'Enter the question';
    const max = Number(f.max_marks), inc = Number(f.mark_increment);
    if (!(max > 0 && max <= 100)) e.max_marks = 'Between 0.5 and 100';
    else if (Math.abs(max / inc - Math.round(max / inc)) > 1e-9) e.max_marks = `Must be a multiple of ${inc}`;
    if (f.numeric_answer && !Number.isFinite(Number(f.numeric_answer))) e.numeric_answer = 'Enter a number';
    setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({
      number: f.number.trim().toLowerCase(), text: f.text.trim(), qtype: f.qtype, max_marks: max, mark_increment: inc,
      numeric_answer: f.numeric_answer.trim() || null, numeric_tolerance: Number(f.numeric_tolerance || '0.01'), unit: f.unit.trim() || null,
    });
  };
  return (
    <Modal open onClose={onClose} title={q ? `Edit question ${q.number}` : 'Add question'} size="wide" busy={save.isPending || del.isPending}
      foot={<>
        {q && <Button variant="danger" icon="trash" loading={del.isPending} onClick={async () => {
          if (await confirm({ title: `Delete question ${q.number}?`, body: 'Its rubric and any marks for it are removed.', confirmLabel: 'Delete', danger: true })) del.mutate();
        }}>Delete</Button>}
        <span className="grow" />
        <Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Save</Button>
      </>}>
      {save.error && <div className="mb-4"><InlineError error={save.error} /></div>}
      <div className="grid g-2col g-3">
        <TextField label="Number" required value={f.number} onChange={set('number')} error={errors.number} hint="1, 2 or 2a" maxLength={3} />
        <SelectField label="Type" value={f.qtype} onChange={set('qtype')} options={QTYPES} />
      </div>
      <TextArea label="Question" required value={f.text} onChange={set('text')} error={errors.text} rows={3} />
      <div className="grid g-2col g-3">
        <TextField label="Maximum marks" required type="number" step="0.5" min={0.5} value={f.max_marks} onChange={set('max_marks')} error={errors.max_marks} />
        <SelectField label="Marks in steps of" value={f.mark_increment} onChange={set('mark_increment')}
          options={[{ value: '0.5', label: 'Half marks' }, { value: '1', label: 'Whole marks' }, { value: '0.25', label: 'Quarter marks' }]} />
      </div>
      <div className="formsection">
        <div className="formsection__title">Numerical answer check (optional)</div>
        <p className="t-xs t-muted mb-3">For calculations: the student's final number is checked by code, independently of the AI.</p>
        <div className="grid g-3col g-3">
          <TextField label="Expected answer" value={f.numeric_answer} onChange={set('numeric_answer')} error={errors.numeric_answer} placeholder="60" />
          <TextField label="Tolerance" type="number" step="any" value={f.numeric_tolerance} onChange={set('numeric_tolerance')} />
          <TextField label="Unit" value={f.unit} onChange={set('unit')} placeholder="km/h" maxLength={20} />
        </div>
      </div>
    </Modal>
  );
}

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function RubricModal({ question: q, onClose }: { question: Question; onClose: () => void }) {
  const toast = useToast();
  const r: Partial<Rubric> = q.rubric ?? { criteria: [{ id: 'C1', name: '', max_marks: q.max_marks, description: '' }] };
  const [criteria, setCriteria] = useState<(Criterion & { key: number })[]>((r.criteria ?? []).map((c, i) => ({ ...c, key: i })));
  const fromRubric = (x: Partial<Rubric>) => ({
    reference_answer: x.reference_answer ?? '', expected_concepts: (x.expected_concepts ?? []).join('\n'), alternatives: (x.alternatives ?? []).join('\n'),
    misconceptions: (x.misconceptions ?? []).join('\n'), partial_credit_rules: x.partial_credit_rules ?? '', required_elements: x.required_elements ?? '',
    ignore_criteria: x.ignore_criteria ?? '', subject_rules: x.subject_rules ?? '',
  });
  const [f, setF] = useState(fromRubric(r));
  const [source, setSource] = useState<'teacher' | 'ai_draft'>('teacher');
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const total = criteria.reduce((a, c) => a + (Number(c.max_marks) || 0), 0);
  const save = useApiMutation<Record<string, unknown>, { answers_to_reevaluate?: number }>('post', `${EV}/questions/${q.id}/rubric`, {
    invalidate: ['/exam-correction'],
    success: (res) => res.data.answers_to_reevaluate ? `Rubric saved. ${res.data.answers_to_reevaluate} answer(s) were marked with the old rubric — use Re-evaluate.` : 'Rubric saved',
    onSuccess: onClose, error: false,
  });

  const draft = async () => {
    setDrafting(true);
    try {
      const d = (await api.postLong<Rubric>(`${EV}/questions/${q.id}/rubric/draft`)).data;
      setCriteria(d.criteria.map((c, i) => ({ ...c, key: Date.now() + i })));
      setF((x) => ({ ...fromRubric(d), required_elements: x.required_elements, subject_rules: x.subject_rules }));
      setSource('ai_draft');
      toast('AI draft filled in — check it before saving', 'info');
    } catch (e) { toast(errorMessage(e), 'critical'); } finally { setDrafting(false); }
  };
  const submit = () => {
    if (criteria.some((c) => !c.id.trim() || !c.name.trim() || !(Number(c.max_marks) > 0))) return setError('Every criterion needs an id, a description and marks.');
    if (Math.abs(total - q.max_marks) > 1e-9) return setError(`Criteria add up to ${marks(total)}; the question is worth ${marks(q.max_marks)}.`);
    setError('');
    save.mutate({
      criteria: criteria.map(({ id, name, max_marks, description }) => ({ id: id.trim(), name: name.trim(), max_marks: Number(max_marks), description: description ?? '' })),
      reference_answer: f.reference_answer, expected_concepts: lines(f.expected_concepts), alternatives: lines(f.alternatives),
      misconceptions: lines(f.misconceptions), partial_credit_rules: f.partial_credit_rules, required_elements: f.required_elements,
      ignore_criteria: f.ignore_criteria, subject_rules: f.subject_rules, source,
    });
  };
  const upd = (key: number, patch: Partial<Criterion>) => setCriteria((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  return (
    <Modal open onClose={onClose} size="wide" busy={save.isPending || drafting}
      title={`Rubric for Q${q.number} (${marks(q.max_marks)} marks)`} sub={q.text}
      foot={<><span className="t-xs t-muted grow">Saving creates a new rubric version. Approved marks never change by themselves.</span>
        <Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Save new version</Button></>}>
      <div className="row g-2 mb-3"><span className="grow" /><Button icon="sparkle" loading={drafting} onClick={draft}>Draft with AI</Button></div>
      {(error || save.error) && <div className="mb-3">{error ? <Banner tone="critical" icon="alert">{error}</Banner> : <InlineError error={save.error} />}</div>}
      <div className="formsection">
        <div className="formsection__title">Criteria — {marks(total)} of {marks(q.max_marks)} marks</div>
        <div className="col g-3">
          {criteria.map((c) => (
            <div key={c.key} className="pc-crit-row">
              <TextField label="Id" value={c.id} onChange={(v) => upd(c.key, { id: v })} maxLength={6} />
              <TextField label="What earns the marks" value={c.name} onChange={(v) => upd(c.key, { name: v })} />
              <TextField label="Marks" type="number" step={q.mark_increment} min={0} value={c.max_marks} onChange={(v) => upd(c.key, { max_marks: v as unknown as number })} />
              <Button icon="trash" aria-label="Remove criterion" disabled={criteria.length === 1} onClick={() => setCriteria((cs) => cs.filter((x) => x.key !== c.key))} />
              <TextField className="pc-crit-desc" label="Details for the marker (optional)" value={c.description ?? ''} onChange={(v) => upd(c.key, { description: v })} />
            </div>
          ))}
          <div><Button size="sm" icon="plus" onClick={() => setCriteria((cs) => [...cs, { key: Date.now(), id: `C${cs.length + 1}`, name: '', max_marks: q.mark_increment, description: '' }])}>Criterion</Button></div>
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Guidance for marking</div>
        <TextArea label="Reference answer" value={f.reference_answer} onChange={set('reference_answer')} rows={3} />
        <div className="grid g-2col g-3">
          <TextArea label="Expected concepts (one per line)" value={f.expected_concepts} onChange={set('expected_concepts')} rows={3} />
          <TextArea label="Also accept — valid alternatives (one per line)" value={f.alternatives} onChange={set('alternatives')} rows={3} />
          <TextArea label="Common misconceptions — no credit (one per line)" value={f.misconceptions} onChange={set('misconceptions')} rows={3} />
          <TextArea label="Partial-credit rules" value={f.partial_credit_rules} onChange={set('partial_credit_rules')} rows={3} placeholder="Method mark even if the arithmetic is wrong" />
          <TextField label="Required reasoning / formulas / units" value={f.required_elements} onChange={set('required_elements')} placeholder="formula, working, unit" />
          <TextField label="Do not assess" value={f.ignore_criteria} onChange={set('ignore_criteria')} placeholder="Spelling and grammar" />
        </div>
        <TextField label="Subject-specific rules" value={f.subject_rules} onChange={set('subject_rules')} />
      </div>
    </Modal>
  );
}

function RubricHistoryModal({ question: q, onClose }: { question: Question; onClose: () => void }) {
  const h = useApiQuery<(Rubric & { created_at: string })[]>(`${EV}/questions/${q.id}/rubrics`);
  return (
    <Modal open onClose={onClose} title={`Rubric history — Q${q.number}`}>
      {h.isLoading ? <PageSkeleton kpis={0} /> : h.error ? <ErrorState error={h.error} /> : (
        <div className="col g-3">
          {(h.data ?? []).map((r) => (
            <div key={r.version} className="pc-history">
              <div className="row g-2"><Badge tone="navy">v{r.version}</Badge>{r.source === 'ai_draft' && <Badge tone="warning">AI draft</Badge>}<span className="t-xs t-muted">{fmt.dateTime(r.created_at)}</span></div>
              <ul className="pc-list">{r.criteria.map((c) => <li key={c.id} className="t-sm">{c.id} ({marks(c.max_marks)}): {c.name}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Results & reports
// ---------------------------------------------------------------------------
interface Report {
  exam: { maximum: number; results_status: string };
  summary: { submissions: number; approved_sheets: number; pending_review: number; failed_or_attention: number; class_average: number | null; highest: number | null; lowest: number | null };
  students: { submission_id: string; name: string; admission_no: string; total: number; maximum: number; percent: number | null; approved: boolean; status: string }[];
  questions: { number: string; text: string; max_marks: number; average: number | null; average_percent: number | null; full_marks: number; zero: number; needs_review: number }[];
  common_misconceptions: [string, number][];
  common_missing_concepts: [string, number][];
  ai_vs_teacher: { approved_with_ai_suggestion: number; exact_agreement: number; within_half_mark: number; mean_absolute_difference: number | null; teacher_higher: number; teacher_lower: number };
  overrides: { count: number };
  ocr: { answers: number; corrected_by_teacher: number };
  processing: { runs: number; failed: number; average_seconds: number | null; cost_usd: number };
  evaluation_cost_usd: number;
}

function ResultsTab({ exam }: { exam: Exam }) {
  const navigate = useNavigate();
  const q = useApiQuery<Report>(`${EV}/exams/${exam.id}/report`);
  const [pushing, setPushing] = useState(false);
  const ready = exam.results_status === 'approved' || exam.results_status === 'published';
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data, s = r.summary, av = r.ai_vs_teacher;
  const ranked = (items: [string, number][]) => items.length
    ? <ol className="pc-list pc-list--num">{items.map(([t, n]) => <li key={t} className="t-sm">{t} <span className="t-muted">({n})</span></li>)}</ol>
    : <p className="t-sm t-muted">None found yet.</p>;

  return (
    <div className="col g-4">
      <Grid cols="g-4col">
        <Kpi icon="fileText" label="Answer sheets" value={s.submissions} foot={`${s.approved_sheets} fully approved`} />
        <Kpi icon="eye" label="Answers to review" value={s.pending_review} tone="amber" foot={`${s.failed_or_attention} sheet(s) need attention`} />
        <Kpi icon="barChart" label="Class average" value={marks(s.class_average)} unit={`/ ${marks(r.exam.maximum)}`} tone="info" />
        <Kpi icon="trending" label="Highest / lowest" value={`${marks(s.highest)} / ${marks(s.lowest)}`} tone="teal" />
      </Grid>

      <Card icon="send" title="Marks register"
        sub={ready ? 'Send the approved totals into a Holy Sai assessment, so they appear in Student 360, report cards and the parent portal.' : 'Approve the results (button at the top) to send them to the marks register.'}
        actions={<Button variant="primary" icon="send" disabled={!ready} onClick={() => setPushing(true)}>Send to assessment</Button>} />

      <Card icon="users" title="Students" flush actions={<Button size="sm" icon="download" onClick={() => api.download(`${EV}/exams/${exam.id}/report.csv`, `${exam.name}_results.csv`)}>Download CSV</Button>}>
        <DataTable rows={r.students} rowKey={(x) => x.submission_id} onRowClick={(x) => navigate(`${BASE}/sheets/${x.submission_id}`)} emptyText="No answer sheets yet."
          columns={[
            { key: 'name', label: 'Student', render: (x) => <><span className="t-bold">{x.name}</span><div className="t-micro t-muted">{x.admission_no}</div></> },
            { key: 'total', label: 'Total', className: 'num', render: (x) => <span className="t-num">{marks(x.total)} / {marks(x.maximum)}</span> },
            { key: 'pct', label: '%', className: 'num', render: (x) => <span className="t-num">{marks(x.percent)}</span> },
            { key: 'ok', label: 'Approved', render: (x) => x.approved ? <Badge tone="success">yes</Badge> : <Badge tone="warning">no</Badge> },
            { key: 'status', label: 'Status', render: (x) => <EvStatus value={x.status} /> },
          ]} />
      </Card>

      <Card icon="list" title="Question-wise performance" flush>
        <DataTable rows={r.questions} rowKey={(x) => x.number} emptyText="No questions."
          columns={[
            { key: 'n', label: 'Q', render: (x) => <span className="t-bold">{x.number}</span> },
            { key: 't', label: 'Question', render: (x) => <span className="t-sm">{x.text}</span> },
            { key: 'm', label: 'Max', className: 'num', render: (x) => <span className="t-num">{marks(x.max_marks)}</span> },
            { key: 'a', label: 'Average', className: 'num', render: (x) => <span className="t-num">{marks(x.average)}</span> },
            { key: 'p', label: 'Avg %', className: 'num', render: (x) => <span className="t-num">{marks(x.average_percent)}</span> },
            { key: 'f', label: 'Full marks', className: 'num', render: (x) => <span className="t-num">{x.full_marks}</span> },
            { key: 'z', label: 'Zero', className: 'num', render: (x) => <span className="t-num">{x.zero}</span> },
            { key: 'r', label: 'To review', className: 'num', render: (x) => <span className="t-num">{x.needs_review}</span> },
          ]} />
      </Card>

      <Grid cols="g-2col">
        <Card icon="alert" title="Common misconceptions">{ranked(r.common_misconceptions)}</Card>
        <Card icon="lightbulb" title="Commonly missing concepts">{ranked(r.common_missing_concepts)}</Card>
        <Card icon="sparkle" title="AI suggestion vs teacher-approved marks">
          <Dl items={[
            ['Approved answers with an AI suggestion', av.approved_with_ai_suggestion], ['Exact agreement', av.exact_agreement],
            ['Within half a mark', av.within_half_mark], ['Mean absolute difference', marks(av.mean_absolute_difference)],
            ['Teacher gave more', av.teacher_higher], ['Teacher gave less', av.teacher_lower], ['Mark overrides recorded', r.overrides.count],
            ['Transcriptions corrected by teachers', `${r.ocr.corrected_by_teacher} of ${r.ocr.answers}`],
          ]} />
        </Card>
        <Card icon="activity" title="Processing">
          <StatStrip items={[
            { label: 'Claude readings', value: r.processing.runs }, { label: 'Failed', value: r.processing.failed },
            { label: 'Avg per sheet', value: r.processing.average_seconds == null ? '—' : `${r.processing.average_seconds} s` },
            { label: 'Reading cost', value: `$${r.processing.cost_usd}` },
          ]} />
          <p className="t-xs t-muted mt-3">Marking cost so far: ${r.evaluation_cost_usd} (estimated from token usage).</p>
        </Card>
      </Grid>
      {pushing && <PushMarksModal exam={exam} onClose={() => setPushing(false)} />}
    </div>
  );
}

interface AssessmentRow { id: string; code: string; name: string; status: string; heldOn: string; maxMarks: number; grade: string; subject: string; of: number; entered: number }
interface PushResult { sent: number; skipped: { admissionNo: string; name: string; reason: string }[]; scaledFrom: number | null; scaledTo: number; entered: number; of: number }

function PushMarksModal({ exam, onClose }: { exam: Exam; onClose: () => void }) {
  const list = usePagedQuery<AssessmentRow>('/academics/assessments', { pageSize: 200, sort: 'date', dir: 'desc' });
  const [assessmentId, setAssessmentId] = useState('');
  const [result, setResult] = useState<PushResult | null>(null);
  const open = useMemo(() => (list.data?.rows ?? []).filter((a) => a.status === 'Scheduled' || a.status === 'In Progress')
    .sort((a, b) => Number(b.subject === exam.subject) - Number(a.subject === exam.subject)), [list.data, exam.subject]);
  const chosen = open.find((a) => a.id === assessmentId);
  const push = useApiMutation<{ assessmentId: string }, PushResult>('post', `/exam-correction/exams/${exam.id}/push-marks`, {
    invalidate: ['/academics/assessments'], onSuccess: (r) => setResult(r.data),
  });
  return (
    <Modal open onClose={onClose} title="Send marks to an assessment" sub={`${exam.name} · ${marks(exam.maximum)} marks`} size="wide" busy={push.isPending}
      foot={result ? <Button variant="primary" onClick={onClose}>Done</Button> : <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="send" disabled={!assessmentId} loading={push.isPending} onClick={() => push.mutate({ assessmentId })}>Send marks</Button>
      </>}>
      {result ? (
        <div className="col g-3">
          <Banner tone="success" icon="check">
            {result.sent} mark(s) saved — {result.entered} of {result.of} students now have marks.
            {result.scaledFrom != null && ` Totals were scaled from ${marks(result.scaledFrom)} to ${marks(result.scaledTo)} marks.`}
          </Banner>
          {result.skipped.length > 0 && (
            <Card title={`Not sent (${result.skipped.length})`} tight>
              <ul className="pc-list">{result.skipped.map((x) => <li key={x.admissionNo} className="t-sm">{x.name} ({x.admissionNo}) — {x.reason}</li>)}</ul>
            </Card>
          )}
          <p className="t-sm">Review, moderate and complete the assessment in <Link to="/assessments">Assessments</Link>.</p>
        </div>
      ) : (
        <div className="col g-3">
          <SelectField label="Assessment" required value={assessmentId} onChange={setAssessmentId}
            placeholder={list.isLoading ? 'Loading…' : open.length ? 'Choose an assessment…' : 'No open assessment — create one in Assessments'}
            options={open.map((a) => ({ value: a.id, label: `${a.code} · ${a.name} — ${a.grade} ${a.subject} · out of ${a.maxMarks} · ${a.status}` }))}
            hint="Scheduled and in-progress assessments you can enter marks for. Matching subjects are listed first." />
          {chosen && Number(chosen.maxMarks) !== exam.maximum && (
            <Banner tone="warning" icon="info">The assessment is out of {chosen.maxMarks}; this examination is out of {marks(exam.maximum)}. Totals are scaled proportionally.</Banner>
          )}
          <p className="t-xs t-muted">Students are matched by admission number. Only fully approved sheets are sent; marks already entered for those students are replaced.</p>
          {push.error && <InlineError error={push.error} />}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Settings (coordinators)
// ---------------------------------------------------------------------------
function SetupTab({ exam }: { exam: Exam }) {
  const users = useApiQuery<{ id: string; name: string; role: string; active: boolean }[]>(`${EV}/users`);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const assigned = picked ?? new Set(exam.teachers.map((t) => t.id));
  const teachers = (users.data ?? []).filter((u) => u.role === 'teacher' && (u.active || assigned.has(u.id)));
  const save = useApiMutation<{ user_ids: string[] }>('put', `${EV}/exams/${exam.id}/teachers`, {
    invalidate: ['/exam-correction'], success: 'Teachers assigned', onSuccess: () => setPicked(null),
  });
  const toggle = (id: string, on: boolean) => { const n = new Set(assigned); if (on) n.add(id); else n.delete(id); setPicked(n); };
  return (
    <Grid cols="g-2col">
      <Card icon="clipboard" title="Examination details" actions={<Button size="sm" icon="edit" onClick={() => setEditing(true)}>Edit</Button>}>
        <Dl items={[
          ['Class', `${exam.class_name}${exam.section ? ` · Section ${exam.section}` : ''}`], ['Subject', exam.subject],
          ['Academic year', exam.academic_year], ['Board / level', exam.grade_level || '—'], ['Instructions', exam.instructions || '—'],
        ]} />
      </Card>
      <Card icon="users" title="Assigned teachers" sub="Teachers see and mark only the examinations assigned to them."
        foot={<Button variant="primary" loading={save.isPending} disabled={!picked} onClick={() => save.mutate({ user_ids: [...assigned] })}>Save</Button>}>
        {users.isLoading ? <PageSkeleton kpis={0} /> : users.error ? <ErrorState error={users.error} /> : teachers.length === 0
          ? <Empty icon="users" title="No teachers yet" sub="Teachers appear here after the roster sync." />
          : <div className="col g-2">{teachers.map((t) => <Checkbox key={t.id} checked={assigned.has(t.id)} onChange={(v) => toggle(t.id, v)} label={<>{t.name}{!t.active && <span className="t-muted"> (inactive)</span>}</>} />)}</div>}
      </Card>
      {editing && <ExamModal exam={exam} onClose={() => setEditing(false)} onSaved={() => undefined} />}
    </Grid>
  );
}

