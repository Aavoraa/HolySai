/**
 * Sidebar model — the wireframe's twelve groups, driven by API permissions
 * instead of hard-coded roles. An item is shown when the user holds ANY of
 * its permissions (the API enforces the same rule on every request).
 */
export interface NavItem {
  label: string;
  icon: string;
  to: string;
  perm?: string[];
  /** Live badge source */
  badge?: 'alerts' | 'tasks';
  tone?: 'alert' | 'amber';
  /** "Dashboard" resolves to the role's home route */
  dynamicHome?: boolean;
  /** Show only to these role keys (in addition to permission) */
  roles?: string[];
  /** Never show to these role keys, even when they hold the permission. */
  hideRoles?: string[];
}

export interface NavGroup {
  group: string;
  icon: string;
  items: NavItem[];
}

/**
 * Personal workspaces that belong to one role's own records. Administrators hold
 * the permissions (Super Admin holds every permission), but have no employee,
 * parent or student record behind these screens, so the pages only report that
 * nothing is linked to the account. Hidden from the menu rather than shown empty.
 */
const NOT_FOR_ADMINS = ['super_admin', 'school_admin', 'principal'];

const STAFF_STUDENTS = ['students.read', 'students.read_assigned'];
const STAFF_TRACK = ['tracking.read_all', 'tracking.read_assigned'];
const DEVICES = ['tracking.read_all', 'tracking.manage'];

