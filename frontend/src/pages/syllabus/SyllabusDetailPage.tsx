import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import {
  Badge, Banner, BulkBar, Button, Card, DataTable, Dl, Empty, ErrorState, FilterSelect, Grid, Icon, InlineError, Kpi, Meter, Modal, Page, PageHead,
  PageSkeleton, Pagination, SearchInput, SelectField, StudentLink, Tabs, TextArea, TextField, Toolbar, useConfirm,
} from '@/components/ui';
import { fmt, todayKey } from '@/lib/format';
import {
  COVERAGE_TONE, GradeDocs, StageBanner, SyllabusForm, TierBadge, TYPE_LABEL, fieldErrors, gradesLabel, minutes,
  type ComponentTier, type CoverageStatus, type EntryRow, type SyllabusComponent, type SyllabusDetail, type SyllabusTopic,
} from './shared';

type Tab = 'overview' | 'topics' | 'entries';

/** Weighting a candidate's route adds up to: tier papers plus shared papers, counting each option group once. */
function routeWeights(s: SyllabusDetail) {
  const total = (tier: ComponentTier | null) => {
    const groups = new Map<string, number>();
    let sum = 0;
    for (const c of s.components) {
      if (c.weightingPercent == null || (tier && c.tier !== 'All' && c.tier !== tier)) continue;
      if (c.optionGroup) groups.set(c.optionGroup, Math.max(groups.get(c.optionGroup) ?? 0, c.weightingPercent));
      else sum += c.weightingPercent;
    }
    return Math.round((sum + [...groups.values()].reduce((a, x) => a + x, 0)) * 10) / 10;
  };
  if (!s.components.some((c) => c.weightingPercent != null)) return 'Weightings not set — check the syllabus document';
  return s.tiered ? `Core route ${total('Core')}% · Extended route ${total('Extended')}%` : `Weightings total ${total(null)}%`;
}

