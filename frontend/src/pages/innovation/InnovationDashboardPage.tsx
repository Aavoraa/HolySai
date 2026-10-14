import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertItem, Button, Card, Chart, DataTable, Empty, ErrorState, Flow, Grid, Kpi, Legend, Meter, Page, CampusBanner, PageSkeleton, StudentLink, charts, DashLayout, DashRail, SchoolPulse } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApi';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { fmt } from '@/lib/format';
import { IdeaSubmitModal, StageBadge } from './shared';
import { NewProjectModal } from './ProjectsPage';

interface Dashboard {
  kpis: {
    ideas: number; ideasThisMonth: number; ideasLastMonth: number; activeProjects: number; totalProjects: number; mentors: number; activeMentors: number;
    students: number; studentsPct: number; competitions: number; competitionEntries: number; placed: number; achievements: number; prototypes: number; overdueMilestones: number;
  };
  pipeline: { stage: number; label: string; value: number }[];
  projects: { id: string; code: string; title: string; stage: number; updatedAt: string; mentor: string | null; studentId: string; studentName: string; grade: string | null; section: string | null; milestones: number; done: number }[];
  competitions: { id: string; name: string; level: string; heldOn: string; result: string | null; teams: number }[];
  skills: { skill: string; lab: number | null; school: number | null }[];
}

