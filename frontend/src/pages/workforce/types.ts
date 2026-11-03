/** Shapes returned by the workforce & payroll API. */

export type EmployeeType = 'teaching' | 'non_teaching';

export interface EmployeeRow {
  id: string;
  code: string;
  fullName: string;
  gender: string | null;
  phone: string | null;
  email: string | null;
  campusId: string;
  campusName: string;
  campusCode: string;
  department: string;
  designation: string;
  employeeType: EmployeeType;
  category: string;
  shift: string | null;
  joinDate: string | null;
  employmentStatus: string;
  workload: number;
  cpd: number;
  backgroundVerified: boolean;
  hasAccount: boolean;
  today: string;
  checkIn: string | null;
  checkOut: string | null;
  leaveBalance: number;
  leaveEntitled: number;
  overtime: number;
}

export interface EmployeeDetail extends EmployeeRow {
  basicSalary?: number;
  bankAccount?: string | null;
  dateOfBirth: string | null;
  campusFullName: string;
  qualification: string | null;
  specialisation: string | null;
  isMentor: boolean | null;
  maxPeriodsWeek: number | null;
  staffCategory: string | null;
  licenceNoMasked: string | null;
  licenceExpiry: string | null;
}

export interface FlowStep { label: string; meta?: string; state?: 'done' | 'active' }

export interface LeaveBalance { leaveTypeId: string; type: string; entitled: number; used: number; balance: number }

export interface EmployeeProfile {
  employee: EmployeeDetail;
  journey: FlowStep[];
  attendance: { marked: number; present: number; late: number; absent: number; leave: number; pct: number | null };
  recentAttendance: { date: string; status: string; checkIn: string | null; checkOut: string | null; source: string }[];
  leaveBalances: LeaveBalance[];
  leaveRequests: { id: string; code: string; type: string; fromDate: string; toDate: string; days: number; status: string }[];
  overtime: { id: string; workDate: string; hours: number; reason: string; rate: number; status: string }[];
  allowances: { id: string; type: string; amount: number; frequency: string; effectiveMonth: string; status: string }[];
  cpd: { id: string; programme: string; provider: string | null; hours: number; completedOn: string | null; status: string }[];
  documents: { id: string; name: string; category: string; status: string; verifiedAt: string | null; requestedOn: string | null; hasFile: boolean }[];
  /** Teaching staff: sections and subjects this year. */
  teaching?: { section: string; subject: string; periods: number; classTeacher: boolean }[];
  roster: { id: string; date: string; post: string; status: string; shift: string; coveredBy: string | null }[];
  payslips: { id: string; payMonth: string; gross: number; net: number; status: string; runStatus: string }[];
}

export interface WorkforceSummary {
  kpis: {
    total: number; teaching: number; nonTeaching: number; present: number; absent: number; leave: number; late: number;
    halfDay: number; notMarked: number; avgWorkload: number | null; overtimeHours: number; overtimeApproved: number;
    overtimePending: number; payrollPending: number; cpdHours: number; openLeave: number; uncoveredToday: number;
  };
  pending: { leave: number; overtime: number; allowances: number; reimbursements: number };
  categories: { label: string; value: number }[];
  departments: string[];
  journey: {
    joinedThisYear: number; active: number; openLeave: number; overtimeHours: number; pendingApprovals: number;
    currentRun: { payMonth: string; status: string } | null;
  };
}

export interface AttendanceRow {
  id: string; code: string; fullName: string; designation: string; department: string; employeeType: EmployeeType;
  shift: string | null; campusName: string; attendanceId: string | null; status: string; checkIn: string | null;
  checkOut: string | null; source: string | null; rosterId: string | null; post: string | null; rosterStatus: string | null;
  coveredBy: string | null;
}

export interface AttendanceSummary {
  date: string;
  counts: { total: number; present: number; absent: number; leave: number; late: number; halfDay: number; notMarked: number };
  byShift: { shift: string; expected: number; present: number; leave: number; absent: number; uncovered: number }[];
  byDepartment: { label: string; value: number | null }[];
  trend: { date: string; present: number; absent: number; late: number; leave: number }[];
  months: { label: string; value: number }[];
}

export interface Shift {
  id: string; name: string; startsAt: string; endsAt: string; splitStartsAt: string | null; splitEndsAt: string | null;
  employees: number; rosteredToday: number;
}

export interface RosterEntry {
  id: string; date: string; post: string; group: string; duty: string | null; status: string;
  employeeId: string; employeeName: string; designation: string; campusId: string;
  shiftId: string; shiftName: string; coveredById: string | null; coveredByName: string | null; attendance: string | null;
}

export interface Roster {
  weekStart: string; days: string[]; groups: string[]; entries: RosterEntry[]; gaps: RosterEntry[]; attention: RosterEntry[]; today: string;
}

export interface LeaveRow {
  id: string; code: string; employeeId: string; employeeName: string; employeeCode: string; designation: string; department: string;
  employeeType: EmployeeType; campusName: string; leaveTypeId: string; leaveType: string; fromDate: string; toDate: string;
  days: number; reason: string | null; coverArrangement: string | null; status: string; decidedBy: string | null;
  decidedAt: string | null; decisionNote: string | null; createdAt: string; balance: number;
}

