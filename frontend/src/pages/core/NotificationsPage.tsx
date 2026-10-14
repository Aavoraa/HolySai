import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useApiMutation, useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { useListParams } from '@/hooks/useListParams';
import { Badge, Banner, Button, Card, Chips, Empty, ErrorState, Icon, Page, PageHead, Pagination, Segment, Skeleton } from '@/components/ui';
import type { NotificationItem } from '@/api/types';
import { cx, fmt } from '@/lib/format';

const TONE: Record<string, string> = { Critical: 'critical', Attention: 'warning', Information: 'info', Completed: 'success' };

const SCOPE: Record<string, string> = {
  family: 'Your own children only. You never see another family’s information.',
  class: 'Your classes and your students only.',
  self: 'Your own shifts, leave, pay and the duties assigned to you.',
  school: 'Everything within your remit across the campus.',
};

interface Counts { unread: number; critical: number; attention: number; information: number; completed: number; total: number }

export default function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const list = useListParams({ pageSize: 25 }, ['category', 'unread']);
  const q = usePagedQuery<NotificationItem>('/notifications', { ...list.query, sort: undefined, dir: undefined });
  const counts = useApiQuery<Counts>('/notifications/counts');
  const markRead = useApiMutation<string>('patch', (id) => `/notifications/${id}/read`, { invalidate: ['/notifications'], success: false, error: false });
  const markAll = useApiMutation('post', '/notifications/read-all', { invalidate: ['/notifications'], success: 'All notifications marked read' });

  const c = counts.data;
  const cat = list.filters.category || 'All';
  const unreadOnly = list.filters.unread === 'true';
  const filtered = unreadOnly || cat !== 'All';

  const open = (n: NotificationItem) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.route) navigate(n.route);
  };

  const emptyTitle = unreadOnly ? 'You are all caught up' : cat === 'All' ? 'No notifications yet' : `No ${cat.toLowerCase()} notifications`;
  const emptySub = unreadOnly
    ? 'Everything in this view has been read. Switch to “All” to see earlier items.'
    : 'Alerts, approvals and updates for your role will appear here as they happen.';

  return (
    <Page>
      <PageHead
        title="Notification Center"
        sub={`Categories map to how quickly somebody must act. ${SCOPE[user?.role.scope ?? 'school']}`}
        actions={
          <>
            <Button icon="settings" to="/account?tab=notifications">Notification settings</Button>
            <Button variant="primary" icon="check" onClick={() => markAll.mutate({})} loading={markAll.isPending} disabled={!c?.unread}>Mark all read</Button>
          </>
        }
      />

      {!!c?.critical && cat !== 'Critical' && (
        <div className="mb-4">
          <Banner tone="critical" icon="alert">
            <div className="row g-3 wrap between">
              <span><strong>{c.critical} critical notification{c.critical === 1 ? '' : 's'}</strong> need prompt action.</span>
              <Button size="sm" variant="danger" onClick={() => list.setFilter('category', 'Critical')}>Show critical</Button>
            </div>
          </Banner>
        </div>
      )}

      <div className="filterbar oi-filters">
        <Segment
          items={[{ id: 'all', label: `All${c ? ` · ${c.total}` : ''}` }, { id: 'unread', label: `Unread${c ? ` · ${c.unread}` : ''}` }]}
          active={unreadOnly ? 'unread' : 'all'}
          onChange={(v) => list.setFilter('unread', v === 'unread' ? 'true' : '')}
        />
        <Chips
          items={[
            { id: 'All', label: 'Any category' },
            { id: 'Critical', label: 'Critical', count: c?.critical, tone: 'critical' },
            { id: 'Attention', label: 'Attention', count: c?.attention, tone: 'warning' },
            { id: 'Information', label: 'Information', count: c?.information, tone: 'info' },
            { id: 'Completed', label: 'Completed', count: c?.completed, tone: 'success' },
          ]}
          active={cat}
          onChange={(v) => list.setFilter('category', v === 'All' ? '' : v)}
        />
      </div>

      <Card flush>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <div className="card__body col g-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={48} />)}</div>
        ) : q.data?.rows.length ? (
          <ul className="oi-notif-list" aria-label="Notifications">
            {q.data.rows.map((n) => {
              const unread = !n.readAt;
              const critical = n.category === 'Critical';
              return (
                <li key={n.id} className={cx('oi-notif', `alert-item--${n.tone}`, unread && 'oi-notif--unread', critical && 'oi-notif--critical')}>
                  <button type="button" className="oi-notif__main" onClick={() => open(n)}>
                    <span className={`alert-item__ico alert-item__ico--${n.tone}`}><Icon name={n.icon} size={16} /></span>
                    <span className="oi-notif__text">
                      <span className="oi-notif__title">
                        {unread && <span className="oi-notif__dot" aria-hidden="true" />}
                        {unread && <span className="sr-only">Unread: </span>}
                        {n.title}
                      </span>
                      {n.body && <span className="oi-notif__body">{n.body}</span>}
                      <span className="oi-notif__meta">
                        <Badge tone={TONE[n.category]} icon={critical ? 'alert' : undefined}>{n.category}</Badge>
                        <span>{fmt.relative(n.createdAt)}</span>
                        {n.route && <span className="oi-notif__go">Open <Icon name="chevronRight" size={12} /></span>}
                      </span>
                    </span>
                  </button>
                  {unread && (
                    <Button
                      size="sm"
                      variant="quiet"
                      icon="check"
                      className="oi-notif__read"
                      aria-label={`Mark “${n.title}” as read`}
                      title="Mark as read"
                      disabled={markRead.isPending && markRead.variables === n.id}
                      onClick={() => markRead.mutate(n.id)}
                    >
                      <span className="oi-hide-sm">Mark read</span>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty
            title={emptyTitle}
            sub={emptySub}
            icon="bell"
            action={filtered ? <Button size="sm" onClick={list.clear}>Show all notifications</Button> : undefined}
          />
        )}
        <Pagination meta={q.data?.meta} onPage={list.setPage} />
      </Card>

      <p className="t-xs t-muted mt-4 row g-2 oi-scope-note">
        <Icon name="lock" size={14} />
        <span>Showing the <strong>{user?.role.name}</strong> queue for {user?.fullName}. Notifications are filtered by role and data scope, so nothing outside your remit appears here.</span>
      </p>
    </Page>
  );
}
