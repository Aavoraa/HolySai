import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import {
  Badge, Button, Card, DataTable, ErrorState, FilterSelect, Icon, InlineError, Modal, Page, PageHead, Pagination, SearchInput, SelectField,
  Status, TextArea, TextField, useConfirm, Toolbar,
} from '@/components/ui';
import { serverFieldErrors } from './shared';

interface Topic { topic: string; subjectId: string; subject: string; stage: string; items: number; used: number; drafts: number; difficulty: string }
interface Question {
  id: string; subjectId: string; subject: string; topic: string; stageLabel: string; question: string; questionType: string;
  difficulty: string; marks: number; timesUsed: number; status: string; createdById: string | null; createdBy: string | null;
}

const TYPES = [{ value: 'short', label: 'Short answer' }, { value: 'mcq', label: 'Multiple choice' }, { value: 'long', label: 'Long answer' }, { value: 'numeric', label: 'Numeric' }];
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));
const DIFF_TONE: Record<string, string> = { Higher: 'warning', Core: 'neutral', Foundation: 'info', Mixed: 'neutral' };

export default function QuestionBankPage() {
  const { can } = useAuth();
  const { lookups } = useLookups();
  const [subjectId, setSubjectId] = useState('');
  const [search, setSearch] = useState('');
  const q = useApiQuery<Topic[]>('/academics/question-bank/topics', { subjectId: subjectId || undefined, q: search || undefined });
  const [browse, setBrowse] = useState<Topic | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <Page>
      <PageHead title="Question Bank" sub="Approved questions, tagged to Cambridge objectives and reused across assessments."
        actions={can('academics.manage') && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add question</Button>} />
      <Card flush>
        <Toolbar>
          <SearchInput value={search} onSearch={setSearch} placeholder="Search topics" />
          <FilterSelect label="Subject" value={subjectId} onChange={setSubjectId} options={(lookups?.subjects ?? []).map((x) => ({ value: x.id, label: x.name }))} />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable
            rows={q.data}
            loading={q.isLoading}
            rowKey={(r) => `${r.subjectId}|${r.topic}|${r.stage}`}
            onRowClick={setBrowse}
            emptyText={search || subjectId ? 'No topics match these filters.' : 'The question bank is empty. Approved questions appear here, grouped by topic.'}
            columns={[
              { key: 'topic', label: 'Topic', render: (r) => <span className="t-bold">{r.topic}</span> },
              { key: 'subject', label: 'Subject' },
              { key: 'stage', label: 'Stage' },
              { key: 'items', label: 'Questions', className: 'num', render: (r) => <span className="t-num">{r.items}{r.drafts ? <span className="t-micro t-muted"> · {r.drafts} draft</span> : null}</span> },
              { key: 'used', label: 'Used in assessments', className: 'num', render: (r) => <span className="t-num">{r.used}</span> },
              { key: 'difficulty', label: 'Difficulty', render: (r) => <Badge tone={DIFF_TONE[r.difficulty] ?? 'neutral'}>{r.difficulty}</Badge> },
              { key: 'a', label: '', className: 'num', render: (r) => <Button size="sm" onClick={(e) => { e.stopPropagation(); setBrowse(r); }}>Browse</Button> },
            ]}
          />
        )}
      </Card>
      {browse && <BrowseModal topic={browse} onClose={() => setBrowse(null)} />}
      {adding && <QuestionForm onClose={() => setAdding(false)} />}
    </Page>
  );
}

