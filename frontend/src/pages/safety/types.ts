/** API shapes for the safety & transport module (see docs/openapi/paths/safety.yaml). */

export interface GateSummary {
  arrived: number;
  inside: number;
  exited: number;
  notArrived: number;
  expected: number;
  visitorsOnSite: number;
  visitorsExpected: number;
  pendingPickup: number;
  pendingAuthorisations: number;
  gates: { gate: string; tone: string; detail: string }[];
  arrivals: { labels: string[]; values: number[] };
  generatedAt: string;
}

export interface FeedItem {
  id: string;
  at: string;
  kind: string;
  icon: string;
  actor: string | null;
  studentId: string | null;
  text: string;
  meta: string | null;
  tone?: string;
}

export interface GateLogRow {
  id: string;
  admissionNo: string;
  fullName: string;
  grade: string | null;
  section: string | null;
  campusName: string;
  firstIn: string | null;
  lastOut: string | null;
  entryMethod: string | null;
  exitGate: string | null;
  arrivalNotified: boolean;
  exitNotified: boolean;
  scans: number;
  status: 'Inside' | 'Exited' | 'Not arrived';
  routeCode: string | null;
}

export interface GateEventRow {
  id: string;
  occurredAt: string;
  direction: 'in' | 'out';
  gate: string;
  method: string;
  parentNotifiedAt: string | null;
  studentId: string;
  admissionNo: string;
  fullName: string;
  grade: string | null;
  section: string | null;
  campusName: string;
}

export interface PickupAuth {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  grade: string | null;
  section: string | null;
  personName: string;
  relation: string;
  phone: string | null;
  method: string;
  status: 'Pending' | 'Verified' | 'Revoked';
  lastPickupAt: string | null;
  createdAt: string;
  parentApproved: boolean;
  approvedByName: string | null;
  otpExpiresAt: string | null;
}

export interface PickupEvent {
  id: string;
  occurredAt: string;
  outcome: 'collected' | 'held';
  personName: string;
  gate: string;
  method: string | null;
  notes: string | null;
  studentId: string;
  studentName: string;
  incidentCode: string | null;
  resolved: boolean;
}

export interface PickupSummary {
  authorisedPersons: number;
  studentsCovered: number;
  averagePerStudent: number;
  verifiedByQrPct: number;
  pendingConfirmation: number;
  otpVerificationsToday: number;
  collectedToday: number;
  heldToday: number;
  heldResolved: number;
  recentEvents: PickupEvent[];
}

export interface Visitor {
  id: string;
  badgeNo: string;
  /** RFID visitor card currently (or last) held. */
  rfidTag: string | null;
  fullName: string;
  phone: string | null;
  purpose: string;
  status: 'Expected' | 'Inside' | 'Completed' | 'Denied';
  checkedInAt: string;
  checkedOutAt: string | null;
  hostId: string | null;
  hostName: string | null;
  hostDesignation: string | null;
  campusName: string;
  createdByName: string | null;
}

export interface VisitorSummary {
  onSite: number;
  today: number;
  preApproved: number;
  notCheckedOut: number;
  checkedOutToday: number;
  deniedToday: number;
}

export type RunStatus = 'Scheduled' | 'En route' | 'Delayed' | 'At campus' | 'Completed' | 'Maintenance';

export interface BusAlert { type: string; tone: string; message: string }
export interface PathPoint { name: string; latitude: number; longitude: number; pickupTime: string }

export interface RouteRow {
  id: string;
  code: string;
  name: string;
  area: string;
  campusId: string;
  campusName: string;
  runStatus: RunStatus;
  delayMinutes: number;
  eta: string | null;
  vehicleId: string | null;
  busNo: string | null;
  registrationNo: string | null;
  capacity: number | null;
  vehicleStatus: string | null;
  driverId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  attendantId: string | null;
  attendantName: string | null;
  students: number;
  stops: number;
  stopsDone: number;
  boardedToday: number;
  deboardedToday: number;
  onboardNow: number;
  deviationMetres: number | null;
  alerts: BusAlert[];
  location: { latitude: number; longitude: number; speedKmph: number | null; heading: number | null; recordedAt: string } | null;
  path: PathPoint[];
}

export interface CampusPoint { id: string; name: string; shortName: string; latitude: number; longitude: number; radiusM: number | null }

export interface RoutesResponse {
  routes: RouteRow[];
  campuses: CampusPoint[];
  summary: { buses: number; students: number; onboardNow: number; atCampus: number; moving: number; delayed: number; maintenance: number; alerts: number };
  generatedAt: string;
}

export interface StopRow {
  id: string;
  sequence: number;
  name: string;
  latitude: number;
  longitude: number;
  pickupTime: string;
  dropTime: string | null;
  students: number;
  boarded: number;
  done: boolean;
}

