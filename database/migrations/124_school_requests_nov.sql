-- School requests, November 2026: admission status history, school bank/UPI details for
-- fee bills, biometric attendance devices, employee documents, public certificate checks
-- and RFID visitor cards.

-- ---------------------------------------------------------------------------
-- Admission applications: every status change, for the office timeline and the
-- parents' "track my application" page. Written by a trigger so every path that
-- changes status (status button, enrolment, imports) is recorded. The app passes
-- who and why with set_config('app.user_id' / 'app.status_note') in the same transaction.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admission_status_history (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admission_id  uuid NOT NULL REFERENCES admissions(id) ON DELETE CASCADE,
  from_status   text,
  to_status     text NOT NULL,
  note          text,
  changed_by    uuid REFERENCES users(id),
  changed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admission_status_history_admission_idx ON admission_status_history (admission_id, changed_at);

CREATE OR REPLACE FUNCTION log_admission_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO admission_status_history (admission_id, from_status, to_status, note, changed_by)
    VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
            NULLIF(current_setting('app.status_note', true), ''),
            NULLIF(current_setting('app.user_id', true), '')::uuid);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_admissions_status_history ON admissions;
CREATE TRIGGER trg_admissions_status_history AFTER INSERT OR UPDATE OF status ON admissions
  FOR EACH ROW EXECUTE FUNCTION log_admission_status();

-- Existing applications start their history at the status they hold today.
INSERT INTO admission_status_history (admission_id, from_status, to_status, note, changed_at)
SELECT a.id, NULL, a.status, 'Status when tracking began', COALESCE(a.decided_at, a.created_at)
  FROM admissions a
 WHERE NOT EXISTS (SELECT 1 FROM admission_status_history h WHERE h.admission_id = a.id);

-- ---------------------------------------------------------------------------
-- Fee bills: the school's bank account and UPI ID, printed on every bill so
-- families can pay by transfer. Filled in by the office under Settings.
-- ---------------------------------------------------------------------------
INSERT INTO system_settings (key, value, description, is_public) VALUES
  ('finance.bank_account_name', '""', 'Fee bills: account holder name for bank transfers', false),
  ('finance.bank_name',         '""', 'Fee bills: bank name', false),
  ('finance.bank_account_no',   '""', 'Fee bills: account number for fee payments', false),
  ('finance.bank_ifsc',         '""', 'Fee bills: IFSC code', false),
  ('finance.bank_branch',       '""', 'Fee bills: branch', false),
  ('finance.upi_id',            '""', 'Fee bills: UPI ID for the pay-by-QR code (e.g. holysai@okicici)', false)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Biometric staff attendance. Each machine posts punches with its own token to
-- POST /api/v1/attendance/punches, or HR imports the machine's log as CSV.
-- Punches are kept raw; the day's check-in/out in staff_attendance is derived
-- from the first and last punch.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS biometric_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code   text NOT NULL UNIQUE,                 -- BIO-001
  name          text NOT NULL,
  campus_id     uuid REFERENCES campuses(id),
  location      text,
  token_hash    text UNIQUE,
  token_issued_at timestamptz,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  last_seen_at  timestamptz,
  last_ip       text,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('biometric_devices');

CREATE TABLE IF NOT EXISTS staff_attendance_punches (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  punched_at    timestamptz NOT NULL,
  direction     text NOT NULL DEFAULT 'auto' CHECK (direction IN ('in', 'out', 'auto')),
  source        text NOT NULL CHECK (source IN ('device', 'import')),
  device_id     uuid REFERENCES biometric_devices(id) ON DELETE SET NULL,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, punched_at)
);
CREATE INDEX IF NOT EXISTS staff_attendance_punches_day_idx ON staff_attendance_punches (employee_id, punched_at);

-- ---------------------------------------------------------------------------
-- RFID visitor cards: the desk hands a reusable card to each visitor. A tap on
-- the reader checks the visitor in (pre-approved) or out. A card can be with only
-- one visitor at a time; the tag stays on the record after checkout for history.
-- ---------------------------------------------------------------------------
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS rfid_tag text;
CREATE UNIQUE INDEX IF NOT EXISTS visitors_active_rfid_tag_key ON visitors (rfid_tag)
  WHERE rfid_tag IS NOT NULL AND status IN ('Expected', 'Inside');
