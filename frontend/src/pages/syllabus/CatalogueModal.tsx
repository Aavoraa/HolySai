import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import { useLookups } from '@/hooks/useLookups';
import { Badge, Button, Checkbox, Chips, DataTable, ErrorState, Icon, InlineError, Modal, SearchInput, SelectField, Toolbar } from '@/components/ui';
import { GradeDocs, GradePicker, fieldErrors, type CambridgeDoc, type GradeDoc } from './shared';

interface CatalogueRow {
  code: string; subject: string; grading: 'A*-G' | '9-1'; documents: CambridgeDoc[]; subjectPage: string | null; byGrade: GradeDoc[];
  school: { id: string; title: string; gradeLevels: number[]; isActive: boolean } | null;
}
interface Catalogue { examYears: Record<string, number>; rows: CatalogueRow[] }

/**
 * Every Cambridge IGCSE syllabus (database/data/cambridge-igcse-syllabuses.csv), with the
 * syllabus document each grade is examined on, and adding one to the school.
 */
export function CatalogueModal({ onClose }: { onClose: () => void }) {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [grading, setGrading] = useState<'A*-G' | '9-1' | ''>('A*-G');
  const [adding, setAdding] = useState<CatalogueRow | null>(null);
  const cat = useApiQuery<Catalogue>('/syllabus-catalogue', { q: q || undefined, grading: grading || undefined });
  const ey = cat.data?.examYears;

  return (
    <Modal open onClose={onClose} size="wide" title="Cambridge IGCSE catalogue"
      sub={ey ? `Grade 10 sits its exams in ${ey[10]}, Grade 9 in ${ey[9]} — each grade is linked to the syllabus for its exam year.` : 'Every Cambridge IGCSE syllabus with its published documents.'}
      foot={<Button onClick={onClose}>Close</Button>}>
      <Toolbar>
        <SearchInput value={q} onSearch={setQ} placeholder="Search by subject or code" />
        <Chips items={[{ id: 'A*-G', label: 'A*–G' }, { id: '9-1', label: '9–1' }, { id: '', label: 'All' }]} active={grading} onChange={(v) => setGrading(v as typeof grading)} />
      </Toolbar>
      {cat.error ? <ErrorState error={cat.error} onRetry={() => cat.refetch()} /> : (
        <DataTable<CatalogueRow>
          rows={cat.data?.rows}
          loading={cat.isLoading}
          rowKey={(r) => r.code}
          emptyText="No Cambridge IGCSE syllabus matches."
          columns={[
            { key: 'code', label: 'Code', sortable: false, render: (r) => <span className="t-bold t-num">{r.code}</span> },
            {
              key: 'subject', label: 'Syllabus', sortable: false, render: (r) => (
                <>
                  <span className="t-bold">{r.subject}</span>{' '}
                  {r.grading === '9-1' && <Badge tone="neutral">9–1</Badge>}
                  {r.subjectPage && (
                    <div className="t-micro"><a href={r.subjectPage} target="_blank" rel="noopener noreferrer">Subject page <Icon name="external" size={11} /></a></div>
                  )}
                </>
              ),
            },
            { key: 'docs', label: 'Syllabus by grade', sortable: false, render: (r) => <GradeDocs compact byGrade={r.byGrade} subjectPage={r.subjectPage} /> },
            {
              key: 'a', label: '', sortable: false, className: 'num', render: (r) => r.school
                ? <Button size="sm" variant="ghost" iconRight="chevronRight" to={`/syllabus/${r.school.id}`}>In school</Button>
                : r.grading === '9-1'
                  ? <span className="t-micro t-muted" title="The school grade scale is A*–G">A*–G only</span>
                  : can('grading.manage') && <Button size="sm" icon="plus" onClick={() => setAdding(r)}>Add</Button>,
            },
          ]}
        />
      )}
      {adding && <AddFromCatalogue row={adding} onClose={() => setAdding(null)} />}
    </Modal>
  );
}

function AddFromCatalogue({ row, onClose }: { row: CatalogueRow; onClose: () => void }) {
  const { lookups } = useLookups();
  const navigate = useNavigate();
  const [subjectId, setSubjectId] = useState('');
  const [gradeLevels, setGradeLevels] = useState<number[]>([9, 10]);
  const [tiered, setTiered] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = useApiMutation<Record<string, unknown>, { id: string }>('post', '/syllabus-catalogue/add', {
    invalidate: ['/syllabuses', '/syllabus-catalogue'], success: `${row.subject} added to the school`, error: false,
    onSuccess: (r) => navigate(`/syllabus/${r.data.id}`),
  });
  useEffect(() => { if (add.error) setErrors(fieldErrors(add.error)); }, [add.error]);
  const submit = () => {
    const e: Record<string, string> = {};
    if (!subjectId) e.subjectId = 'Choose the school subject it belongs to';
    if (!gradeLevels.length) e.gradeLevels = 'Choose at least one grade';
    setErrors(e);
    if (!Object.keys(e).length) add.mutate({ code: row.code, subjectId, gradeLevels, tiered });
  };
  return (
    <Modal open onClose={onClose} title={`Add ${row.code} ${row.subject}`} sub="Papers and topics are added afterwards, from the syllabus document." busy={add.isPending}
      foot={<><Button onClick={onClose} disabled={add.isPending}>Cancel</Button><Button variant="primary" onClick={submit} loading={add.isPending}>Add syllabus</Button></>}>
      {add.error && !Object.keys(fieldErrors(add.error)).length && <div className="mb-4"><InlineError error={add.error} /></div>}
      <div className="col g-3">
        <SelectField label="School subject" required value={subjectId} onChange={setSubjectId} placeholder="Choose a subject" error={errors.subjectId}
          options={(lookups?.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <GradePicker value={gradeLevels} onChange={setGradeLevels} error={errors.gradeLevels} />
        <Checkbox checked={tiered} onChange={setTiered} label="Tiered — students are entered for Core (C–G) or Extended (A*–E). Check the syllabus document." />
      </div>
    </Modal>
  );
}
