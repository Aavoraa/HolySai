import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation } from '@/hooks/useApi';
import {
  Badge, Banner, Button, Card, Checkbox, DataTable, ErrorState, Grid, InlineError, Modal, Page, PageHead, Segment, SelectField, Skeleton, TextField, useConfirm,
} from '@/components/ui';
import { fmt } from '@/lib/format';
import { gradeColor, gradeFor, gradeTone, orderedBoundaries, useGradeScale, type GradeBoundary, type GradeScale, type Tier } from '@/lib/grades';
import { fieldErrors } from './shared';

/** The school grade scale: Cambridge IGCSE A* to G, with U below G. */
export default function GradingPage() {
  const { can } = useAuth();
  const { scale, query } = useGradeScale();
  const [editing, setEditing] = useState(false);
  const bands = useMemo(() => orderedBoundaries(scale), [scale]);
  const ranges = bands.map((b, i) => ({ ...b, upper: i === 0 ? 100 : bands[i - 1].minPercent - 0.01 }));

  return (
    <Page>
      <PageHead
        title="Grading Scheme"
        sub="Every mark in the school is reported on the Cambridge IGCSE letters A* to G, with U (ungraded) below G."
        actions={<>
          <Button icon="graduation" to="/syllabus">IGCSE syllabuses</Button>
          {can('grading.manage') && <Button variant="primary" icon="edit" onClick={() => setEditing(true)} disabled={!scale.id}>Edit boundaries</Button>}
        </>}
      />
      <Banner tone="warning" icon="alert">
        {scale.note ?? 'Cambridge International publishes component grade thresholds for each exam series; these percentage boundaries are the school’s defaults.'}
        {scale.updatedAt && <> Last changed {fmt.relative(scale.updatedAt)}{scale.updatedBy ? ` by ${scale.updatedBy}` : ''}.</>}
      </Banner>
      {query.error && <div className="mt-3"><ErrorState error={query.error} onRetry={() => query.refetch()} title="Showing the default scale — the school scale could not be loaded" /></div>}

      <Grid cols="g-main" className="mt-4">
        <div className="col g-4">
          <Card icon="award" title={scale.name} sub={scale.description ?? undefined} flush>
            {query.isLoading ? <div className="card__body"><Skeleton height={220} /></div> : (
              <>
                <div className="card__body">
                  <div role="img" aria-label={`Grade bands: ${ranges.map((b) => `${b.grade} from ${b.minPercent}%`).join(', ')}`}
                    style={{ display: 'flex', height: 34, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line, rgba(0,0,0,.08))' }}>
                    {[...ranges].reverse().map((b) => (
                      <div key={b.grade} title={`${b.grade}: ${b.minPercent}–${Math.floor(b.upper)}%`}
                        style={{ width: `${Math.max(0, b.upper - b.minPercent + 0.01)}%`, background: gradeColor(b.grade), opacity: 0.85, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12 }}>
                        {b.upper - b.minPercent >= 6 ? b.grade : ''}
                      </div>
                    ))}
                  </div>
                  <div className="row t-micro t-muted mt-1" style={{ justifyContent: 'space-between' }}><span>0%</span><span>50%</span><span>100%</span></div>
                </div>
                <DataTable
                  rows={ranges}
                  rowKey={(r) => r.grade}
                  columns={[
                    { key: 'grade', label: 'Grade', render: (r) => <Badge tone={gradeTone(r.grade, scale)} lg>{r.grade}</Badge> },
                    { key: 'range', label: 'Percentage', render: (r, i) => <span className="t-num">{r.minPercent}% {i === 0 ? 'and above' : `to under ${ranges[i - 1].minPercent}%`}</span> },
                    { key: 'description', label: 'Description', render: (r) => r.description ?? '—' },
                    { key: 'points', label: 'Points', className: 'num', render: (r) => <span className="t-num">{r.points}</span> },
                  ]}
                />
              </>
            )}
          </Card>
          <Card icon="layers" title="Core and Extended tiers" sub="Applies to tiered IGCSE syllabuses (for example Mathematics 0580 and the sciences) in Grades 9–10">
            <div className="grid g-2col g-4">
              <TierCard tier="Extended" scale={scale}
                text="For students aiming for the top grades. Graded A* to E; a result below E is U. Extended candidates sit the Extended papers." />
              <TierCard tier="Core" scale={scale}
                text="For students who need a firmer foundation. Graded C to G — the highest available grade is C; a result below G is U." />
            </div>
            <p className="t-sm t-muted mt-3">
              Untiered syllabuses (for example First Language English 0500 and Computer Science 0478) and every Grade 1–8 assessment use the full A*–G scale.
              Each student’s tier is recorded on the <Link to="/syllabus">IGCSE Syllabus</Link> entries tab; an assessment linked to a Core or Extended paper is graded on that paper’s tier.
            </p>
          </Card>
        </div>
        <div className="col g-4">
          <MarkChecker scale={scale} />
          <Card icon="info" title="How grades are used">
            <ul className="t-sm col g-2" style={{ paddingLeft: 18, margin: 0 }}>
              <li>Assessment marks are graded from the percentage of maximum marks when they are saved.</li>
              <li>Term results in Student 360, Parent 360 and report cards use the same letters.</li>
              <li>Academic performance bands: <strong>above expectation</strong> is grade B or better, <strong>at expectation</strong> is grade C.</li>
              <li>Grades 1–8 follow Cambridge Primary and Lower Secondary (<Link to="/curriculum">Curriculum</Link>, <Link to="/objectives">Cambridge Objectives</Link>) but report on the same letters.</li>
            </ul>
          </Card>
        </div>
      </Grid>
      {editing && scale.id && <BoundaryForm scale={scale} onClose={() => setEditing(false)} />}
    </Page>
  );
}

function TierCard({ tier, scale, text }: { tier: Tier; scale: GradeScale; text: string }) {
  const r = scale.tierRules[tier];
  const list = orderedBoundaries(scale);
  const hi = list.findIndex((b) => b.grade === r.highest);
  const lo = list.findIndex((b) => b.grade === r.lowest);
  return (
    <div className="col g-2">
      <div className="row g-2"><Badge tone={tier === 'Extended' ? 'info' : 'warning'} lg>{tier}</Badge><span className="t-bold">{r.highest} to {r.lowest}</span></div>
      <div className="row g-1 wrap">
        {list.map((b, i) => (
          <Badge key={b.grade} tone={i >= hi && i <= lo ? gradeTone(b.grade, scale) : 'neutral'}>
            {i >= hi && i <= lo ? b.grade : <s>{b.grade}</s>}
          </Badge>
        ))}
      </div>
      <p className="t-sm t-muted">{text}</p>
    </div>
  );
}

function MarkChecker({ scale }: { scale: GradeScale }) {
  const [marks, setMarks] = useState('');
  const [max, setMax] = useState('100');
  const [tier, setTier] = useState<'None' | Tier>('None');
  const m = Number(marks);
  const x = Number(max);
  const valid = marks.trim() !== '' && Number.isFinite(m) && Number.isFinite(x) && x > 0 && m >= 0 && m <= x;
  const pct = valid ? (100 * m) / x : null;
  const grade = pct == null ? null : gradeFor(pct, { tier: tier === 'None' ? null : tier, scale });
  const plain = pct == null ? null : gradeFor(pct, { scale });
  return (
    <Card icon="hash" title="Check a mark" sub="See the grade a mark earns on the current boundaries">
      <div className="grid g-2col g-3">
        <TextField label="Marks" type="number" min={0} value={marks} onChange={setMarks} error={marks.trim() && !valid ? `Enter 0–${Number.isFinite(x) ? x : '…'}` : undefined} />
        <TextField label="Out of" type="number" min={1} value={max} onChange={setMax} />
      </div>
      <div className="mt-3">
        <span className="label">Entry tier</span>
        <Segment<'None' | Tier> items={[{ id: 'None', label: 'Untiered' }, { id: 'Extended', label: 'Extended' }, { id: 'Core', label: 'Core' }]} active={tier} onChange={setTier} />
      </div>
      <div className="mt-4 row g-3" aria-live="polite">
        {grade ? (
          <>
            <Badge tone={gradeTone(grade, scale)} lg>{grade}</Badge>
            <span className="t-sm">
              {pct!.toFixed(1)}%{tier !== 'None' && grade !== plain ? ` — ${plain} on the untiered scale, ${tier === 'Core' ? 'capped at C on Core' : 'below E is U on Extended'}` : ''}
            </span>
          </>
        ) : <span className="t-sm t-muted">Enter a mark to see its grade.</span>}
      </div>
    </Card>
  );
}

function BoundaryForm({ scale, onClose }: { scale: GradeScale; onClose: () => void }) {
  const confirm = useConfirm();
  const bands = orderedBoundaries(scale);
  const [rows, setRows] = useState<(GradeBoundary & { input: string })[]>(bands.map((b) => ({ ...b, input: String(b.minPercent) })));
  const [rules, setRules] = useState(scale.tierRules);
  const [regrade, setRegrade] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useApiMutation<Record<string, unknown>>('put', '/grading/scale/boundaries', {
    invalidate: ['/grading', '/academics', '/students', '/syllabuses'], success: 'Grade boundaries updated', error: false, onSuccess: onClose,
  });
  useEffect(() => { if (save.error) setErrors((e) => ({ ...e, ...fieldErrors(save.error) })); }, [save.error]);
  const grades = bands.map((b) => ({ value: b.grade, label: b.grade }));

  const submit = async () => {
    const e: Record<string, string> = {};
    rows.forEach((r, i) => {
      const v = Number(r.input);
      if (r.input.trim() === '' || !Number.isFinite(v) || v < 0 || v > 100) e[r.grade] = '0–100';
      else if (i > 0 && v >= Number(rows[i - 1].input)) e[r.grade] = `Must be below ${rows[i - 1].grade}`;
    });
    const last = rows[rows.length - 1];
    if (last && Number(last.input) !== 0) e[last.grade] = `${last.grade} starts at 0`;
    for (const t of ['Core', 'Extended'] as Tier[]) {
      const hi = bands.findIndex((b) => b.grade === rules[t].highest);
      const lo = bands.findIndex((b) => b.grade === rules[t].lowest);
      if (hi > lo) e[t] = 'Highest must be above lowest';
      if (lo === bands.length - 1) e[t] = 'Lowest cannot be the ungraded band';
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    const ok = await confirm({
      title: 'Update grade boundaries?',
      body: regrade
        ? 'New marks are graded with these boundaries, and this academic year’s saved marks and term results are re-graded now.'
        : 'New and edited marks are graded with these boundaries. Grades already saved stay as they are unless you choose to re-grade.',
      confirmLabel: 'Update boundaries',
    });
    if (!ok) return;
    save.mutate({ boundaries: rows.map((r) => ({ grade: r.grade, minPercent: Number(r.input), description: r.description })), tierRules: rules, regrade });
  };

  return (
    <Modal open onClose={onClose} title="Edit grade boundaries" sub={scale.name} size="wide" busy={save.isPending}
      foot={<><Button onClick={onClose} disabled={save.isPending}>Cancel</Button><Button variant="primary" onClick={submit} loading={save.isPending}>Save boundaries</Button></>}>
      <Banner tone="neutral" icon="info">Set each grade’s minimum percentage. Each grade must start below the one above it, and U starts at 0%. Check the thresholds Cambridge publishes for the exam series you are preparing for.</Banner>
      {save.error && !Object.keys(fieldErrors(save.error)).length && <div className="mt-3"><InlineError error={save.error} /></div>}
      <div className="mt-3">
        <DataTable
          compact
          stack={false}
          rows={rows}
          rowKey={(r) => r.grade}
          columns={[
            { key: 'grade', label: 'Grade', width: '80px', render: (r) => <Badge tone={gradeTone(r.grade, scale)}>{r.grade}</Badge> },
            {
              key: 'min', label: 'Minimum %', render: (r, i) => (
                <span className="col">
                  <input className="input" style={{ maxWidth: 110 }} type="number" min={0} max={100} step="0.5" value={r.input} aria-label={`Minimum percent for ${r.grade}`}
                    aria-invalid={!!errors[r.grade] || undefined} disabled={i === rows.length - 1}
                    onChange={(e) => { const v = e.target.value; setRows((x) => x.map((y) => (y.grade === r.grade ? { ...y, input: v } : y))); setErrors((x) => ({ ...x, [r.grade]: '' })); }} />
                  {errors[r.grade] && <span className="ac-err" role="alert">{errors[r.grade]}</span>}
                </span>
              ),
            },
            {
              key: 'description', label: 'Description', render: (r) => (
                <input className="input" maxLength={80} value={r.description ?? ''} aria-label={`Description for ${r.grade}`}
                  onChange={(e) => { const v = e.target.value; setRows((x) => x.map((y) => (y.grade === r.grade ? { ...y, description: v } : y))); }} />
              ),
            },
          ]}
        />
      </div>
      <div className="formsection mt-3">
        <div className="formsection__title">Tier rules</div>
        <div className="grid g-2col g-3">
          {(['Extended', 'Core'] as Tier[]).map((t) => (
            <div key={t} className="grid g-2col g-2">
              <SelectField label={`${t}: highest grade`} value={rules[t].highest} onChange={(v) => setRules((x) => ({ ...x, [t]: { ...x[t], highest: v } }))} options={grades} error={errors[t]} />
              <SelectField label={`${t}: lowest grade`} value={rules[t].lowest} onChange={(v) => setRules((x) => ({ ...x, [t]: { ...x[t], lowest: v } }))} options={grades} />
            </div>
          ))}
        </div>
        <p className="t-micro t-muted mt-2">Cambridge rules: Extended A*–E, Core C–G (capped at C). Below the lowest grade a candidate is U.</p>
      </div>
      <div className="mt-3">
        <Checkbox checked={regrade} onChange={setRegrade} label="Re-grade this academic year’s saved marks and term results with the new boundaries" />
      </div>
    </Modal>
  );
}
