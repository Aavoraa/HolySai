/**
 * Shared dashboard pieces, so every role dashboard has the same structure as the
 * Command Center: main column + right rail (Quick Actions, Recent Notifications,
 * Upcoming Events).
 */
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useSchool } from '@/layouts/SchoolContext';
import { useApiQuery, usePagedQuery } from '@/hooks/useApi';
import { fmt, todayKey } from '@/lib/format';
import type { NotificationItem } from '@/api/types';
import type { SchoolEvent } from '@/pages/parents-experience/types';
import { Card, CardLink, Empty, Icon } from './primitives';
import { QuoteCard } from './dashboardViz';

/** Main column + right rail. The rail stacks under the main column below 1280 px. */
export function DashLayout({ rail, children }: { rail?: ReactNode; children: ReactNode }) {
  if (!rail) return <>{children}</>;
  return (
    <div className="dash">
      <div className="dash__main">{children}</div>
      <aside className="dash__rail" aria-label="Shortcuts and updates">{rail}</aside>
    </div>
  );
}

export interface QuickAction {
  label: string;
  icon: string;
  to: string;
  /** '' (magenta) | gold | violet | indigo | teal | critical */
  tone?: string;
  /** Hide when false (e.g. a permission check). */
  show?: boolean;
}

/** Muted hues the quick-action icons rotate through (tokens in system.css). */
const QA_HUES = ['brand', 'blue', 'plum', 'sage', 'amber', 'steel', 'teal'];

export function QuickActions({ items, title = 'Quick Actions' }: { items: QuickAction[]; title?: string }) {
  const visible = items.filter((x) => x.show !== false);
  if (!visible.length) return null;
  return (
    <Card icon="zap" title={title}>
      <div className="qa">
        {visible.map((x, i) => {
          const tone = x.tone === 'critical' ? 'critical' : '';
          const hue = QA_HUES[i % QA_HUES.length];
          return (
          <Link key={x.label + x.to} className="qa__item" to={x.to}>
            <span className={`qa__ico${tone ? ` qa__ico--${tone}` : ''}`} data-hue={tone ? undefined : hue}><Icon name={x.icon} size={17} /></span>
            {x.label}
            <Icon name="chevronRight" size={15} />
          </Link>
          );
        })}
      </div>
    </Card>
  );
}

/** Standard right rail: role-specific quick actions, the school's line, notifications and upcoming events. */
export function DashRail({ actions, events = true, quote = true, children }: { actions: QuickAction[]; events?: boolean; quote?: boolean; children?: ReactNode }) {
  return (
    <>
      <QuickActions items={actions} />
      {children}
      {quote && <QuoteCard />}
      <RecentNotifications />
      {events && <UpcomingEvents />}
    </>
  );
}

/** "early_warning" → "Early warning" */
const topicLabel = (t?: string | null) => (t ? t.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'General');

const NOTE_DOT: Record<string, string> = { critical: 'critical', warning: 'warning', caution: 'warning', success: 'success', info: 'info', neutral: 'violet' };

/** The five latest notifications for the signed-in user. */
export function RecentNotifications() {
  const navigate = useNavigate();
  const notes = usePagedQuery<NotificationItem>('/notifications', { pageSize: 5 });
  return (
    <Card icon="bell" title="Recent Notifications" actions={<CardLink to="/notifications">View All</CardLink>}>
      {notes.isLoading ? (
        <div className="col g-3">{[0, 1, 2].map((i) => <span key={i} className="skeleton" style={{ height: 34 }} />)}</div>
      ) : notes.data?.rows.length ? (
        <div>
          {notes.data.rows.map((n) => (
            <button key={n.id} type="button" className="nlist__item" onClick={() => navigate(n.route ?? '/notifications')}>
              <span className={`nlist__dot nlist__dot--${NOTE_DOT[n.tone] ?? 'info'}`} />
              <span className="grow" style={{ minWidth: 0 }}>
                <span className={`nlist__title${n.readAt ? '' : ' nlist__title--unread'}`}>{n.title}</span>
                <span className="nlist__meta">{topicLabel(n.topic)} · {fmt.relative(n.createdAt)}</span>
              </span>
              <Icon name="chevronRight" size={14} />
            </button>
          ))}
        </div>
      ) : (
        <Empty icon="bell" title="You're all caught up" sub="New notifications appear here." />
      )}
    </Card>
  );
}

const EVENT_TAG: Record<string, string> = { Academic: 'academic', PTM: 'academic', Sports: 'sports', School: 'event', Cultural: 'event', Holiday: 'finance' };

/** Next school events: the staff calendar, or the family calendar for parents. Renders nothing for roles without either. */
export function UpcomingEvents({ limit = 4 }: { limit?: number }) {
  const { can } = useAuth();
  const { campusParam } = useSchool();
  const staff = can('communication.read');
  const family = !staff && can('parent_portal.use');
  const staffQ = usePagedQuery<SchoolEvent>(staff ? '/events' : null, { when: 'upcoming', pageSize: limit, ...campusParam });
  const familyQ = useApiQuery<SchoolEvent[]>(family ? '/family/events' : null);
  if (!staff && !family) return null;

  const today = todayKey();
  const rows = staff
    ? staffQ.data?.rows ?? []
    : (familyQ.data ?? []).filter((e) => (e.endsOn ?? e.startsOn).slice(0, 10) >= today).slice(0, limit);
  const loading = staff ? staffQ.isLoading : familyQ.isLoading;

  return (
    <Card icon="calendar" title="Upcoming Events" actions={staff ? <CardLink to="/events">View All</CardLink> : undefined}>
      {loading ? (
        <div className="col g-3">{[0, 1, 2].map((i) => <span key={i} className="skeleton" style={{ height: 44 }} />)}</div>
      ) : rows.length ? (
        <div>
          {rows.map((e) => {
            const dt = new Date(e.startsOn);
            return (
              <div className="evrow" key={e.id}>
                <span className="evdate"><strong>{dt.getDate()}</strong><span>{dt.toLocaleString('en-IN', { month: 'short' })}</span></span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="evrow__title t-clip">{e.title}</div>
                  <div className="evrow__meta t-clip">{e.startsAt ? `${e.startsAt.slice(0, 5)} · ` : ''}{e.venue ?? e.audience}</div>
                </div>
                <span className={`evtag evtag--${EVENT_TAG[e.eventType] ?? 'other'}`}>{e.eventType}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty icon="calendar" title="No upcoming events" sub="Published events from the school calendar appear here." />
      )}
    </Card>
  );
}
