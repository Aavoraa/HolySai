import { useState } from 'react';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { ApiError } from '@/api/client';
import { fmt } from '@/lib/format';
import { SERIES } from '@/lib/tones';
import {
  AiNotice, Badge, Banner, Button, Card, Chart, charts, Empty, ErrorState, Flow, Icon, Modal, Page, PageHead, Skeleton,
} from '@/components/ui';
import { Eyebrow, SourceChip } from './shared';

interface Answer {
  question: string; found: boolean; kind: 'documents' | 'live'; answer: string; confidence: 'High' | 'Medium' | 'Low';
  restricted?: boolean; coverage?: number; matchedTerms?: string[];
  chart?: { label: string; value: number }[];
  sources: { id: string | null; doc: string; section: string | null; updated: string | null; live?: boolean }[];
  excerpts: { documentId: string; doc: string; section: string | null; text: string; matched: string[] }[];
  method: string;
}
interface Sources {
  documents: { id: string; title: string; section: string | null; audience: string[]; keywords: string[]; updated: string | null; restricted: boolean }[];
  live: { title: string; detail: string }[];
}

const SUGGESTED = [
  'What is the procedure for student leave?',
  'When is the next Grade VI PTM?',
  'Show this month’s admissions by source.',
  'What is our safeguarding escalation path?',
];
const confTone = (c: string) => (c === 'High' ? 'success' : c === 'Medium' ? 'warning' : 'neutral');

