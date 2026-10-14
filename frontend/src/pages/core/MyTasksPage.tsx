import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { Badge, Banner, Button, Card, DataTable, ErrorState, Flow, Modal, Page, PageHead, Pagination, Segment, Status, useConfirm, type Column } from '@/components/ui';
import type { TaskItem } from '@/api/types';
import { cx, fmt } from '@/lib/format';

const DAY = 86_400_000;

/** Days from today until the due date (negative when past). */
function daysUntil(d: string | null): number | null {
  if (!d) return null;
  const due = new Date(d);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / DAY);
}

function DueCell({ r }: { r: TaskItem }) {
  if (!r.dueOn) return <span className="t-faint">—</span>;
  if (r.status === 'Completed') return <span className="t-muted">{fmt.dateShort(r.dueOn)}</span>;
  if (r.overdue) return <Badge tone="critical" icon="alert">Overdue · {fmt.dateShort(r.dueOn)}</Badge>;
  const d = daysUntil(r.dueOn);
  if (d === 0) return <Badge tone="warning" icon="clock">Due today</Badge>;
  if (d != null && d > 0 && d <= 3) return <Badge tone="caution" icon="clock">Due {fmt.dateShort(r.dueOn)}</Badge>;
  return <span className="t-sm">{fmt.dateShort(r.dueOn)}</span>;
}