export default function InnovationDashboardPage() {
  const { campusParam } = useSchool();
  const { can } = useAuth();
  const navigate = useNavigate();
  const q = useApiQuery<Dashboard>('/innovation/dashboard', campusParam);
  const [modal, setModal] = useState<'idea' | 'project' | null>(null);
  const manage = can('innovation.manage');
  if (q.isLoading) return <Page><PageSkeleton /></Page>;
  if (q.error || !q.data) return <Page><ErrorState error={q.error} onRetry={q.refetch} /></Page>;
  const d = q.data;
  const k = d.kpis;
  const ideaDelta = k.ideasLastMonth ? Math.round(((k.ideasThisMonth - k.ideasLastMonth) / k.ideasLastMonth) * 100) : null;
  const activeStage = d.pipeline.reduce((best, s) => (s.stage > 0 && s.stage < 6 && s.value > (d.pipeline[best]?.value ?? 0) ? s.stage : best), 3);
  const skillsReady = d.skills.every((s) => s.lab != null && s.school != null);
  return (
    <Page>
      <CampusBanner title="Student Innovation Lab"
        sub="Idea → Review → Mentor → Project → Prototype → Competition → Achievement. Every project has a student, a mentor and evidence."
        actions={manage && <>
          <Button icon="lightbulb" onClick={() => setModal('idea')}>Submit an idea</Button>
          <Button variant="primary" icon="plus" onClick={() => setModal('project')}>New project</Button>
        </>} />
      <DashLayout rail={<DashRail events={false} actions={[
        { label: 'Ideas', icon: 'lightbulb', to: '/ideas' },
        { label: 'Projects', icon: 'puzzle', to: '/projects' },
        { label: 'Mentors', icon: 'users', to: '/mentors' },
        { label: 'Milestones', icon: 'flag', to: '/milestones' },
        { label: 'Competitions', icon: 'award', to: '/competitions' },
        { label: 'Achievements', icon: 'star', to: '/achievements' },
      ]} />}>
      <Grid cols="g-4col">
        <Kpi size="hero" icon="lightbulb" label="Ideas submitted" value={fmt.n(k.ideas)} delta={ideaDelta} deltaUnit="% vs last month" foot={`${k.ideasThisMonth} this month`} to="/ideas" />
        <Kpi size="hero" icon="rocket" label="Active projects" value={fmt.n(k.activeProjects)} tone="amber" to="/projects" foot={`${k.totalProjects} in total`} />
        <Kpi size="hero" icon="users" label="Students involved" value={fmt.n(k.students)} tone="teal" foot={`${fmt.pct(k.studentsPct, 1)} of the school`} />
        <Kpi size="hero" icon="flag" label="Milestones overdue" value={fmt.n(k.overdueMilestones)} tone="critical" to="/milestones?status=Overdue"
          foot={k.overdueMilestones ? 'Needs mentor follow-up' : 'Everything on schedule'} />
      </Grid>
      <div className="statgrid statgrid--card mt-4">
        <Kpi size="compact" icon="graduation" label="Mentors" value={fmt.n(k.mentors)} tone="info" to="/mentors" foot={`${k.activeMentors} mentoring now`} />
        <Kpi size="compact" icon="target" label="Competitions entered" value={fmt.n(k.competitions)} to="/competitions" foot={`${k.competitionEntries} entries · ${k.placed} placed`} />
        <Kpi size="compact" icon="award" label="Achievements" value={fmt.n(k.achievements)} tone="teal" to="/achievements" foot="This academic year" />
        <Kpi size="compact" icon="tool" label="Prototypes built" value={fmt.n(k.prototypes)} tone="amber" foot="Projects at Prototype or beyond" />
      </div>
      <SchoolPulse />
      <Card icon="target" title="Pipeline" sub={`Where the ${k.activeProjects} active projects and open ideas sit today`} className="mt-5">
        <Flow steps={d.pipeline.map((s) => ({
          label: s.label,
          meta: `${fmt.n(s.value)} ${s.stage === 6 ? 'recorded' : s.stage < 3 ? 'ideas & projects' : 'projects'}`,
          state: s.stage === activeStage ? 'active' : s.stage < activeStage ? 'done' : undefined,
        }))} />
      </Card>
      <div className="grid g-main mt-4">
        <Card icon="rocket" title="Projects" sub="Most recently updated" flush actions={<Button size="sm" to="/projects">All projects</Button>}>
          {!d.projects.length ? (
            <Empty icon="rocket" title="No projects yet" sub="Accepted ideas become projects with a mentor. Review ideas or start a project directly."
              action={manage ? <Button variant="primary" icon="plus" onClick={() => setModal('project')}>New project</Button> : <Button to="/ideas">Open ideas</Button>} />
          ) : (
            <DataTable
              rows={d.projects} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/projects/${r.id}`)}
              columns={[
                { key: 'title', label: 'Project', render: (r) => <><span className="t-bold">{r.title}</span><div className="t-micro t-muted">{r.code}</div></> },
                { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={`${r.grade ?? ''}${r.section ?? ''}`} /> },
                { key: 'mentor', label: 'Mentor', render: (r) => r.mentor ?? '—' },
                { key: 'stage', label: 'Stage', render: (r) => <StageBadge stage={r.stage} /> },
                { key: 'done', label: 'Milestones', render: (r) => <Meter label="" value={r.milestones ? (r.done / r.milestones) * 100 : 0} right={`${r.done}/${r.milestones}`} tone={r.done === r.milestones && r.milestones ? 'teal' : 'amber'} /> },
                { key: 'updated', label: 'Updated', render: (r) => fmt.date(r.updatedAt) },
              ]}
            />
          )}
        </Card>
        <div className="col g-4">
          <Card icon="award" title="Competitions" flush actions={<Button size="sm" to="/competitions">All competitions</Button>}>
            {!d.competitions.length ? (
              <Empty icon="award" title="No recent or upcoming competitions" sub="Register the lab for an event to send project teams and record results." />
            ) : (
              <div>
                {d.competitions.map((c) => (
                  <AlertItem key={c.id} tone={/place|finalist|winner/i.test(c.result ?? '') ? 'success' : 'info'} icon="award" title={c.name}
                    meta={`${fmt.date(c.heldOn)} · ${c.teams} team${c.teams === 1 ? '' : 's'} · ${c.result ?? 'Registered'}`} to="/competitions" />
                ))}
              </div>
            )}
          </Card>
          <Card icon="grid" title="Skills developed" sub="Lab participants against the school median (Student 360 skill scores)">
            {skillsReady ? (
              <>
                <Chart svg={charts.radar({
                  size: 240, axes: d.skills.map((s) => s.skill),
                  series: [{ name: 'Lab participants', values: d.skills.map((s) => s.lab), color: 'var(--amber)' },
                    { name: 'School median', values: d.skills.map((s) => s.school), color: 'var(--neutral)' }],
                })} />
                <div className="mt-3"><Legend items={[{ label: 'Lab participants', color: 'var(--amber)' }, { label: 'School median', color: 'var(--neutral)' }]} /></div>
              </>
            ) : <Empty icon="chart" title="Not enough skill data yet" sub="Skill scores appear once participants have Student 360 assessments." />}
          </Card>
        </div>
      </div>
      {modal === 'idea' && <IdeaSubmitModal onClose={() => setModal(null)} />}
      {modal === 'project' && <NewProjectModal onClose={() => setModal(null)} />}
      </DashLayout>
    </Page>
  );
}
