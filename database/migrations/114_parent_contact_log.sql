-- =============================================================================
-- 114 PARENT CONTACT LOG
-- How often parents (and teachers/staff) approach or try to reach the
-- principal and staff. Two parts:
--   1. contact_log_entries — walk-ins, calls and other attempts recorded by hand
--      by the front office or staff (who wanted to meet whom, why, outcome).
--   2. contact_log_v — one unified log that merges those manual entries with
--      parent contacts the app already records: inbound communications,
--      parent-started message threads, PTM bookings and gate visitors whose
--      phone matches a parent.
-- =============================================================================

CREATE TABLE contact_log_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,                       -- CL-0001
  campus_id          uuid REFERENCES campuses(id),
  contact_kind       text NOT NULL CHECK (contact_kind IN ('parent', 'teacher', 'staff', 'other')),
  parent_id          uuid REFERENCES parents(id) ON DELETE SET NULL,
  employee_id        uuid REFERENCES employees(id) ON DELETE SET NULL,  -- the teacher / staff member approaching
  contact_name       text NOT NULL,                              -- denormalised, or the name for 'other'
  contact_phone      text,
  student_id         uuid REFERENCES students(id) ON DELETE SET NULL,
  target_kind        text NOT NULL CHECK (target_kind IN ('principal', 'staff', 'office', 'class_teacher', 'management')),
  target_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  target_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  channel            text NOT NULL CHECK (channel IN ('Walk-in', 'Phone call', 'WhatsApp', 'Email', 'Message', 'Letter', 'Other')),
  purpose_category   text NOT NULL CHECK (purpose_category IN ('Academic', 'Fees', 'Transport', 'Admission', 'Complaint', 'Behaviour',
                                                               'Health', 'Leave', 'Meeting request', 'General', 'Other')),
  summary            text NOT NULL,
  outcome            text NOT NULL DEFAULT 'Pending' CHECK (outcome IN ('Met', 'Spoke on call', 'Not available', 'Callback scheduled',
                                                                       'Message left', 'Resolved', 'Escalated', 'Pending')),
  resolution_note    text,
  follow_up_on       date,
  resolved_at        timestamptz,
  resolved_by        uuid REFERENCES users(id),
  logged_by          uuid REFERENCES users(id),
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (contact_kind <> 'parent' OR parent_id IS NOT NULL),
  CHECK (contact_kind NOT IN ('teacher', 'staff') OR employee_id IS NOT NULL)
);
SELECT attach_updated_at('contact_log_entries');
CREATE INDEX ix_contact_log_parent ON contact_log_entries (parent_id, occurred_at DESC);
CREATE INDEX ix_contact_log_target ON contact_log_entries (target_employee_id);
CREATE INDEX ix_contact_log_time ON contact_log_entries (occurred_at DESC);
CREATE INDEX ix_contact_log_open ON contact_log_entries (follow_up_on) WHERE resolved_at IS NULL;

-- Visitors are matched to parents by the last ten digits of the phone number.
CREATE OR REPLACE FUNCTION phone_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(regexp_replace(COALESCE(p, ''), '\D', '', 'g')) >= 10
              THEN right(regexp_replace(p, '\D', '', 'g'), 10) END
$$;
CREATE INDEX ix_parents_phone_key ON parents (phone_key(phone));
CREATE INDEX ix_parents_alt_phone_key ON parents (phone_key(alt_phone));

