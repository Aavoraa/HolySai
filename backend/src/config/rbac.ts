/**
 * Role-Based Access Control — the single source of truth.
 *
 * Permissions are checked on every API route (never only in the UI). Roles
 * also carry a data *scope* that services apply to every query:
 *   school — the whole school (optionally narrowed by campus)
 *   class  — only students in sections the teacher is assigned to
 *   family — only the parent's own children
 *   self   — only the signed-in person's own record
 *
 * The seed writes these definitions to the roles / permissions /
 * role_permissions tables; the API reads permissions from the database so
 * an administrator can change them without a deploy.
 */

export const PERMISSIONS = {
  // Dashboards & reports
  'dashboard.view': 'View the dashboard for your role',
  'dashboard.group': 'View the multi-campus group dashboard',
  'reports.read': 'View analytics and reports',

  // Students
  'students.read': 'View all student records',
  'students.read_assigned': 'View students in your assigned classes',
  'students.create': 'Create student records',
  'students.update': 'Update student records',
  'students.delete': 'Archive (soft delete) student records',
  'students.sensitive': 'View wellbeing, counselling and medical notes',

  // Academics
  'attendance.read': 'View student attendance',
  'attendance.mark': 'Mark student attendance',
  'academics.read': 'View curriculum, timetable, assessments and report cards',
  'academics.manage': 'Manage curriculum, timetable, lesson plans and homework',
  'assessments.manage': 'Create assessments and enter marks',
  'earlywarning.read': 'View Early Warning signals',
  'earlywarning.manage': 'Review and act on Early Warning signals',
  'ai.use': 'Use the AI Teacher Co-Pilot and School Knowledge AI',

  // Student GPS tracking
  'tracking.read_all': 'View the current location of any student',
  'tracking.read_assigned': 'View the current location of students in your classes',
  'tracking.history': 'View student location history',
  'tracking.write': 'Record student locations (devices and integrations)',
  'tracking.manage': 'Enable, pause or disable tracking for a student',
  'tracking.read_own_children': 'View the location of your own children',

  // Admissions & CRM
  'admissions.read': 'View enquiries, follow-ups and applications',
  'admissions.manage': 'Manage enquiries, follow-ups and applications',
  'crm.read': 'View alumni, vendors and partners',
  'crm.manage': 'Manage alumni, vendors and partners',

  // Parents & communication
  'parents.read': 'View the parent directory',
  'parents.manage': 'Create and update parent records',
  'communication.read': 'View parent communication, circulars, PTM and events',
  'communication.send': 'Send messages and publish circulars and events',
  'notifications.broadcast': 'Send school-wide notifications and emergency alerts',

  // Finance
  'finance.read': 'View fees, payments and financial reports',
  'finance.manage': 'Record payments, raise fees, manage concessions and expenses',
  'finance.approve': 'Approve expenses, concessions and reimbursements',
  'fees.pay_own': 'View and pay your own children’s fees',

  // Workforce
  'hr.read': 'View employee records, attendance and leave',
  'hr.manage': 'Manage employee records, shifts, leave and CPD',
  'hr.approve': 'Approve leave, overtime and allowances',
  'payroll.read': 'View payroll runs and payslips',
  'payroll.manage': 'Prepare payroll runs',
  'payroll.approve': 'Approve and release payroll',
  'selfservice.use': 'Use staff self-service (own attendance, leave, payslips)',

  // Safety, transport, operations
  'safety.read': 'View gate, visitor, pickup, infirmary and incident records',
  'safety.manage': 'Record gate, visitor, pickup and incident events',
  'transport.read': 'View routes, buses and boarding',
  'transport.manage': 'Manage routes and confirm boarding',
  'operations.read': 'View assets, facilities, maintenance, inventory and compliance',
  'operations.manage': 'Manage assets, facilities, maintenance, inventory and compliance',
  'documents.read': 'View documents and certificates',
  'documents.manage': 'Upload, verify and issue documents and certificates',

  // Innovation
  'innovation.read': 'View the Innovation Lab',
  'innovation.manage': 'Manage ideas, projects, milestones and competitions',

  // Group & administration
  'group.read': 'View campuses and campus comparison',
  'group.manage': 'Manage transfers and group policies',
  'audit.read': 'View the audit trail',
  'users.manage': 'Manage user accounts and roles',
  'settings.manage': 'Manage system settings',
  'prototype.view': 'View demo and hand-off tools (Day in the Life, Automations, Design System)',

  // Portals
  'parent_portal.use': 'Use the Parent 360 portal',
  'student_portal.use': 'Use the student portal',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export type RoleScope = 'school' | 'class' | 'family' | 'self';

export interface RoleDef {
  key: string;
  name: string;
  description: string;
  homeRoute: string;
  scope: RoleScope;
  permissions: Permission[] | '*';
}

const MANAGEMENT_READ: Permission[] = [
  'dashboard.view', 'dashboard.group', 'reports.read',
  'students.read', 'attendance.read', 'academics.read', 'earlywarning.read',
  'tracking.read_all', 'tracking.history',
  'admissions.read', 'crm.read', 'parents.read', 'communication.read',
  'finance.read', 'hr.read', 'payroll.read',
  'safety.read', 'transport.read', 'operations.read', 'documents.read',
  'innovation.read', 'group.read', 'audit.read', 'ai.use', 'prototype.view',
];

export const ROLES: RoleDef[] = [
  {
    key: 'super_admin', name: 'Super Admin', scope: 'school', homeRoute: '/command-center',
    description: 'Unrestricted platform administration across every campus', permissions: '*',
  },
  {
    key: 'school_admin', name: 'School Admin', scope: 'school', homeRoute: '/command-center',
    description: 'Full school administration, user and settings management',
    permissions: ALL_PERMISSIONS.filter((p) => !['parent_portal.use', 'student_portal.use', 'fees.pay_own', 'tracking.read_own_children', 'selfservice.use'].includes(p)),
  },
  {
    key: 'management', name: 'Management', scope: 'school', homeRoute: '/command-center',
    description: 'Dashboards, reports, authorised student information and tracking',
    permissions: MANAGEMENT_READ,
  },
  {
    key: 'principal', name: 'Principal', scope: 'school', homeRoute: '/command-center',
    description: 'Full analytics, command centre, approvals and group dashboard',
    permissions: [
      ...MANAGEMENT_READ,
      'students.update', 'students.sensitive', 'attendance.mark', 'academics.manage', 'assessments.manage',
      'earlywarning.manage', 'tracking.manage', 'admissions.manage', 'crm.manage', 'parents.manage',
      'communication.send', 'notifications.broadcast', 'finance.approve', 'hr.approve', 'payroll.approve',
      'safety.manage', 'transport.manage', 'operations.manage', 'documents.manage', 'innovation.manage', 'group.manage',
    ],
  },
  {
    key: 'teacher', name: 'Teacher', scope: 'class', homeRoute: '/teacher',
    description: 'Attendance, classes, Student 360, academics, AI Co-Pilot for assigned classes; own leave and payslips',
    permissions: [
      'dashboard.view', 'reports.read', 'students.read_assigned', 'attendance.read', 'attendance.mark',
      'academics.read', 'academics.manage', 'assessments.manage', 'earlywarning.read', 'earlywarning.manage',
      'tracking.read_assigned', 'parents.read', 'communication.read', 'communication.send',
      'safety.read', 'transport.read', 'innovation.read', 'innovation.manage', 'ai.use', 'documents.read',
      // Own attendance, leave, overtime and payslips. Self-scoped: every /me/* route
      // resolves req.user.employeeId and never takes an id from the request.
      'selfservice.use',
    ],
  },
  {
    key: 'hr', name: 'HR', scope: 'school', homeRoute: '/workforce',
    description: 'Employee records, attendance, leave, CPD and payroll preparation',
    permissions: ['dashboard.view', 'reports.read', 'hr.read', 'hr.manage', 'hr.approve', 'payroll.read', 'payroll.manage', 'documents.read', 'documents.manage', 'audit.read'],
  },
  {
    key: 'finance', name: 'Finance', scope: 'school', homeRoute: '/fees',
    description: 'Fees, payments, concessions, expenses, budgets and reconciliation',
    permissions: ['dashboard.view', 'reports.read', 'finance.read', 'finance.manage', 'finance.approve', 'payroll.read', 'students.read', 'parents.read', 'documents.read'],
  },
  {
    key: 'office', name: 'Office', scope: 'school', homeRoute: '/admissions',
    description: 'Admissions, fees, documents, HR records and front-office safety',
    permissions: [
      'dashboard.view', 'reports.read', 'students.read', 'students.create', 'students.update', 'attendance.read',
      'academics.read', 'earlywarning.read', 'tracking.read_all', 'admissions.read', 'admissions.manage',
      'crm.read', 'crm.manage', 'parents.read', 'parents.manage', 'communication.read', 'communication.send',
      'finance.read', 'finance.manage', 'hr.read', 'payroll.read', 'safety.read', 'safety.manage',
      'transport.read', 'operations.read', 'operations.manage', 'documents.read', 'documents.manage', 'innovation.read', 'audit.read',
    ],
  },
  {
    key: 'staff', name: 'Non-Teaching Staff', scope: 'self', homeRoute: '/staff-self',
    description: 'Own attendance, shifts, leave and payslips; transport and gate duties',
    permissions: ['selfservice.use', 'safety.read', 'safety.manage', 'transport.read', 'transport.manage'],
  },
  {
    key: 'parent', name: 'Parent', scope: 'family', homeRoute: '/parent-360',
    description: 'Own children only: tracking, safety, academics, fees, communication',
    permissions: ['parent_portal.use', 'tracking.read_own_children', 'fees.pay_own'],
  },
  {
    key: 'student', name: 'Student', scope: 'self', homeRoute: '/my-profile',
    description: 'Own profile, timetable, homework and achievements',
    permissions: ['student_portal.use'],
  },
];

export function permissionsFor(role: RoleDef): Permission[] {
  return role.permissions === '*' ? ALL_PERMISSIONS : role.permissions;
}