export default function SyllabusDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const q = useApiQuery<SyllabusDetail>(id ? `/syllabuses/${id}` : null);
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const s = q.data;

  if (q.isLoading) return <Page><PageSkeleton /></Page>;
  if (q.error || !s) return <Page><ErrorState error={q.error ?? new Error('Not found')} onRetry={() => q.refetch()} /></Page>;

  const heading = s.syllabusCode ? `${s.syllabusCode} · ${s.title}` : s.title;
  return (
    <Page>
      <PageHead
        title={heading}
        sub={`${s.subject} · ${s.awardingBody}${s.examSeriesYears ? ` · for examination in ${s.examSeriesYears}` : ''} · ${s.tiered ? 'Tiered: Core (C–G) or Extended (A*–E)' : 'Untiered: graded A*–G'}`}
        actions={<>
          <Button icon="arrowLeft" to="/syllabus">All syllabuses</Button>
          {can('grading.manage') && <Button icon="edit" onClick={() => setEditing(true)}>Edit syllabus</Button>}
        </>}
      />
      <StageBanner />

      <Grid cols="g-4col" className="mt-4">
        <Kpi icon="file" label="Papers" value={s.components.length} foot={routeWeights(s)} />
        <Kpi icon="list" label="Topics" value={s.topics.length} tone="info" foot={`${s.topics.reduce((a, t) => a + (t.plannedHours ?? 0), 0)} planned hours`} />
        <Kpi icon="checkSquare" label="Coverage" value={s.coverage.pct == null ? '—' : `${s.coverage.pct}%`} tone="teal" foot={`${s.coverage.covered} of ${s.coverage.slots} topic-sections · ${s.coverage.inProgress} in progress`} />
        <Kpi icon="users" label="Entries" value={`${s.entries.entered}/${s.entries.students}`} tone="amber"
          foot={s.tiered ? `${s.entries.extended} Extended · ${s.entries.core} Core` : 'Grade 9–10 students entered'} />
      </Grid>

      <div className="mt-4">
        <Tabs<Tab> items={[
          { id: 'overview', label: 'Overview' },
          { id: 'topics', label: 'Topics', count: s.topics.length },
          { id: 'entries', label: 'Entries', count: s.entries.entered },
        ]} active={tab} onChange={setTab} />
      </div>
      <div className="mt-4">
        {tab === 'overview' && <OverviewTab s={s} />}
        {tab === 'topics' && <TopicsTab s={s} />}
        {tab === 'entries' && <EntriesTab s={s} />}
      </div>
      {editing && <SyllabusForm initial={s} onClose={() => setEditing(false)} />}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Overview: components (papers) + section coverage
// ---------------------------------------------------------------------------
function OverviewTab({ s }: { s: SyllabusDetail }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [form, setForm] = useState<SyllabusComponent | 'new' | null>(null);
  const del = useApiMutation<string>('delete', (cid) => `/syllabuses/${s.id}/components/${cid}`, { invalidate: ['/syllabuses'], success: 'Component removed' });
  const manage = can('grading.manage');
  return (
    <Grid cols="g-main">
      <div className="col g-4">
        <Card icon="file" title="Components (papers)" sub="Durations, marks and weightings are editable defaults — check them against the current Cambridge syllabus document." flush
          actions={manage && <Button size="sm" icon="plus" onClick={() => setForm('new')}>Add paper</Button>}>
          <DataTable
            rows={s.components}
            rowKey={(r) => r.id}
            emptyText="No papers recorded for this syllabus yet."
            columns={[
              { key: 'paper', label: 'Paper', render: (r) => <><span className="t-bold">{r.name}</span><div className="t-micro t-muted">{TYPE_LABEL[r.assessmentType] ?? r.assessmentType}{r.optionGroup ? ` · ${r.optionGroup}` : ''}</div></> },
              { key: 'tier', label: 'Tier', render: (r) => <TierBadge tier={r.tier} /> },
              { key: 'duration', label: 'Duration', render: (r) => minutes(r.durationMinutes) },
              { key: 'marks', label: 'Marks', className: 'num', render: (r) => <span className="t-num">{r.maxMarks ?? '—'}</span> },
              { key: 'weight', label: 'Weighting', className: 'num', render: (r) => <span className="t-num">{r.weightingPercent == null ? '—' : `${r.weightingPercent}%`}</span> },
              ...(manage ? [{
                key: 'a', label: '', className: 'num', render: (r: SyllabusComponent) => (
                  <span className="row g-1" style={{ justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="ghost" icon="edit" aria-label={`Edit ${r.name}`} onClick={() => setForm(r)} />
                    <Button size="sm" variant="ghost" icon="trash" aria-label={`Remove ${r.name}`} disabled={r.assessments > 0}
                      title={r.assessments ? `Linked to ${r.assessments} assessment(s)` : undefined}
                      onClick={async () => { if (await confirm({ title: `Remove ${r.name}?`, body: 'The paper is removed from this syllabus.', confirmLabel: 'Remove', danger: true })) del.mutate(r.id); }} />
                  </span>
                ),
              }] : []),
            ]}
          />
        </Card>
        {s.notes && <Banner tone="neutral" icon="info">{s.notes}</Banner>}
      </div>
      <div className="col g-4">
        <Card icon="info" title="Syllabus">
          <Dl items={[
            ['Code', s.syllabusCode ?? 'School-assessed (no Cambridge code)'],
            ['Subject', s.subject],
            ['Taught in', gradesLabel(s.gradeLevels)],
            ['Awarding body', s.awardingBody],
            ['Exam series', s.examSeriesYears ?? '—'],
            ['Grading', s.tiered ? 'A*–G · Core C–G (capped at C), Extended A*–E' : 'A*–G, U below G'],
            ['Status', s.isActive ? 'Active' : 'Inactive'],
          ]} />
        </Card>
        {s.cambridge && (
          <Card icon="bookOpen" title="Cambridge syllabus documents" sub="The syllabus each grade is examined on, from the year it sits the exams">
            <GradeDocs byGrade={s.cambridge.byGrade} subjectPage={s.cambridge.subjectPage} />
            {s.cambridge.subjectPage && (
              <a className="row g-2 mt-3 t-sm" style={{ alignItems: 'center' }} href={s.cambridge.subjectPage} target="_blank" rel="noopener noreferrer">
                Cambridge subject page — past papers, all syllabus versions <Icon name="external" size={14} />
              </a>
            )}
          </Card>
        )}
        <Card icon="checkSquare" title="Coverage by section" sub="Topics marked Covered">
          {s.sections.length ? (
            <div className="col g-3">
              {s.sections.map((sec) => (
                <Meter key={sec.id} label={`${sec.campus} · ${sec.label}`} value={sec.pct ?? 0} right={`${sec.covered}/${s.topics.length}`}
                  tone={(sec.pct ?? 0) >= 60 ? 'teal' : (sec.pct ?? 0) >= 30 ? 'amber' : 'critical'} hint={sec.inProgress ? `${sec.inProgress} in progress` : undefined} />
              ))}
            </div>
          ) : <Empty icon="users" title="No Grade 9–10 sections" sub="Sections you teach in Grades 9–10 appear here." />}
        </Card>
      </div>
      {form && <ComponentForm syllabus={s} initial={form === 'new' ? null : form} onClose={() => setForm(null)} />}
    </Grid>
  );
}

function ComponentForm({ syllabus, initial, onClose }: { syllabus: SyllabusDetail; initial: SyllabusComponent | null; onClose: () => void }) {
  const [f, setF] = useState({
    paperNo: initial?.paperNo ?? '', name: initial?.name ?? '', tier: (initial?.tier ?? 'All') as ComponentTier,
    durationMinutes: initial?.durationMinutes?.toString() ?? '', maxMarks: initial?.maxMarks?.toString() ?? '', weightingPercent: initial?.weightingPercent?.toString() ?? '',
    assessmentType: initial?.assessmentType ?? 'written', optionGroup: initial?.optionGroup ?? '', notes: initial?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); };
  const save = useApiMutation<Record<string, unknown>>(initial ? 'put' : 'post', initial ? `/syllabuses/${syllabus.id}/components/${initial.id}` : `/syllabuses/${syllabus.id}/components`, {
    invalidate: ['/syllabuses'], success: initial ? 'Paper updated' : 'Paper added', error: false, onSuccess: onClose,
  });
  useEffect(() => { if (save.error) setErrors(fieldErrors(save.error)); }, [save.error]);
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const submit = () => {
    const e: Record<string, string> = {};
    if (!f.paperNo.trim()) e.paperNo = 'Enter the paper number';
    if (f.name.trim().length < 3) e.name = 'Enter a name';
    for (const k of ['durationMinutes', 'maxMarks', 'weightingPercent'] as const) {
      const v = num(f[k]);
      if (v != null && (!Number.isFinite(v) || v < 0)) e[k] = 'Enter a positive number';
    }
    if ((num(f.weightingPercent) ?? 0) > 100) e.weightingPercent = 'At most 100';
    setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({
      paperNo: f.paperNo.trim(), name: f.name.trim(), tier: f.tier, durationMinutes: num(f.durationMinutes), maxMarks: num(f.maxMarks),
      weightingPercent: num(f.weightingPercent), assessmentType: f.assessmentType, optionGroup: f.optionGroup.trim() || null, notes: f.notes.trim() || null,
    });
  };
  return (
    <Modal open onClose={onClose} title={initial ? `Edit ${initial.name}` : 'Add paper'} sub={syllabus.title} size="wide" busy={save.isPending}
      foot={<><Button onClick={onClose} disabled={save.isPending}>Cancel</Button><Button variant="primary" onClick={submit} loading={save.isPending}>Save</Button></>}>
      {save.error && !Object.keys(fieldErrors(save.error)).length && <div className="mb-4"><InlineError error={save.error} /></div>}
      <div className="grid g-2col g-3">
        <TextField label="Paper / component no." required value={f.paperNo} onChange={set('paperNo')} error={errors.paperNo} placeholder="4" maxLength={20} />
        <TextField label="Name" required value={f.name} onChange={set('name')} error={errors.name} placeholder="Paper 4 (Extended) — Calculator" maxLength={120} />
        <SelectField label="Tier" value={f.tier} onChange={(v) => set('tier')(v)} error={errors.tier}
          options={syllabus.tiered ? [{ value: 'All', label: 'All candidates' }, { value: 'Core', label: 'Core' }, { value: 'Extended', label: 'Extended' }] : [{ value: 'All', label: 'All candidates (untiered)' }]} />
        <SelectField label="Type" value={f.assessmentType} onChange={set('assessmentType')} options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
        <TextField label="Duration (minutes)" type="number" min={1} value={f.durationMinutes} onChange={set('durationMinutes')} error={errors.durationMinutes} />
        <TextField label="Maximum marks" type="number" min={1} value={f.maxMarks} onChange={set('maxMarks')} error={errors.maxMarks} />
        <TextField label="Weighting (%)" type="number" min={0} max={100} step="0.5" value={f.weightingPercent} onChange={set('weightingPercent')} error={errors.weightingPercent} />
        <TextField label="Option group" value={f.optionGroup} onChange={set('optionGroup')} maxLength={60} placeholder="Practical (Paper 5 or 6)" hint="Papers candidates choose between share a group." />
      </div>
      <div className="mt-3"><TextArea label="Notes" value={f.notes} onChange={set('notes')} rows={2} maxLength={1000} /></div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Topics: units and per-section coverage (teachers update their sections)
// ---------------------------------------------------------------------------
function TopicsTab({ s }: { s: SyllabusDetail }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [sectionId, setSectionId] = useState(s.sections[0]?.id ?? '');
  const [topicForm, setTopicForm] = useState<SyllabusTopic | 'new' | null>(null);
  const [coverFor, setCoverFor] = useState<SyllabusTopic | null>(null);
  const section = s.sections.find((x) => x.id === sectionId);
  const manage = can('grading.manage');
  const teach = can('academics.manage');
  const del = useApiMutation<string>('delete', (tid) => `/syllabuses/${s.id}/topics/${tid}`, { invalidate: ['/syllabuses'], success: 'Topic removed' });
  const quick = useApiMutation<{ topicId: string; status: CoverageStatus }>('post', (v) => `/syllabuses/${s.id}/topics/${v.topicId}/coverage`, {
    invalidate: ['/syllabuses'], success: (_r, v) => `Marked ${v.status.toLowerCase()}`, body: (v) => ({ sectionId, status: v.status }),
  });

  return (
    <Card icon="list" title="Topics and coverage" flush
      sub={section ? `${section.campus} · ${section.label}: ${section.covered} of ${s.topics.length} topics covered${section.inProgress ? `, ${section.inProgress} in progress` : ''}` : 'Choose a section to see its coverage'}
      actions={manage && <Button size="sm" icon="plus" onClick={() => setTopicForm('new')}>Add topic</Button>}>
      <Toolbar>
        {s.sections.length ? (
          <FilterSelect label="Section" allLabel={null} value={sectionId} onChange={setSectionId}
            options={s.sections.map((x) => ({ value: x.id, label: `${x.campus} · ${x.label}` }))} />
        ) : <span className="t-sm t-muted">No Grade 9–10 sections in your scope — coverage is shown per section.</span>}
      </Toolbar>
      <DataTable
        rows={s.topics}
        rowKey={(r) => r.id}
        emptyText="No topics recorded for this syllabus yet."
        columns={[
          { key: 'unit', label: 'Unit', width: '70px', render: (r) => <span className="t-num t-bold">{r.code ?? r.unitNo}</span> },
          {
            key: 'title', label: 'Topic', render: (r) => (
              <>
                <span className="t-bold">{r.title}</span>{r.tier !== 'All' && <> <TierBadge tier={r.tier} /></>}
                {r.subtopics && <div className="t-micro t-muted" style={{ maxWidth: 520 }}>{r.subtopics}</div>}
              </>
            ),
          },
          { key: 'hours', label: 'Planned', className: 'num', render: (r) => (r.plannedHours == null ? '—' : <span className="t-num">{r.plannedHours} h</span>) },
          {
            key: 'all', label: 'Sections covered', render: (r) => {
              const n = Object.values(r.coverage).filter((c) => c.status === 'Covered').length;
              return <Meter label="" value={s.sections.length ? (100 * n) / s.sections.length : 0} right={`${n}/${s.sections.length}`} tone="teal" />;
            },
          },
          {
            key: 'status', label: section ? section.label : 'Status', render: (r) => {
              const c = section ? r.coverage[section.id] : undefined;
              const st: CoverageStatus = c?.status ?? 'Not started';
              return (
                <>
                  <Badge tone={COVERAGE_TONE[st]}>{st}</Badge>
                  {c && (c.coveredOn || c.teacher) && <div className="t-micro t-muted">{[c.coveredOn ? fmt.date(c.coveredOn) : null, c.teacher].filter(Boolean).join(' · ')}</div>}
                </>
              );
            },
          },
          ...(teach && section ? [{
            key: 'a', label: '', className: 'num', render: (r: SyllabusTopic) => {
              const st = r.coverage[section.id]?.status ?? 'Not started';
              return (
                <span className="row g-1" style={{ justifyContent: 'flex-end' }}>
                  {st !== 'Covered' && <Button size="sm" variant="teal" icon="check" loading={quick.isPending && quick.variables?.topicId === r.id}
                    onClick={() => quick.mutate({ topicId: r.id, status: 'Covered' })}>Covered</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setCoverFor(r)}>Update</Button>
                  {manage && <Button size="sm" variant="ghost" icon="edit" aria-label={`Edit ${r.title}`} onClick={() => setTopicForm(r)} />}
                  {manage && <Button size="sm" variant="ghost" icon="trash" aria-label={`Remove ${r.title}`}
                    onClick={async () => { if (await confirm({ title: `Remove “${r.title}”?`, body: 'The topic and its coverage records for every section are removed.', confirmLabel: 'Remove topic', danger: true })) del.mutate(r.id); }} />}
                </span>
              );
            },
          }] : []),
        ]}
      />
      {coverFor && section && <CoverageForm syllabusId={s.id} topic={coverFor} sectionId={section.id} sectionLabel={`${section.campus} · ${section.label}`} onClose={() => setCoverFor(null)} />}
      {topicForm && <TopicForm syllabus={s} initial={topicForm === 'new' ? null : topicForm} onClose={() => setTopicForm(null)} />}
    </Card>
  );
}

function CoverageForm({ syllabusId, topic, sectionId, sectionLabel, onClose }: { syllabusId: string; topic: SyllabusTopic; sectionId: string; sectionLabel: string; onClose: () => void }) {
  const cur = topic.coverage[sectionId];
  const [status, setStatus] = useState<CoverageStatus>(cur?.status ?? 'In progress');
  const [coveredOn, setCoveredOn] = useState(cur?.coveredOn ?? todayKey());
  const [notes, setNotes] = useState(cur?.notes ?? '');
  const [error, setError] = useState('');
  const save = useApiMutation<Record<string, unknown>>('post', `/syllabuses/${syllabusId}/topics/${topic.id}/coverage`, {
    invalidate: ['/syllabuses'], success: 'Coverage updated', onSuccess: onClose,
  });
  const submit = () => {
    if (status === 'Covered' && (!coveredOn || coveredOn > todayKey())) { setError('Choose a date that is not in the future'); return; }
    save.mutate({ sectionId, status, coveredOn: status === 'Covered' ? coveredOn : null, notes: notes.trim() || null });
  };
  return (
    <Modal open onClose={onClose} title="Update coverage" sub={`${sectionLabel} · ${topic.code ? `${topic.code} ` : ''}${topic.title}`} busy={save.isPending}
      foot={<><Button onClick={onClose} disabled={save.isPending}>Cancel</Button><Button variant="primary" onClick={submit} loading={save.isPending}>Save</Button></>}>
      {save.error && <div className="mb-3"><InlineError error={save.error} /></div>}
      <div className="grid g-2col g-3">
        <SelectField label="Status" required value={status} onChange={(v) => setStatus(v as CoverageStatus)} options={['Not started', 'In progress', 'Covered']} />
        {status === 'Covered' && <TextField label="Covered on" type="date" required value={coveredOn} max={todayKey()} onChange={(v) => { setCoveredOn(v); setError(''); }} error={error} />}
      </div>
      <div className="mt-3"><TextArea label="Notes" value={notes} onChange={setNotes} rows={2} maxLength={500} placeholder="E.g. revision needed on circle theorems" /></div>
    </Modal>
  );
}

function TopicForm({ syllabus, initial, onClose }: { syllabus: SyllabusDetail; initial: SyllabusTopic | null; onClose: () => void }) {
  const [f, setF] = useState({
    unitNo: initial?.unitNo?.toString() ?? String((syllabus.topics.at(-1)?.unitNo ?? 0) + 1), code: initial?.code ?? '', title: initial?.title ?? '',
    subtopics: initial?.subtopics ?? '', tier: (initial?.tier ?? 'All') as ComponentTier, plannedHours: initial?.plannedHours?.toString() ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); };
  const save = useApiMutation<Record<string, unknown>>(initial ? 'put' : 'post', initial ? `/syllabuses/${syllabus.id}/topics/${initial.id}` : `/syllabuses/${syllabus.id}/topics`, {
    invalidate: ['/syllabuses'], success: initial ? 'Topic updated' : 'Topic added', error: false, onSuccess: onClose,
  });
  useEffect(() => { if (save.error) setErrors(fieldErrors(save.error)); }, [save.error]);
  const submit = () => {
    const e: Record<string, string> = {};
    const unit = Number(f.unitNo);
    if (!Number.isInteger(unit) || unit < 0) e.unitNo = 'Enter a unit number';
    if (f.title.trim().length < 2) e.title = 'Enter the topic title';
    const hours = f.plannedHours.trim() === '' ? null : Number(f.plannedHours);
    if (hours != null && (!Number.isFinite(hours) || hours < 0)) e.plannedHours = 'Enter a positive number';
    setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({ unitNo: unit, code: f.code.trim() || null, title: f.title.trim(), subtopics: f.subtopics.trim() || null, tier: f.tier, plannedHours: hours, plannedWeeks: hours == null ? null : Math.round((hours / 4) * 2) / 2 });
  };
  return (
    <Modal open onClose={onClose} title={initial ? 'Edit topic' : 'Add topic'} sub={syllabus.title} size="wide" busy={save.isPending}
      foot={<><Button onClick={onClose} disabled={save.isPending}>Cancel</Button><Button variant="primary" onClick={submit} loading={save.isPending}>Save</Button></>}>
      {save.error && !Object.keys(fieldErrors(save.error)).length && <div className="mb-4"><InlineError error={save.error} /></div>}
      <div className="grid g-2col g-3">
        <TextField label="Unit no." type="number" min={0} required value={f.unitNo} onChange={set('unitNo')} error={errors.unitNo} />
        <TextField label="Code" value={f.code} onChange={set('code')} error={errors.code} maxLength={20} placeholder="2.13" />
        <TextField label="Title" required value={f.title} onChange={set('title')} error={errors.title} maxLength={200} />
        <SelectField label="Tier" value={f.tier} onChange={(v) => set('tier')(v)}
          options={[{ value: 'All', label: 'All candidates' }, { value: 'Core', label: 'Core only' }, { value: 'Extended', label: 'Extended only' }]} />
        <TextField label="Planned hours" type="number" min={0} value={f.plannedHours} onChange={set('plannedHours')} error={errors.plannedHours} />
      </div>
      <div className="mt-3"><TextArea label="Subtopics" value={f.subtopics} onChange={set('subtopics')} rows={3} maxLength={4000} /></div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Entries: Core / Extended tier per Grade 9–10 student
// ---------------------------------------------------------------------------
function EntriesTab({ s }: { s: SyllabusDetail }) {
  const { can } = useAuth();
  const { lookups } = useLookups();
  const list = useListParams({ sort: 'section', pageSize: 25 }, ['sectionId', 'tier']);
  const q = usePagedQuery<EntryRow>(`/syllabuses/${s.id}/entries`, list.query);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const edit = can('academics.manage');
  const save = useApiMutation<{ entries: Record<string, unknown>[] }, { saved: number; removed: number }>('put', `/syllabuses/${s.id}/entries`, {
    invalidate: [`/syllabuses`], success: (r) => `${r.data.saved ? `Saved ${r.data.saved} entr${r.data.saved === 1 ? 'y' : 'ies'}` : ''}${r.data.removed ? `${r.data.saved ? ', ' : ''}removed ${r.data.removed}` : ''}`,
    onSuccess: () => setSelected(new Set()),
  });
  // Grade 10 sits the exam at the end of this academic year; Grade 9 a year later.
  const finalYear = useMemo(() => Number((lookups?.academicYears.find((y) => y.isCurrent)?.endsOn ?? todayKey()).slice(0, 4)), [lookups]);
  const seriesFor = (r: EntryRow) => r.examSeries ?? `May/June ${r.section.includes('10') ? finalYear : finalYear + 1}`;
  const setTier = (rows: EntryRow[], tier: 'Core' | 'Extended' | null, remove = false) =>
    save.mutate({ entries: rows.map((r) => (remove ? { studentId: r.id, remove: true } : { studentId: r.id, tier, examSeries: seriesFor(r) })) });
  const rows = q.data?.rows ?? [];
  const chosen = rows.filter((r) => selected.has(r.id));

  return (
    <Card icon="users" title="Student entries" flush
      sub={s.tiered ? 'Extended entries are graded A*–E (below E is U); Core entries are graded C–G and capped at C.' : 'Untiered syllabus — every entry is graded A*–G (U below G).'}>
      <Toolbar>
        <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search students" />
        <FilterSelect label="Section" value={list.filters.sectionId} onChange={(v) => list.setFilter('sectionId', v)} options={s.sections.map((x) => ({ value: x.id, label: `${x.campus} · ${x.label}` }))} />
        <FilterSelect label="Entry" value={list.filters.tier} onChange={(v) => list.setFilter('tier', v)}
          options={s.tiered ? ['Extended', 'Core', { value: 'None', label: 'Not entered' }] : [{ value: 'None', label: 'Not entered' }]} />
      </Toolbar>
      {edit && chosen.length > 0 && (
        <BulkBar count={chosen.length} onClear={() => setSelected(new Set())}>
          {s.tiered ? (
            <>
              <Button size="sm" onClick={() => setTier(chosen, 'Extended')} loading={save.isPending}>Enter Extended</Button>
              <Button size="sm" onClick={() => setTier(chosen, 'Core')} loading={save.isPending}>Enter Core</Button>
            </>
          ) : <Button size="sm" onClick={() => setTier(chosen, null)} loading={save.isPending}>Enter</Button>}
          <Button size="sm" variant="ghost" onClick={() => setTier(chosen, null, true)} loading={save.isPending}>Withdraw</Button>
        </BulkBar>
      )}
      {save.error && <div className="mb-3" style={{ padding: '0 16px' }}><InlineError error={save.error} /></div>}
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <DataTable
          rows={q.data?.rows}
          loading={q.isLoading}
          rowKey={(r) => r.id}
          sort={list.sort}
          onSort={list.setSort}
          selectable={edit}
          selected={selected}
          onSelect={setSelected}
          emptyText={list.hasFilters ? 'No students match these filters.' : 'No Grade 9–10 students in your scope.'}
          columns={[
            { key: 'name', label: 'Student', render: (r) => <StudentLink id={r.id} name={r.fullName} meta={`${r.admissionNo}`} /> },
            { key: 'section', label: 'Section', render: (r) => `${r.campus} · ${r.section}` },
            {
              key: 'tier', label: s.tiered ? 'Tier' : 'Entry', render: (r) => {
                if (!r.entryId) return <Badge tone="neutral">Not entered</Badge>;
                if (!s.tiered) return <Badge tone="success">Entered</Badge>;
                if (!edit) return <TierBadge tier={r.tier} />;
                return (
                  <select className="select" style={{ width: 'auto', minWidth: 120 }} aria-label={`Tier for ${r.fullName}`} value={r.tier ?? ''} disabled={save.isPending}
                    onChange={(e) => setTier([r], e.target.value as 'Core' | 'Extended')}>
                    <option value="Extended">Extended</option>
                    <option value="Core">Core</option>
                  </select>
                );
              },
            },
            { key: 'series', label: 'Exam series', render: (r) => r.examSeries ?? <span className="t-faint">—</span> },
            { key: 'updated', label: 'Updated', sortable: false, render: (r) => r.updatedAt ? <span className="t-sm">{r.updatedBy ?? '—'}<div className="t-micro t-muted">{fmt.relative(r.updatedAt)}</div></span> : '—' },
            ...(edit ? [{
              key: 'a', label: '', sortable: false, className: 'num', render: (r: EntryRow) => r.entryId ? null : (
                s.tiered
                  ? <span className="row g-1" style={{ justifyContent: 'flex-end' }}><Button size="sm" onClick={() => setTier([r], 'Extended')}>Extended</Button><Button size="sm" variant="ghost" onClick={() => setTier([r], 'Core')}>Core</Button></span>
                  : <Button size="sm" onClick={() => setTier([r], null)}>Enter</Button>
              ),
            }] : []),
          ]}
        />
      )}
      <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
    </Card>
  );
}
