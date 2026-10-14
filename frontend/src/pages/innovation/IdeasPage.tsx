import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Banner, Button, Card, Chips, DataTable, ErrorState, FilterSelect, InlineError, Modal, Page, PageHead, Pagination, SearchInput, SelectField, Status, StudentLink,
  TextArea, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { fmt } from '@/lib/format';
import { FormGrid, req, useForm } from '../operations/shared';
import { AREAS, IdeaSubmitModal, MilestoneDrafts, cleanMilestones, useMentorOptions } from './shared';

interface Idea {
  id: string; title: string; problem: string | null; category: string | null; status: string; submittedOn: string; ageDays: number; reviewedBy: string | null;
  projectId: string | null; projectCode: string | null; studentId: string; studentName: string; admissionNo: string; grade: string | null; section: string | null;
}
interface Summary { total: number; submitted: number; underReview: number; accepted: number; converted: number; declined: number; overdueReview: number }

export default function IdeasPage() {
  const list = useListParams({ sort: 'submitted', dir: 'desc' }, ['status', 'category']);
  const { campusParam } = useSchool();
  const { can } = useAuth();
  const manage = can('innovation.manage');
  const navigate = useNavigate();
  const q = usePagedQuery<Idea>('/innovation/ideas', { ...list.query, ...campusParam });
  const sum = useApiQuery<Summary>('/innovation/ideas/summary', campusParam);
  const [submit, setSubmit] = useState(false);
  const [review, setReview] = useState<Idea | null>(null);
  const [convert, setConvert] = useState<Idea | null>(null);
  const s = sum.data;
  return (
    <Page>
      <PageHead title="Ideas" sub="Where every project starts. Reviewed by a teacher within a week of submission."
        actions={manage && <Button variant="primary" icon="lightbulb" onClick={() => setSubmit(true)}>Submit an idea</Button>} />
      <Chips active={list.filters.status || ''} onChange={(v) => list.setFilter('status', v)} items={[
        { id: '', label: 'All', count: s?.total },
        { id: 'open', label: 'Open', count: s ? s.submitted + s.underReview + s.accepted : undefined },
        { id: 'Submitted', label: 'Submitted', count: s?.submitted, tone: s?.overdueReview ? 'critical' : 'warning' },
        { id: 'Under Review', label: 'Under Review', count: s?.underReview },
        { id: 'Accepted', label: 'Accepted', count: s?.accepted, tone: 'success' },
        { id: 'Converted', label: 'Became projects', count: s?.converted },
        { id: 'Declined', label: 'Declined', count: s?.declined },
      ]} />
      {s && s.overdueReview > 0 && (
        <div className="mt-3">
          <Banner tone="critical" icon="clock">
            <strong>{s.overdueReview} idea(s)</strong> have waited more than a week for review.{' '}
            {list.filters.status !== 'Submitted' && <button type="button" className="t-bold" onClick={() => list.setFilter('status', 'Submitted')}>Show submitted ideas</button>}
          </Banner>
        </div>
      )}
      <Card flush className="mt-4">
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search idea or student" />
          <FilterSelect label="Area" value={list.filters.category} onChange={(v) => list.setFilter('category', v)} options={AREAS} />
          {list.hasFilters && <Button size="sm" variant="quiet" icon="x" onClick={list.clear}>Clear filters</Button>}
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
          <DataTable<Idea>
            rows={q.data?.rows} loading={q.isLoading} rowKey={(r) => r.id} sort={list.sort} onSort={list.setSort}
            emptyText={list.hasFilters ? 'No ideas match these filters. Clear them to see every idea.' : 'No ideas yet. Submitted ideas appear here for teacher review.'}
            columns={[
              { key: 'title', label: 'Idea', render: (r) => <><span className="t-bold">{r.title}</span>{r.problem && <div className="t-micro t-muted t-clip" style={{ maxWidth: 360 }}>{r.problem}</div>}</> },
              { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={`${r.grade ?? ''}${r.section ?? ''}`} /> },
              { key: 'category', label: 'Area', render: (r) => r.category ?? '—' },
              { key: 'submitted', label: 'Submitted', render: (r) => <><span className="t-num">{fmt.date(r.submittedOn)}</span>
                {r.status === 'Submitted' && r.ageDays > 7 && <div className="t-micro t-critical">{r.ageDays} days waiting</div>}</> },
              { key: 'status', label: 'Status', render: (r) => <><Status value={r.status} />{r.reviewedBy && <div className="t-micro t-muted mt-1">{r.reviewedBy}</div>}</> },
              { key: 'a', label: '', sortable: false, className: 'num', render: (r) => {
                if (r.projectId) return <Button size="sm" onClick={() => navigate(`/projects/${r.projectId}`)}>Open {r.projectCode}</Button>;
                if (!manage) return null;
                if (r.status === 'Accepted') return <Button size="sm" variant="primary" icon="rocket" onClick={() => setConvert(r)}>Convert to project</Button>;
                if (r.status === 'Submitted' || r.status === 'Under Review') return <Button size="sm" variant="primary" onClick={() => setReview(r)}>Review</Button>;
                return null;
              } },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      {submit && <IdeaSubmitModal onClose={() => setSubmit(false)} />}
      {review && <ReviewModal idea={review} onClose={() => setReview(null)} onConvert={() => { setConvert({ ...review, status: 'Accepted' }); setReview(null); }} />}
      {convert && <ConvertModal idea={convert} onClose={() => setConvert(null)} />}
    </Page>
  );
}

function ReviewModal({ idea, onClose, onConvert }: { idea: Idea; onClose: () => void; onConvert: () => void }) {
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const confirm = useConfirm();
  const act = useApiMutation<{ action: string; note?: string }, { status: string }>('post', `/innovation/ideas/${idea.id}/review`, {
    invalidate: ['/innovation'],
    success: (_r, v) => (v.action === 'accept' ? 'Idea accepted' : v.action === 'decline' ? 'Idea declined' : 'Review started'),
  });
  const run = async (action: string) => {
    if (action === 'decline' && !note.trim()) { setErr('Tell the student why'); return; }
    if (action === 'decline' && !(await confirm({
      title: `Decline "${idea.title}"?`, body: `${idea.studentName} and their family are notified with your note.`, confirmLabel: 'Decline idea', danger: true,
    }))) return;
    try {
      await act.mutateAsync({ action, note: note.trim() || undefined });
      if (action === 'accept') onConvert(); else onClose();
    } catch { /* toast shown */ }
  };
  return (
    <Modal open onClose={onClose} title="Review idea" sub={`${idea.studentName} · ${idea.grade ?? ''}${idea.section ?? ''} · submitted ${fmt.date(idea.submittedOn)}`} busy={act.isPending}
      foot={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={act.isPending && act.variables?.action === 'decline'} onClick={() => run('decline')}>Decline</Button>
        {idea.status === 'Submitted' && <Button loading={act.isPending && act.variables?.action === 'start'} onClick={() => run('start')}>Start review</Button>}
        <Button variant="primary" loading={act.isPending && act.variables?.action === 'accept'} onClick={() => run('accept')}>Accept</Button>
      </>}>
      {act.error && <div className="mb-3"><InlineError error={act.error} /></div>}
      <div className="h3">{idea.title}</div>
      <p className="t-sm mt-2" style={{ whiteSpace: 'pre-wrap' }}>{idea.problem}</p>
      <p className="t-micro t-muted mt-2">Area: {idea.category ?? '—'}</p>
      <div className="mt-4"><TextArea label="Note to the student (required to decline)" rows={3} maxLength={500} value={note} onChange={(x) => { setNote(x); setErr(''); }} error={err} /></div>
      <p className="t-xs t-muted mt-2">Accepting lets you assign a mentor and turn the idea into a project straight away. The family is notified of the decision.</p>
    </Modal>
  );
}

function ConvertModal({ idea, onClose }: { idea: Idea; onClose: () => void }) {
  const navigate = useNavigate();
  const mentors = useMentorOptions();
  const f = useForm({ mentorId: '', title: idea.title, summary: idea.problem ?? '', milestones: [{ title: 'Design and first build', dueOn: '' }, { title: 'Test and refine', dueOn: '' }] });
  const v = f.values;
  const save = useApiMutation<Record<string, unknown>, { id: string; code: string }>('post', `/innovation/ideas/${idea.id}/convert`, {
    invalidate: ['/innovation'], success: (r) => `Project ${r.data.code} created`, onSuccess: (r) => navigate(`/projects/${r.data.id}`),
  });
  const submit = async () => {
    if (!f.validate({ mentorId: req(v.mentorId, 'Mentor'), title: req(v.title, 'Title') })) return;
    try { await save.mutateAsync({ mentorId: v.mentorId, title: v.title.trim(), summary: v.summary || null, milestones: cleanMilestones(v.milestones) }); onClose(); } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title="Convert to project" sub={`${idea.studentName} becomes the lead student`} size="wide" busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Create project</Button></>}>
      {save.error && <div className="mb-3"><InlineError error={save.error} /></div>}
      <FormGrid>
        <TextField label="Project title" required maxLength={160} value={v.title} onChange={(x) => f.set('title', x)} error={f.errors.title} />
        <SelectField label="Mentor" required value={v.mentorId} onChange={(x) => f.set('mentorId', x)} options={mentors} placeholder="Choose a mentor…" error={f.errors.mentorId} />
      </FormGrid>
      <div className="mt-3"><TextArea label="Summary" rows={2} maxLength={1000} value={v.summary} onChange={(x) => f.set('summary', x)} /></div>
      <div className="mt-4"><MilestoneDrafts items={v.milestones} onChange={(x) => f.set('milestones', x)} /></div>
    </Modal>
  );
}