export default function KnowledgePage() {
  const { campusParam } = useSchool();
  const [text, setText] = useState(SUGGESTED[0]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Answer | null>(null);
  const [open, setOpen] = useState<Answer['excerpts'][number] | null>(null);
  const [manage, setManage] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState<string | null>(null);
  const sources = useApiQuery<Sources>('/knowledge/sources');
  const top = useApiQuery<{ label: string; value: number }[]>('/knowledge/top-questions');

  const ask = useApiMutation<{ question: string }, Answer>('post', () => `/knowledge/ask${campusParam.campusId ? `?campusId=${campusParam.campusId}` : ''}`, {
    success: false, error: false,
    invalidate: ['/knowledge/top-questions'],
    onSuccess: (r) => { setResult(r.data); setFeedbackSent(null); },
  });
  const feedback = useApiMutation<{ question: string; helpful: boolean; documentIds: string[]; routeToPerson?: boolean }>('post', '/knowledge/feedback', {
    onSuccess: (_r, v) => setFeedbackSent(v.routeToPerson ? 'routed' : v.helpful ? 'helpful' : 'not'),
  });

  const submit = (q = text) => {
    const question = q.trim();
    if (question.length < 3) { setError('Type a question of at least 3 characters'); return; }
    setError(null);
    setText(question);
    ask.mutate({ question }, { onError: (e) => setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : e.message) });
  };
  const docIds = (result?.sources ?? []).map((s) => s.id).filter((x): x is string => !!x);

  return (
    <Page>
      <PageHead
        title="School Knowledge AI"
        sub="Ask the school anything. Answers come only from approved school documents and live records, and always show their source."
        actions={<Button icon="folder" onClick={() => setManage(true)}>Manage sources</Button>}
      />
      <div className="grid g-main">
        <div className="col g-4">
          <Card icon="grid" title="Ask Holy Sai Knowledge">
            <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="row g-2">
              <div className="input-icon grow" style={{ maxWidth: 'none' }}>
                <Icon name="brain" size={16} />
                <input className="input" style={{ height: 46 }} value={text} maxLength={300} aria-label="Your question" aria-invalid={!!error || undefined}
                  placeholder="For example: what is the procedure for student leave?" onChange={(e) => setText(e.target.value)} />
              </div>
              <Button type="submit" variant="primary" icon="send" loading={ask.isPending} style={{ height: 46 }}>Ask</Button>
            </form>
            {error && <div className="mt-2"><span className="hint hint--error" role="alert"><Icon name="alertCircle" size={13} />{error}</span></div>}
            <div className="eyebrow mt-4 mb-2">Suggested questions</div>
            <div className="row g-2 wrap">
              {SUGGESTED.map((q) => (
                <button key={q} type="button" className="chip" aria-pressed={result?.question === q} onClick={() => submit(q)}>{q}</button>
              ))}
            </div>
          </Card>

          {ask.isPending ? <Skeleton height={260} style={{ borderRadius: 14 }} /> : !result ? (
            <Card><Empty icon="brain" title="Ask a question to begin" sub="Pick a suggested question or type your own. Only approved documents you are allowed to read are searched." /></Card>
          ) : (
            <section className="ai-card">
              <div className="ai-card__head">
                <span className="ai-badge"><Icon name="brain" size={12} />Answer</span>
                <span className="t-xs t-muted grow">{result.kind === 'live' ? 'Computed from live school records' : result.found ? 'Sourced from approved school documents' : 'No matching approved source'}</span>
                <Badge tone={result.found ? confTone(result.confidence) : 'neutral'}>{result.found ? `${result.confidence} confidence` : 'Not found'}</Badge>
              </div>
              <div className="card__body">
                <div className="row-top g-2 mb-4">
                  <Icon name="user" size={15} className="t-muted" />
                  <span className="col"><span className="t-micro t-muted">You asked</span><span className="t-sm t-bold">{result.question}</span></span>
                </div>
                {result.found ? (
                  <div className="col g-3">
                    {result.answer.split('\n\n').map((p, i) => <p key={i} className="t-sm" style={{ fontSize: 15, lineHeight: 1.65, maxWidth: '72ch' }}>{p}</p>)}
                  </div>
                ) : (
                  <Banner tone={result.restricted ? 'warning' : 'neutral'} icon={result.restricted ? 'lock' : 'search'}>{result.answer}</Banner>
                )}
                {result.chart && result.chart.length > 0 && (
                  <div className="mt-5">
                    <Chart svg={charts.hbar({ rows: result.chart.map((r, i) => ({ label: r.label, value: r.value, color: SERIES[i % SERIES.length] })), labelW: 96, rowH: 28 })} />
                  </div>
                )}
                {result.found && result.kind === 'documents' && result.confidence !== 'High' && (
                  <p className="t-xs t-muted mt-3">Only part of the question matched the source{result.matchedTerms?.length ? ` (${result.matchedTerms.join(', ')})` : ''}. Check the source before relying on it.</p>
                )}
                <div className="divider" />
                <Eyebrow className="mb-3">Sources</Eyebrow>
                {result.sources.length ? (
                  <div className="col g-2">
                    {result.sources.map((s, i) => {
                      const ex = result.excerpts.find((e) => e.documentId === s.id);
                      return (
                        <SourceChip key={i} icon={s.live ? 'zap' : 'fileText'} title={s.doc}
                          meta={`${s.section ?? ''}${s.section ? ' · ' : ''}updated ${s.live ? fmt.dateTime(s.updated) : fmt.date(s.updated)}`}
                          onClick={ex ? () => setOpen(ex) : undefined} />
                      );
                    })}
                  </div>
                ) : <p className="t-sm t-muted">No source was used, so no answer is given.</p>}
                <div className="mt-4">
                  <AiNotice><strong>Permission-aware.</strong> The answer is built only from documents and records the person asking is allowed to see. A teacher and a parent asking the same question can get different answers, and neither sees anything they should not.</AiNotice>
                </div>
                <div className="row g-2 mt-3 wrap">
                  {feedbackSent ? (
                    <span className="t-sm t-muted row g-2"><Icon name="check" size={14} className="t-success" />
                      {feedbackSent === 'routed' ? 'Sent to the front office — they will reply in your notifications.' : 'Thanks — your feedback is recorded.'}</span>
                  ) : <>
                    <span className="t-xs t-muted">Was this useful?</span>
                    <Button size="sm" icon="check" loading={feedback.isPending} onClick={() => feedback.mutate({ question: result.question, helpful: true, documentIds: docIds })}>Helpful</Button>
                    <Button size="sm" icon="x" loading={feedback.isPending} onClick={() => feedback.mutate({ question: result.question, helpful: false, documentIds: docIds })}>Not quite</Button>
                    <Button size="sm" icon="message" loading={feedback.isPending} onClick={() => feedback.mutate({ question: result.question, helpful: false, documentIds: docIds, routeToPerson: true })}>Ask a person instead</Button>
                  </>}
                </div>
                <p className="t-micro t-faint mt-3">{result.method}</p>
              </div>
            </section>
          )}
        </div>

        <div className="col g-4">
          <Card icon="target" title="Approved sources" sub="What the assistant is allowed to read for your role" flush>
            {sources.isLoading ? <div className="card__body"><Skeleton height={180} /></div> : sources.error ? <ErrorState error={sources.error} onRetry={() => sources.refetch()} /> : (
              <div style={{ padding: '0 var(--s-5)' }}>
                {sources.data!.documents.map((s) => (
                  <div key={s.id} className="mrow">
                    <Icon name={s.restricted ? 'lock' : 'fileText'} size={15} className="t-muted" />
                    <span className="col grow" style={{ minWidth: 0 }}>
                      <span className="t-sm t-clip">{s.title}</span>
                      <span className="t-micro t-muted t-clip">{s.section}{s.restricted ? ' · restricted' : ''}</span>
                    </span>
                    <span className="t-micro t-faint none">{fmt.date(s.updated)}</span>
                  </div>
                ))}
                {sources.data!.live.map((l) => (
                  <div key={l.title} className="mrow">
                    <Icon name="zap" size={15} className="t-muted" />
                    <span className="col grow" style={{ minWidth: 0 }}><span className="t-sm">Live records — {l.title}</span><span className="t-micro t-muted">{l.detail}</span></span>
                    <span className="t-micro t-faint none">Continuous</span>
                  </div>
                ))}
                {!sources.data!.documents.length && <Empty icon="folder" title="No documents available for your role" sub="Approved documents appear here once the school shares them with your role. Live records can still be asked about." />}
              </div>
            )}
          </Card>
          <Card icon="grid" title="Most asked this month" sub="Number of times each question was asked">
            {top.isLoading ? <Skeleton height={150} /> : top.data?.length ? (
              <Chart svg={charts.hbar({ rows: top.data.map((r, i) => ({ label: r.label.replace(/ 2026–27$/, ''), value: r.value, color: SERIES[i % SERIES.length] })), labelW: 150, rowH: 28 })} />
            ) : <Empty icon="barChart" title="No questions yet this month" sub="Questions asked by staff and parents are counted here." />}
          </Card>
        </div>
      </div>

      <Modal open={!!open} onClose={() => setOpen(null)} size="wide" title={open?.doc ?? ''} sub={open?.section ?? undefined}
        foot={<Button variant="primary" onClick={() => setOpen(null)}>Close</Button>}>
        {open && <>
          <Eyebrow>Excerpt used</Eyebrow>
          <blockquote className="card card--tint t-sm" style={{ padding: 14, lineHeight: 1.6 }}>{open.text}</blockquote>
          {open.matched.length > 0 && <div className="row g-2 wrap mt-3"><span className="t-xs t-muted">Matched:</span>{open.matched.map((m) => <Badge key={m}>{m}</Badge>)}</div>}
        </>}
      </Modal>

      <Modal open={manage} onClose={() => setManage(false)} size="wide" title="Knowledge sources" sub="What the assistant may read, and who may see the answer"
        foot={<Button variant="primary" onClick={() => setManage(false)}>Close</Button>}>
        <p className="t-sm t-muted">Documents are uploaded and approved by the school. Nothing outside this set is used to answer a question, and every answer names the document it came from.</p>
        <div className="mt-4">
          <Flow steps={[
            { label: 'Upload', meta: 'By an authorised owner', state: 'done' },
            { label: 'Approve', meta: 'Principal or section head', state: 'done' },
            { label: 'Set visibility', meta: 'Which roles may see it', state: 'active' },
            { label: 'Live', meta: 'Answers cite it by name' },
          ]} />
        </div>
        {sources.data && (
          <div className="mt-4 col g-2">
            {sources.data.documents.map((d) => (
              <div key={d.id} className="card card--tint" style={{ padding: '10px 12px' }}>
                <div className="row between wrap g-2"><span className="t-sm t-bold">{d.title} <span className="t-muted">· {d.section}</span></span><span className="t-micro t-muted">Updated {fmt.date(d.updated)}</span></div>
                <div className="t-micro t-muted mt-1">Visible to: {d.audience.length ? d.audience.join(', ').replace(/_/g, ' ') : 'everyone'}</div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4"><Banner tone="warning" icon="lock">Restricted documents such as the safeguarding policy are readable by the assistant only when the person asking already has access to them.</Banner></div>
      </Modal>
    </Page>
  );
}
