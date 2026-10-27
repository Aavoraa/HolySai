-- =============================================================================
-- 116 ADMISSION FORMS — the filled admission form behind each application.
--
-- A lead (enquiry) comes in → the family fills the school's admission form
-- (paper or PDF) → the office either types it in (form_source 'Manual') or
-- uploads the filled / scanned form ('Upload'), or both.
--
--   form_data          the whole form as entered (jsonb, camelCase keys)
--   form_document_id   the uploaded scan — a documents row
--                      (owner_type 'admission', category 'Admission form');
--                      checklist documents keep category 'Admission'
--   queryable columns  copied from the form so lists, search, duplicate
--                      checks and enrolment can use them without jsonb
-- =============================================================================

ALTER TABLE admissions
  ADD COLUMN form_source        text CHECK (form_source IN ('Manual', 'Upload', 'Online')),
  ADD COLUMN form_received_on   date,
  ADD COLUMN form_data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN form_entered_by    uuid REFERENCES users(id),
  ADD COLUMN form_entered_at    timestamptz,             -- last manual save
  ADD COLUMN form_completed_at  timestamptz,             -- manual form submitted with every required field
  ADD COLUMN form_document_id   uuid REFERENCES documents(id) ON DELETE SET NULL,
  ADD COLUMN father_name        text,
  ADD COLUMN mother_name        text,
  ADD COLUMN guardian_phone     text,                    -- primary contact on the form
  ADD COLUMN guardian_email     citext,
  ADD COLUMN address            text,
  ADD COLUMN city               text,
  ADD COLUMN pincode            text,
  ADD COLUMN nationality        text,
  ADD COLUMN blood_group        text,
  ADD COLUMN mother_tongue      text,
  ADD COLUMN previous_grade     text,
  ADD COLUMN siblings_in_school boolean,
  ADD COLUMN medical_notes      text,
  ADD COLUMN transport_required boolean;

CREATE INDEX ix_admissions_form_source ON admissions (form_source);
CREATE INDEX ix_admissions_guardian_phone ON admissions ((regexp_replace(guardian_phone, '\D', '', 'g'))) WHERE guardian_phone IS NOT NULL;
CREATE INDEX ix_admissions_enquiry ON admissions (enquiry_id);
