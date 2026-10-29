/** Response shapes of the finance API (see backend/src/services/finance-*.service.ts). */

export interface FeeHead { id: string; code: string; name: string; isOptional: boolean }
export interface FinanceEmployee { id: string; fullName: string; code: string; department: string; category: string; employeeType: string; campusId: string; basicSalary: number }
export interface FinanceLookups {
  feeHeads: FeeHead[];
  vendors: { id: string; name: string; category: string }[];
  expenseCategories: string[];
  employees: FinanceEmployee[];
  employeeCategories: string[];
  campuses: { id: string; name: string }[];
}

export interface FeeDashboard {
  kpis: {
    billed: number; collected: number; outstanding: number; outstandingAccounts: number;
    overdue: number; overdueAccounts: number; overdueAll: number; overdueAllAccounts: number;
    expected: number; dueSoonAccounts: number; collectionPct: number; collected30dDelta: number | null;
  };
  trend: { label: string; month: string; billed: number; collected: number }[];
  ageing: { label: string; value: number }[];
  methods: { label: string; amount: number; count: number; pct: number }[];
  byCampus: { id: string; label: string; collected: number; outstanding: number }[];
  byHead: { head: string; billed: number; collected: number }[];
  attention: { id: string; fullName: string; admissionNo: string; grade: string; section: string; outstanding: number; ageDays: number; feeStatus: string }[];
}

export interface ReminderAudience { overdue30: number; outstanding: number; due7: number; overdue: number }

export interface StructureSummaryRow {
  campusId: string; campus: string; stage: string; fromGrade: number; toGrade: number; classes: number;
  tuition: number; transport: number; activities: number; terms: number; students: number; status: string;
}
export interface StructureRow {
  id: string; classId: string; class: string; stage: string; campus: string; feeHeadId: string; head: string;
  term: string; amount: number; dueDate: string; status: string; applied: number;
}

export interface AccountRow {
  id: string; admissionNo: string; fullName: string; grade: string; section: string; campus: string;
  billed: number; paid: number; balance: number; overdue: number; nextDue: string | null; feeStatus: string;
}

export interface FeeLine {
  id: string; description: string; head: string; headCode: string; amountDue: number; concession: number;
  amountPaid: number; balance: number; dueDate: string; status: string;
}

export interface PaymentBrief {
  id: string; receiptNo: string; amount: number; method: string; gatewayRef: string | null; status: string;
  paidAt: string; reconciled: boolean; receiptSentAt: string | null; delivery: string; collectedBy: string | null; paidBy: string | null;
}

export interface Account {
  student: { id: string; admissionNo: string; fullName: string; grade: string; section: string; campus: string; busRoute: string | null; parentName: string | null; parentPhone: string | null };
  summary: { gross: number; concession: number; billed: number; paid: number; outstanding: number; overdue: number; nextDue: string | null; nextDueAmount: number | null };
  lines: FeeLine[];
  payments: PaymentBrief[];
  concessions: { id: string; type: string; percent: number | null; amount: number; status: string; reason: string | null; approvedBy: string | null; approvedAt: string | null; validUntil: string }[];
}

export interface Receipt {
  id: string; receiptNo: string; amount: number; method: string; gatewayRef: string | null; status: string;
  paidAt: string; receiptSentAt: string | null; delivery: string; reconciled: boolean; collectedBy: string | null; paidBy: string | null;
  academicYear: string; studentId: string;
  student: { id: string; admissionNo: string; fullName: string; grade: string | null; section: string | null; campus: string; campusShort: string };
  lines: { feeId: string; description: string; head: string; amount: number; balanceAfter: number }[];
}

export interface PaymentRow {
  id: string; receiptNo: string; amount: number; method: string; gatewayRef: string | null; status: string; paidAt: string;
  reconciled: boolean; receiptSentAt: string | null; delivery: string; studentId: string; studentName: string; admissionNo: string;
  grade: string | null; section: string | null; campus: string; collectedBy: string | null; paidOnline: boolean;
}

export interface PaymentSummary {
  collectedToday: number; transactionsToday: number; failedOrPending: number; unreconciled: number;
  collected30d: number; receiptsPending: number; receiptsDelivered: number;
}

export interface ConcessionSummary {
  types: { type: string; students: number; value: number; pending: number }[];
  tuitionBilled: number;
  scholarships: { awards: number; value: number; underReview: number };
}
export interface ConcessionRow {
  id: string; type: string; percent: number | null; amount: number; status: string; reason: string | null; createdAt: string;
  decidedAt: string | null; decidedBy: string | null; requestedBy: string | null;
  studentId: string; studentName: string; admissionNo: string; grade: string | null; section: string | null;
}
export interface Scholarship { id: string; name: string; criteria: string | null; amount: number; seats: number; awarded: number; status: string }

export interface ExpenseRow {
  id: string; code: string; category: string; description: string; amount: number; expenseDate: string; status: string;
  rejectionReason: string | null; decidedAt: string | null; decidedBy: string | null; raisedBy: string | null; department: string | null;
  vendor: string | null; campus: string;
}
export interface ExpenseSummary {
  flow: { draft: number; submitted: number; underReview: number; approvedThisWeek: number; approved: number; rejected30d: number; paid: number; pendingValue: number };
  byCategory: { label: string; value: number }[];
}

export interface ReimbursementRow {
  id: string; code: string; claimType: string; description: string; amount: number; claimDate: string; status: string;
  decidedAt: string | null; decidedBy: string | null; payrollRunId: string | null; employeeId: string; employee: string; department: string; campus: string;
  /** The claim's receipt; null for claims recorded before receipts were required. */
  receipt: { name: string; mimeType: string; sizeBytes: number } | null;
}
export interface ReimbursementSummary { pending: number; pendingValue: number; approvedUnpaid: number; paidThisMonth: number; rejected: number }

export interface AllowanceSummaryRow {
  allowanceType: string; appliesTo: string; employees: number; minAmount: number; maxAmount: number; pctOfBasic: number | null;
  monthlyCost: number; pendingCost: number; frequency: string; effectiveMonth: string; status: string; pendingCount: number;
}
export interface AllowanceRow {
  id: string; allowanceType: string; amount: number; frequency: string; effectiveMonth: string; status: string;
  employeeId: string; employee: string; category: string; department: string;
}

export interface BudgetRow {
  category: string; id: string | null; allocated: number; owner: string | null; actual: number; committed: number;
  projected: number; variance: number; utilisation: number | null;
}
export interface Budgets {
  kpis: { allocated: number; spent: number; committed: number; projectedVariance: number; yearElapsedPct: number; overBudget: { category: string; variance: number } | null };
  rows: BudgetRow[];
}

export interface ReconSummary {
  latestDate: string | null; matchedLatest: number; exceptions: number; unmatched: number; matched: number;
  settlementLatest: number; inTransit: number;
}
export interface ReconLine {
  id: string; statementDate: string; reference: string; amount: number; channel: string; status: string; note: string | null;
  paymentId: string | null; receiptNo: string | null; paymentAmount: number | null; studentId: string | null; studentName: string | null;
}
export interface ReconCandidate {
  id: string; receiptNo: string; amount: number; method: string; gatewayRef: string | null; paidAt: string;
  studentName: string; admissionNo: string; referenceMatch: boolean; amountDiff: number;
}

export interface Report {
  key: string; title: string; generatedAt: string;
  columns: { key: string; label: string; money?: boolean }[];
  rows: Record<string, unknown>[];
}