-- Purpose category inferred from free text (message subjects, visitor purpose).
CREATE OR REPLACE FUNCTION contact_log_purpose(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN t ~* '(admission|enquiry|campus visit)' THEN 'Admission'
    WHEN t ~* '(fee|receipt|payment|concession|refund)' THEN 'Fees'
    WHEN t ~* '(bus|transport|route|pick ?up|drop|stop)' THEN 'Transport'
    WHEN t ~* '(complain|grievance|unhappy|not satisfied)' THEN 'Complaint'
    WHEN t ~* '(behavio|bully|fight|discipline)' THEN 'Behaviour'
    WHEN t ~* '(health|unwell|fever|sick|medical|doctor|nurse|injur|allerg)' THEN 'Health'
    WHEN t ~* '(leave|absence|absent)' THEN 'Leave'
    WHEN t ~* '(ptm|meet|appointment|slot)' THEN 'Meeting request'
    WHEN t ~* '(homework|worksheet|test|exam|marks|lesson|academic|syllabus|report card|subject|math|science|english|support)' THEN 'Academic'
    ELSE 'General'
  END
$$;

-- -----------------------------------------------------------------------------
-- Unified contact log
-- -----------------------------------------------------------------------------
CREATE VIEW contact_log_v AS
WITH base AS (
  -- 1. Manual entries
  SELECT 'manual'::text AS source, e.id AS source_id, e.code, e.occurred_at, e.campus_id, e.contact_kind,
         e.parent_id, e.employee_id, e.contact_name, e.contact_phone, e.student_id,
         e.target_kind, e.target_employee_id, e.target_user_id,
         e.channel, e.purpose_category AS purpose, e.outcome,
         (e.resolved_at IS NULL AND e.outcome NOT IN ('Met', 'Spoke on call', 'Resolved')) AS is_open,
         e.summary, e.resolution_note AS details, e.logged_by, e.follow_up_on, e.resolved_at
    FROM contact_log_entries e

  UNION ALL
  -- 2. Inbound communications from parents (WhatsApp, email, SMS, calls, app messages)
  SELECT 'communication', c.id, NULL, c.occurred_at,
         COALESCE(cs.campus_id, (SELECT s2.campus_id FROM student_guardians g2 JOIN students s2 ON s2.id = g2.student_id
                                  WHERE g2.parent_id = c.parent_id ORDER BY s2.full_name LIMIT 1)),
         'parent', c.parent_id, NULL, p.full_name, p.phone, c.student_id,
         CASE WHEN c.thread_id IS NOT NULL THEN 'staff' ELSE 'office' END,
         NULL,
         (SELECT mp.user_id FROM message_thread_participants mp
           WHERE c.thread_id IS NOT NULL AND mp.thread_id = c.thread_id AND mp.user_id IS DISTINCT FROM p.user_id
           ORDER BY mp.user_id LIMIT 1),
         CASE c.channel WHEN 'Call' THEN 'Phone call' WHEN 'In-app' THEN 'Message' ELSE c.channel END,
         contact_log_purpose(c.subject),
         CASE WHEN c.needs_reply THEN 'Pending'
              WHEN c.replied_at IS NOT NULL THEN 'Responded'
              WHEN c.channel = 'Call' AND c.status = 'Connected' THEN 'Spoke on call'
              WHEN c.channel = 'Call' THEN 'Not available'
              ELSE 'Received' END,
         c.needs_reply,
         c.subject, c.body, c.sent_by, NULL::date, c.replied_at
    FROM communications c
    JOIN parents p ON p.id = c.parent_id
    LEFT JOIN students cs ON cs.id = c.student_id
   WHERE c.direction = 'inbound' AND c.channel <> 'Note'

  UNION ALL
  -- 3. Parent-started app conversations not already mirrored in communications
  SELECT 'message', t.id, NULL, t.created_at,
         COALESCE(ts.campus_id, (SELECT s2.campus_id FROM student_guardians g2 JOIN students s2 ON s2.id = g2.student_id
                                  WHERE g2.parent_id = p.id ORDER BY s2.full_name LIMIT 1)),
         'parent', p.id, NULL, p.full_name, p.phone, t.student_id,
         'staff', NULL,
         (SELECT mp.user_id FROM message_thread_participants mp WHERE mp.thread_id = t.id AND mp.user_id <> t.created_by
           ORDER BY mp.user_id LIMIT 1),
         'Message', contact_log_purpose(t.subject),
         CASE WHEN t.status = 'Closed' THEN 'Resolved'
              WHEN EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND m.sender_id <> t.created_by) THEN 'Responded'
              ELSE 'Pending' END,
         (t.status = 'Open' AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND m.sender_id <> t.created_by)),
         t.subject,
         (SELECT m.body FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at LIMIT 1),
         t.created_by, NULL::date, NULL::timestamptz
    FROM message_threads t
    JOIN parents p ON p.user_id = t.created_by
    LEFT JOIN students ts ON ts.id = t.student_id
   WHERE NOT EXISTS (SELECT 1 FROM communications c WHERE c.thread_id = t.id)

  UNION ALL
  -- 4. PTM bookings — a booked slot is a meeting request; attended / no-show at the slot time
  SELECT 'ptm', b.id, NULL,
         CASE WHEN b.status = 'Booked' THEN b.created_at
              ELSE ((ps.session_date + ps.starts_at + make_interval(mins => (b.slot_no - 1) * ps.slot_minutes)) AT TIME ZONE 'Asia/Kolkata') END,
         bs.campus_id, 'parent', b.parent_id, NULL, p.full_name, p.phone, b.student_id,
         CASE WHEN sec.class_teacher_id = ps.employee_id THEN 'class_teacher' ELSE 'staff' END,
         ps.employee_id, NULL,
         'PTM meeting', 'Meeting request',
         CASE b.status WHEN 'Attended' THEN 'Met' WHEN 'No-show' THEN 'No-show' ELSE 'Scheduled' END,
         false,
         'PTM — ' || ps.subject_label, ps.venue, NULL::uuid, ps.session_date, NULL::timestamptz
    FROM ptm_bookings b
    JOIN ptm_sessions ps ON ps.id = b.ptm_session_id
    JOIN parents p ON p.id = b.parent_id
    LEFT JOIN students bs ON bs.id = b.student_id
    LEFT JOIN sections sec ON sec.id = ps.section_id
   WHERE b.status <> 'Cancelled'

  UNION ALL
  -- 5. Gate visitors whose phone matches a parent
  SELECT 'visitor', v.id, v.badge_no, v.checked_in_at, v.campus_id, 'parent', vp.id, NULL, vp.full_name, v.phone, NULL,
         CASE WHEN v.host_employee_id IS NULL THEN 'office' ELSE 'staff' END,
         v.host_employee_id, NULL,
         'Walk-in', contact_log_purpose(v.purpose),
         CASE v.status WHEN 'Completed' THEN 'Met' WHEN 'Denied' THEN 'Not available' ELSE 'In meeting' END,
         (v.status = 'Denied'),
         v.purpose, NULL, v.created_by, NULL::date, v.checked_out_at
    FROM visitors v
    JOIN LATERAL (
      SELECT p.id, p.full_name FROM parents p
       WHERE p.deleted_at IS NULL AND phone_key(v.phone) IS NOT NULL
         AND (phone_key(p.phone) = phone_key(v.phone) OR phone_key(p.alt_phone) = phone_key(v.phone))
       ORDER BY p.created_at LIMIT 1
    ) vp ON true
   WHERE v.status <> 'Expected'
)
SELECT b.source, b.source_id, b.code, b.occurred_at, b.campus_id, b.contact_kind,
       b.parent_id, b.employee_id, b.student_id,
       COALESCE(pp.full_name, ae.full_name, b.contact_name) AS contact_name,
       COALESCE(b.contact_phone, pp.phone, ae.phone) AS contact_phone,
       pp.parent_code, ae.designation AS employee_designation,
       s.full_name AS student_name, s.admission_no, cl.name AS student_grade, sec.name AS student_section,
       CASE WHEN tr.key = 'principal' THEN 'principal'
            WHEN b.source <> 'manual' AND b.target_kind = 'staff' AND tr.key = 'office' THEN 'office'
            WHEN b.source <> 'manual' AND b.target_kind = 'staff' AND tr.key = 'management' THEN 'management'
            ELSE b.target_kind END AS target_kind,
       COALESCE(b.target_employee_id, tue.id) AS target_employee_id,
       COALESCE(b.target_user_id, te.user_id) AS target_user_id,
       COALESCE(te.full_name, tue.full_name, tu.full_name,
                CASE b.target_kind WHEN 'principal' THEN 'Principal' WHEN 'office' THEN 'Front office'
                                   WHEN 'management' THEN 'Management' WHEN 'class_teacher' THEN 'Class teacher' ELSE 'Staff' END) AS target_name,
       COALESCE(te.designation, tue.designation) AS target_designation,
       b.channel, b.purpose, b.outcome, b.is_open, b.summary, b.details,
       b.logged_by, lu.full_name AS logged_by_name, b.follow_up_on, b.resolved_at
  FROM base b
  LEFT JOIN parents pp ON pp.id = b.parent_id
  LEFT JOIN employees ae ON ae.id = b.employee_id
  LEFT JOIN students s ON s.id = b.student_id
  LEFT JOIN sections sec ON sec.id = s.section_id
  LEFT JOIN classes cl ON cl.id = sec.class_id
  LEFT JOIN employees te ON te.id = b.target_employee_id
  LEFT JOIN employees tue ON b.target_employee_id IS NULL AND tue.user_id = b.target_user_id
  LEFT JOIN users tu ON tu.id = COALESCE(b.target_user_id, te.user_id)
  LEFT JOIN roles tr ON tr.id = tu.role_id
  LEFT JOIN users lu ON lu.id = b.logged_by
 WHERE b.occurred_at <= now();
