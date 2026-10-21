import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import { useSchool } from '@/layouts/SchoolContext';
import {
  AiNotice, Badge, Button, Card, DataTable, ErrorState, Grid, InlineError, Kpi, Modal, Page, PageHead, SearchInput,
  SelectField, TextArea, TextField, Toolbar,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { AiNotReady, BASE, Connecting, EV, EvStatus, marks, NotConnected, usePcStatus, type Exam } from './shared';

export default function ExamsPage() {
  const navigate = useNavigate();
  const st = usePcStatus();
  const connected = !!st.data?.connected;
  const exams = useApiQuery<Exam[]>(connected ? `${EV}/exams` : null);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const role = st.data?.role;
  const manager = role === 'admin' || role === 'coordinator';
  const sync = useApiMutation('post', '/exam-correction/sync', { invalidate: ['/exam-correction'] });

  const rows = useMemo(() => {
    const t = q.toLowerCase();
    return (exams.data ?? []).filter((e) => !t || `${e.name} ${e.subject} ${e.class_name} ${e.section}`.toLowerCase().includes(t));
  }, [exams.data, q]);
  const sum = (k: keyof Exam['counts']) => (exams.data ?? []).reduce((a, e) => a + e.counts[k], 0);

  return (
    <Page>
      <PageHead title="Paper Correction"
        sub="Claude reads handwritten answer sheets and suggests marks against your rubrics. Teachers check and approve every mark."
        actions={connected && <>
          {role === 'admin' && <Button icon="settings" to={`${BASE}/settings`}>AI configuration</Button>}
          {manager && <Button icon="refresh" loading={sync.isPending} onClick={() => sync.mutate(undefined)}>Sync students & staff</Button>}
          {manager && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New examination</Button>}
        </>} />

      {st.isLoading ? <Connecting /> : st.error ? <ErrorState error={st.error} onRetry={() => st.refetch()} />
        : !connected ? <NotConnected status={st.data} onRetry={() => st.refetch()} />
        : (
          <>
            <div className="col g-3 mb-4">
              <AiNotice><strong>Advisory only.</strong> Claude's marks are suggestions. A teacher confirms each student's identity, checks the transcription and approves every mark before results are published.</AiNotice>
              <AiNotReady ai={st.data?.ai} />
            </div>
            <Grid cols="g-4col">
              <Kpi icon="clipboard" label="Examinations" value={exams.data?.length ?? 0} loading={exams.isLoading}
                foot={manager ? 'All examinations' : 'Assigned to you'} />
              <Kpi icon="fileText" label="Answer sheets" value={sum('submissions')} loading={exams.isLoading} tone="info"
                foot={sum('processing') ? `${sum('processing')} being read or marked` : 'None in progress'} />
              <Kpi icon="eye" label="Awaiting review" value={sum('pending_review')} loading={exams.isLoading} tone="amber" foot="Sheets with marks to check" />
              <Kpi icon="alert" label="Need attention" value={sum('failed')} loading={exams.isLoading} tone={sum('failed') ? 'critical' : 'teal'}
                foot={`${sum('approved')} sheet(s) fully approved`} />
            </Grid>

            <div className="mt-4">
              <Card icon="checkSquare" title="Examinations" flush
                sub={st.data?.lastSync ? `Roster synced ${fmt.relative(st.data.lastSync.at)} · ${st.data.ai?.vision_model ?? ''}` : undefined}>
                <Toolbar><SearchInput value={q} onSearch={setQ} placeholder="Search by name, subject or class" /></Toolbar>
                {exams.error ? <ErrorState error={exams.error} onRetry={() => exams.refetch()} /> : (
                  <DataTable rows={rows} loading={exams.isLoading} rowKey={(e) => e.id} onRowClick={(e) => navigate(`${BASE}/exams/${e.id}`)}
                    emptyText={manager ? 'No examinations yet. Create one to start.' : 'No examinations are assigned to you yet.'}
                    columns={[
                      { key: 'name', label: 'Examination', render: (e) => <><span className="t-bold">{e.name}</span><div className="t-micro t-muted">{e.academic_year} · {e.subject}</div></> },
                      { key: 'class', label: 'Class', render: (e) => `${e.class_name}${e.section ? ` · ${e.section}` : ''}` },
                      { key: 'q', label: 'Questions', className: 'num', render: (e) => <span className="t-num">{e.question_count} ({marks(e.maximum)} marks)</span> },
                      { key: 'sheets', label: 'Sheets', className: 'num', render: (e) => <span className="t-num">{e.counts.submissions}</span> },
                      { key: 'review', label: 'To review', className: 'num', render: (e) => <span className="t-num">{e.counts.pending_review}</span> },
                      { key: 'approved', label: 'Approved', className: 'num', render: (e) => <span className="t-num">{e.counts.approved}</span> },
                      { key: 'attn', label: 'Attention', className: 'num', render: (e) => e.counts.failed ? <Badge tone="critical">{e.counts.failed}</Badge> : <span className="t-num">0</span> },
                      { key: 'results', label: 'Results', render: (e) => <EvStatus value={e.results_status} /> },
                    ]} />
                )}
              </Card>
            </div>
          </>
        )}
      {creating && <ExamModal onClose={() => setCreating(false)} onSaved={(e) => navigate(`${BASE}/exams/${e.id}?tab=questions`)} />}
    </Page>
  );
}

// ---------------------------------------------------------------------------

/** Create or edit an examination. Class and section come from Holy Sai so they match the synced roster. */
export function ExamModal({ exam, onClose, onSaved }: { exam?: Exam; onClose: () => void; onSaved: (e: Exam) => void }) {
  const { lookups } = useLookups();
  const { campusId } = useSchool();
  const campusCode = (id: string) => lookups?.campuses.find((c) => c.id === id)?.code.toUpperCase() ?? '';
  const label = (c: { name: string; campusId: string }) => `${c.name} · ${campusCode(c.campusId)}`;
  const initialClass = exam ? lookups?.classes.find((c) => label(c) === exam.class_name)?.id ?? '' : '';
  const currentYear = lookups?.academicYears.find((y) => y.isCurrent)?.label ?? '';

  const [f, setF] = useState({
    name: exam?.name ?? '', academic_year: exam?.academic_year ?? currentYear, classId: initialClass, section: exam?.section ?? '',
    subject: exam?.subject ?? '', grade_level: exam?.grade_level ?? '', instructions: exam?.instructions ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v, ...(k === 'classId' ? { section: '' } : {}) })); setErrors((e) => ({ ...e, [k]: '' })); };

  const classes = (lookups?.classes ?? []).filter((c) => !campusId || c.campusId === campusId || c.id === f.classId);
  const cls = lookups?.classes.find((c) => c.id === f.classId);
  const save = useApiMutation<Record<string, string>, Exam>(exam ? 'put' : 'post', exam ? `${EV}/exams/${exam.id}` : `${EV}/exams`, {
    invalidate: ['/exam-correction'], success: exam ? 'Examination updated' : 'Examination created', onSuccess: (r) => { onSaved(r.data); onClose(); }, error: false,
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = 'Enter a name';
    if (f.academic_year.trim().length < 4) e.academic_year = 'Enter the academic year';
    if (!cls && !exam) e.classId = 'Choose a class';
    if (!f.subject) e.subject = 'Choose a subject';
    setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({
      name: f.name.trim(), academic_year: f.academic_year.trim(), class_name: cls ? label(cls) : exam!.class_name,
      section: f.section, subject: f.subject, grade_level: f.grade_level.trim(), instructions: f.instructions.trim(),
    });
  };

  return (
    <Modal open onClose={onClose} title={exam ? 'Edit examination' : 'New examination'} size="wide" busy={save.isPending}
      foot={<><Button onClick={onClose} disabled={save.isPending}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Save</Button></>}>
      {save.error && <div className="mb-4"><InlineError error={save.error} /></div>}
      <div className="formsection">
        <div className="formsection__title">Examination</div>
        <div className="grid g-2col g-3">
          <TextField label="Name" required value={f.name} onChange={set('name')} error={errors.name} placeholder="Unit Test 1 — Science" maxLength={160} />
          <TextField label="Academic year" required value={f.academic_year} onChange={set('academic_year')} error={errors.academic_year} placeholder="2026-27" maxLength={20} />
        </div>
      </div>
      <div className="formsection">
        <div className="formsection__title">Who sits it</div>
        <div className="grid g-2col g-3">
          <SelectField label="Class" required value={f.classId} onChange={set('classId')} error={errors.classId} placeholder="Choose a class"
            options={classes.map((c) => ({ value: c.id, label: label(c) }))}
            hint={exam && !initialClass ? `Currently ${exam.class_name}` : 'Students of this class are listed for upload.'} />
          <SelectField label="Section" value={f.section} onChange={set('section')} placeholder="Whole class" disabled={!cls}
            options={(cls?.sections ?? []).map((s) => ({ value: s.name, label: `Section ${s.name}` }))} />
          <SelectField label="Subject" required value={f.subject} onChange={set('subject')} error={errors.subject} placeholder="Choose a subject"
            options={(lookups?.subjects ?? []).map((s) => s.name)} />
          <TextField label="Board / grade level" value={f.grade_level} onChange={set('grade_level')} placeholder="Cambridge Lower Secondary, Stage 7" maxLength={40}
            hint="Helps Claude pitch the marking." />
        </div>
      </div>
      <TextArea label="Instructions for markers" value={f.instructions} onChange={set('instructions')} rows={3}
        placeholder="e.g. Accept British or American spelling. Units are required in numerical answers." />
    </Modal>
  );
}
