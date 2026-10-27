/** Shapes returned by the admissions & CRM API. */

export const STAGES = ['New Lead', 'Contacted', 'Qualified', 'Visit Scheduled', 'Visit Completed', 'Application', 'Assessment', 'Offer', 'Enrolled'] as const;
export const SOURCES = ['WhatsApp', 'Website', 'Meta Ads', 'Referral', 'Google', 'Walk-in', 'Instagram', 'Phone'] as const;
export const FOLLOW_UP_TYPES = ['Call', 'WhatsApp', 'Email', 'SMS', 'Campus Visit', 'Meeting', 'Note'] as const;
export const GRADES = Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`);

export interface Lead {
  id: string;
  code: string;
  parentName: string;
  phone: string;
  email: string | null;
  studentName: string;
  studentDob: string | null;
  grade: string;
  curriculum: string | null;
  source: string;
  campaign: string | null;
  stage: string;
  score: number;
  counsellorId: string | null;
  counsellor: string | null;
  transportRequired: boolean;
  nextAction: string | null;
  nextActionAt: string | null;
  overdue: boolean;
  lostReason: string | null;
  acquisitionCost: number;
  campusId: string;
  campusName: string;
  createdAt: string;
  updatedAt: string;
  applicationId: string | null;
  applicationNo: string | null;
  applicationStatus: string | null;
  studentId: string | null;
}

export interface FollowUp {
  id: string;
  type: string;
  scheduledAt: string;
  completedAt: string | null;
  outcome: string | null;
  notes: string | null;
  status: 'Scheduled' | 'Completed' | 'Missed' | 'Cancelled';
  assignedTo: string | null;
  assignedName: string | null;
  overdue: boolean;
}

export interface Communication {
  id: string;
  channel: string;
  direction: string;
  counterpart: string;
  subject: string;
  body: string | null;
  status: string;
  occurredAt: string;
  sentBy: string | null;
  automated: boolean;
}

export interface AppDocument { id: string; name: string; status: string; verifiedAt: string | null; hasFile?: boolean; fileName?: string | null; mimeType?: string | null }

export type FormStatus = 'Not received' | 'Entered manually' | 'Uploaded' | 'Both';

/** The admission form as typed in by the office (every field optional while it is a draft). */
export type AdmissionFormData = Partial<Record<string, string | boolean>>;

export interface Application {
  id: string;
  applicationNo: string;
  status: string;
  studentName: string;
  dateOfBirth: string | null;
  gender: 'M' | 'F' | 'O' | null;
  grade: string;
  previousSchool: string | null;
  documentsComplete: boolean;
  assessmentAt: string | null;
  assessmentScore: number | null;
  offerExpiresOn: string | null;
  feePaid: boolean;
  studentId: string | null;
  admissionNo: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  createdAt: string;
  campusId: string;
  documents: AppDocument[];
  formStatus: FormStatus;
  formSource: 'Manual' | 'Upload' | 'Online' | null;
  formReceivedOn: string | null;
  formComplete: boolean;
  formDocumentId: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  fatherName: string | null;
  motherName: string | null;
  formData: AdmissionFormData;
}

export interface LeadProfile extends Lead {
  notes: string | null;
  stageIndex: number;
  referredBy: { parentId: string; parentName: string; rewardStatus: string } | null;
  history: { id: number; fromStage: string | null; toStage: string; note: string | null; changedAt: string; changedBy: string | null }[];
  followUps: FollowUp[];
  communications: Communication[];
  application: Application | null;
}

export interface Counsellor { id: string; fullName: string; designation: string; campusName: string; hasAccount: boolean; openLeads: number }

export interface ApplicationRow {
  id: string;
  applicationNo: string;
  status: string;
  studentName: string;
  grade: string;
  documentsTotal: number;
  documentsVerified: number;
  assessmentAt: string | null;
  offerExpiresOn: string | null;
  studentId: string | null;
  admissionNo: string | null;
  campusName: string;
  enquiryId: string | null;
  leadCode: string | null;
  parentName: string | null;
  curriculum: string | null;
  stage: string | null;
  counsellor: string | null;
  blockingItem: string;
  offerExpiring: boolean;
  createdAt: string;
  formStatus: FormStatus;
  formSource: string | null;
  formReceivedOn: string | null;
  formComplete: boolean;
  formDocumentId: string | null;
  fatherName: string | null;
  motherName: string | null;
  guardianPhone: string | null;
}

export interface Visit {
  id: string;
  scheduledAt: string;
  completedAt: string | null;
  status: string;
  outcome: string | null;
  notes: string | null;
  hostId: string | null;
  host: string | null;
  overdue: boolean;
  enquiryId: string;
  code: string;
  family: string;
  studentName: string;
  grade: string;
  stage: string;
  phone: string;
  campusName: string;
}

export interface Named { label: string; value: number }
