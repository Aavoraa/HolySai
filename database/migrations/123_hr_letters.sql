-- HR letters issued to employees: Letter of Appointment (onboarding), Relieving Letter and
-- Experience Letter. Each issue gets a reference number (HS/HR/AL|RL|EL/YYYY/NNN) and keeps
-- the details it was printed with, so it can be reprinted exactly and is audited.
CREATE TABLE hr_letters (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES employees(id),
  letter_type  text NOT NULL CHECK (letter_type IN ('onboarding', 'relieving', 'experience')),
  ref_no       text NOT NULL UNIQUE,
  issued_on    date NOT NULL,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- dates, salary, signatory … as printed
  issued_by    uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_hr_letters_employee ON hr_letters (employee_id, created_at DESC);
