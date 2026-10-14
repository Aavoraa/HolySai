import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { useLookups } from '@/hooks/useLookups';
import {
  Badge, Button, Card, DataTable, ErrorState, FilterSelect, Page, PageHead, Pagination, SearchInput, Segment, StudentLink, Toolbar, useToast,
} from '@/components/ui';
import { errorMessage } from '@/components/ui/states';
import { GateEventModal, gradeOf, TimeCell, todayIso } from './shared';
import { GATES, type GateEventRow, type GateLogRow } from './types';

type View = 'students' | 'scans';

export default function GateLogPage() {
  const { can } = useAuth();
  const toast = useToast();
  const { campusParam } = useSchool();
  const { classOptions } = useLookups();
  const [sp, setSp] = useSearchParams();
  const view = (sp.get('view') as View) || 'students';
  const setView = (v: View) => setSp((p) => {
    const n = new URLSearchParams();
    if (v !== 'students') n.set('view', v);
    if (p.get('date')) n.set('date', p.get('date')!);
    return n;
  });
  const [recording, setRecording] = useState(false);
  const [exporting, setExporting] = useState(false);

  const list = useListParams(
    view === 'students' ? { sort: 'name', pageSize: 25 } : { sort: 'time', dir: 'desc', pageSize: 50 },
    ['date', 'status', 'classId', 'direction', 'gate', 'method'],
  );
  const date = list.filters.date || todayIso();
  const common = { q: list.query.q, page: list.query.page, pageSize: list.query.pageSize, sort: list.query.sort, dir: list.query.dir, date, ...campusParam };
  const students = usePagedQuery<GateLogRow>(view === 'students' ? '/gate/log' : null, {
    ...common, status: list.filters.status || undefined, classId: list.filters.classId || undefined,
  });
  const scans = usePagedQuery<GateEventRow>(view === 'scans' ? '/gate/events' : null, {
    ...common, direction: list.filters.direction || undefined, gate: list.filters.gate || undefined, method: list.filters.method || undefined,
  });
  const q = view === 'students' ? students : scans;

  const exportLog = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ date, ...(campusParam.campusId ? { campusId: campusParam.campusId } : {}) });
      await api.download(`/gate/events/export?${params}`, `gate-log-${date}.csv`);
      toast('Gate log exported', 'success', 'download');
    } catch (err) {
      toast(errorMessage(err), 'critical');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Page>
      <PageHead
        title="Gate Entry / Exit"
        sub="The raw log behind the Smart Gate dashboard. Every scan, with the method used."
        actions={
          <>
            <Button icon="download" onClick={exportLog} loading={exporting}>Export log</Button>
            {can('safety.manage') && <Button variant="primary" icon="scan" onClick={() => setRecording(true)}>Record entry / exit</Button>}
          </>
        }
      />
      <Card flush>
        <Toolbar>
        <Segment<View> items={[{ id: 'students', label: 'By student' }, { id: 'scans', label: 'All scans' }]} active={view} onChange={setView} />
        <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search student or admission no." />
        <input className="input st-date" type="date" aria-label="Date" value={date} max={todayIso()}
          onChange={(e) => list.setFilter('date', e.target.value === todayIso() ? '' : e.target.value)} />
        {view === 'students' ? (
          <>
            <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={['Inside', 'Exited', 'Not arrived']} />
            <FilterSelect label="Class" value={list.filters.classId} onChange={(v) => list.setFilter('classId', v)} options={classOptions(campusParam.campusId)} />
          </>
        ) : (
          <>
            <FilterSelect label="Direction" value={list.filters.direction} onChange={(v) => list.setFilter('direction', v)}
              options={[{ value: 'in', label: 'Entry' }, { value: 'out', label: 'Exit' }]} />
            <FilterSelect label="Gate" value={list.filters.gate} onChange={(v) => list.setFilter('gate', v)} options={GATES} />
            <FilterSelect label="Method" value={list.filters.method} onChange={(v) => list.setFilter('method', v)} options={['RFID', 'Face', 'QR', 'Manual']} />
          </>
        )}
        {list.hasFilters && <Button variant="quiet" size="sm" onClick={list.clear}>Clear</Button>}
        </Toolbar>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : view === 'students' ? (
          <DataTable
            rows={students.data?.rows}
            loading={students.isLoading || students.isFetching}
            rowKey={(r) => r.id}
            sort={list.sort}
            onSort={list.setSort}
            emptyText="No students match these filters."
            columns={[
              { key: 'name', label: 'Student', render: (r) => <StudentLink id={r.id} name={r.fullName} meta={[r.admissionNo, gradeOf(r.grade, r.section)].filter(Boolean).join(' · ')} /> },
              { key: 'entry', label: 'Entry', render: (r) => <TimeCell value={r.firstIn} /> },
              { key: 'method', label: 'Method', sortable: false, render: (r) => r.entryMethod ? <Badge>{r.entryMethod}</Badge> : <span className="t-faint">—</span> },
              { key: 'exit', label: 'Exit', render: (r) => <span>{r.lastOut ? <><TimeCell value={r.lastOut} /> <span className="t-micro t-muted">{r.exitGate}</span></> : <span className="t-faint">—</span>}</span> },
              {
                key: 'status', label: 'Status',
                render: (r) => <Badge dot tone={r.status === 'Inside' ? 'success' : r.status === 'Exited' ? 'neutral' : 'warning'}>{r.status === 'Inside' ? 'Inside campus' : r.status}</Badge>,
              },
              {
                key: 'notify', label: 'Parent notified', sortable: false,
                render: (r) => r.status === 'Not arrived' ? <Badge tone="neutral">No scan yet</Badge>
                  : <span className="row g-1 wrap">
                    {r.arrivalNotified && <Badge tone="success" icon="check">Arrival sent</Badge>}
                    {r.exitNotified && <Badge tone="info" icon="check">Exit sent</Badge>}
                    {!r.arrivalNotified && !r.exitNotified && <span className="t-faint">—</span>}
                  </span>,
              },
            ]}
          />
        ) : (
          <DataTable
            rows={scans.data?.rows}
            loading={scans.isLoading || scans.isFetching}
            rowKey={(r) => r.id}
            sort={list.sort}
            onSort={list.setSort}
            emptyText="No scans recorded for these filters."
            columns={[
              { key: 'time', label: 'Time', render: (r) => <TimeCell value={r.occurredAt} /> },
              { key: 'name', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.fullName} meta={[r.admissionNo, gradeOf(r.grade, r.section)].filter(Boolean).join(' · ')} /> },
              { key: 'direction', label: 'Direction', sortable: false, render: (r) => <Badge tone={r.direction === 'in' ? 'success' : 'info'} icon={r.direction === 'in' ? 'door' : 'logout'}>{r.direction === 'in' ? 'Entry' : 'Exit'}</Badge> },
              { key: 'gate', label: 'Gate' },
              { key: 'method', label: 'Method', render: (r) => <Badge>{r.method}</Badge> },
              { key: 'notified', label: 'Parent notified', sortable: false, render: (r) => r.parentNotifiedAt ? <Badge tone="success" icon="check">Sent <TimeCell value={r.parentNotifiedAt} /></Badge> : <span className="t-faint">Already notified today</span> },
            ]}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>

      {recording && <GateEventModal onClose={() => setRecording(false)} />}
    </Page>
  );
}
