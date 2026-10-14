import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import {
  Badge, Banner, Button, Card, Empty, ErrorState, Flow, Grid, Kpi, Modal, Page, PageHead,
  PageSkeleton, SelectField, Status, TextArea, TextField,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { AREAS } from '../innovation/shared';
import { FormGrid, req, useForm } from '../operations/shared';

/**
 * Student portal — the signed-in student's own ideas, and the form to submit a new
 * one. The API takes the student from the access token, so nothing here identifies
 * the student and a student can only ever see or submit their own work.
 */
interface MyIdea {
  id: string;
  title: string;
  problem: string | null;
  category: string | null;
  status: string;
  submittedOn: string;
  reviewedBy: string | null;
  ageDays: number;
  projectId: string | null;
  projectCode: string | null;
  projectStage: number | null;
}

/** What the student should expect next, in their own words. */
function nextStep(idea: MyIdea) {
  if (idea.projectId) return 'This became a project — open it to see your milestones.';
  switch (idea.status) {
    case 'Submitted':
      return idea.ageDays > 7
        ? 'Still waiting for a teacher. Ask your class teacher if it has been a while.'
        : 'Waiting for a teacher to pick it up. Usually within a week.';
    case 'Under Review': return `${idea.reviewedBy ?? 'A teacher'} is reading it now.`;
    case 'Accepted': return 'Accepted. A mentor will be assigned so you can start building.';
    case 'Declined': return 'Not taken forward this time. Ask your teacher what would make it stronger.';
    default: return '';
  }
}

export default function MyIdeasPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const q = useApiQuery<MyIdea[]>('/me/ideas', undefined, { enabled: !!user?.studentId });

  const head = (
    <PageHead
      title="My Ideas"
      sub="Have an idea for something to build, fix or improve? Submit it here — a teacher reviews it within a week."
      actions={user?.studentId && <Button variant="primary" icon="lightbulb" onClick={() => setOpen(true)}>Submit an idea</Button>}
    />
  );

  if (!user?.studentId) {
    return (
      <Page>
        {head}
        <Card><Empty icon="user" title="No student record is linked to this account" sub="Please contact the school office." /></Card>
      </Page>
    );
  }
  if (q.isLoading) return <Page>{head}<PageSkeleton kpis={3} /></Page>;
  if (q.error || !q.data) return <Page>{head}<ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;

  const ideas = q.data;
  const waiting = ideas.filter((i) => i.status === 'Submitted' || i.status === 'Under Review').length;
  const accepted = ideas.filter((i) => i.status === 'Accepted').length;
  const projects = ideas.filter((i) => i.projectId).length;

  return (
    <Page>
      {head}

      {ideas.length > 0 && (
        <Grid cols="g-4col">
          <Kpi icon="lightbulb" label="Ideas submitted" value={fmt.n(ideas.length)} />
          <Kpi icon="checkSquare" label="Waiting for review" value={fmt.n(waiting)} tone={waiting ? 'amber' : undefined} />
          <Kpi icon="activity" label="Accepted" value={fmt.n(accepted)} tone={accepted ? 'teal' : undefined} />
          <Kpi icon="lightbulb" label="Became projects" value={fmt.n(projects)} tone={projects ? 'teal' : undefined} />
        </Grid>
      )}

      {!ideas.length ? (
        <Card className="mt-4">
          <Empty
            icon="lightbulb"
            title="You have not submitted an idea yet"
            sub="It does not have to be finished or perfect — describe the problem and a teacher will help you shape it."
            action={<Button variant="primary" icon="lightbulb" onClick={() => setOpen(true)}>Submit your first idea</Button>}
          />
        </Card>
      ) : (
        <div className="col g-3 mt-4">
          {ideas.map((i) => (
            <Card key={i.id} title={i.title} sub={`${i.category ?? 'Other'} · submitted ${fmt.date(i.submittedOn)}`}
              actions={<Status value={i.status} />}
              foot={i.projectId
                ? <Button size="sm" variant="primary" icon="rocket" onClick={() => navigate(`/projects/${i.projectId}`)}>Open {i.projectCode}</Button>
                : <span className="t-xs t-muted">{nextStep(i)}</span>}>
              {i.problem && <p className="t-sm pre-wrap">{i.problem}</p>}
              {i.reviewedBy && !i.projectId && <p className="t-micro t-muted mt-2">Reviewed by {i.reviewedBy}</p>}
              <div className="mt-3">
                <Flow steps={[
                  { label: 'Idea', state: 'done' },
                  { label: 'Review', state: i.status === 'Submitted' ? 'active' : 'done' },
                  { label: 'Mentor', state: i.status === 'Accepted' ? 'active' : i.projectId ? 'done' : undefined },
                  { label: 'Project', state: i.projectId ? 'done' : undefined },
                ]} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {open && <SubmitOwnIdeaModal onClose={() => setOpen(false)} />}
    </Page>
  );
}

function SubmitOwnIdeaModal({ onClose }: { onClose: () => void }) {
  const f = useForm({ title: '', problem: '', category: '', wantsMentor: 'Yes, please assign one' });
  const v = f.values;
  const save = useApiMutation<Record<string, unknown>>('post', '/me/ideas', {
    invalidate: ['/me/ideas'], success: 'Idea submitted — a teacher will review it',
  });

  const submit = async () => {
    if (!f.validate({
      title: req(v.title, 'Title') ?? (v.title.trim().length < 4 ? 'Give the idea a short title' : null),
      problem: req(v.problem, 'Description') ?? (v.problem.trim().length < 10 ? 'Describe it in a sentence or two' : null),
      category: req(v.category, 'Area'),
    })) return;
    try {
      await save.mutateAsync({ title: v.title, problem: v.problem, category: v.category, wantsMentor: v.wantsMentor });
      onClose();
    } catch (e) { f.fromError(e); }
  };

  return (
    <Modal open onClose={onClose} title="Submit an idea" sub="A teacher reads every idea, usually within a week." busy={save.isPending}
      foot={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={submit}>Submit idea</Button>
      </>}>
      <div className="col g-3">
        <TextField label="Idea title" required maxLength={160} placeholder="What are you trying to make or solve?"
          value={v.title} onChange={(x) => f.set('title', x)} error={f.errors.title} />
        <TextArea label="Describe it" required rows={4} maxLength={1000} placeholder="What problem does it solve, and how might it work?"
          value={v.problem} onChange={(x) => f.set('problem', x)} error={f.errors.problem} />
        <FormGrid>
          <SelectField label="Area" required value={v.category} onChange={(x) => f.set('category', x)} options={AREAS} placeholder="Choose…" error={f.errors.category} />
          <SelectField label="Would you like a mentor?" value={v.wantsMentor} onChange={(x) => f.set('wantsMentor', x)}
            options={['Yes, please assign one', 'I already have one in mind', 'Not yet']} />
        </FormGrid>
      </div>
      <div className="mt-4"><Flow steps={[{ label: 'Idea', state: 'active' }, { label: 'Review' }, { label: 'Mentor' }, { label: 'Project' }]} /></div>
      <div className="mt-3">
        <Banner tone="neutral" icon="info">
          It is submitted in your name. You can see the teacher&rsquo;s decision on this page.
        </Banner>
      </div>
    </Modal>
  );
}
