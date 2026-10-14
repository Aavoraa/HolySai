/** Status → tone mapping, identical to the wireframe so every module reads the same. */
export type Tone = 'critical' | 'warning' | 'caution' | 'info' | 'success' | 'neutral';

const AVATAR_TONES = ['', 'avatar--blue', 'avatar--plum', 'avatar--sage', 'avatar--amber-soft', 'avatar--slate'];

export function toneFor(key: string) {
  const s = String(key || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

export function riskTone(risk?: string | null): Tone {
  return ({ 'At Risk': 'critical', 'Developing Risk': 'warning', 'On Track': 'success', Watch: 'caution' } as Record<string, Tone>)[risk ?? ''] ?? 'neutral';
}

const STATUS: Record<string, Tone> = {
  Approved: 'success', Paid: 'success', Present: 'success', present: 'success', Completed: 'success', Enrolled: 'success', Closed: 'success',
  Active: 'success', active: 'success', Verified: 'success', Released: 'success', Cleared: 'success', 'On Track': 'success', Resolved: 'success',
  Onboard: 'success', Success: 'success', Issued: 'success', Matched: 'success', 'At campus': 'success', Published: 'success', Booked: 'success',
  Attended: 'success', Accepted: 'success', 'Tracking Active': 'success', Delivered: 'success', Available: 'success', Inside: 'info',
  Pending: 'warning', 'Under Review': 'warning', Submitted: 'warning', Partial: 'warning', Late: 'warning', late: 'warning',
  'In Progress': 'warning', Draft: 'neutral', Scheduled: 'info', 'Follow-up': 'warning', 'Due Soon': 'warning', Delayed: 'warning',
  'Renewal due': 'warning', 'Maintenance due': 'warning', Unmatched: 'warning', 'Tracking Paused': 'warning', paused: 'warning',
  'Awaiting pickup': 'warning', 'Cover needed': 'warning', 'In maintenance': 'warning', Maintenance: 'warning', 'Under review': 'warning',
  Rejected: 'critical', Overdue: 'critical', Absent: 'critical', absent: 'critical', 'At Risk': 'critical', Breach: 'critical',
  Expired: 'critical', Escalated: 'critical', Failed: 'critical', Exception: 'critical', Offline: 'critical', offline: 'critical',
  Lost: 'critical', Denied: 'critical', Critical: 'critical', 'No answer': 'warning',
  Leave: 'info', leave: 'info', 'On Leave': 'info', New: 'info', 'New Lead': 'info', Open: 'info', Contacted: 'info', Qualified: 'info',
  'En route': 'info', 'In transit': 'info', Expected: 'info', Opened: 'info', 'Visit Scheduled': 'info',
  'Tracking Disabled': 'neutral', disabled: 'neutral', 'No Location Yet': 'neutral', unmarked: 'neutral', Waived: 'neutral',
  Retired: 'neutral', Cancelled: 'neutral', Withdrawn: 'neutral', Internal: 'neutral',
};

export function statusTone(s?: string | null): Tone {
  return STATUS[s ?? ''] ?? 'neutral';
}

export const SERIES = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)', 'var(--viz-6)', 'var(--viz-7)', 'var(--viz-8)'];

export function capitalize(s?: string | null) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
