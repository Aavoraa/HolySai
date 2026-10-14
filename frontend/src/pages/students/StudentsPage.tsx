import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import { api } from '@/api/client';
import {
  Badge, BulkBar, Button, Card, DataTable, ErrorState, FilterSelect, Icon, Kpi, Grid, Page, PageHead, Pagination, Risk,
  SearchInput, Status, StudentLink, Toolbar, useToast,
} from '@/components/ui';
import type { StudentRow } from '@/api/types';
import { StudentFormModal } from './StudentFormModal';

export function TrendCell({ v }: { v: number }) {
  const tone = v > 2 ? 'success' : v < -3 ? 'critical' : v < 0 ? 'warning' : 'muted';
  return (
    <span className="row g-2">
      <span className={`t-num t-bold t-${tone}`}>{v > 0 ? '+' : ''}{v}</span>
      <Icon name={v >= 0 ? 'arrowUp' : 'arrowDown'} size={12} />
    </span>
  );
}

export const TODAY_LABEL: Record<string, string> = { present: 'Present', absent: 'Absent', late: 'Late', leave: 'Leave', unmarked: 'Not marked' };

export default function StudentsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { campusParam } = useSchool();
  const { gradeNames, lookups } = useLookups();
  const list = useListParams({ sort: 'name', pageSize: 25 }, ['grade', 'risk', 'feeStatus', 'today', 'house']);
  const params = { ...list.query, ...campusParam };
  const q = usePagedQuery<StudentRow>('/students', params);
  const summary = useApiQuery<{ total: number; atRisk: number; developing: number; onTrack: number }>('/students/summary', campusParam);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // ?new=1 (dashboard quick action) opens the Add student form directly.
  const [sp] = useSearchParams();
  const [adding, setAdding] = useState(() => sp.get('new') === '1' && can('students.create'));
  const [exporting, setExporting] = useState(false);

  // Export the current filtered view (all pages) as CSV, built client-side from the API.
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: StudentRow[] = [];
      for (let page = 1; page < 50; page++) {
        const r = await api.getPaged<StudentRow>('/students', { ...params, page, pageSize: 200 });
        all.push(...r.rows);
        if (page >= r.meta.totalPages) break;
      }
      const cols: [string, (s: StudentRow) => unknown][] = [
        ['Admission No', (s) => s.admissionNo], ['Name', (s) => s.fullName], ['Grade', (s) => s.grade], ['Section', (s) => s.section],
        ['House', (s) => s.house], ['Campus', (s) => s.campusName], ['Attendance %', (s) => s.attendance], ['Average', (s) => s.average],
        ['Trend', (s) => s.trend], ['Risk', (s) => s.risk], ['Fees', (s) => s.feeStatus], ['Parent', (s) => s.parentName], ['Transport', (s) => s.busRoute ?? 'Own transport'],
      ];
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [cols.map((c) => esc(c[0])).join(','), ...all.map((s) => cols.map((c) => esc(c[1](s))).join(','))].join('\r\n');
      const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `students-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Exported ${all.length} students`, 'success', 'download');
    } catch (err) {
      toast((err as Error).message, 'critical');
    } finally {
      setExporting(false);
    }
  };

  const s = summary.data;

  return (
    <Page>
      <PageHead
        title="Students"
        sub="The student register. Every row opens the same Student 360 profile used everywhere else in the system."
        actions={
          <>
            <Button icon="download" onClick={exportCsv} loading={exporting}>Export</Button>
            {can('students.create') && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add student</Button>}
          </>
        }
      />
      <Grid cols="g-4col" className="mb-4">
        <Kpi icon="users" label="Students" value={s?.total ?? '—'} loading={summary.isLoading} onClick={() => list.clear()} />
        <Kpi icon="activity" label="On Track" value={s?.onTrack ?? '—'} tone="teal" loading={summary.isLoading} onClick={() => list.setFilter('risk', 'On Track')} />
        <Kpi icon="alert" label="Developing Risk" value={s?.developing ?? '—'} tone="amber" loading={summary.isLoading} onClick={() => list.setFilter('risk', 'Developing Risk')} />
        <Kpi icon="alert" label="At Risk" value={s?.atRisk ?? '—'} tone="critical" loading={summary.isLoading} onClick={() => list.setFilter('risk', 'At Risk')} />
      </Grid>
      <Card flush>
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search name or admission ID" />
          <FilterSelect label="Grade" value={list.filters.grade} onChange={(v) => list.setFilter('grade', v)} options={gradeNames} />
          <FilterSelect label="Risk band" value={list.filters.risk} onChange={(v) => list.setFilter('risk', v)} options={['On Track', 'Developing Risk', 'At Risk']} />
          <FilterSelect label="Today" value={list.filters.today} onChange={(v) => list.setFilter('today', v)}
            options={Object.entries(TODAY_LABEL).map(([value, label]) => ({ value, label }))} />
          {can('finance.read') && (
            <FilterSelect label="Fees" value={list.filters.feeStatus} onChange={(v) => list.setFilter('feeStatus', v)} options={['Paid', 'Partial', 'Pending', 'Overdue']} />
          )}
          <FilterSelect label="House" value={list.filters.house} onChange={(v) => list.setFilter('house', v)} options={lookups?.houses ?? []} />
          {list.hasFilters && <Button size="sm" variant="quiet" icon="x" onClick={list.clear}>Clear filters</Button>}
          <div className="spacer" />
          <span className="t-sm t-muted t-num" aria-live="polite">{q.data ? `${q.data.meta.total} students` : ''}</span>
        </Toolbar>
        <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
          {can('communication.send') && (
            <Button size="sm" icon="message" onClick={() => navigate(`/parent-communication?students=${[...selected].join(',')}`)}>Message parents</Button>
          )}
          {can('earlywarning.manage') && (
            <Button size="sm" icon="flag" onClick={() => navigate('/early-warning')}>Review in Early Warning</Button>
          )}
        </BulkBar>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={q.data?.rows}
            loading={q.isLoading || q.isPlaceholderData}
            rowKey={(r) => r.id}
            sort={list.sort}
            onSort={list.setSort}
            selectable
            selected={selected}
            onSelect={setSelected}
            onRowClick={(r) => navigate(`/student-360/${r.id}`)}
            emptyText={list.hasFilters ? 'No students match these filters. Try clearing a filter or searching by admission ID.' : 'No students yet. Use Add student to create the first record.'}
            columns={[
              { key: 'name', label: 'Student', render: (r) => <StudentLink id={r.id} name={r.fullName} meta={r.admissionNo} /> },
              { key: 'grade', label: 'Grade', render: (r) => `${r.grade ?? '—'} ${r.section ?? ''}` },
              { key: 'house', label: 'House', sortable: false, render: (r) => r.house ?? '—' },
              { key: 'today', label: 'Today', sortable: false, render: (r) => <Badge tone={toneForToday(r.today)} dot>{TODAY_LABEL[r.today] ?? r.today}</Badge> },
              {
                key: 'attendance', label: 'Attendance', className: 'num', render: (r) => (
                  <span className={`t-num t-bold ${r.attendance == null ? 't-faint' : r.attendance < 85 ? 't-critical' : r.attendance < 90 ? 't-warning' : ''}`}>
                    {r.attendance == null ? '—' : `${r.attendance}%`}
                  </span>
                ),
              },
              { key: 'average', label: 'Average', className: 'num', render: (r) => <span className="t-num">{r.average ?? '—'}</span> },
              { key: 'trend', label: 'Trend', render: (r) => <TrendCell v={r.trend} /> },
              { key: 'risk', label: 'Risk', render: (r) => <Risk value={r.risk} /> },
              ...(can('finance.read') ? [{ key: 'feeStatus', label: 'Fees', render: (r: StudentRow) => <Status value={r.feeStatus} /> }] : []),
              { key: 'transport', label: 'Transport', sortable: false, render: (r) => <span className="t-xs t-muted">{r.busRoute ?? 'Own transport'}</span> },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      {adding && (
        <StudentFormModal
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            navigate(`/student-360/${id}`);
          }}
        />
      )}
    </Page>
  );
}

export function toneForToday(v: string) {
  return v === 'present' ? 'success' : v === 'late' ? 'warning' : v === 'absent' ? 'critical' : v === 'leave' ? 'info' : 'neutral';
}
