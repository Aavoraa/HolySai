import { useSearchParams } from 'react-router-dom';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiQuery } from '@/hooks/useApi';
import { fmt } from '@/lib/format';
import {
  Avatar, Badge, Button, Card, Chart, charts, DataTable, Empty, ErrorState, Grid, Icon, Meter, Page, PageHead, PageSkeleton,
  Skeleton, Status, Timeline,
} from '@/components/ui';
import { StudentPicker, useCsvDownload } from './shared';

interface Overview {
  students: number; complete: number;
  categories: { key: string; label: string; value: number }[];
  byGrade: { label: string; students: number; complete: number; achievements: number; activities: number; projects: number; documents: number }[];
}
interface Portfolio {
  student: { id: string; fullName: string; admissionNo: string; house: string | null; grade: string | null; section: string | null; campus: string };
  completeness: { key: string; label: string; done: boolean }[];
  achievements: { id: string; title: string; type: string; level: string | null; date: string; verified: boolean }[];
  activities: { name: string; category: string; role: string; since: string; hours: number; status: string }[];
  projects: { id: string; code: string | null; title: string; status: string; date: string | null; mentor: string | null; source: string }[];
  documents: { id: string; name: string; category: string; status: string; verifiedAt: string | null; hasFile: boolean }[];
  skills: { name: string; score: number; confidence: string | null }[];
  interests: string[];
  timeline: { date: string; title: string; body: string | null; category: string; tone: string }[];
}

const SAMPLE = 'HS-2026-1041';

export default function PortfolioPage() {
  const { campusParam } = useSchool();
  const [sp, setSp] = useSearchParams();
  const selected = sp.get('student');
  const choose = (id: string | null) => setSp((p) => { const n = new URLSearchParams(p); if (id) n.set('student', id); else n.delete('student'); return n; }, { replace: true });
  const overview = useApiQuery<Overview>('/portfolio/overview', campusParam);
  const { download, busy } = useCsvDownload();

  return (
    <Page>
      <PageHead
        title="Student Portfolio"
        sub="Portfolios are generated from verified achievements, project evidence and selected work."
        actions={<Button icon="download" title="Download portfolio completeness for every student as a CSV file" loading={busy === 'pc'} onClick={() => download('pc', '/reports/portfolio-completeness/export', campusParam, 'portfolio-completeness.csv')}>Export</Button>}
      />
      <Card icon="grid" title="Open a portfolio" sub="Search by name or admission number">
        <div className="row-top g-3 wrap">
          <div className="grow" style={{ minWidth: 0, flexBasis: 260 }}><StudentPicker onPick={(s) => choose(s.admissionNo)} placeholder="Find a student’s portfolio" /></div>
          <Button icon="user" onClick={() => choose(SAMPLE)}>Open a sample portfolio</Button>
        </div>
      </Card>

      {selected && <div className="mt-4"><StudentPortfolio id={selected} onClose={() => choose(null)} /></div>}

      <div className="mt-4">
        {overview.error ? <ErrorState error={overview.error} onRetry={() => overview.refetch()} /> : (
          <Card icon="trending" title="Portfolio completeness by grade" sub={overview.data ? `Share of students with evidence in all four categories · ${overview.data.complete}% overall across ${overview.data.students} students` : 'Loading…'}>
            {overview.isLoading || !overview.data ? <Skeleton height={230} /> : overview.data.byGrade.length ? (
              <div className="grid g-main">
                <Chart svg={charts.bar({
                  labels: overview.data.byGrade.map((g) => g.label),
                  series: [{ name: 'Complete %', values: overview.data.byGrade.map((g) => g.complete), color: 'var(--amber)' }],
                  yMax: 100, height: 230,
                })} />
                <div className="col g-3">
                  <div className="eyebrow">Evidence coverage by category</div>
                  {overview.data.categories.map((c) => <Meter key={c.key} label={c.label} value={c.value} tone={c.value < 40 ? 'critical' : c.value < 70 ? 'amber' : 'teal'} />)}
                </div>
              </div>
            ) : <Empty icon="folder" title="No students in view" sub="Completeness by grade appears once students are enrolled on this campus." />}
          </Card>
        )}
      </div>
    </Page>
  );
}