export const NAV: NavGroup[] = [
  {
    group: 'Overview', icon: 'grid', items: [
      { label: 'Dashboard', icon: 'home', to: '/command-center', dynamicHome: true },
      { label: 'Command Center', icon: 'pulse', to: '/command-center', perm: ['dashboard.group'] },
      { label: 'Teacher Dashboard', icon: 'bookOpen', to: '/teacher', perm: ['attendance.mark'], hideRoles: NOT_FOR_ADMINS },
      { label: 'Parent 360', icon: 'heart', to: '/parent-360', perm: ['parent_portal.use'], hideRoles: NOT_FOR_ADMINS },
      { label: 'My Profile', icon: 'user', to: '/my-profile', perm: ['student_portal.use'], hideRoles: NOT_FOR_ADMINS },
      { label: 'Staff Self-Service', icon: 'idCard', to: '/staff-self', perm: ['selfservice.use'], hideRoles: NOT_FOR_ADMINS },
      { label: 'Notifications', icon: 'bell', to: '/notifications', badge: 'alerts', tone: 'alert' },
      { label: 'My Tasks', icon: 'checkSquare', to: '/my-tasks', badge: 'tasks' },
    ],
  },
  {
    group: 'Student Management', icon: 'users', items: [
      { label: 'Students', icon: 'users', to: '/students', perm: STAFF_STUDENTS },
      { label: 'Student 360', icon: 'user', to: '/student-360', perm: STAFF_STUDENTS },
      { label: 'Student Tracking', icon: 'mapPin', to: '/student-tracking', perm: STAFF_TRACK },
      { label: 'Attendance', icon: 'checkSquare', to: '/attendance', perm: ['attendance.read'] },
      { label: 'Academic Performance', icon: 'trending', to: '/academic-performance', perm: STAFF_STUDENTS },
      { label: 'Assessments', icon: 'clipboard', to: '/assessments', perm: ['academics.read'] },
      { label: 'Behaviour & Wellbeing', icon: 'heart', to: '/wellbeing', perm: STAFF_STUDENTS },
      { label: 'Student Portfolio', icon: 'folder', to: '/portfolio', perm: STAFF_STUDENTS },
      { label: 'Talent Discovery', icon: 'sparkle', to: '/talent', perm: [...STAFF_STUDENTS, 'ai.use'] },
      { label: 'Early Warning', icon: 'alert', to: '/early-warning', perm: ['earlywarning.read'], tone: 'alert' },
    ],
  },
  {
    group: 'Admissions & CRM', icon: 'target', items: [
      { label: 'Admissions Dashboard', icon: 'target', to: '/admissions', perm: ['admissions.read'] },
      { label: 'Leads', icon: 'list', to: '/leads', perm: ['admissions.read'] },
      { label: 'Enquiries', icon: 'message', to: '/enquiries', perm: ['admissions.read'] },
      { label: 'Counselling Pipeline', icon: 'layers', to: '/pipeline', perm: ['admissions.read'] },
      { label: 'Applications', icon: 'fileText', to: '/applications', perm: ['admissions.read'] },
      { label: 'Campus Visits', icon: 'mapPin', to: '/visits', perm: ['admissions.read'] },
      { label: 'Conversion Analytics', icon: 'percent', to: '/conversion', perm: ['admissions.read'] },
      { label: 'Parent Referrals', icon: 'link', to: '/referrals', perm: ['admissions.read'] },
      { label: 'Alumni', icon: 'graduation', to: '/alumni', perm: ['crm.read'] },
      { label: 'Vendors & Partners', icon: 'briefcase', to: '/vendors', perm: ['crm.read'] },
    ],
  },
  {
    group: 'Academics', icon: 'book', items: [
      { label: 'Curriculum', icon: 'bookOpen', to: '/curriculum', perm: ['academics.read'] },
      { label: 'Classes', icon: 'grid', to: '/classes', perm: ['academics.read'] },
      { label: 'Subjects', icon: 'book', to: '/subjects', perm: ['academics.read'] },
      { label: 'Timetable', icon: 'calendar', to: '/timetable', perm: ['academics.read'] },
      { label: 'Lesson Plans', icon: 'clipboard', to: '/lesson-plans', perm: ['academics.read'] },
      { label: 'Homework', icon: 'edit', to: '/homework', perm: ['academics.read'] },
      { label: 'Question Bank', icon: 'helpCircle', to: '/question-bank', perm: ['academics.read'] },
      { label: 'Assessments', icon: 'checkSquare', to: '/assessments', perm: ['academics.read'] },
      { label: 'Report Cards', icon: 'fileText', to: '/report-cards', perm: ['academics.read'] },
      { label: 'Cambridge Objectives', icon: 'target', to: '/objectives', perm: ['academics.read'] },
    ],
  },
  {
    group: 'Parent Experience', icon: 'heart', items: [
      { label: 'Parent Directory', icon: 'users', to: '/parent-directory', perm: ['parents.read'] },
      { label: 'Parent Communication', icon: 'message', to: '/parent-communication', perm: ['communication.read'] },
      { label: 'PTM', icon: 'calendar', to: '/ptm', perm: ['communication.read'] },
      { label: 'Circulars', icon: 'megaphone', to: '/circulars', perm: ['communication.read'] },
      { label: 'Events', icon: 'star', to: '/events', perm: ['communication.read'] },
      { label: 'Acknowledgements', icon: 'checkSquare', to: '/acknowledgements', perm: ['communication.read'] },
    ],
  },
  {
    group: 'Safety & Transport', icon: 'shield', items: [
      { label: 'Smart Gate', icon: 'door', to: '/smart-gate', perm: ['safety.read'] },
      { label: 'Gate Entry/Exit', icon: 'scan', to: '/gate-log', perm: ['safety.read'] },
      { label: 'Pickup Authorisation', icon: 'key', to: '/pickup', perm: ['safety.read'] },
      { label: 'Visitor Management', icon: 'idCard', to: '/visitors', perm: ['safety.read'] },
      { label: 'Student Tracking', icon: 'mapPin', to: '/student-tracking', perm: STAFF_TRACK },
      { label: 'GPS Devices', icon: 'navigation', to: '/gps-devices', perm: DEVICES },
      { label: 'Device Assignments', icon: 'link', to: '/device-assignments', perm: DEVICES },
      { label: 'Bus Tracking', icon: 'bus', to: '/bus-tracking', perm: ['transport.read'] },
      { label: 'Routes', icon: 'route', to: '/routes', perm: ['transport.read'] },
      { label: 'Boarding/De-boarding', icon: 'navigation', to: '/boarding', perm: ['transport.read'] },
      { label: 'Emergency Alerts', icon: 'megaphone', to: '/emergency', perm: ['safety.read'] },
      { label: 'Safeguarding', icon: 'shieldCheck', to: '/safeguarding', perm: ['safety.read'] },
      { label: 'Health & Infirmary', icon: 'stethoscope', to: '/infirmary', perm: ['safety.read'] },
      { label: 'Counselling', icon: 'heart', to: '/counselling', perm: ['safety.read'] },
    ],
  },
  {
    group: 'Finance', icon: 'wallet', items: [
      { label: 'Fee Structures', icon: 'layers', to: '/fee-structures', perm: ['finance.read'] },
      { label: 'Fee Collection', icon: 'wallet', to: '/fees', perm: ['finance.read'] },
      { label: 'Student Accounts', icon: 'user', to: '/student-accounts', perm: ['finance.read'] },
      { label: 'Payments', icon: 'creditCard', to: '/payments', perm: ['finance.read'] },
      { label: 'Receipts', icon: 'receipt', to: '/receipts', perm: ['finance.read'] },
      { label: 'Concessions', icon: 'percent', to: '/concessions', perm: ['finance.read'] },
      { label: 'Scholarships', icon: 'award', to: '/scholarships', perm: ['finance.read'] },
      { label: 'Expenses', icon: 'fileText', to: '/expenses', perm: ['finance.read'] },
      { label: 'Reimbursements', icon: 'refresh', to: '/reimbursements', perm: ['finance.read'] },
      { label: 'Allowances', icon: 'plus', to: '/allowances', perm: ['finance.read'] },
      { label: 'Budgets', icon: 'pieChart', to: '/budgets', perm: ['finance.read'] },
      { label: 'Reconciliation', icon: 'check', to: '/reconciliation', perm: ['finance.read'] },
      { label: 'Financial Reports', icon: 'barChart', to: '/financial-reports', perm: ['finance.read'] },
    ],
  },
  {
    group: 'Workforce', icon: 'briefcase', items: [
      { label: 'Employee Directory', icon: 'users', to: '/workforce', perm: ['hr.read'] },
      { label: 'Teaching Staff', icon: 'graduation', to: '/teaching-staff', perm: ['hr.read'] },
      { label: 'Non-Teaching Staff', icon: 'tool', to: '/non-teaching-staff', perm: ['hr.read'] },
      { label: 'Attendance', icon: 'checkSquare', to: '/staff-attendance', perm: ['hr.read'] },
      { label: 'Shifts & Rosters', icon: 'clock', to: '/shifts', perm: ['hr.read'] },
      { label: 'Leave', icon: 'calendar', to: '/leave', perm: ['hr.read'] },
      { label: 'Overtime', icon: 'clock', to: '/overtime', perm: ['hr.read'] },
      { label: 'Allowances', icon: 'plus', to: '/staff-allowances', perm: ['hr.read', 'finance.read'] },
      { label: 'Workload', icon: 'barChart', to: '/workload', perm: ['hr.read'] },
      { label: 'CPD', icon: 'award', to: '/cpd', perm: ['hr.read'] },
      { label: 'Payroll', icon: 'wallet', to: '/payroll', perm: ['payroll.read'], tone: 'amber' },
      { label: 'Payslips', icon: 'receipt', to: '/payslips', perm: ['payroll.read'] },
    ],
  },
  {
    group: 'Operations', icon: 'box', items: [
      { label: 'Assets', icon: 'box', to: '/assets', perm: ['operations.read'] },
      { label: 'Facilities', icon: 'building', to: '/facilities', perm: ['operations.read'] },
      { label: 'Maintenance', icon: 'wrench', to: '/maintenance', perm: ['operations.read'] },
      { label: 'Inventory', icon: 'layers', to: '/inventory', perm: ['operations.read'] },
      { label: 'Documents', icon: 'folder', to: '/documents', perm: ['documents.read'] },
      { label: 'Certificates', icon: 'award', to: '/certificates', perm: ['documents.read'] },
      { label: 'Circulars', icon: 'megaphone', to: '/op-circulars', perm: ['operations.read'] },
      { label: 'Compliance Calendar', icon: 'shield', to: '/compliance', perm: ['operations.read'], tone: 'alert' },
      { label: 'Audit Trail', icon: 'list', to: '/audit', perm: ['audit.read'] },
    ],
  },
  {
    group: 'Innovation', icon: 'rocket', items: [
      // The student portal's own entry — submit an idea and follow its review.
      { label: 'My Ideas', icon: 'lightbulb', to: '/my-ideas', perm: ['student_portal.use'] },
      { label: 'Innovation Lab', icon: 'rocket', to: '/innovation', perm: ['innovation.read'] },
      { label: 'Ideas', icon: 'lightbulb', to: '/ideas', perm: ['innovation.read'] },
      { label: 'Projects', icon: 'puzzle', to: '/projects', perm: ['innovation.read'] },
      { label: 'Mentors', icon: 'users', to: '/mentors', perm: ['innovation.read'] },
      { label: 'Milestones', icon: 'flag', to: '/milestones', perm: ['innovation.read'] },
      { label: 'Competitions', icon: 'award', to: '/competitions', perm: ['innovation.read'] },
      { label: 'Achievements', icon: 'star', to: '/achievements', perm: ['innovation.read'] },
    ],
  },
  {
    group: 'Intelligence', icon: 'brain', items: [
      { label: 'AI Teacher Co-Pilot', icon: 'sparkle', to: '/copilot', perm: ['ai.use'] },
      { label: 'School Knowledge AI', icon: 'brain', to: '/knowledge-ai', perm: ['ai.use'] },
      { label: 'Talent Discovery', icon: 'star', to: '/talent', perm: [...STAFF_STUDENTS, 'ai.use'] },
      { label: 'Early Warning', icon: 'alert', to: '/early-warning', perm: ['earlywarning.read'] },
      { label: 'Analytics', icon: 'chart', to: '/analytics', perm: ['reports.read'] },
      { label: 'Reports', icon: 'fileText', to: '/reports', perm: ['reports.read'] },
    ],
  },
  {
    group: 'Group Management', icon: 'building', items: [
      { label: 'Campuses', icon: 'building', to: '/campuses', perm: ['group.read'] },
      { label: 'Group Dashboard', icon: 'globe', to: '/group-dashboard', perm: ['dashboard.group'] },
      { label: 'Campus Comparison', icon: 'barChart', to: '/campus-comparison', perm: ['group.read'] },
      { label: 'Transfers', icon: 'refresh', to: '/transfers', perm: ['group.read'] },
      { label: 'Group Policies', icon: 'shield', to: '/group-policies', perm: ['group.read'] },
    ],
  },
  {
    group: 'Administration', icon: 'settings', items: [
      { label: 'Report Centre', icon: 'barChart', to: '/admin/reports', perm: ['users.manage'] },
      { label: 'Users & Roles', icon: 'users', to: '/admin/users', perm: ['users.manage'] },
      { label: 'System Settings', icon: 'settings', to: '/admin/settings', perm: ['settings.manage'] },
    ],
  },
  {
    // Demo and hand-off tools; Management only in the wireframe.
    group: 'Prototype', icon: 'play', items: [
      { label: 'Day in the Life', icon: 'clock', to: '/day-in-life', perm: ['prototype.view'] },
      { label: 'Automation Flows', icon: 'zap', to: '/automations', perm: ['prototype.view'] },
      { label: 'WhatsApp AI', icon: 'message', to: '/whatsapp-ai', perm: ['prototype.view'] },
      { label: 'Design System', icon: 'layers', to: '/design-system', perm: ['prototype.view'] },
    ],
  },
];

