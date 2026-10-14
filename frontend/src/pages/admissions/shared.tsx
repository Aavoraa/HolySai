import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { useSchool } from '@/layouts/SchoolContext';
import { Badge, DataTable, Icon, Person, type Sort } from '@/components/ui';
import { cx, fmt, todayKey } from '@/lib/format';
import type { Tone } from '@/lib/tones';
import type { Counsellor, Lead } from './types';

export const SOURCE_TONE: Record<string, Tone> = {
  WhatsApp: 'success', Website: 'info', 'Meta Ads': 'info', Referral: 'warning', Google: 'neutral', 'Walk-in': 'neutral', Instagram: 'warning', Phone: 'neutral',
};
export const SOURCE_COLOR: Record<string, string> = {
  WhatsApp: 'var(--teal)', Website: 'var(--navy)', 'Meta Ads': 'var(--viz-4)', Referral: 'var(--amber)', Google: 'var(--viz-5)',
  'Walk-in': 'var(--viz-7)', Instagram: 'var(--viz-6)', Phone: 'var(--viz-8)',
};

export const stageTone = (s: string): Tone => (s === 'Enrolled' ? 'success' : s === 'New Lead' ? 'info' : s === 'Lost' ? 'critical' : 'neutral');

export function SourceBadge({ source }: { source: string }) {
  return <Badge tone={SOURCE_TONE[source] ?? 'neutral'}>{source}</Badge>;
}

export function ScoreCell({ score }: { score: number }) {
  return <span className={`t-num t-bold ${score >= 80 ? 't-success' : score < 55 ? 't-critical' : ''}`}>{score}</span>;
}

