/** Shapes returned by the parent-experience API (see docs/openapi/paths/parents-experience.yaml). */

export type AudienceKind = 'all' | 'grades' | 'transport' | 'staff';
export interface Audience { kind: AudienceKind; grades?: number[] }

export interface ChildRef { id: string; fullName: string; admissionNo?: string; grade?: string | null; section?: string | null; relationship?: string }

export interface DirectoryRow {
  id: string;
  parentCode: string;
  fullName: string;
  phone: string;
  email: string | null;
  occupation: string | null;
  preferredChannel: string;
  engagement: number;
  lastContactAt: string | null;
  lastContactChannel: string | null;
  hasAppAccount: boolean;
  children: ChildRef[];
  ptmBooked: boolean;
  openQueries: number;
}

export interface DirectorySummary {
  parents: number; appAccounts: number; high: number; medium: number; low: number; averageEngagement: number;
  ptmBooked: number; contacted7d: number; noContact30d: number;
}

export interface ParentRecord {
  id: string; parentCode: string; fullName: string; phone: string; altPhone: string | null; email: string | null; occupation: string | null;
  address: string | null; preferredChannel: string; engagement: number; lastContactAt: string | null; lastContactChannel: string | null; hasAppAccount: boolean;
}

export interface ParentChild {
  id: string; fullName: string; admissionNo: string; grade: string | null; section: string | null; relationship: string; isPrimary: boolean;
  attendance: number | null; average: number | null; risk: string; feeStatus: string;
}

export type Channel = 'WhatsApp' | 'Email' | 'SMS' | 'Call' | 'Note' | 'In-app';

export interface Communication {
  id: string;
  channel: Channel;
  direction: 'inbound' | 'outbound' | 'internal';
  counterpart: string;
  subject: string;
  body: string | null;
  status: string;
  recipients: number;
  needsReply: boolean;
  repliedAt: string | null;
  occurredAt: string;
  threadId: string | null;
  parentId: string | null;
  parentName: string | null;
  parentPhone: string | null;
  parentHasApp: boolean | null;
  studentId: string | null;
  studentName: string | null;
  admissionNo: string | null;
  grade: string | null;
  sentBy: string | null;
  repliedBy: string | null;
  ageHours: number | null;
}

export interface CommSummary {
  last30Days: number; today: number; unanswered: number; unansweredOver24h: number; oldestHours: number;
  byChannel: Record<string, number>; unreadThreads: number;
}

export interface ThreadRow {
  id: string; subject: string; status: 'Open' | 'Closed'; lastMessageAt: string; createdAt: string;
  studentId: string | null; studentName: string | null; admissionNo: string | null; grade: string | null;
  parentId: string | null; parentName: string | null;
  participants: { userId: string; name: string; role: string; title: string | null }[];
  lastMessage: string | null; lastSender: string | null; awaitingReply: boolean | null; messageCount: number; unread: boolean;
}

export interface ThreadDetail extends ThreadRow {
  messages: { id: string; body: string; createdAt: string; senderId: string; senderName: string; senderRole: string; senderTitle: string | null; mine: boolean }[];
}

export interface PtmSession {
  id: string; employeeId: string; teacher: string; designation: string; subjectLabel: string; sectionId: string | null;
  grade: string | null; section: string | null; campusId: string | null; sessionDate: string; startsAt: string; slotMinutes: number;
  totalSlots: number; venue: string | null; booked: number; free: number; sectionStudents: number; past: boolean;
}

export interface PtmBooking {
  id: string; slotNo: number; status: string; bookedAt: string; parentId: string; parentName: string; parentPhone: string;
  studentId: string; studentName: string; admissionNo: string; risk: string;
}

export interface PtmSessionDetail extends PtmSession {
  slots: { slotNo: number; time: string; booking: PtmBooking | null }[];
  bookings: PtmBooking[];
  unbooked: { studentId: string; studentName: string; risk: string; parentId: string | null; parentName: string | null; parentPhone: string | null; hasAppAccount: boolean | null }[];
}

export interface PtmSummary {
  sessions: number; totalSlots: number; booked: number; firstDate: string | null; lastDate: string | null;
  grades: string[]; venues: string[]; unbookedFamilies: number; unbookedStudents: number; prioritiseFamilies: number;
}

export type CircularStatus = 'Draft' | 'Under Review' | 'Released' | 'Withdrawn';

export interface Circular {
  id: string; title: string; body: string; audience: string; audienceFilter: Audience; campusId: string | null; campus: string | null;
  requiresAck: boolean; status: CircularStatus; channels: string[]; publishedAt: string | null; createdAt: string;
  submittedAt: string | null; lastRemindedAt: string | null; reminderCount: number; targetCount: number; ackCount: number;
  createdBy: string | null; submittedBy: string | null; releasedBy: string | null;
  attachments: CircularAttachment[];
}

export interface CircularAttachment { id: string; name: string; mimeType: string; sizeBytes: number; uploadedAt: string }

export interface AckSummary {
  circulars: number; targeted: number; acknowledged: number; outstanding: number; rate: number | null;
  neverAcknowledged: number; drafts: number; underReview: number;
}

export interface AckRow {
  parentId: string; parentName: string; phone: string; engagement: number; hasAppAccount: boolean; acknowledgedAt: string | null;
  children: { id: string; fullName: string; grade: string | null }[];
}

export type EventType = 'School' | 'Sports' | 'Academic' | 'PTM' | 'Cultural' | 'Holiday';

export interface SchoolEvent {
  id: string; title: string; description: string | null; eventType: EventType; startsOn: string; endsOn: string | null;
  startsAt: string | null; venue: string | null; audience: string; audienceFilter: Audience; campusId: string | null; campus: string | null;
  status: 'Draft' | 'Published' | 'Cancelled'; notifiedAt: string | null; createdAt: string; createdBy: string | null;
}

export interface EventSummary { upcoming: number; next30Days: number; drafts: number; cancelled: number }