function BrowseModal({ topic, onClose }: { topic: Topic; onClose: () => void }) {
  const { can, user } = useAuth();
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Question | 'new' | null>(null);
  const q = usePagedQuery<Question>('/academics/question-bank', {
    subjectId: topic.subjectId, topic: topic.topic, q: search || undefined, difficulty: difficulty || undefined, status: status || undefined, page, pageSize: 10, sort: 'question',
  });
  const inv = ['/academics/question-bank'];
  const retire = useApiMutation<string>('put', (id) => `/academics/question-bank/${id}`, { invalidate: inv, body: () => ({ status: 'Retired' }), success: 'Question retired' });
  const del = useApiMutation<string>('delete', (id) => `/academics/question-bank/${id}`, { invalidate: inv, success: 'Question deleted' });
  const mayEdit = (r: Question) => can('academics.manage') && (can('students.read') || r.createdById === user?.id);
  useEffect(() => setPage(1), [search, difficulty, status]);

  return (
    <Modal open onClose={onClose} size="full" title={topic.topic} sub={`${topic.subject} · ${topic.stage} · ${topic.items} questions, ${topic.used} used in assessments`}
      foot={<>{can('academics.manage') && <Button icon="plus" onClick={() => setEditing('new')}>Add to this topic</Button>}<Button variant="primary" onClick={onClose}>Close</Button></>}>
      <div className="filterbar mb-3">
        <SearchInput value={search} onSearch={setSearch} placeholder="Search questions" />
        <FilterSelect label="Difficulty" value={difficulty} onChange={setDifficulty} options={['Foundation', 'Core', 'Higher']} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={['Approved', 'Draft', 'Retired']} />
      </div>
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <DataTable
          compact
          rows={q.data?.rows}
          loading={q.isLoading}
          rowKey={(r) => r.id}
          emptyText="No questions match."
          columns={[
            { key: 'question', label: 'Question', render: (r) => <><span className="t-sm">{r.question}</span><div className="t-micro t-muted">{TYPE_LABEL[r.questionType]} · {r.marks} mark{r.marks === 1 ? '' : 's'}{r.createdBy ? ` · ${r.createdBy}` : ''}</div></> },
            { key: 'difficulty', label: 'Difficulty', render: (r) => <Badge tone={DIFF_TONE[r.difficulty]}>{r.difficulty}</Badge> },
            { key: 'used', label: 'Used', className: 'num', render: (r) => <span className="t-num">{r.timesUsed}</span> },
            { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
            {
              key: 'a', label: '', className: 'num', render: (r) => mayEdit(r) && (
                <span className="ac-links">
                  <Button size="sm" icon="edit" onClick={() => setEditing(r)} aria-label="Edit question">Edit</Button>
                  {r.timesUsed > 0 ? (
                    r.status !== 'Retired' && <Button size="sm" onClick={async () => {
                      if (await confirm({ title: 'Retire this question?', body: 'It stays on past assessments but is no longer offered for new ones.', confirmLabel: 'Retire' })) retire.mutate(r.id);
                    }}>Retire</Button>
                  ) : (
                    <Button size="sm" variant="danger" icon="trash" aria-label="Delete question" onClick={async () => {
                      if (await confirm({ title: 'Delete this question?', body: 'It has never been used, so it will be removed permanently.', confirmLabel: 'Delete', danger: true })) del.mutate(r.id);
                    }} />
                  )}
                </span>
              ),
            },
          ]}
        />
      )}
      <Pagination meta={q.data?.meta} onPage={setPage} />
      {editing && <QuestionForm question={editing === 'new' ? undefined : editing} defaults={topic} onClose={() => setEditing(null)} />}
    </Modal>
  );
}