export interface LeaveType { id: string; name: string; annualQuota: number }

export interface LeaveSummary {
  counts: { submitted: number; underReview: number; approvedThisWeek: number; rejectedThisMonth: number; noCover: number; onLeaveToday: number };
  byMonth: { label: string; value: number }[];
  typeMix: { label: string; value: number }[];
  totalDays: number;
  types: LeaveType[];
}

export interface OvertimeRow {
  id: string; employeeId: string; employeeName: string; employeeCode: string; designation: string; department: string;
  campusName: string; workDate: string; hours: number; reason: string; rate: number; cost: number; status: string;
  approvedBy: string | null; createdAt: string;
}

export interface OvertimeSummary {
  kpis: { hours: number; approvedHours: number; pendingHours: number; pendingCount: number; cost: number; employees: number };
  byDepartment: { label: string; value: number }[];
  trend: { label: string; value: number }[];
}

export interface WorkloadRow {
  id: string; code: string; fullName: string; designation: string; department: string; category: string; campusName: string;
  max: number; recorded: number; assigned: number; sections: number; timetabled: number; periods: number; band: 'over' | 'near' | 'ok';
}

export interface Workload {
  rows: WorkloadRow[];
  kpis: { teachers: number; average: number; over: number; near: number };
  suggestions: { employeeId: string; text: string }[];
}

export interface CpdRow {
  id: string; code: string; fullName: string; designation: string; department: string; employeeType: EmployeeType; campusName: string;
  hours: number; target: number; planned: number; mandatoryComplete: boolean; lastCompleted: string | null;
}

export interface CpdSummary {
  kpis: {
    hoursLogged: number; avgPerTeacher: number | null; belowTarget: number; mandatoryPct: number | null; mandatoryOutstanding: number;
    employees: number; targetTeaching: number; targetNonTeaching: number;
  };
  upcoming: { programme: string; status: string; staff: number; hours: number }[];
}

export type RunStatus = 'Draft' | 'Inputs' | 'Calculated' | 'Under Review' | 'Approved' | 'Released' | 'Paid';

export interface PayrollRun {
  id: string; campusId: string | null; campusName: string | null; campusCode: string | null; payMonth: string; monthLabel: string;
  status: RunStatus; employeeCount: number; gross: number; deductions: number; overtime: number; allowances: number; net: number;
  createdAt: string; createdBy: string | null; calculatedById: string | null; calculatedBy: string | null; calculatedAt: string | null;
  submittedBy: string | null; submittedAt: string | null; approvedBy: string | null; approvedAt: string | null;
  releasedBy: string | null; releasedAt: string | null; paidAt: string | null; reviewNote: string | null; releasedSlips: number;
}

export interface RunDetail {
  run: PayrollRun;
  stage: number;
  stages: RunStatus[];
  byCategory: { label: string; count: number; gross: number; net: number }[];
  inputs: {
    attendance: { marked: number; absent: number; leave: number; lastMarked: string | null };
    leave: { approvedDays: number; pending: number };
    overtime: { hours: number; value: number; items: number };
    allowances: { approved: number; pending: number; pendingValue: number };
    reimbursements: { approved: number; pending: number; pendingValue: number };
    pendingItems: { what: string; count: number; value: number }[];
    pendingCount: number;
  } | null;
  actions: {
    canPrepare: boolean; canSubmit: boolean; canApprove: boolean; makerChecker: boolean;
    canReturn: boolean; canRelease: boolean; canPay: boolean;
  };
}

export interface PayslipRow {
  id: string; employeeId: string; employeeName: string; employeeCode: string; designation: string; employeeType: EmployeeType;
  category: string; runId: string; payMonth: string; monthLabel: string; runStatus: RunStatus; campusName: string | null;
  gross: number; deductions: number; net: number; status: 'Draft' | 'Released'; releasedAt: string | null; previousStatus: string | null;
}

export interface Payslip {
  id: string; employeeId: string; employeeName: string; employeeCode: string; designation: string; department: string;
  bankAccount: string | null; joinDate: string | null; campusName: string | null; campusAddress: string | null;
  runId: string; payMonth: string; monthLabel: string; runStatus: RunStatus; paymentDate: string | null; monthEnd: string;
  earnings: { label: string; amount: number }[]; deductions: { label: string; amount: number }[];
  gross: number; totalDeductions: number; net: number; daysWorked: number; status: string; releasedAt: string | null;
  workingDays: number; leaveDays: number; overtimeHours: number;
}

export interface MyEmployee {
  employee: EmployeeRow;
  shift: { name: string; startsAt: string; endsAt: string; splitStartsAt: string | null; splitEndsAt: string | null } | null;
  rosterToday: RosterEntry | null;
  overtime: { hours: number; pending: number; approved: number };
  lastPayslip: { id: string; monthLabel: string; net: number; releasedAt: string } | null;
  month: { attended: number; marked: number; late: number };
  openRequests: number;
  today: string;
}

export interface MyRosterDay {
  date: string; shift: string | null; duty: string | null; rosterStatus: string | null; attendance: string | null; onLeave: boolean;
}

export interface TaskRow { id: string; code: string; title: string; module: string; dueOn: string | null; priority: string; status: string; route: string | null; overdue: boolean }
