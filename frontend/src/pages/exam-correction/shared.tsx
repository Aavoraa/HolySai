/**
 * Paper Correction (EXAM Vision) — shared types, API paths and small pieces.
 * Every call goes through the Holy Sai API, which forwards /exam-correction/api/* to the
 * marking service as the signed-in user.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge, Banner, Button, Card, Empty, Modal, TextArea } from '@/components/ui';

export const EV = '/exam-correction/api';
export const BASE = '/paper-correction';

export type ExamRole = 'admin' | 'coordinator' | 'teacher';

export interface PcStatus {
  connected: boolean;
  /** The service is waking up (free hosting sleeps when idle). */
  waking?: boolean;
  reason: string | null;
  role: ExamRole | null;
  ai?: AiStatus;
  lastSync: { at: string; students_created: number; students_updated: number; staff: number } | null;
}
export interface AiStatus {
  reading_available: boolean; reading_reason: string; marking_available: boolean; marking_reason: string;
  vision_model: string; eval_model: string;
}

export interface Criterion { id: string; name: string; max_marks: number; description?: string }
export interface Rubric {
  version: number; source: 'teacher' | 'ai_draft'; reference_answer: string; criteria: Criterion[];
  expected_concepts: string[]; alternatives: string[]; misconceptions: string[]; partial_credit_rules: string;
  required_elements: string; ignore_criteria: string; subject_rules: string; created_at?: string;
}
export interface Question {
  id: string; number: string; order: number; text: string; qtype: string; max_marks: number; mark_increment: number;
  numeric_answer: string | null; numeric_tolerance: number; unit: string | null; rubric: Rubric | null; rubric_problems: string[];
}
export interface Exam {
  id: string; name: string; academic_year: string; class_name: string; section: string; subject: string; grade_level: string;
  instructions: string; results_status: 'draft' | 'reviewed' | 'approved' | 'published'; maximum: number; question_count: number;
  teachers: { id: string; name: string }[];
  counts: { submissions: number; processing: number; pending_review: number; approved: number; failed: number };
  questions?: Question[];
}
export interface Job { id: string; kind: string; status: string; progress: string; error: string | null }
export interface Totals { total: number; maximum: number; marked: number; questions: number; approved: boolean }
export interface SheetRow {
  id: string; student: { id: string; name: string; admission_no: string; roll_no: string }; status: string; status_note: string;
  pages: number; identity_verified: boolean; filename: string; created_at: string; totals: Totals;
  cost: { cost_usd: number; input_tokens: number; output_tokens: number }; name_check: { status: string; detail: string } | null; job: Job | null;
}
export interface EvStudent { id: string; admission_no: string; name: string; class_name: string; section: string; roll_no: string }

export const QTYPES = ['short', 'long', 'math', 'science', 'diagram', 'essay', 'comprehension', 'translation'];

/** Marks shown to two decimals at most, without trailing zeros. */
export const marks = (n: number | null | undefined) => (n == null ? '—' : String(Math.round(n * 100) / 100));

const TONE: Record<string, string> = {
  uploaded: 'neutral', extracting: 'info', extracted: 'info', evaluating: 'info', evaluated: 'navy', reviewed: 'warning',
  approved: 'success', needs_attention: 'critical', failed: 'critical', pending: 'neutral', suggested: 'navy',
  needs_review: 'warning', draft: 'neutral', published: 'success', verified: 'success', unverified: 'neutral',
  needs_verification: 'critical', queued: 'info', running: 'info', done: 'success', ok: 'success', invalid: 'critical',
};
const LABEL: Record<string, string> = { evaluated: 'AI marked', suggested: 'AI suggested', extracted: 'read' };

export function EvStatus({ value }: { value?: string | null }) {
  if (!value) return <span className="t-faint">—</span>;
  return <Badge tone={TONE[value] ?? 'neutral'}>{LABEL[value] ?? value.replaceAll('_', ' ')}</Badge>;
}

export const isBusy = (job: Job | null | undefined) => !!job && (job.status === 'queued' || job.status === 'running');

/** Service status: connection, the caller's role and Claude readiness. Re-checks every 10 s while the service wakes. */
export function usePcStatus() {
  return useQuery<PcStatus>({
    queryKey: ['/exam-correction/status', {}],
    queryFn: ({ signal }) => api.get<PcStatus>('/exam-correction/status', undefined, signal),
    staleTime: 60_000,
    refetchInterval: (q) => (q.state.data?.waking ? 10_000 : false),
  });
}

/** Shown while the connection check runs; on free hosting the service may need up to a minute to wake. */
export function Connecting() {
  return (
    <Card>
      <Empty icon="clock" title="Connecting to Paper Correction…"
        sub="If the marking service has been idle it takes up to a minute to start. This page continues by itself." />
    </Card>
  );
}

export function NotConnected({ status, onRetry }: { status?: PcStatus; onRetry?: () => void }) {
  if (status?.waking) {
    return (
      <Card>
        <Empty icon="clock" title="Starting Paper Correction…"
          sub="The marking service sleeps when nobody uses it and takes up to a minute to wake. This page continues by itself." />
      </Card>
    );
  }
  return (
    <Card>
      <Empty icon="alert" title="Paper Correction is not connected"
        sub={<>{status?.reason ?? 'The marking service is not available.'} An administrator starts it from <code>exam-vision/</code> — see HOW-TO-RUN.txt.</>}
        action={onRetry && <Button icon="refresh" onClick={onRetry}>Try again</Button>} />
    </Card>
  );
}

export function AiNotReady({ ai }: { ai?: AiStatus }) {
  if (!ai || ai.reading_available) return null;
  return <Banner tone="warning" icon="alert">Answer sheets can be uploaded, but Claude cannot read them yet: {ai.reading_reason}</Banner>;
}

/** A small "why?" dialog for actions that need a reason on record. */
export function ReasonModal({ title, label, confirmLabel, busy, onClose, onSubmit, children }: {
  title: string; label: string; confirmLabel: string; busy?: boolean; onClose: () => void; onSubmit: (reason: string) => void; children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal open onClose={onClose} title={title} busy={busy}
      foot={<><Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={() => (reason.trim() ? onSubmit(reason.trim()) : setError('Enter a reason'))}>{confirmLabel}</Button></>}>
      {children}
      <TextArea label={label} required value={reason} onChange={(v) => { setReason(v); setError(''); }} error={error} rows={3} maxLength={500} autoFocus />
    </Modal>
  );
}
