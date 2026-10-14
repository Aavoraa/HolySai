import { useEffect, useMemo, useRef, useState } from 'react';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { ApiError } from '@/api/client';
import type { StudentRow } from '@/api/types';
import { fmt, todayKey } from '@/lib/format';
import {
  AiNotice, Banner, Button, Card, Chips, DataTable, Dl, ErrorState, Flow, Icon, Modal, Page, PageHead,
  Pagination, SelectField, Skeleton, Status, TextField, Toolbar,
} from '@/components/ui';
import { DraftCard, type Draft } from './CopilotDraft';
import { StudentPicker } from './shared';

type DraftType = Draft['type'];
interface Ctx {
  actions: { id: DraftType; label: string; icon: string; desc: string }[];
  sections: { id: string; gradeLevel: number; label: string; campus: string }[];
  subjects: { id: string; code: string; name: string }[];
  grades: number[];
  topics: string[];
  lessonLengths: number[];
  banner: null | {
    objective: { code: string; description: string; coverage: number; mastery: number } | null;
    objectiveCount: number; questionCount: number;
    stats: { label: string; term: string | null; average: number | null; below60: number; students: number } | null;
  };
  provider: { name: string; kind: string; description: string; envVar: string };
}
interface DraftRow { id: string; type: DraftType; status: Draft['status']; createdAt: string; approvedAt: string | null; requestedBy: string; approvedBy: string | null; title: string; classLabel: string | null; warnings: number }

const TYPE_LABEL: Record<DraftType, string> = { lesson: 'Lesson plan', worksheet: 'Worksheet', quiz: 'Quiz', comment: 'Report comments', message: 'Parent message', brief: 'Weekly brief' };
const PURPOSES = [
  { value: 'attendance', label: 'Attendance' }, { value: 'homework', label: 'Homework' },
  { value: 'progress', label: 'Progress update' }, { value: 'general', label: 'General update' },
];

