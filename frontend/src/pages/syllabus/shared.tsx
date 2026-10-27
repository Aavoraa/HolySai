/** Shared types, forms and helpers for the Cambridge IGCSE syllabus screens. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiMutation } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import { Badge, Banner, Button, Checkbox, InlineError, Modal, SelectField, TextArea, TextField } from '@/components/ui';
import { ApiError } from '@/api/client';

export type ComponentTier = 'Core' | 'Extended' | 'All';
export type CoverageStatus = 'Not started' | 'In progress' | 'Covered';

export interface SyllabusRow {
  id: string; syllabusCode: string | null; title: string; stage: string; awardingBody: string; examSeriesYears: string | null;
  tiered: boolean; grading: string; isActive: boolean; subjectId: string; subjectCode: string; subject: string;
  topics: number; sections: number; covered: number; inProgress: number; entries: number; coreEntries: number; students: number;
  coveragePct: number | null; componentCount: number;
  components: { id: string; paperNo: string; name: string; tier: ComponentTier; maxMarks: number | null; weightingPercent: number | null }[];
}

export interface SyllabusComponent {
  id: string; paperNo: string; name: string; tier: ComponentTier; durationMinutes: number | null; maxMarks: number | null;
  weightingPercent: number | null; assessmentType: string; optionGroup: string | null; notes: string | null; sortOrder: number; assessments: number;
}
export interface CoverageCell { status: CoverageStatus; coveredOn: string | null; teacher: string | null; notes: string | null; updatedAt: string }
export interface SyllabusTopic {
  id: string; unitNo: number; code: string | null; title: string; subtopics: string | null; tier: ComponentTier;
  plannedHours: number | null; plannedWeeks: number | null; sortOrder: number; coverage: Record<string, CoverageCell>;
}
export interface SectionCoverage { id: string; label: string; gradeLevel: number; campus: string; campusId: string; students: number; covered: number; inProgress: number; pct: number | null }
export interface SyllabusDetail extends Omit<SyllabusRow, 'components' | 'topics' | 'sections' | 'covered' | 'inProgress' | 'entries' | 'coreEntries' | 'students' | 'coveragePct' | 'componentCount'> {
  notes: string | null; updatedAt: string;
  components: SyllabusComponent[];
  topics: SyllabusTopic[];
  sections: SectionCoverage[];
  coverage: { slots: number; covered: number; inProgress: number; pct: number | null };
  entries: { students: number; entered: number; extended: number; core: number };
  componentWeightTotal: number;
}
export interface EntryRow {
  id: string; admissionNo: string; fullName: string; section: string; sectionId: string; campus: string;
  entryId: string | null; tier: 'Core' | 'Extended' | null; examSeries: string | null; updatedAt: string | null; updatedBy: string | null;
}

export const COVERAGE_TONE: Record<CoverageStatus, string> = { Covered: 'success', 'In progress': 'warning', 'Not started': 'neutral' };
export const TIER_TONE: Record<ComponentTier, string> = { Extended: 'info', Core: 'warning', All: 'neutral' };
export const TYPE_LABEL: Record<string, string> = { written: 'Written', practical: 'Practical', coursework: 'Coursework', oral: 'Oral', listening: 'Listening' };

export function TierBadge({ tier }: { tier: ComponentTier | null | undefined }) {
  if (!tier) return <span className="t-faint">—</span>;
  return <Badge tone={TIER_TONE[tier]}>{tier === 'All' ? 'All candidates' : tier}</Badge>;
}

export function minutes(m: number | null) {
  if (!m) return '—';
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}

export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(err.fieldErrors)) out[k.split('.').pop()!] = v;
  return out;
}

/** Lower grades follow Cambridge Primary / Lower Secondary — explained on every IGCSE screen. */
export function StageBanner() {
  return (
    <Banner tone="neutral" icon="graduation">
      <strong>Grades 9–10 follow Cambridge IGCSE syllabuses.</strong> Grades 1–8 follow Cambridge Primary and Lower Secondary — see{' '}
      <Link to="/curriculum">Curriculum</Link> and <Link to="/objectives">Cambridge Objectives</Link>. Every mark in the school is reported on the
      same Cambridge IGCSE letters (A* to G, U below G) — see the <Link to="/grading">Grading Scheme</Link>.
    </Banner>
  );
}

