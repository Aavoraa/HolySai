import { useEffect, useState } from 'react';
import { useApiMutation } from '@/hooks/useApi';
import { fmt } from '@/lib/format';
import {
  AiNotice, Badge, Banner, Button, DataTable, Icon, Stepper, StudentLink, TextArea, TextField, useConfirm,
} from '@/components/ui';
import { CheckList, Eyebrow, SourceChip } from './shared';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Draft {
  id: string; type: 'lesson' | 'worksheet' | 'quiz' | 'comment' | 'message' | 'brief';
  status: 'Draft' | 'Under Review' | 'Approved' | 'Rejected';
  prompt: Record<string, any>;
  output: Record<string, any>;
  title: string; classLabel: string | null;
  createdAt: string; updatedAt: string; approvedAt: string | null;
  requestedById: string; requestedBy: string; approvedBy: string | null;
  lessonPlanId?: string | null;
}

const levelTone = (l: string) => (l === 'Foundation' ? 'info' : l === 'Core' ? 'neutral' : 'success');
/** Readable line length for generated prose. */
const PROSE = { maxWidth: '72ch' } as const;
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function statusBadge(d: Draft) {
  if (d.status === 'Approved') return <Badge tone="success" icon="check">Approved and published</Badge>;
  if (d.status === 'Rejected') return <Badge tone="neutral">Discarded</Badge>;
  return <Badge tone="warning">Draft — not published</Badge>;
}

