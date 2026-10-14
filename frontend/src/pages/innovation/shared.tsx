import { Badge, Button, Flow, InlineError, Modal, SelectField, TextArea, TextField } from '@/components/ui';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { FormGrid, StudentPicker, req, useForm, type StudentPick } from '../operations/shared';

export const STAGES = ['Idea', 'Review', 'Mentor', 'Project', 'Prototype', 'Competition', 'Achievement'];
export const AREAS = ['Robotics & electronics', 'Software & apps', 'Environment & sustainability', 'Health & wellbeing', 'Community & social', 'Other'];

export function StageBadge({ stage }: { stage: number }) {
  const tone = stage >= 6 ? 'success' : stage >= 4 ? 'info' : stage >= 2 ? 'warning' : 'neutral';
  return <Badge tone={tone}>{STAGES[stage] ?? 'Idea'}</Badge>;
}

export interface Mentor {
  id: string; employeeCode: string; name: string; designation: string; department: string; campusName: string; isMentor: boolean;
  specialisation: string | null; activeProjects: number; completedProjects: number; students: number;
  projects: { id: string; code: string; title: string; stage: number }[]; feedback30d: number;
}

export function useMentorOptions() {
  const q = useApiQuery<Mentor[]>('/innovation/mentors', undefined, { staleTime: 60_000 });
  return (q.data ?? []).filter((m) => m.isMentor).map((m) => ({ value: m.id, label: `${m.name} — ${m.activeProjects} active` }));
}

export interface ProjectRow {
  id: string; code: string; title: string; summary: string | null; stage: number; status: string; startedOn: string | null; updatedAt: string;
  mentorId: string | null; mentor: string | null; studentId: string; studentName: string; admissionNo: string; grade: string | null; section: string | null;
  campusName: string; milestones: number; done: number; overdueMilestones: number; nextMilestone: string | null; nextDue: string | null; members: number;
}

export function IdeaSubmitModal({ onClose }: { onClose: () => void }) {
  const f = useForm({ title: '', problem: '', category: '', wantsMentor: 'Yes, please assign one', student: null as StudentPick | null });
  const v = f.values;
  const save = useApiMutation<Record<string, unknown>>('post', '/innovation/ideas', { invalidate: ['/innovation'], success: 'Idea submitted for review' });
  const submit = async () => {
    if (!f.validate({
      student: !v.student ? 'Choose the student' : null,
      title: req(v.title, 'Title') ?? (v.title.trim().length < 4 ? 'Give the idea a short title' : null),
      problem: req(v.problem, 'Description') ?? (v.problem.trim().length < 10 ? 'Describe it in a sentence or two' : null),
      category: req(v.category, 'Area'),
    })) return;
    try {
      await save.mutateAsync({ title: v.title, problem: v.problem, category: v.category, wantsMentor: v.wantsMentor, studentId: v.student!.id });
      onClose();
    } catch (e) { f.fromError(e); }
  };
  return (
    <Modal open onClose={onClose} title="Submit an idea" sub="Any student can submit. A teacher reviews within a week." busy={save.isPending}
      foot={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Submit idea</Button></>}>
      <div className="col g-3">
        <InlineError error={save.error} />
        <StudentPicker required value={v.student} onChange={(x) => f.set('student', x)} error={f.errors.student || f.errors.studentId} />
        <TextField label="Idea title" required maxLength={160} placeholder="What are you trying to make or solve?" value={v.title} onChange={(x) => f.set('title', x)} error={f.errors.title} />
        <TextArea label="Describe it" required rows={4} maxLength={1000} placeholder="What problem does it solve, and how might it work?" value={v.problem} onChange={(x) => f.set('problem', x)} error={f.errors.problem} />
        <FormGrid>
          <SelectField label="Area" required value={v.category} onChange={(x) => f.set('category', x)} options={AREAS} placeholder="Choose…" error={f.errors.category} />
          <SelectField label="Would you like a mentor?" value={v.wantsMentor} onChange={(x) => f.set('wantsMentor', x)} options={['Yes, please assign one', 'I already have one in mind', 'Not yet']} />
        </FormGrid>
      </div>
      <div className="mt-4"><Flow steps={[{ label: 'Idea', state: 'active' }, { label: 'Review' }, { label: 'Mentor' }, { label: 'Project' }]} /></div>
    </Modal>
  );
}

type MilestoneDraft = { title: string; dueOn: string };

export function MilestoneDrafts({ items, onChange }: { items: MilestoneDraft[]; onChange: (x: MilestoneDraft[]) => void }) {
  return (
    <div className="col g-2">
      <span className="label">First milestones</span>
      {items.map((m, i) => (
        <div key={i} className="row g-2 wrap">
          <input className="input grow" aria-label={`Milestone ${i + 1} title`} placeholder={`Milestone ${i + 1}`} value={m.title} maxLength={160}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
          <input className="input" type="date" aria-label={`Milestone ${i + 1} due date`} style={{ width: 160 }} value={m.dueOn}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, dueOn: e.target.value } : x)))} />
          <Button size="sm" variant="quiet" icon="x" aria-label="Remove milestone" onClick={() => onChange(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      {items.length < 12 && <div><Button size="sm" icon="plus" onClick={() => onChange([...items, { title: '', dueOn: '' }])}>Add milestone</Button></div>}
    </div>
  );
}

export const cleanMilestones = (items: MilestoneDraft[]) =>
  items.filter((m) => m.title.trim().length >= 3).map((m) => ({ title: m.title.trim(), dueOn: m.dueOn || null }));
