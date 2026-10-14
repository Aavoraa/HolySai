import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { ApiError } from '@/api/client';
import { fmt } from '@/lib/format';
import {
  AiNotice, AlertItem, Badge, Banner, Button, Card, Chart, charts, Dl, Empty, ErrorState, Feed, Legend, Modal, Page,
  PageHead, PageSkeleton, Segment, StudentLink, TextArea,
} from '@/components/ui';
import { StudentPicker } from './shared';

interface Suggestion {
  skillId: string; skill: string; score: number; confidence: string; evidence: string[]; evidenceCount: number; assessedOn: string;
  studentId: string; studentName: string; admissionNo: string; grade: string | null; section: string | null; activities: number;
}
interface TalentOverview {
  rule: string; threshold: number;
  distribution: { skill: string; strong: number; developing: number; emerging: number; average: number }[];
  suggestions: Suggestion[];
  decisions: { at: string; action: 'accept' | 'dismiss'; by: string; description: string; skill: string; studentId: string; studentName: string }[];
  totals: { students: number; withStrength: number };
}
interface StudentTalent {
  student: { id: string; fullName: string; admissionNo: string; grade: string | null; section: string | null };
  strengths: { id: string; name: string; score: number; confidence: string | null; evidence: string[]; assessedOn: string; decision: { action: string; by: string; at: string; note: string } | null }[];
  interests: string[];
  activities: { name: string; category: string; role: string; hours: number }[];
}

const confTone = (c: string | null) => (c === 'High' ? 'success' : c === 'Medium' ? 'info' : 'neutral');
const DEFAULT_EXAMPLE = 'HS-2026-1041';