function StudentPortfolio({ id, onClose }: { id: string; onClose?: () => void }) {
  const q = useApiQuery<Portfolio>(`/portfolio/students/${encodeURIComponent(id)}`);
  if (q.isLoading) return <PageSkeleton kpis={4} />;
  if (q.error || !q.data) return (
    <div className="col g-3">
      <ErrorState error={q.error} onRetry={() => q.refetch()} />
      {onClose && <div><Button variant="quiet" icon="x" onClick={onClose}>Close portfolio</Button></div>}
    </div>
  );
  const p = q.data;
  const done = p.completeness.filter((c) => c.done).length;
  return (
    <div className="col g-4">
      <section className="card profilehead">
        <div className="profilehead__main">
          <Avatar name={p.student.fullName} size="xl" />
          <div className="profilehead__id">
            <div className="row g-2 wrap">
              <h2 className="profilehead__name">{p.student.fullName}</h2>
              <Badge tone={done === 4 ? 'success' : done >= 2 ? 'warning' : 'critical'} dot>{done} of 4 categories evidenced</Badge>
            </div>
            <p className="profilehead__meta">
              <span className="t-strong t-semi">{p.student.admissionNo}</span> · {p.student.grade ?? ''}{p.student.section ?? ''} · {p.student.house ? `${p.student.house} House · ` : ''}{p.student.campus}
            </p>
            <div className="row g-2 wrap mt-2">
              {p.completeness.map((c) => (
                <Badge key={c.key} tone={c.done ? 'success' : 'neutral'} icon={c.done ? 'check' : 'minus'}>{c.label}</Badge>
              ))}
            </div>
          </div>
          <div className="profilehead__actions">
            <Button size="sm" icon="user" to={`/student-360/${p.student.id}`}>Open Student 360</Button>
            {onClose && <Button size="sm" variant="quiet" icon="x" onClick={onClose}>Close portfolio</Button>}
          </div>
        </div>
        <dl className="profilehead__stats">
          <div><dt>Achievements</dt><dd>{p.achievements.length}</dd></div>
          <div><dt>Activity hours</dt><dd>{fmt.n(p.activities.reduce((a, x) => a + x.hours, 0))}</dd></div>
          <div><dt>Projects</dt><dd>{p.projects.length}</dd></div>
          <div><dt>Documents</dt><dd>{p.documents.length}</dd></div>
        </dl>
      </section>
      <Grid cols="g-2col">
        <Card icon="award" title="Achievements" sub={`${p.achievements.filter((a) => a.verified).length} verified`} flush>
          <DataTable compact rows={p.achievements} rowKey={(r) => r.id} emptyText="No achievements recorded yet."
            columns={[
              { key: 'title', label: 'Achievement', render: (r) => <><div className="t-sm t-bold">{r.title}</div><div className="t-micro t-muted">{r.type}{r.level ? ` · ${r.level}` : ''}</div></> },
              { key: 'date', label: 'Date', render: (r) => fmt.date(r.date) },
              { key: 'verified', label: 'Status', render: (r) => <Status value={r.verified ? 'Verified' : 'Pending'} /> },
            ]} />
        </Card>
        <Card icon="grid" title="Activities" sub={`${p.activities.reduce((a, x) => a + x.hours, 0)} hours recorded`} flush>
          <DataTable compact rows={p.activities} rowKey={(r) => r.name} emptyText="No activities yet."
            columns={[
              { key: 'name', label: 'Activity', render: (r) => <><div className="t-sm t-bold">{r.name}</div><div className="t-micro t-muted">{r.category} · {r.role}</div></> },
              { key: 'since', label: 'Since', render: (r) => fmt.date(r.since) },
              { key: 'hours', label: 'Hours', className: 'num' },
            ]} />
        </Card>
        <Card icon="rocket" title="Projects" sub="Innovation Lab projects and recorded project work" flush>
          <DataTable compact rows={p.projects} rowKey={(r) => r.id} emptyText="No project evidence yet."
            columns={[
              { key: 'title', label: 'Project', render: (r) => <><div className="t-sm t-bold">{r.title}</div><div className="t-micro t-muted">{r.source}{r.code ? ` · ${r.code}` : ''}{r.mentor ? ` · mentor ${r.mentor}` : ''}</div></> },
              { key: 'date', label: 'Date', render: (r) => fmt.date(r.date) },
              { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
            ]} />
        </Card>
        <Card icon="folder" title="Documents" sub="Files are opened from Student 360 (access is audited)" flush>
          <DataTable compact rows={p.documents} rowKey={(r) => r.id} emptyText="No documents on file."
            columns={[
              { key: 'name', label: 'Document', render: (r) => <span className="row g-2"><Icon name="fileText" size={14} className="t-muted" />{r.name}</span> },
              { key: 'category', label: 'Category' },
              { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
            ]} />
        </Card>
      </Grid>
      <div className="grid g-main">
        <Card icon="activity" title="Growth timeline">
          {p.timeline.length
            ? <Timeline items={p.timeline.map((t) => ({ time: fmt.date(t.date), title: t.title, body: t.body ?? undefined, tone: t.tone }))} />
            : <Empty icon="clock" title="No timeline entries" sub="Verified achievements, activities and projects build this timeline." />}
        </Card>
        <Card icon="grid" title="Strengths and interests">
          {p.skills.length ? <div className="col g-3">{p.skills.map((s) => <Meter key={s.name} label={`${s.name}${s.confidence ? ` · ${s.confidence}` : ''}`} value={s.score} right={String(s.score)} tone={s.score >= 82 ? 'teal' : s.score >= 68 ? undefined : 'amber'} />)}</div>
            : <Empty icon="star" title="No skill ratings" sub="Teacher rubric assessments appear here." />}
          {p.interests.length > 0 && <div className="row g-2 wrap mt-4">{p.interests.map((i) => <Badge key={i}>{i}</Badge>)}</div>}
        </Card>
      </div>
    </div>
  );
}
