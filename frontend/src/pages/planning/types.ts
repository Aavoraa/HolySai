export type PlanStatus = 'Draft' | 'Submitted' | 'Under Review' | 'Approved' | 'Rejected';

export interface PlanRow {
  id: string;
  code: string;
  title: string;
  department: string;
  category: string;
  status: PlanStatus;
  periodStart: string;
  periodEnd: string;
  amountRequested: number;
  amountApproved: number | null;
  submittedAt: string | null;
  submittedBy: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  campusId: string;
  campus: string;
  academicYear: string;
  createdBy: string | null;
  createdById: string | null;
  updatedAt: string;
  lineCount: number;
}

export interface PlanLine { id?: string; item: string; quantity: number; unitCost: number; amount: number; notes: string | null }

export interface PlanDetail extends PlanRow {
  justification: string | null;
  academicYearId: string;
  createdAt: string;
  budgetId: string | null;
  budgetAllocated: number | null;
  lines: PlanLine[];
  history: { id: string; action: string; fromStatus: string | null; toStatus: string | null; amount: number | null; note: string | null; actor: string; at: string }[];
  currentBudget: { id: string; allocated: number; owner: string | null } | null;
}

export interface PlanSummary {
  kpis: {
    requested: number; approved: number; pendingValue: number; pending: number; approvedCount: number; rejected: number; drafts: number;
    approvedRequested: number; oldestPendingAt: string | null;
  };
  byCategory: { label: string; requested: number; approved: number }[];
  byStatus: { label: string; value: number }[];
}

export interface PlanLookups {
  categories: string[];
  departments: string[];
  academicYears: { id: string; label: string; startsOn: string; endsOn: string; isCurrent: boolean }[];
  statuses: PlanStatus[];
}

export interface PendingApproval {
  module: string;
  moduleLabel: string;
  id: string;
  code: string | null;
  title: string;
  detail: string | null;
  amount: number | null;
  campusId: string | null;
  campus: string | null;
  requestedBy: string | null;
  requestedAt: string;
  status: string;
  route: string;
  ageDays: number;
}

export interface ApprovalSummary {
  total: number;
  amount: number;
  over7Days: number;
  oldestAt: string | null;
  modules: { module: string; label: string; count: number; amount: number | null; oldestAt: string | null }[];
}