export default function MyTasksPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [policy, setPolicy] = useState(false);
  const list = useListParams({ pageSize: 25 }, ['status']);
  const status = list.filters.status || 'open';
  const q = usePagedQuery<TaskItem>('/tasks', { page: list.page, pageSize: list.pageSize, status, q: list.q || undefined });
  const update = useApiMutation<{ id: string; status: string }>('patch', (v) => `/tasks/${v.id}`, {
    invalidate: ['/tasks', '/notifications/counts'],
    body: (v) => ({ status: v.status }),
    success: (_r, v) => (v.status === 'Completed' ? 'Task marked complete' : 'Task reopened'),
  });
  const isFamily = user?.role.scope === 'family';
  const rows = q.data?.rows ?? [];
  const review = rows.filter((r) => r.status === 'Under Review');
  const others = rows.filter((r) => r.status !== 'Under Review');
  const overdue = rows.filter((r) => r.overdue && r.status !== 'Completed').length;
  const showGroups = status === 'open' && review.length > 0;

  const toggle = async (r: TaskItem, done: boolean) => {
    if (!done) {
      const ok = await confirm({
        title: 'Reopen this task?',
        body: `“${r.title}” will move back to your open items as Pending.`,
        confirmLabel: 'Reopen task',
        icon: 'refresh',
      });
      if (!ok) return;
    }
    update.mutate({ id: r.id, status: done ? 'Completed' : 'Pending' });
  };

  const columns: Column<TaskItem>[] = [
    {
      key: 'title', label: 'Task', render: (r) => (
        <div className="row g-3 oi-task">
          <input
            type="checkbox"
            checked={r.status === 'Completed'}
            aria-label={r.status === 'Completed' ? `Reopen ${r.title}` : `Mark ${r.title} complete`}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => toggle(r, e.target.checked)}
            disabled={update.isPending}
          />
          <span className="col oi-minw0">
            <span className={cx('t-sm t-bold', r.status === 'Completed' && 'oi-task--done')}>{r.title}</span>
            <span className="t-micro t-muted">{r.code} · {r.module}</span>
          </span>
        </div>
      ),
    },
    { key: 'due', label: 'Due', render: (r) => <DueCell r={r} /> },
    { key: 'priority', label: 'Priority', render: (r) => <Badge tone={r.priority === 'High' ? 'critical' : r.priority === 'Medium' ? 'warning' : 'neutral'}>{r.priority}</Badge> },
    { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> },
    {
      key: 'go', label: '', className: 'num', render: (r) => (
        r.route ? (
          <Button size="sm" variant={r.status === 'Under Review' ? 'primary' : 'ghost'} iconRight="chevronRight" to={r.route} onClick={(e) => e.stopPropagation()}>
            {r.status === 'Under Review' ? 'Review' : 'Open'}
          </Button>
        ) : null
      ),
    },
  ];

  const table = (data: TaskItem[], emptyText: string) => (
    <DataTable
      rows={data}
      loading={q.isLoading}
      rowKey={(r) => r.id}
      onRowClick={(r) => r.route && navigate(r.route)}
      rowClassName={(r) => (r.overdue && r.status !== 'Completed' ? 'oi-row--overdue' : undefined)}
      emptyText={emptyText}
      columns={columns}
    />
  );

  return (
    <Page>
      <PageHead
        title="My Tasks"
        sub={`${isFamily ? 'Things the school needs from you.' : `Approvals and actions assigned to ${user?.fullName}.`} Each one carries the standard status states.`}
        actions={<Button icon="shield" onClick={() => setPolicy(true)}>{isFamily ? 'How this works' : 'Approval policy'}</Button>}
      />

      {isFamily ? (
        <Banner tone="neutral" icon="lock">These are your own actions as a parent. Approvals, payroll, compliance and staff matters belong to school administration and never appear here.</Banner>
      ) : (
        <Card>
          <Flow steps={[
            { label: 'Draft', meta: 'Created, not submitted', state: 'done' },
            { label: 'Submitted', meta: 'Waiting for reviewer', state: 'done' },
            { label: 'Under Review', meta: `${review.length} item${review.length === 1 ? '' : 's'} here now`, state: 'active' },
            { label: 'Approved', meta: 'Actioned and logged' },
            { label: 'Rejected', meta: 'Returned with a reason' },
          ]} />
          <p className="t-xs t-muted mt-3">Leave, payroll, expenses, reimbursements, certificates, admission offers, parent communication and AI-generated content all follow this same path. Approve or reject inside the record — open it with <strong>Review</strong>.</p>
        </Card>
      )}

      {status === 'open' && overdue > 0 && (
        <div className="mt-4">
          <Banner tone="critical" icon="alert"><strong>{overdue} overdue item{overdue === 1 ? '' : 's'}</strong> on this page — highlighted below.</Banner>
        </div>
      )}

      <div className="row between wrap g-3 mt-5 mb-3">
        <div className="t-sm t-muted">{q.data?.meta.total ?? 0} {status === 'Completed' ? 'completed' : 'open, assigned to you'}</div>
        <Segment items={[{ id: 'open', label: 'Open' }, { id: 'Completed', label: 'Completed' }]} active={status} onChange={(v) => list.setFilter('status', v === 'open' ? '' : v)} />
      </div>

      {q.error ? (
        <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
      ) : showGroups ? (
        <div className="col g-4">
          <Card icon="checkSquare" title="Awaiting your review" sub={`${review.length} approval${review.length === 1 ? '' : 's'} — open each record to approve or reject`} flush>
            {table(review, 'No approvals are waiting for you.')}
          </Card>
          <Card icon="grid" title="Other open items" sub="Actions and follow-ups assigned to you" flush>
            {table(others, 'Nothing else is open right now.')}
            <Pagination meta={q.data?.meta} onPage={list.setPage} />
          </Card>
        </div>
      ) : (
        <Card title={status === 'Completed' ? 'Completed items' : 'Open items'} flush>
          {table(rows, status === 'Completed' ? 'Nothing completed yet. Tick an open item when you finish it.' : 'Nothing is assigned to you right now. New approvals and actions will appear here.')}
          <Pagination meta={q.data?.meta} onPage={list.setPage} />
        </Card>
      )}

      <Modal open={policy} onClose={() => setPolicy(false)} title="Approval and workflow design" size="wide" foot={<Button variant="primary" onClick={() => setPolicy(false)}>Close</Button>}>
        <p className="t-sm t-muted">Anywhere an action needs authorisation, the same states are used, with the same badges, so staff learn the pattern once.</p>
        <div className="mt-4">
          <Flow steps={[
            { label: 'Draft', meta: 'Editable by the author', state: 'done' },
            { label: 'Submitted', meta: 'Locked, queued for review', state: 'done' },
            { label: 'Under Review', meta: 'Reviewer can request changes', state: 'active' },
            { label: 'Approved / Rejected', meta: 'Outcome recorded in the audit trail' },
          ]} />
        </div>
        <div className="grid g-2col g-3 mt-5">
          {[
            ['Leave', 'Line manager, then HR if over 3 days'], ['Payroll', 'Prepared by HR, approved by a different authorised user'],
            ['Expense', 'Budget owner, then Finance'], ['Reimbursement', 'Line manager, then Finance'],
            ['Certificate', 'Front office, then Principal'], ['Admission offer', 'Counsellor, then Head of Admissions'],
            ['Parent communication', 'Class teacher, then Section head'], ['AI-generated content', 'Always a named human reviewer'],
          ].map(([k, v]) => (
            <div key={k} className="card card--tint oi-tile">
              <div className="t-sm t-bold">{k}</div>
              <div className="t-micro t-muted">{v}</div>
            </div>
          ))}
        </div>
      </Modal>
    </Page>
  );
}