/** Mobile bottom navigation per role (wireframe), falling back to a generic set. */
export const MOBILE_NAV: Record<string, { label: string; icon: string; to?: string; drawer?: boolean }[]> = {
  principal: [
    { label: 'Pulse', icon: 'pulse', to: '/command-center' },
    { label: 'Students', icon: 'users', to: '/students' },
    { label: 'Alerts', icon: 'bell', to: '/notifications' },
    { label: 'Tracking', icon: 'mapPin', to: '/student-tracking' },
    { label: 'More', icon: 'menu', drawer: true },
  ],
  teacher: [
    { label: 'Home', icon: 'home', to: '/teacher' },
    { label: 'Attendance', icon: 'checkSquare', to: '/attendance' },
    { label: 'Co-Pilot', icon: 'sparkle', to: '/copilot' },
    { label: 'Students', icon: 'users', to: '/students' },
    { label: 'More', icon: 'menu', drawer: true },
  ],
  parent: [
    { label: 'Home', icon: 'home', to: '/parent-360' },
    { label: 'Track', icon: 'mapPin', to: '/parent-360?tab=track' },
    { label: 'Academics', icon: 'bookOpen', to: '/parent-360?tab=academics' },
    { label: 'Fees', icon: 'wallet', to: '/parent-360?tab=fees' },
    { label: 'More', icon: 'menu', drawer: true },
  ],
  office: [
    { label: 'Admissions', icon: 'target', to: '/admissions' },
    { label: 'Fees', icon: 'wallet', to: '/fees' },
    { label: 'Students', icon: 'users', to: '/students' },
    { label: 'Tasks', icon: 'checkSquare', to: '/my-tasks' },
    { label: 'More', icon: 'menu', drawer: true },
  ],
  staff: [
    { label: 'Home', icon: 'home', to: '/staff-self' },
    { label: 'Transport', icon: 'bus', to: '/bus-tracking' },
    { label: 'Gate', icon: 'scan', to: '/gate-log' },
    { label: 'Alerts', icon: 'bell', to: '/notifications' },
    { label: 'More', icon: 'menu', drawer: true },
  ],
  student: [
    { label: 'Me', icon: 'user', to: '/my-profile' },
    { label: 'Alerts', icon: 'bell', to: '/notifications' },
    { label: 'Tasks', icon: 'checkSquare', to: '/my-tasks' },
    { label: 'More', icon: 'menu', drawer: true },
  ],
};

export function mobileNavFor(roleKey: string, homeRoute: string) {
  return MOBILE_NAV[roleKey] ?? [
    { label: 'Home', icon: 'home', to: homeRoute },
    { label: 'Alerts', icon: 'bell', to: '/notifications' },
    { label: 'Tasks', icon: 'checkSquare', to: '/my-tasks' },
    { label: 'More', icon: 'menu', drawer: true },
  ];
}
