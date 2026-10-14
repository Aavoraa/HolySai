import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import {
  Badge, Button, Card, DataTable, ErrorState, FilterSelect, Page, PageHead, Pagination, SearchInput, StudentLink, Toolbar,
} from '@/components/ui';
import { AssignDeviceModal, GpsStatusBadge, useUnassign } from '@/components/tracking/devices';
import type { DeviceAssignment } from '@/api/types';
import { fmt } from '@/lib/format';

export default function DeviceAssignmentsPage() {
  const { can } = useAuth();
  const manage = can('tracking.manage');
  const list = useListParams({ sort: 'assigned', dir: 'desc', pageSize: 25 }, ['status']);
  const status = list.filters.status === 'all' ? undefined : list.filters.status || 'active';
  const rows = usePagedQuery<DeviceAssignment>('/device-assignments', { ...list.query, status });
  const [assigning, setAssigning] = useState(false);
  const unassign = useUnassign();

  return (
    <Page>
      <PageHead
        title="Device Assignments"
        sub="Which student carries which GPS device. Ending an assignment keeps it here, with every location recorded while it was active."
        crumbs={[{ label: 'Safety & Transport' }, { label: 'Device Assignments' }]}
        actions={manage && <Button variant="primary" icon="qr" onClick={() => setAssigning(true)}>Assign device</Button>}
      />
      <Card flush>
        <Toolbar>
          <SearchInput value={list.q} onSearch={list.setQ} placeholder="Search student or device ID" />
          <FilterSelect label="Status" allLabel="Active" value={list.filters.status} onChange={(v) => list.setFilter('status', v)}
            options={[{ value: 'inactive', label: 'Ended' }, { value: 'all', label: 'All' }]} />
          {list.hasFilters && <Button size="sm" variant="quiet" onClick={list.clear}>Clear filters</Button>}
          {rows.data && <span className="t-xs t-muted">{rows.data.meta.total} {status === 'active' ? 'active assignments' : 'assignments'}</span>}
        </Toolbar>
        {rows.error ? <ErrorState error={rows.error} onRetry={() => rows.refetch()} /> : (
          <DataTable
            rows={rows.data?.rows}
            loading={rows.isLoading}
            rowKey={(r) => r.id}
            sort={list.sort}
            onSort={list.setSort}
            emptyText={status === 'active' ? 'No devices are assigned yet.' : 'No assignments match.'}
            columns={[
              { key: 'student', label: 'Student', render: (r) => <StudentLink id={r.studentId} name={r.studentName} meta={[r.admissionNo, r.grade ? `${r.grade}${r.section ?? ''}` : null].filter(Boolean).join(' · ')} /> },
              { key: 'device', label: 'Device', render: (r) => <span className="coord t-bold">{r.deviceCode}</span> },
              { key: 'assigned', label: 'Assigned', render: (r) => <span className="t-xs">{fmt.dateTime(r.assignedAt)}{r.assignedBy && <div className="t-muted">by {r.assignedBy}</div>}{r.notes && <div className="t-muted t-clip st-notes-cell">{r.notes}</div>}</span> },
              { key: 'unassigned', label: 'Ended', render: (r) => (r.unassignedAt ? <span className="t-xs">{fmt.dateTime(r.unassignedAt)}<div className="t-muted">{[r.unassignedBy && `by ${r.unassignedBy}`, r.unassignReason].filter(Boolean).join(' · ')}</div></span> : <span className="t-faint">—</span>) },
              { key: 'status', label: 'Status', sortable: false, render: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'} dot={r.status === 'active'}>{r.status === 'active' ? 'Active' : 'Ended'}</Badge> },
              { key: 'gps', label: 'GPS', sortable: false, render: (r) => (r.status === 'active' ? <GpsStatusBadge status={r.gpsStatus} seenAt={r.lastSeenAt} showSeen /> : <span className="t-faint">—</span>) },
              {
                key: 'a', label: '', sortable: false, className: 'num', render: (r) => (
                  <span className="row g-1 end">
                    {r.status === 'active' && <Button size="sm" variant="quiet" icon="mapPin" to={`/student-tracking/${r.studentId}`} aria-label={`Track ${r.studentName}`} />}
                    {manage && r.status === 'active' && (
                      <Button size="sm" onClick={() => unassign.run({ id: r.id, deviceCode: r.deviceCode!, admissionNo: r.admissionNo, studentName: r.studentName })}>Unassign</Button>
                    )}
                  </span>
                ),
              },
            ]}
          />
        )}
        <Pagination meta={rows.data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </Card>
      {assigning && <AssignDeviceModal onClose={() => setAssigning(false)} />}
    </Page>
  );
}
