import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import {
  Badge, Banner, Button, Card, DataTable, ErrorState, FilterSelect, InlineError, Meter, Modal, Page, PageHead, Pagination, Person,
  SearchInput, SelectField, TextField, Toolbar,
} from '@/components/ui';
import { plural, serverFieldErrors } from './shared';

interface ClassRow {
  id: string; name: string; section: string; gradeLevel: number; campusName: string; room: string | null;
  classTeacherId: string | null; classTeacher: string | null; students: number; marked: number; present: number;
  attendance: number | null; register: string;
}

const REGISTER_TONE: Record<string, string> = { Marked: 'success', Partial: 'warning', 'Not marked': 'critical', 'No students': 'neutral' };

export default function ClassesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { campusParam, campus } = useSchool();
  const { lookups } = useLookups();
  const list = useListParams({ sort: 'name', pageSize: 25 }, ['grade', 'register']);
  const q = usePagedQuery<ClassRow>('/academics/classes', { ...list.query, ...campusParam });
  const summary = useApiQuery<{ sections: number; classes: number; withoutClassTeacher: number }>('/academics/classes/summary', campusParam);
  const [editing, setEditing] = useState<ClassRow | null>(null);
  const canEdit = can('academics.manage') && can('students.read');

  const grades = useMemo(() => {
    const set = new Set((lookups?.classes ?? []).filter((c) => !campusParam.campusId || c.campusId === campusParam.campusId).map((c) => c.gradeLevel));
    return [...set].sort((a, b) => a - b).map((g) => ({ value: String(g), label: `Grade ${g}` }));
  }, [lookups, campusParam.campusId]);

  const s = summary.data;
  const where = campus && campusParam.campusId ? `at ${campus.shortName}` : 'across the campuses';
  const sub = s
    ? `${s.sections} sections ${where}, each with a class teacher and a home room. Select a class to open its register.`
    : 'Sections, class teachers and home rooms.';

  return (
    <Page>
      <PageHead title="Classes" sub={sub} />
      {s && s.withoutClassTeacher > 0 && canEdit && (
        <div className="mb-4">
          <Banner tone="warning" icon="alert">
            <strong>{plural(s.withoutClassTeacher, 'section')} without a class teacher.</strong> Use Edit on a class to assign one — the class teacher marks the register.
          </Banner>
        </div>
      )}
      <Card flush>
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search class or teacher" />
          <FilterSelect label="Grade" value={list.filters.grade} onChange={(v) => list.setFilter('grade', v)} options={grades} />
          <FilterSelect label="Register" value={list.filters.register} onChange={(v) => list.setFilter('register', v)} options={['Marked', 'Partial', 'Not marked']} />
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <DataTable
            rows={q.data?.rows}
            loading={q.isLoading}
            rowKey={(r) => r.id}
            sort={list.sort}
            onSort={list.setSort}
            onRowClick={(r) => navigate(`/attendance?section=${r.id}`)}
            emptyText={list.hasFilters ? 'No classes match these filters.' : 'No sections are set up for this year.'}
            columns={[
              { key: 'name', label: 'Class', render: (r) => <><span className="t-bold">{r.name}</span>{!campusParam.campusId && <div className="t-micro t-muted">{r.campusName}</div>}</> },
              { key: 'students', label: 'Students', className: 'num', render: (r) => <span className="t-num">{r.students}</span> },
              { key: 'teacher', label: 'Class teacher', render: (r) => (r.classTeacher ? <Person name={r.classTeacher} /> : <span className="t-faint">Not assigned</span>) },
              { key: 'room', label: 'Room', render: (r) => r.room ?? '—' },
              {
                key: 'attendance', label: 'Attendance today', render: (r) => (r.attendance == null
                  ? <span className="t-faint">—</span>
                  : <Meter label="" value={r.attendance} right={`${r.attendance}%`} tone={r.attendance < 90 ? 'amber' : 'teal'} />),
              },
              { key: 'register', label: 'Register', sortable: false, render: (r) => <Badge tone={REGISTER_TONE[r.register] ?? 'neutral'}>{r.register}</Badge> },
              {
                key: 'a', label: '', sortable: false, className: 'num',
                render: (r: ClassRow) => (
                  <span className="ac-links" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" icon="calendar" to={`/timetable?section=${r.id}`} aria-label={`Timetable for ${r.name}`}>Timetable</Button>
                    <Button size="sm" icon="fileText" to={`/homework?sectionId=${r.id}`} aria-label={`Homework for ${r.name}`}>Homework</Button>
                    {canEdit && <Button size="sm" icon="settings" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`}>Edit</Button>}
                  </span>
                ),
              },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      {editing && <EditSectionModal row={editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}

function EditSectionModal({ row, onClose }: { row: ClassRow; onClose: () => void }) {
  const { lookups } = useLookups();
  const [teacher, setTeacher] = useState(row.classTeacherId ?? '');
  const [room, setRoom] = useState(row.room ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useApiMutation<{ classTeacherId: string | null; room: string | null }>('put', `/academics/sections/${row.id}`, {
    invalidate: ['/academics/classes', '/academics/sections', '/lookups'], success: `${row.name} updated`, onSuccess: onClose, error: false,
  });
  useEffect(() => { if (save.error) setErrors(serverFieldErrors(save.error)); }, [save.error]);
  const teachers = (lookups?.staff ?? []).filter((s) => s.employeeType === 'teaching').map((s) => ({ value: s.id, label: `${s.fullName} · ${s.designation}` }));

  const submit = () => {
    if (room.length > 40) { setErrors({ room: 'Use 40 characters or fewer' }); return; }
    save.mutate({ classTeacherId: teacher || null, room: room.trim() || null });
  };

  return (
    <Modal open onClose={onClose} busy={save.isPending} title={`Edit ${row.name}`} sub={`${row.students} students`}
      foot={<><Button onClick={onClose} disabled={save.isPending}>Cancel</Button><Button variant="primary" onClick={submit} loading={save.isPending}>Save</Button></>}>
      {save.error && !Object.keys(serverFieldErrors(save.error)).length && <div className="mb-3"><InlineError error={save.error} /></div>}
      <div className="col g-3">
        <SelectField label="Class teacher" value={teacher} onChange={setTeacher} options={teachers} placeholder="Not assigned" error={errors.classTeacherId}
          hint="Must be a teacher at the same campus. The class teacher can mark this register and sees these students." />
        <TextField label="Home room" value={room} onChange={setRoom} maxLength={40} error={errors.room} placeholder="R-204" />
      </div>
    </Modal>
  );
}