/** datetime-local input value (browser local time) → ISO string. */
export const localToIso = (v: string) => new Date(v).toISOString();
/** A datetime-local value n days from now at hh:mm. */
export function localInput(days = 1, hhmm = '10:00') {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "Wed 17 Sep · 10:00" in school time. */
export function whenLabel(iso: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata',
  }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${parts.day} ${parts.month} · ${parts.hour}:${parts.minute}`;
}

export const PHONE_RE = /^\+?[0-9 ]{8,16}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The lead profile opens over any admissions screen via ?lead=LD-4412, so it can be linked and bookmarked. */
export function useLeadParam() {
  const [sp, setSp] = useSearchParams();
  const leadCode = sp.get('lead');
  const openLead = useCallback((code: string) => setSp((prev) => {
    const next = new URLSearchParams(prev);
    next.set('lead', code);
    return next;
  }), [setSp]);
  const closeLead = useCallback(() => setSp((prev) => {
    const next = new URLSearchParams(prev);
    next.delete('lead');
    return next;
  }, { replace: true }), [setSp]);
  return { leadCode, openLead, closeLead };
}

export function useCounsellors() {
  const { campusParam } = useSchool();
  return useApiQuery<Counsellor[]>('/admissions/counsellors', campusParam, { staleTime: 60_000 });
}

/** Where a lead's next step sits relative to today (school time). */
export type DueState = 'overdue' | 'today' | 'upcoming' | 'none';
export function dueState(at: string | null, overdue?: boolean): DueState {
  if (overdue) return 'overdue';
  if (!at) return 'none';
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(at));
  const today = todayKey();
  return key < today ? 'overdue' : key === today ? 'today' : 'upcoming';
}

/** "Today · 10:00", "Wed 17 Sep · 10:00" — the short due label used across the CRM. */
export function dueLabel(at: string | null) {
  if (!at) return '';
  const state = dueState(at);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date(at));
  return state === 'today' ? `Today · ${time}` : whenLabel(at);
}

const CLOSED = ['Enrolled', 'Lost'];

/** Next action + when it is due + overdue/today flag, so the next step on each lead is obvious. */
export function NextActionCell({ lead }: { lead: Pick<Lead, 'stage' | 'nextAction' | 'nextActionAt' | 'overdue'> }) {
  if (CLOSED.includes(lead.stage)) return <span className="t-faint">—</span>;
  if (!lead.nextAction) {
    return (
      <span className="adm-next adm-next--none">
        <span className="adm-next__what">No next step</span>
        <span className="adm-next__when">Schedule a follow-up</span>
      </span>
    );
  }
  const due = dueState(lead.nextActionAt, lead.overdue);
  return (
    <span className="adm-next" title={lead.nextActionAt ? fmt.dateTime(lead.nextActionAt) : undefined}>
      <span className="adm-next__what">{lead.nextAction}</span>
      <span className="adm-next__when">
        {due === 'overdue' && <Badge tone="critical" dot>Overdue</Badge>}
        {due === 'today' && <Badge tone="warning">Due today</Badge>}
        {lead.nextActionAt && <span>{dueLabel(lead.nextActionAt)}</span>}
      </span>
    </span>
  );
}

export function CounsellorCell({ lead }: { lead: Pick<Lead, 'stage' | 'counsellor'> }) {
  if (lead.counsellor) return <Person name={lead.counsellor} size="xs" />;
  return CLOSED.includes(lead.stage) ? <span className="t-faint">—</span> : <Badge tone="critical" icon="userCheck">Unassigned</Badge>;
}

export function LeadsTable({ rows, loading, sort, onSort, onOpen, emptyText }: {
  rows: Lead[] | undefined; loading?: boolean; sort?: Sort; onSort?: (s: Sort) => void; onOpen: (code: string) => void; emptyText?: string;
}) {
  return (
    <DataTable
      rows={rows}
      loading={loading}
      rowKey={(r) => r.id}
      sort={sort}
      onSort={onSort}
      onRowClick={(r) => onOpen(r.code)}
      rowClassName={(r) => (r.overdue && !CLOSED.includes(r.stage) ? 'adm-row--overdue' : undefined)}
      emptyText={emptyText ?? 'No leads match the current filters.'}
      columns={[
        { key: 'student', label: 'Student / Parent', render: (r) => <Person name={r.studentName} meta={`${r.parentName} · ${r.code}`} /> },
        { key: 'grade', label: 'Grade', render: (r) => r.grade },
        { key: 'curriculum', label: 'Curriculum', render: (r) => <span className="t-xs t-muted">{r.curriculum ?? '—'}</span> },
        { key: 'source', label: 'Source', render: (r) => <SourceBadge source={r.source} /> },
        { key: 'stage', label: 'Stage', render: (r) => <Badge tone={stageTone(r.stage)}>{r.stage}</Badge> },
        { key: 'next', label: 'Next action', render: (r) => <NextActionCell lead={r} /> },
        { key: 'counsellor', label: 'Counsellor', render: (r) => <CounsellorCell lead={r} /> },
        { key: 'score', label: 'Score', className: 'num', render: (r) => <ScoreCell score={r.score} /> },
      ]}
    />
  );
}

export function PipeCard({ lead, onOpen }: { lead: Lead; onOpen: (code: string) => void }) {
  const open = !CLOSED.includes(lead.stage);
  const due = open ? dueState(lead.nextActionAt, lead.overdue) : 'none';
  return (
    <button type="button" className={cx('pipecard adm-pipecard', due === 'overdue' && 'adm-pipecard--overdue')} onClick={() => onOpen(lead.code)}
      aria-label={`${lead.studentName}, ${lead.grade}, score ${lead.score}${due === 'overdue' ? ', follow-up overdue' : ''}`}>
      <span className="adm-pipecard__head">
        <span className="t-sm t-bold t-clip">{lead.studentName}</span>
        <span className={cx('adm-pipecard__score', lead.score >= 80 && 'adm-pipecard__score--hot', lead.score < 55 && 'adm-pipecard__score--cold')} title="Lead score">{lead.score}</span>
      </span>
      <span className="adm-pipecard__meta">{lead.grade} · {lead.parentName}</span>
      {open && (
        <span className={cx('adm-pipecard__next', due === 'overdue' && 'adm-pipecard__next--overdue', due === 'today' && 'adm-pipecard__next--today')}>
          <Icon name={due === 'overdue' ? 'alertCircle' : 'clock'} size={12} />
          <span>
            {lead.nextAction ?? 'No next step'}
            {lead.nextActionAt ? ` · ${due === 'overdue' ? 'overdue' : dueLabel(lead.nextActionAt)}` : ''}
          </span>
        </span>
      )}
      <span className="adm-pipecard__foot">
        <SourceBadge source={lead.source} />
        <span className={cx('adm-pipecard__owner', !lead.counsellor && open && 'adm-pipecard__owner--none')}>
          {lead.counsellor ?? (open ? 'Unassigned' : '—')}
        </span>
      </span>
    </button>
  );
}