export default function CopilotPage() {
  const [action, setAction] = useState<DraftType | null>(null);
  const [form, setForm] = useState({ grade: '', sectionId: '', subjectId: '', topic: '', customTopic: '', lessonMinutes: '40', messagePurpose: 'attendance', plannedFor: '' });
  const [student, setStudent] = useState<StudentRow | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftId, setDraftId] = useState<string | null>(null);
  const [policy, setPolicy] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const historyRef = useRef<HTMLDivElement>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const topic = form.topic === '__other' ? form.customTopic.trim() : form.topic;
  // Options load once; the banner (objective, class results) follows the selection and keeps its last value while refetching.
  const ctx = useApiQuery<Ctx>('/copilot/context', undefined, { staleTime: 5 * 60_000 });
  const ready = !!(form.grade && form.subjectId);
  const detail = useApiQuery<Ctx>(ready ? '/copilot/context' : null, {
    grade: form.grade, subjectId: form.subjectId, topic: topic || undefined, sectionId: form.sectionId || undefined,
  }, { staleTime: 30_000 });
  const [lastDetail, setLastDetail] = useState<Ctx | null>(null);
  useEffect(() => { if (detail.data) setLastDetail(detail.data); }, [detail.data]);
  const c = ctx.data ? { ...ctx.data, topics: (ready && lastDetail?.topics) || ctx.data.topics } : undefined;
  // Sensible defaults once the options arrive: first grade taught, Mathematics if available.
  useEffect(() => {
    if (!c) return;
    setForm((f) => ({
      ...f,
      grade: f.grade || String(c.grades.includes(6) ? 6 : c.grades[0] ?? ''),
      subjectId: f.subjectId || (c.subjects.find((s) => s.code === 'MAT') ?? c.subjects[0])?.id || '',
      topic: f.topic || c.topics[0] || '',
    }));
  }, [ctx.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const draft = useApiQuery<Draft>(draftId ? `/copilot/drafts/${draftId}` : null);
  const drafts = usePagedQuery<DraftRow>('/copilot/drafts', { page, pageSize: 8, sort: 'created', dir: 'desc', status: statusFilter || undefined });
  const generate = useApiMutation<Record<string, unknown>, Draft>('post', '/copilot/drafts', {
    invalidate: ['/copilot/drafts'],
    success: 'Draft generated — review before publishing',
    onSuccess: (r) => setDraftId(r.data.id),
    error: false,
  });

  const sections = useMemo(() => (ctx.data?.sections ?? []).filter((s) => String(s.gradeLevel) === form.grade), [ctx.data, form.grade]);
  const needsSection = action === 'comment' || action === 'brief';

  const pick = (id: DraftType) => { setAction(id); setDraftId(null); setErrors({}); };
  const submit = () => {
    const e: Record<string, string> = {};
    if (!form.grade) e.grade = 'Choose a grade';
    if (!form.subjectId) e.subjectId = 'Choose a subject';
    if (!topic || topic.length < 2) e.topic = 'Choose or type a topic';
    if (needsSection && !form.sectionId) e.sectionId = 'Choose a class section';
    if (action === 'message' && !student) e.studentId = 'Choose a student';
    if (form.plannedFor && form.plannedFor < todayKey()) e.plannedFor = 'Choose today or a later date';
    setErrors(e);
    if (Object.keys(e).length || !action) return;
    generate.mutate({
      type: action, grade: Number(form.grade), subjectId: form.subjectId, topic,
      sectionId: form.sectionId || undefined, studentId: action === 'message' ? student?.id : undefined,
      lessonMinutes: Number(form.lessonMinutes), messagePurpose: form.messagePurpose, plannedFor: action === 'lesson' && form.plannedFor ? form.plannedFor : undefined,
    }, { onError: (err) => setErrors(err instanceof ApiError ? { ...err.fieldErrors, _: err.message } : { _: err.message }) });
  };

  const b = ready && topic ? (detail.data ?? lastDetail)?.banner : null;
  const current = draft.data;
  return (
    <Page>
      <PageHead
        title="AI Teacher Co-Pilot"
        sub="Drafts the routine work so teaching time goes to teaching. Every output is reviewed, edited and approved by a named teacher before it reaches a student or a parent."
        actions={<>
          <Button icon="shield" onClick={() => setPolicy(true)}>Approval policy</Button>
          <Button icon="clock" onClick={() => { setAction(null); setDraftId(null); setTimeout(() => historyRef.current?.scrollIntoView({ behavior: 'smooth' }), 0); }}>History</Button>
        </>}
      />

      <Card icon="grid" title="What do you need?" sub="Pick a task. The Co-Pilot drafts it from your class data and the approved curriculum.">
        {ctx.error ? <ErrorState error={ctx.error} onRetry={() => ctx.refetch()} /> : !c ? <Skeleton height={140} /> : (
          <div className="grid g-3col">
            {c.actions.map((a) => {
              const on = action === a.id;
              return (
                <button key={a.id} type="button" className="card card--link" aria-pressed={on} onClick={() => pick(a.id)}
                  style={{ padding: 16, textAlign: 'left', ...(on ? { borderColor: 'var(--navy)', boxShadow: 'inset 0 0 0 1px var(--navy)' } : {}) }}>
                  <span className="row g-3">
                    <span className="avatar avatar--amber none"><Icon name={a.icon} size={17} /></span>
                    <span className="col grow"><span className="t-sm t-bold">{a.label}</span><span className="t-micro t-muted">{a.desc}</span></span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {action && c && (
        <div className="mt-4">
          <Card
            title="Context"
            sub="The Co-Pilot only uses this class, this curriculum and the approved question bank."
            foot={
              <div className="row between wrap g-3">
                <span className="t-micro t-muted">Generator: {c.provider.description}</span>
                <Button variant="primary" icon="sparkle" loading={generate.isPending} onClick={submit}>{draftId ? 'Regenerate draft' : 'Generate draft'}</Button>
              </div>
            }
          >
            <div className="grid g-4col g-3">
              <SelectField label="Grade" required value={form.grade} onChange={(v) => setForm((f) => ({ ...f, grade: v, sectionId: '' }))}
                options={c.grades.map((g) => ({ value: String(g), label: `Grade ${g}` }))} placeholder="Choose" error={errors.grade} />
              <SelectField label={needsSection ? 'Class' : 'Class (optional)'} required={needsSection} value={form.sectionId} onChange={set('sectionId')}
                options={sections.map((s) => ({ value: s.id, label: `${s.label} · ${s.campus}` }))} placeholder={needsSection ? 'Choose a class' : 'Whole grade'} error={errors.sectionId} />
              <SelectField label="Subject" required value={form.subjectId} onChange={set('subjectId')}
                options={c.subjects.map((s) => ({ value: s.id, label: s.name }))} placeholder="Choose" error={errors.subjectId} />
              <SelectField label="Topic" required value={form.topic} onChange={set('topic')}
                options={[...c.topics.map((t) => ({ value: t, label: t })), { value: '__other', label: 'Other topic…' }]} placeholder="Choose" error={form.topic === '__other' ? undefined : errors.topic} />
              {form.topic === '__other' && <TextField label="Topic name" required value={form.customTopic} onChange={set('customTopic')} maxLength={80} error={errors.topic} />}
              {action === 'lesson' && <>
                <SelectField label="Lesson length" value={form.lessonMinutes} onChange={set('lessonMinutes')}
                  options={c.lessonLengths.map((m) => ({ value: String(m), label: m === 80 ? 'Double period (80 minutes)' : `${m} minutes` }))} />
                <TextField label="Planned for (optional)" type="date" min={todayKey()} value={form.plannedFor} onChange={set('plannedFor')} error={errors.plannedFor} />
              </>}
              {action === 'message' && (
                <SelectField label="Purpose" value={form.messagePurpose} onChange={set('messagePurpose')} options={PURPOSES} />
              )}
            </div>
            {action === 'message' && (
              <div className="mt-3 field">
                <span className="label">Student <span className="req">*</span></span>
                {student ? (
                  <div className="row g-3 card card--tint" style={{ padding: '8px 12px', maxWidth: 520 }}>
                    <span className="grow t-sm"><strong>{student.fullName}</strong> · {student.grade}{student.section} · {student.admissionNo}</span>
                    <Button size="sm" variant="quiet" onClick={() => setStudent(null)}>Change</Button>
                  </div>
                ) : <StudentPicker onPick={setStudent} />}
                {errors.studentId && <span className="hint hint--error" role="alert"><Icon name="alertCircle" size={13} />{errors.studentId}</span>}
              </div>
            )}
            <div className="mt-3">
              {detail.isLoading && !lastDetail ? <Skeleton height={40} /> : b ? (
                <Banner tone="neutral" icon="target">
                  {b.objective
                    ? <>Cambridge objective <strong>{b.objective.code}</strong> will be used ({b.objective.description.toLowerCase()} — mastery {b.objective.mastery}%). </>
                    : <>No approved learning objective matches this topic yet. </>}
                  {b.stats?.average != null
                    ? <>{b.stats.label} average in the latest term ({b.stats.term}) was <strong>{b.stats.average}</strong>, with {b.stats.below60} of {b.stats.students} students below 60. </>
                    : <>No term results are recorded for this selection. </>}
                  {b.questionCount} approved question-bank item{b.questionCount === 1 ? '' : 's'} on this topic.
                </Banner>
              ) : <Banner tone="neutral" icon="target">Choose a grade, subject and topic to see the curriculum and class data the draft will use.</Banner>}
            </div>
            {errors._ && <div className="mt-3"><Banner tone="critical" icon="alert">{errors._}</Banner></div>}
          </Card>
        </div>
      )}

      {draftId && (draft.isLoading ? <div className="mt-4"><Skeleton height={320} /></div> : draft.error ? <div className="mt-4"><ErrorState error={draft.error} onRetry={() => draft.refetch()} /></div>
        : current && <DraftCard draft={current} onClosed={() => setDraftId(null)} />)}

      <div className="mt-4" ref={historyRef}>
        <Card icon="grid"
          title="Recent drafts" flush
          sub="Open any draft to review, edit, approve or discard it"
        >
          <Toolbar>
            <Chips items={[{ id: '', label: 'All' }, { id: 'Under Review', label: 'Under review' }, { id: 'Draft', label: 'Draft' }, { id: 'Approved', label: 'Approved' }, { id: 'Rejected', label: 'Discarded' }]}
              active={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} />
          </Toolbar>
          {drafts.error ? <ErrorState error={drafts.error} onRetry={() => drafts.refetch()} /> : (
            <DataTable<DraftRow>
              rows={drafts.data?.rows} loading={drafts.isLoading} rowKey={(r) => r.id}
              onRowClick={(r) => { setDraftId(r.id); setAction(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              rowClassName={(r) => (r.id === draftId ? 'is-selected' : undefined)}
              emptyText={statusFilter ? 'No drafts with this status. Choose “All” to see every draft.' : 'No drafts yet. Pick a task above to create one.'}
              columns={[
                { key: 'what', label: 'Draft', render: (r) => <><div className="t-sm t-bold">{r.title}</div><div className="t-micro t-muted">{TYPE_LABEL[r.type]}{r.warnings ? ` · ${r.warnings} note${r.warnings > 1 ? 's' : ''} to check` : ''}</div></> },
                { key: 'cls', label: 'Class', render: (r) => r.classLabel ?? '—' },
                { key: 'by', label: 'Approved by', render: (r) => r.approvedBy ?? <span className="t-faint">—</span> },
                { key: 'when', label: 'When', render: (r) => <>{fmt.relative(r.approvedAt ?? r.createdAt)}<div className="t-micro t-muted">by {r.requestedBy}</div></> },
                { key: 'status', label: 'Status', render: (r) => <Status value={r.status} label={r.status === 'Rejected' ? 'Discarded' : r.status} /> },
              ]}
            />
          )}
          <Pagination meta={drafts.data?.meta} onPage={setPage} />
        </Card>
      </div>

      <Modal open={policy} onClose={() => setPolicy(false)} size="wide" title="AI approval policy" foot={<Button variant="primary" onClick={() => setPolicy(false)}>Close</Button>}>
        <Flow steps={[
          { label: 'Review', meta: 'Teacher reads the draft', state: 'done' },
          { label: 'Edit', meta: 'Anything can be changed', state: 'active' },
          { label: 'Approve', meta: 'Named approver recorded' },
          { label: 'Publish', meta: 'Lesson plan / message / comment' },
        ]} />
        <div className="mt-4">
          <Dl items={[
            ['Who can approve', 'Any member of staff with Co-Pilot access. The approver’s name and time are stored with the draft.'],
            ['What gets published', 'An approved lesson draft becomes an approved lesson plan for the class. Other drafts are kept ready for use and are never sent automatically.'],
            ['What the Co-Pilot reads', 'Learning objectives, the approved question bank, class results, attendance and homework for classes you teach.'],
            ['Generator', c?.provider.description ?? 'Template draft generator'],
            ['Configuration', `A language model can be connected later through the ${c?.provider.envVar ?? 'AI_PROVIDER'} setting; the approval gate stays the same.`],
          ]} />
        </div>
        <div className="mt-4"><AiNotice /></div>
      </Modal>
    </Page>
  );
}