export function DraftCard({ draft, onClosed }: { draft: Draft; onClosed?: () => void }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [work, setWork] = useState<Record<string, any>>(draft.output);
  useEffect(() => { setWork(draft.output); setEditing(false); }, [draft.id, draft.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const inv = { invalidate: ['/copilot'] };
  const save = useApiMutation<{ output: Record<string, any> }>('put', `/copilot/drafts/${draft.id}`, { ...inv, success: 'Edits saved — ready for approval', onSuccess: () => setEditing(false) });
  const approve = useApiMutation<Record<string, never>>('post', `/copilot/drafts/${draft.id}/approve`, inv);
  const discard = useApiMutation<{ reason?: string }>('post', `/copilot/drafts/${draft.id}/discard`, { ...inv, onSuccess: () => onClosed?.() });

  const open = draft.status === 'Draft' || draft.status === 'Under Review';
  const o = editing ? work : draft.output;
  const step = draft.status === 'Approved' ? 3 : draft.output.edited ? 2 : 0;

  const doApprove = async () => {
    if (editing) return;
    const ok = await confirm({
      title: 'Approve and publish?',
      body: draft.type === 'lesson'
        ? 'Your name is recorded as the approver and an approved lesson plan is created for this class.'
        : 'Your name is recorded as the approver. Approved drafts can be used with students and parents.',
      confirmLabel: 'Approve and publish', icon: 'check',
    });
    if (ok) approve.mutate({});
  };
  const doDiscard = async () => {
    if (await confirm({ title: 'Discard this draft?', body: 'The draft is kept in the history as discarded and cannot be approved later.', confirmLabel: 'Discard', danger: true })) {
      discard.mutate({});
    }
  };

  return (
    <section className="ai-card mt-4">
      <div className="ai-card__head">
        <span className="ai-badge"><Icon name="sparkle" size={12} />AI draft</span>
        <span className="t-sm t-bold grow">{o.title ?? draft.title}</span>
        {statusBadge(draft)}
      </div>
      <div className="card__body">
        <AiNotice><strong>Nothing is published automatically.</strong> Read it, edit anything, then approve. Your name is recorded as the approver.</AiNotice>
        {(draft.output.warnings ?? []).length > 0 && (
          <div className="mt-3"><Banner tone="warning" icon="alert">{(draft.output.warnings as string[]).map((w, i) => <div key={i}>{w}</div>)}</Banner></div>
        )}
        {editing && <div className="mt-3"><Banner tone="neutral" icon="edit">Editing — change any text below, then save. The generator and sources are kept as they were.</Banner></div>}

        <Body type={draft.type} o={o} editing={editing} set={(patch) => setWork((w) => ({ ...w, ...patch }))} />

        <div className="mt-5">
          <Eyebrow className="mb-3">Built from</Eyebrow>
          <div className="grid g-2col g-2">
            {(draft.output.sources ?? []).map((s: any, i: number) => <SourceChip key={i} title={s.label} meta={s.detail} icon="layers" />)}
            <SourceChip title={`Generator: ${draft.output.generator?.provider ?? 'template'}`} meta={`${draft.output.generator?.kind === 'template' ? 'Deterministic templates — no language model' : 'Model'} · ${draft.output.generator?.version ?? ''}`} icon="settings" />
          </div>
        </div>

        <div className="divider" />
        <div className="row between wrap g-3">
          <div className="col g-1">
            <Stepper steps={['Review', 'Edit', 'Approve']} active={step} />
            <span className="t-micro t-muted">
              Requested by {draft.requestedBy} · {fmt.dateTime(draft.createdAt)}
              {draft.output.edited && ` · edited by ${draft.output.edited.by}`}
              {draft.approvedBy && ` · approved by ${draft.approvedBy} ${fmt.dateTime(draft.approvedAt)}`}
              {draft.output.rejection && ` · discarded by ${draft.output.rejection.by}`}
            </span>
          </div>
          {open && (
            <div className="row g-2">
              {editing ? <>
                <Button onClick={() => { setWork(draft.output); setEditing(false); }}>Cancel edits</Button>
                <Button variant="primary" icon="save" loading={save.isPending} onClick={() => save.mutate({ output: work })}>Save edits</Button>
              </> : <>
                <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>
                <Button icon="trash" onClick={doDiscard} loading={discard.isPending}>Discard</Button>
                <Button variant="primary" icon="check" loading={approve.isPending} onClick={doApprove}>Approve and publish</Button>
              </>}
            </div>
          )}
          {draft.status === 'Approved' && <Button variant="teal" icon="check" disabled>Approved</Button>}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
function Body({ type, o, editing, set }: { type: Draft['type']; o: Record<string, any>; editing: boolean; set: (p: Record<string, any>) => void }) {
  const upd = (key: string, i: number, patch: Record<string, any>) => set({ [key]: (o[key] as any[]).map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  if (type === 'lesson') return (
    <>
      <div className="mt-5">
        <Eyebrow>Learning objective</Eyebrow>
        {editing ? <TextArea value={o.objective} onChange={(v) => set({ objective: v })} rows={3} maxLength={600} /> : <p className="t-sm" style={PROSE}>{o.objective}</p>}
      </div>
      <div className="mt-5">
        <Eyebrow className="mb-3">Lesson plan{o.lessonMinutes ? ` · ${o.lessonMinutes} minutes` : ''}</Eyebrow>
        {editing ? (
          <div className="col g-2">{(o.plan ?? []).map((p: any, i: number) => (
            <div className="grid g-4col g-2" key={i}>
              <TextField label={i === 0 ? 'Time' : undefined} value={p.time} onChange={(v) => upd('plan', i, { time: v })} maxLength={20} />
              <TextField label={i === 0 ? 'Step' : undefined} value={p.step} onChange={(v) => upd('plan', i, { step: v })} maxLength={60} />
              <TextField label={i === 0 ? 'Detail' : undefined} value={p.detail} onChange={(v) => upd('plan', i, { detail: v })} maxLength={400} style={{ gridColumn: 'span 2' }} />
            </div>
          ))}</div>
        ) : (
          <DataTable compact rows={o.plan ?? []} rowKey={(r: any) => r.time + r.step}
            columns={[
              { key: 'time', label: 'Time', width: '92px' },
              { key: 'step', label: 'Step', render: (r: any) => <span className="t-bold">{r.step}</span> },
              { key: 'detail', label: 'Detail' },
            ]} />
        )}
      </div>
      <div className="grid g-2col g-5 mt-5">
        <div>
          <Eyebrow>Activities</Eyebrow>
          {editing ? <TextArea value={(o.activities ?? []).join('\n')} onChange={(v) => set({ activities: lines(v) })} rows={4} hint="One activity per line" />
            : <CheckList items={o.activities ?? []} />}
        </div>
        <div>
          <Eyebrow>Differentiated exercises</Eyebrow>
          <div className="col g-2">
            {(o.differentiated ?? []).map((d: any, i: number) => (
              <div className="row-top g-3" key={d.level}>
                <Badge tone={levelTone(d.level)}>{d.level}</Badge>
                {editing ? <TextArea value={d.detail} onChange={(v) => upd('differentiated', i, { detail: v })} rows={2} style={{ flex: 1 }} />
                  : <span className="t-sm grow">{d.detail}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
      <QuestionList title="Quiz" items={o.quiz ?? []} textKey="q" editing={editing} onChange={(quiz) => set({ quiz })} empty="No approved question-bank items were available for the exit quiz." />
      <div className="mt-5">
        <Eyebrow>Homework</Eyebrow>
        {editing ? <TextArea value={o.homework} onChange={(v) => set({ homework: v })} rows={2} maxLength={600} /> : <p className="t-sm" style={PROSE}>{o.homework}</p>}
      </div>
    </>
  );

  if (type === 'worksheet') return (
    <>
      {o.objective && <div className="mt-5"><Eyebrow>Learning objective</Eyebrow><p className="t-sm" style={PROSE}>{o.objective}</p></div>}
      {(o.sections ?? []).map((s: any, i: number) => (
        <div className="mt-5" key={s.level}>
          <div className="row g-2 mb-2"><Badge tone={levelTone(s.level)}>{s.level}</Badge>
            {editing ? <TextField value={s.instructions} onChange={(v) => upd('sections', i, { instructions: v })} style={{ flex: 1 }} maxLength={300} />
              : <span className="t-sm t-muted">{s.instructions}</span>}
          </div>
          <QuestionList items={s.items} textKey="q" editing={editing} onChange={(items) => upd('sections', i, { items })} empty="No approved items at this level." />
        </div>
      ))}
    </>
  );

  if (type === 'quiz') return (
    <>
      <div className="row g-2 mt-5"><Badge>{o.totalMarks} marks</Badge><Badge>{o.durationMinutes} minutes</Badge><Badge tone="info">Approved question bank only</Badge></div>
      <QuestionList items={o.questions ?? []} textKey="q" editing={editing} onChange={(questions) => set({ questions, totalMarks: questions.reduce((a: number, q: any) => a + Number(q.marks || 0), 0) })} extra={(q) => q.difficulty} />
    </>
  );

  if (type === 'comment') return (
    <div className="mt-5">
      <Eyebrow className="mb-3">{(o.comments ?? []).length} comments{o.term ? ` · ${o.term}` : ''}</Eyebrow>
      <div className="col g-3">
        {(o.comments ?? []).map((c: any, i: number) => (
          <div className="card card--tint" style={{ padding: 12 }} key={c.studentId}>
            <div className="row between wrap g-2">
              <StudentLink id={c.studentId} name={c.studentName} meta={c.admissionNo} />
              <span className="row g-2">
                {c.subjectScore != null && <Badge>Score {c.subjectScore}</Badge>}
                {c.trend != null && c.trend !== 0 && <Badge tone={c.trend > 0 ? 'success' : 'warning'}>{c.trend > 0 ? '+' : ''}{c.trend}</Badge>}
                {c.attendance != null && <Badge tone={c.attendance < 85 ? 'warning' : 'neutral'}>{c.attendance}% attendance</Badge>}
              </span>
            </div>
            {editing ? <div className="mt-2"><TextArea value={c.comment} onChange={(v) => upd('comments', i, { comment: v })} rows={3} maxLength={800} /></div>
              : <p className="t-sm mt-2" style={PROSE}>{c.comment}</p>}
          </div>
        ))}
      </div>
    </div>
  );

  if (type === 'message') return (
    <div className="grid g-main mt-5">
      <div>
        <Eyebrow>To</Eyebrow>
        <p className="t-sm">{o.recipient?.parentName ?? 'No guardian linked'} · parent of {o.recipient?.studentName} · via {o.recipient?.channel ?? 'whatsapp'}</p>
        <div className="mt-3">
          {editing ? <>
            <TextField label="Subject" value={o.subject} onChange={(v) => set({ subject: v })} maxLength={120} />
            <div className="mt-2"><TextArea label="Message" value={o.body} onChange={(v) => set({ body: v })} rows={10} maxLength={3000} /></div>
          </> : <>
            <Eyebrow>Subject</Eyebrow><p className="t-sm t-bold">{o.subject}</p>
            <div className="bubble bubble--in mt-3" style={{ whiteSpace: 'pre-wrap', maxWidth: 560 }}>{o.body}</div>
          </>}
        </div>
      </div>
      <div className="col g-3">
        <div><Eyebrow>Facts used</Eyebrow>{(o.facts ?? []).length ? <CheckList items={o.facts} icon="layers" tone="t-muted" /> : <p className="t-sm t-muted">No record-specific facts.</p>}</div>
        {o.toneCheck && <div><Eyebrow>Tone check</Eyebrow><p className="t-sm t-bold">{o.toneCheck.result}</p><CheckList items={o.toneCheck.rules} /></div>}
        {o.translation && <Banner tone="neutral" icon="globe">{o.translation.note}</Banner>}
      </div>
    </div>
  );

  // brief
  return (
    <>
      <div className="mt-5">
        <Eyebrow>Highlights</Eyebrow>
        {editing ? <TextArea value={(o.highlights ?? []).join('\n')} onChange={(v) => set({ highlights: lines(v) })} rows={4} hint="One point per line" />
          : <CheckList items={o.highlights ?? []} icon="activity" tone="t-muted" />}
      </div>
      <div className="grid g-2col g-5 mt-5">
        <div>
          <Eyebrow>Learning gaps</Eyebrow>
          {(o.gaps ?? []).length ? (
            <div className="col g-2">{o.gaps.map((g: any) => (
              <div className="row-top g-3" key={g.code}><Badge tone="warning">{g.code}</Badge><span className="t-sm grow">{g.description} <span className="t-muted">· coverage {g.coverage}% · mastery {g.mastery}%</span></span></div>
            ))}</div>
          ) : <p className="t-sm t-muted">No objective is below 60% mastery after being taught.</p>}
        </div>
        <div>
          <Eyebrow>Students to watch</Eyebrow>
          {(o.watch ?? []).length ? (
            <div className="col g-2">{o.watch.map((w: any) => <StudentLink key={w.id} id={w.id} name={w.name} meta={w.reason} />)}</div>
          ) : <p className="t-sm t-muted">No students flagged this week.</p>}
        </div>
      </div>
      <div className="mt-5">
        <Eyebrow>Next steps</Eyebrow>
        {editing ? <TextArea value={(o.nextSteps ?? []).join('\n')} onChange={(v) => set({ nextSteps: lines(v) })} rows={3} hint="One step per line" />
          : <CheckList items={o.nextSteps ?? []} icon="arrowRight" tone="t-muted" />}
      </div>
    </>
  );
}

function QuestionList({ title, items, textKey, editing, onChange, empty, extra }: {
  title?: string; items: any[]; textKey: string; editing: boolean; onChange: (items: any[]) => void; empty?: string; extra?: (q: any) => string | undefined;
}) {
  return (
    <div className={title ? 'mt-5' : 'mt-2'}>
      {title && <Eyebrow className="mb-3">{title}</Eyebrow>}
      {!items.length ? <p className="t-sm t-muted">{empty ?? 'No items.'}</p> : (
        <div className="col g-2">
          {items.map((q, i) => (
            <div className="card card--tint row g-3" style={{ padding: '12px 14px' }} key={i}>
              <span className="t-bold t-muted none">{i + 1}.</span>
              {editing ? <>
                <TextField value={q[textKey]} onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, [textKey]: v } : x)))} style={{ flex: 1 }} maxLength={400} />
                <TextField type="number" min={0} max={20} value={q.marks} onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, marks: Math.max(0, Number(v) || 0) } : x)))} style={{ width: 80 }} />
                <Button size="sm" variant="quiet" icon="trash" aria-label="Remove question" onClick={() => onChange(items.filter((_, j) => j !== i))} />
              </> : <>
                <span className="t-sm grow">{q[textKey]}</span>
                {extra?.(q) && <Badge tone={levelTone(extra(q)!)}>{extra(q)}</Badge>}
                <Badge tone="neutral">{q.marks} marks</Badge>
              </>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
