/**
 * Types and helpers shared by the Job Cards and Departments screens.
 */
import { Badge } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApi';

export interface Department {
  id: string; name: string; code: string; description: string | null; isActive: boolean; aliases: string[];
  campusId: string | null; campusName: string | null; headEmployeeId: string | null; headName: string | null; headDesignation: string | null;
  membersCount: number; openIn: number; openOut: number; overdueIn: number; isMine: boolean;
}

export interface Member { id: string; fullName: string; designation: string; employeeCode: string; isHead: boolean; hasAccount: boolean; campusName: string | null }

export interface JobCard {
  id: string; code: string; title: string; description: string | null; category: string; priority: string; status: string; location: string | null;
  dueOn: string | null; overdue: boolean; dueInDays: number | null;
  fromDepartmentId: string; fromDepartment: string; toDepartmentId: string; toDepartment: string;
  raisedById: string | null; raisedBy: string | null; assignedToId: string | null; assignedTo: string | null; assignedToDesignation: string | null;
  campusId: string | null; campusName: string | null; estimatedHours: number | null; actualHours: number | null;
  assignedAt: string | null; startedAt: string | null; completedAt: string | null; closedAt: string | null;
  createdAt: string; updatedAt: string; commentCount: number;
}

export interface CardUpdate { id: string; kind: string; fromStatus: string | null; toStatus: string | null; body: string | null; createdAt: string; userId: string | null; userName: string | null }

export interface JobCardDetail extends JobCard {
  toHeadId: string | null; toHead: string | null;
  updates: CardUpdate[];
  permissions: { statuses: string[]; canAssign: boolean; canEdit: boolean; canEditDetails: boolean; canComment: boolean; role: string };
}

export interface DeptSummary { id: string; name: string; code: string; openIn: number; openOut: number; overdueIn: number; completed30d: number; avgCompletionHours: number | null }

export interface JobCardSummary {
  total: number; active: number; open: number; inProgress: number; onHold: number; overdue: number; completedThisMonth: number; awaitingClosure: number;
  avgCompletionHours: number | null; inbox: number; raised: number; assigned: number; inboxUnassigned: number;
  byStatus: Record<string, number>; perDepartment: DeptSummary[]; myDepartmentIds: string[];
}

export const CATEGORIES = ['Maintenance', 'IT', 'Event support', 'Academic', 'Administrative', 'Transport', 'Housekeeping', 'Procurement', 'HR', 'Other'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
export const STATUSES = ['Open', 'Assigned', 'In Progress', 'On Hold', 'Completed', 'Closed', 'Cancelled', 'Reopened'];
export const FINAL = ['Completed', 'Closed', 'Cancelled'];
/** Status changes that need a reason. */
export const NEEDS_NOTE = ['On Hold', 'Cancelled', 'Reopened'];

export const priTone = (p: string) => (p === 'Urgent' ? 'critical' : p === 'High' ? 'warning' : p === 'Medium' ? 'info' : 'neutral');

export function PriorityBadge({ value }: { value: string }) {
  return <Badge tone={priTone(value)} dot={value === 'Urgent'}>{value}</Badge>;
}

/** Label for the action button that moves a card to a status. */
export function actionLabel(to: string, from: string) {
  switch (to) {
    case 'In Progress': return from === 'On Hold' ? 'Resume work' : 'Start work';
    case 'Completed': return 'Mark completed';
    case 'Closed': return 'Accept & close';
    case 'Reopened': return 'Reopen';
    case 'Cancelled': return 'Cancel card';
    case 'On Hold': return 'Put on hold';
    case 'Open': case 'Assigned': return 'Resume';
    default: return to;
  }
}

export function hoursLabel(h: number | null | undefined) {
  if (h == null) return '—';
  if (h < 24) return `${h} h`;
  return `${Math.round((h / 24) * 10) / 10} days`;
}

export function useDepartments(includeInactive = false) {
  return useApiQuery<Department[]>('/departments', includeInactive ? { includeInactive: true } : undefined, { staleTime: 60_000 });
}