export interface RouteStudent {
  id: string;
  admissionNo: string;
  fullName: string;
  grade: string | null;
  section: string | null;
  stopId: string | null;
  stopName: string | null;
  pickupTime: string | null;
  mode: string;
  boardedAt: string | null;
  deboardedAt: string | null;
  lastEvent: 'boarded' | 'deboarded' | null;
  method: string | null;
}

export interface RouteDetail extends Omit<RouteRow, 'students'> {
  stopList: StopRow[];
  students: RouteStudent[];
  trail: { latitude: number; longitude: number; speedKmph: number | null; recordedAt: string }[];
}

export interface Vehicle { id: string; busNo: string; registrationNo: string; capacity: number; status: string; campusId: string; routeCode: string | null }

export interface BoardingSummary {
  boarded: number;
  deboarded: number;
  stillOnboard: number;
  notBoarded: number;
  expected: number;
  maintenanceStudents: number;
  afternoonRun: string | null;
  routes: {
    id: string; code: string; name: string; area: string; busNo: string | null; runStatus: RunStatus; attendantName: string | null;
    expected: number; boarded: number; deboarded: number; notBoarded: number; stillOnboard: number; state: string;
  }[];
}

export interface Broadcast {
  id: string;
  alertType: string;
  message: string;
  audience: string;
  recipients: number;
  sentAt: string;
  sentByName: string | null;
  campusName: string | null;
}

export interface Incident {
  id: string;
  code: string;
  campusName: string;
  incidentType: string;
  summary: string;
  details: string | null;
  severity: 'Critical' | 'Attention' | 'Information';
  status: 'Open' | 'Under Review' | 'Escalated' | 'Closed';
  occurredOn: string;
  isConfidential: boolean;
  studentId: string | null;
  studentName: string | null;
  admissionNo: string | null;
  ownerId: string | null;
  ownerName: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentSummary {
  openConcerns: number;
  underReview: number;
  closedThisYear: number;
  closedWithin24h: number;
  escalated: number;
  openAll: number;
  confidential: number;
  last30Days: number;
  byType: { type: string; n: number }[];
  compliance: { id: string; item: string; authority: string; owner: string; dueOn: string; status: string }[];
  canViewConfidential: boolean;
}

export interface InfirmaryVisit {
  id: string;
  visitedAt: string;
  reason: string;
  actionTaken: string | null;
  outcome: string;
  parentInformed: boolean;
  attendedBy: string | null;
  studentId: string;
  studentName: string;
  admissionNo: string;
  grade: string | null;
  section: string | null;
}

export interface InfirmarySummary {
  today: number;
  sentHome: number;
  awaitingPickup: number;
  parentNotInformed: number;
  thisMonth: number;
  lastMonthToDate: number;
  monthDeltaPct: number | null;
  medicalOnFile: number;
  reasons: { label: string; value: number }[];
}

export interface CounsellingSession {
  id: string;
  sessionOn: string;
  reason: string;
  status: 'Scheduled' | 'Completed' | 'Cancelled' | 'Referred';
  notes: string | null;
  hasNotes: boolean;
  counsellorId: string;
  counsellorName: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  grade: string | null;
  section: string | null;
}

export interface CounsellingSummary {
  studentsSupported: number;
  sessionsThisYear: number;
  openCases: number;
  upcoming: number;
  referrals: number;
  reasons: { label: string; value: number }[];
  canViewNotes: boolean;
}

export interface StudentOption {
  id: string;
  admissionNo: string;
  fullName: string;
  grade: string | null;
  section: string | null;
  routeId: string | null;
  routeCode: string | null;
  stopId: string | null;
  stopName: string | null;
}

export const GATES = ['Main Gate', 'Rear Gate', 'Visitor Gate', 'Bus Bay'];
export const PICKUP_METHODS = ['QR', 'QR + Face', 'Face', 'OTP', 'OTP + ID'];
export const RUN_STATUSES: RunStatus[] = ['Scheduled', 'En route', 'Delayed', 'At campus', 'Completed', 'Maintenance'];
export const INCIDENT_TYPES = ['Safeguarding', 'Health', 'Transport', 'Facilities', 'Security', 'Emergency'];
export const SEVERITIES = ['Critical', 'Attention', 'Information'];
export const INCIDENT_STATUSES = ['Open', 'Under Review', 'Escalated', 'Closed'];
export const OUTCOMES = ['Under observation', 'Returned to class', 'Awaiting pickup', 'Sent home', 'Referred to hospital'];
export const SESSION_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'Referred'];
export const VISIT_PURPOSES = ['Parent meeting', 'Admission enquiry', 'Vendor / contractor', 'Audit or inspection', 'Other'];