export default function TalentPage() {
  const { campusParam } = useSchool();
  const { can } = useAuth();
  const canDecide = can(['students.read', 'students.read_assigned']);
  const q = useApiQuery<TalentOverview>('/talent/overview', campusParam);
  const [exampleId, setExampleId] = useState(DEFAULT_EXAMPLE);
  const example = useApiQuery<StudentTalent>(`/talent/students/${encodeURIComponent(exampleId)}`);
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<Suggestion | null>(null);
  const [method, setMethod] = useState(false);

  const head = (
    <PageHead
      title="Talent Discovery"
      sub="Where strengths are showing across the school, and which students have evidence that has not yet been acted on."
      actions={<Button icon="helpCircle" onClick={() => setMethod(true)}>Methodology</Button>}
    />
  );
  if (q.isLoading) return <Page>{head}<PageSkeleton kpis={0} /></Page>;
  if (q.error || !q.data) return <Page>{head}<ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;
  const d = q.data;

  return (
    <Page>
      {head}
      <AiNotice><strong>Advisory throughout.</strong> Talent signals surface evidence for a teacher to interpret. Nothing here selects, streams or excludes a student automatically.</AiNotice>

      <div className="grid g-main mt-4">
        <Card icon="grid" title="Strength distribution" sub={`Students with strong evidence (score ${d.threshold}+), by skill · ${d.totals.withStrength} of ${d.totals.students} students`}>
          {d.distribution.length ? <>
            <Chart svg={charts.stacked({
              labels: d.distribution.map((x) => x.skill.split(' ')[0]),
              series: [
                { name: 'Strong evidence', values: d.distribution.map((x) => x.strong), color: 'var(--teal)' },
                { name: 'Developing', values: d.distribution.map((x) => x.developing), color: 'var(--amber)' },
                { name: 'Emerging', values: d.distribution.map((x) => x.emerging), color: 'var(--border-strong)' },
              ],
              height: 240,
            })} />
            <div className="mt-3"><Legend items={[{ label: 'Strong evidence', color: 'var(--teal)' }, { label: 'Developing', color: 'var(--amber)' }, { label: 'Emerging', color: 'var(--border-strong)' }]} /></div>
          </> : <Empty icon="star" title="No skill ratings yet" sub="Teacher rubric assessments will appear here." />}
        </Card>
        <Card icon="grid" title="Unrecognised potential" sub={`Strong evidence, no opportunity offered yet${d.suggestions.length ? ` · open one to decide` : ''}`} flush>
          {d.suggestions.length ? (
            <div>
              {d.suggestions.map((s) => (
                <AlertItem key={s.skillId} tone="info" icon="sparkle"
                  title={`${s.studentName} — ${s.skill}`}
                  meta={`${s.grade ?? ''}${s.section ?? ''} · score ${s.score} · evidence from ${s.evidenceCount} source${s.evidenceCount === 1 ? '' : 's'}`}
                  onClick={() => setOpen(s)} />
              ))}
            </div>
          ) : <Empty icon="check" title="Nothing waiting" sub="Every strong strength already has an opportunity or a recorded decision." />}
        </Card>
      </div>

      <div className="mt-4">
        <Card
          title="Example: evidence behind a recommendation"
          sub={example.data ? `${example.data.student.fullName} · ${example.data.student.grade ?? ''}${example.data.student.section ?? ''} — every strength links to the record that produced it` : 'Choose a student to see the evidence behind each strength'}
          actions={<Button size="sm" icon="search" onClick={() => setPicking((p) => !p)}>{picking ? 'Cancel' : 'Choose student'}</Button>}
        >
          {picking && <div className="mb-4"><StudentPicker onPick={(s) => { setExampleId(s.admissionNo); setPicking(false); }} /></div>}
          {example.isLoading ? <PageSkeleton kpis={0} /> : example.error ? (
            <Empty icon="user" title={exampleId === DEFAULT_EXAMPLE ? 'Choose a student from your classes' : 'Student not available'} sub="Use “Choose student” to see the evidence behind their strengths." />
          ) : example.data && (
            example.data.strengths.length ? <>
              <div className="grid g-2col g-4">
                {example.data.strengths.slice(0, 4).map((st) => (
                  <div className="card card--tint" style={{ padding: 16 }} key={st.id}>
                    <div className="row between">
                      <span className="t-sm t-bold">{st.name} <span className="t-muted t-num">· {st.score}</span></span>
                      <Badge tone={confTone(st.confidence)}>{st.confidence ?? 'Unrated'} confidence</Badge>
                    </div>
                    <div className="evidence mt-3">
                      {st.evidence.map((e, i) => <div className="evidence__item" key={i}>{e}</div>)}
                    </div>
                    <div className="t-micro t-muted mt-2">
                      Assessed {fmt.date(st.assessedOn)}
                      {st.decision && <> · {st.decision.action === 'accept' ? 'Opportunity offered' : 'Suggestion dismissed'} by {st.decision.by}{st.decision.note ? ` — ${st.decision.note}` : ''}</>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="row g-2 wrap mt-4">
                <StudentLink id={example.data.student.id} name={example.data.student.fullName} meta="Open Student 360" />
                <span className="spacer" />
                {example.data.interests.map((i) => <Badge key={i}>{i}</Badge>)}
              </div>
            </> : <Empty icon="star" title="No strengths recorded" sub="No skill ratings exist for this student yet." />
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card icon="grid" title="Recent decisions" sub="Every accept and dismiss is recorded against the person who made it">
          {d.decisions.length ? (
            <Feed items={d.decisions.map((x) => ({
              time: fmt.relative(x.at),
              icon: x.action === 'accept' ? 'check' : 'x',
              text: x.description,
              meta: x.by,
              badge: <Badge tone={x.action === 'accept' ? 'success' : 'neutral'}>{x.action === 'accept' ? 'Accepted' : 'Dismissed'}</Badge>,
            }))} />
          ) : <Empty icon="clock" title="No decisions yet" sub="Accept or dismiss a suggestion to record it here." />}
        </Card>
      </div>

      {open && <SuggestionModal s={open} canDecide={canDecide} onClose={() => setOpen(null)} />}
      <Modal open={method} onClose={() => setMethod(false)} size="wide" title="How Talent Discovery works" foot={<Button variant="primary" onClick={() => setMethod(false)}>Close</Button>}>
        <p className="t-sm">Skills are rated by teachers against a rubric (0–100) and each rating keeps the evidence that produced it: competition results, teacher observations, behaviour notes and activity hours.</p>
        <div className="mt-3">
          <Dl items={[
            ['Strong evidence', `Score ${d.threshold} or above`],
            ['Developing', 'Score 68 to ' + (d.threshold - 1)],
            ['Emerging', 'Score below 68'],
            ['Suggestion rule', d.rule],
          ]} />
        </div>
        <div className="mt-4"><Banner tone="warning" icon="shield">Suggestions never stream, select or exclude a student. A teacher decides whether to offer an opportunity, and that decision is recorded.</Banner></div>
      </Modal>
    </Page>
  );
}

function SuggestionModal({ s, canDecide, onClose }: { s: Suggestion; canDecide: boolean; onClose: () => void }) {
  const [decision, setDecision] = useState<'accept' | 'dismiss'>('accept');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const save = useApiMutation<Record<string, string>>('post', `/talent/suggestions/${s.skillId}/decision`, {
    invalidate: ['/talent', '/students'], onSuccess: onClose, error: false,
  });
  const submit = () => {
    if (text.trim().length < 5) { setError(decision === 'accept' ? 'Describe the opportunity offered' : 'Record why this is being dismissed'); return; }
    setError(undefined);
    save.mutate(decision === 'accept' ? { decision, opportunity: text.trim() } : { decision, reason: text.trim() }, {
      onError: (e) => setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : e.message),
    });
  };
  return (
    <Modal
      open onClose={onClose} busy={save.isPending} size="wide"
      title={`${s.skill} — ${s.studentName}`}
      sub={`${s.grade ?? ''}${s.section ?? ''} · ${s.admissionNo} · score ${s.score} · ${s.confidence} confidence`}
      foot={<>
        <Button onClick={onClose}>Cancel</Button>
        {canDecide && <Button variant={decision === 'accept' ? 'primary' : 'danger'} icon={decision === 'accept' ? 'check' : 'x'} loading={save.isPending} onClick={submit}>
          {decision === 'accept' ? 'Record opportunity' : 'Dismiss suggestion'}
        </Button>}
      </>}
    >
      <div className="eyebrow mb-2">Evidence</div>
      <div className="evidence">{s.evidence.map((e, i) => <div className="evidence__item" key={i}>{e}</div>)}</div>
      <p className="t-xs t-muted mt-2">Assessed {fmt.date(s.assessedOn)} · {s.activities} active {s.activities === 1 ? 'activity' : 'activities'}</p>
      <div className="mt-3"><StudentLink id={s.studentId} name={s.studentName} meta="Open Student 360" /></div>
      {canDecide && (
        <div className="mt-4">
          <Segment items={[{ id: 'accept', label: 'Offer an opportunity' }, { id: 'dismiss', label: 'Dismiss' }]} active={decision} onChange={(v) => { setDecision(v); setError(undefined); }} />
          <div className="mt-3">
            <TextArea
              label={decision === 'accept' ? 'Opportunity offered' : 'Reason'} required value={text} onChange={setText} rows={3}
              maxLength={decision === 'accept' ? 300 : 500} error={error}
              placeholder={decision === 'accept' ? 'For example: invited to lead the Grade 5 maths club this term.' : 'For example: already captains the robotics team.'}
              hint={decision === 'accept' ? 'Added to the student’s growth timeline.' : 'Kept in the audit trail.'}
            />
          </div>
        </div>
      )}
      <div className="mt-4"><AiNotice /></div>
    </Modal>
  );
}