function QuestionForm({ question, defaults, onClose }: { question?: Question; defaults?: Topic; onClose: () => void }) {
  const { lookups } = useLookups();
  const topics = useApiQuery<Topic[]>('/academics/question-bank/topics');
  const editing = !!question;
  const [f, setF] = useState({
    subjectId: question?.subjectId ?? defaults?.subjectId ?? '', topic: question?.topic ?? defaults?.topic ?? '',
    stageLabel: question?.stageLabel ?? defaults?.stage ?? '', question: question?.question ?? '', questionType: question?.questionType ?? 'short',
    difficulty: question?.difficulty ?? 'Core', marks: String(question?.marks ?? 1), status: question?.status ?? 'Draft',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); };
  const save = useApiMutation<Record<string, unknown>>(editing ? 'put' : 'post', editing ? `/academics/question-bank/${question!.id}` : '/academics/question-bank', {
    invalidate: ['/academics/question-bank'], success: editing ? 'Question updated' : 'Question added', onSuccess: onClose, error: false,
  });
  useEffect(() => { if (save.error) setErrors(serverFieldErrors(save.error)); }, [save.error]);
  const submit = () => {
    const e: Record<string, string> = {};
    if (!editing && !f.subjectId) e.subjectId = 'Choose a subject';
    if (f.topic.trim().length < 2) e.topic = 'Enter a topic';
    if (!f.stageLabel.trim()) e.stageLabel = 'Enter a stage';
    if (f.question.trim().length < 5) e.question = 'Write the question';
    const marks = Number(f.marks);
    if (!Number.isInteger(marks) || marks < 1 || marks > 100) e.marks = '1–100';
    setErrors(e);
    if (Object.keys(e).length) return;
    const body = { topic: f.topic.trim(), stageLabel: f.stageLabel.trim(), question: f.question.trim(), questionType: f.questionType, difficulty: f.difficulty, marks, status: f.status };
    save.mutate(editing ? body : { ...body, subjectId: f.subjectId });
  };
  return (
    <Modal open onClose={onClose} busy={save.isPending} size="wide" title={editing ? 'Edit question' : 'Add question'}
      foot={<><Button onClick={onClose} disabled={save.isPending}>Cancel</Button><Button variant="primary" onClick={submit} loading={save.isPending}>{editing ? 'Save changes' : 'Add question'}</Button></>}>
      {save.error && !Object.keys(serverFieldErrors(save.error)).length && <div className="mb-3"><InlineError error={save.error} /></div>}
      <div className="formsection">
        <div className="formsection__title">Where it belongs</div>
        <div className="grid g-2col g-3">
          {!editing && <SelectField label="Subject" required value={f.subjectId} onChange={set('subjectId')} placeholder="Choose a subject" error={errors.subjectId} options={(lookups?.subjects ?? []).map((x) => ({ value: x.id, label: x.name }))} />}
          <div className="field">
            <label className="label" htmlFor="qb-topic">Topic<span className="req"> *</span></label>
            <input id="qb-topic" className="input" list="qb-topics" value={f.topic} maxLength={120} onChange={(e) => set('topic')(e.target.value)} aria-invalid={!!errors.topic || undefined} />
            <datalist id="qb-topics">{[...new Set((topics.data ?? []).filter((t) => !f.subjectId || t.subjectId === f.subjectId).map((t) => t.topic))].map((t) => <option key={t} value={t} />)}</datalist>
            {errors.topic
              ? <span className="hint hint--error" role="alert"><Icon name="alertCircle" size={13} />{errors.topic}</span>
              : <span className="hint">Pick an existing topic or type a new one.</span>}
          </div>
          <TextField label="Stage" required value={f.stageLabel} onChange={set('stageLabel')} error={errors.stageLabel} placeholder="Primary 5" maxLength={40} />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Question</div>
        <div className="grid g-2col g-3">
          <SelectField label="Question type" value={f.questionType} onChange={set('questionType')} options={TYPES} />
          <SelectField label="Difficulty" value={f.difficulty} onChange={set('difficulty')} options={['Foundation', 'Core', 'Higher']} />
          <TextField label="Marks" required type="number" min={1} max={100} value={f.marks} onChange={set('marks')} error={errors.marks} />
          <SelectField label="Status" value={f.status} onChange={set('status')} options={editing ? ['Draft', 'Approved', 'Retired'] : ['Draft', 'Approved']} />
        </div>
        <div className="mt-3"><TextArea label="Question" required rows={4} value={f.question} onChange={set('question')} error={errors.question} maxLength={2000} /></div>
      </div>
    </Modal>
  );
}
