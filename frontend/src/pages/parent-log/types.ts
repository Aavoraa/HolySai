export type Source = 'manual' | 'communication' | 'message' | 'ptm' | 'visitor';
export type ContactKind = 'parent' | 'teacher' | 'staff' | 'other';
export type TargetKind = 'principal' | 'staff' | 'office' | 'class_teacher' | 'management';

export interface LogRow {
  id: string;
  source: Source;
  sourceId: string;
  code: string | null;
  occurredAt: string;
  campusId: string | null;
  contactKind: ContactKind;
  parentId: string | null;
  parentCode: string | null;
  employeeId: string | null;
  employeeDesignation: string | null;
  contactName: string;
  contactPhone: string | null;
  studentId: string | null;
  studentName: string | null;
  admissionNo: string | null;
  grade: string | null;
  targetKind: TargetKind;
  targetEmployeeId: string | null;
  targetUserId: string | null;
  targetName: string;
  targetDesignation: string | null;
  channel: string;
  purpose: string;
  outcome: string;
  isOpen: boolean;
  summary: string;
  details: string | null;
  loggedBy: string | null;
  loggedByName: string | null;
  followUpOn: string | null;
  resolvedAt: string | null;
  followUpOverdue: boolean;
}

export interface KeyCount { key: string; n: number }

export interface TopParent {
  parentId: string; fullName: string; parentCode: string | null; phone: string | null; contacts: number; toPrincipal: number; open: number;
  lastContactAt: string; lastChannel: string; lastPurpose: string;
}

export interface RepeatContact {
  key: string; parentId: string | null; employeeId: string | null; contactKind: ContactKind; contactName: string; phone: string | null;
  attempts: number; toPrincipal: number; firstAt: string; lastAt: string; channels: string[]; lastPurpose: string; lastOutcome: string; lastTarget: string;
}

export interface StaffApproached { employeeId: string; fullName: string; designation: string | null; contacts: number; open: number; fromParents: number }

export interface Summary {
  range: { from: string; to: string; repeatFrom: string };
  scope: 'all' | 'mine';
  principal: { employeeId: string | null; fullName: string } | null;
  totals: {
    total: number; toPrincipal: number; principalUnreached: number; principalOpen: number; open: number; followUpsOverdue: number;
    fromParents: number; fromStaff: number; fromOthers: number; distinctParents: number; manual: number; automatic: number; repeatContacts: number;
  };
  byChannel: KeyCount[]; byPurpose: KeyCount[]; byOutcome: KeyCount[]; bySource: KeyCount[]; byTarget: KeyCount[];
  byWeek: { week: string; total: number; toPrincipal: number; open: number }[];
  topParents: TopParent[];
  repeatContacts: RepeatContact[];
  staffApproached: StaffApproached[];
}

export interface Child { id: string; fullName: string; admissionNo: string; grade: string | null; section: string | null; campusId?: string }

export interface ParentHit { id: string; parentCode: string; fullName: string; phone: string; children: Child[] }

export interface StaffTarget {
  id: string; employeeCode: string; fullName: string; designation: string; department: string; employeeType: 'teaching' | 'non_teaching';
  campusId: string; hasAccount: boolean; isPrincipal: boolean;
}

export interface Targets {
  principal: { userId: string; employeeId: string | null; fullName: string; campusId: string | null } | null;
  staff: StaffTarget[];
}

export interface ParentHistory {
  parent: { id: string; parentCode: string; fullName: string; phone: string; altPhone: string | null; email: string | null; hasAppAccount: boolean; children: Child[] };
  counts: {
    total: number; toPrincipal: number; open: number; last30Days: number; last14Days: number; firstAt: string | null; lastAt: string | null;
    bySource: Record<string, number>; byChannel: Record<string, number>;
  };
  rows: LogRow[];
  scope: 'all' | 'mine';
}