// ---------------------------------------------------------------------------
// Syllabus form (grading.manage)
// ---------------------------------------------------------------------------
export function SyllabusForm({ initial, onClose, onSaved }: { initial?: SyllabusDetail | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const { lookups } = useLookups();
  const [f, setF] = useState({
    subjectId: initial?.subjectId ?? '', syllabusCode: initial?.syllabusCode ?? '', title: initial?.title ?? '', stage: initial?.stage ?? 'IGCSE',
    awardingBody: initial?.awardingBody ?? 'Cambridge International', examSeriesYears: initial?.examSeriesYears ?? '', tiered: initial?.tiered ?? false,
    notes: initial?.notes ?? '', isActive: initial?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); };
  const save = useApiMutation<Record<string, unknown>, { id: string }>(initial ? 'put' : 'post', initial ? `/syllabuses/${initial.id}` : '/syllabuses', {
    invalidate: ['/syllabuses'], success: initial ? 'Syllabus updated' : 'Syllabus added', error: false,
    onSuccess: (r) => { onSaved?.(r.data.id); onClose(); },
  });
  useEffect(() => { if (save.error) setErrors(fieldErrors(save.error)); }, [save.error]);
  const submit = () => {
    const e: Record<string, string> = {};
    if (!f.subjectId) e.subjectId = 'Choose a subject';
    if (f.title.trim().length < 3) e.title = 'Enter the syllabus title';
    if (f.syllabusCode.trim() && !/^[0-9A-Z]{3,6}$/.test(f.syllabusCode.trim())) e.syllabusCode = 'Use the 4-digit Cambridge code, e.g. 0580';
    setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate({
      subjectId: f.subjectId, syllabusCode: f.syllabusCode.trim() || null, title: f.title.trim(), stage: f.stage.trim() || 'IGCSE',
      awardingBody: f.awardingBody.trim() || 'Cambridge International', examSeriesYears: f.examSeriesYears.trim() || null,
      tiered: f.tiered, notes: f.notes.trim() || null, isActive: f.isActive,
    });
  };
  return (
    <Modal open onClose={onClose} title={initial ? 'Edit syllabus' : 'Add syllabus'} size="wide" busy={save.isPending}
      foot={<><Button onClick={onClose} disabled={save.isPending}>Cancel</Button><Button variant="primary" onClick={submit} loading={save.isPending}>{initial ? 'Save' : 'Add syllabus'}</Button></>}>
      {save.error && !Object.keys(fieldErrors(save.error)).length && <div className="mb-4"><InlineError error={save.error} /></div>}
      <div className="grid g-2col g-3">
        <SelectField label="Subject" required value={f.subjectId} onChange={set('subjectId')} placeholder="Choose a subject" error={errors.subjectId}
          options={(lookups?.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <TextField label="Cambridge syllabus code" value={f.syllabusCode} onChange={(v) => set('syllabusCode')(v.toUpperCase())} error={errors.syllabusCode} placeholder="0580" maxLength={6}
          hint="Leave blank for a school-assessed subject." />
        <TextField label="Title" required value={f.title} onChange={set('title')} error={errors.title} placeholder="Cambridge IGCSE Mathematics" maxLength={160} />
        <TextField label="Exam series years" value={f.examSeriesYears} onChange={set('examSeriesYears')} error={errors.examSeriesYears} placeholder="2025-2027" maxLength={40} />
        <TextField label="Stage" value={f.stage} onChange={set('stage')} maxLength={40} />
        <TextField label="Awarding body" value={f.awardingBody} onChange={set('awardingBody')} maxLength={80} />
      </div>
      <div className="row g-4 mt-3 wrap">
        <Checkbox checked={f.tiered} onChange={set('tiered')} label="Tiered — students are entered for Core (C–G) or Extended (A*–E)" />
        <Checkbox checked={f.isActive} onChange={set('isActive')} label="Active" />
      </div>
      <div className="mt-3">
        <TextArea label="Notes" value={f.notes} onChange={set('notes')} rows={3} maxLength={2000} hint="E.g. which papers Core and Extended candidates take." />
      </div>
    </Modal>
  );
}
