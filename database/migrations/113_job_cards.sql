-- =============================================================================
-- 113 JOB CARDS — departments and inter-department work requests
-- Any department can raise a job card to another department; the receiving
-- department accepts, assigns, works and completes it; the raiser closes it.
-- =============================================================================

-- Departments. employees.department stays free text; employee_departments
-- resolves each employee to a department by name (or alias). Teaching staff
-- whose department holds a subject code (ART, ENG, MAT …) resolve to Academics.
CREATE TABLE departments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  code             text NOT NULL,
  description      text,
  aliases          text[] NOT NULL DEFAULT '{}',   -- earlier names / spellings in employees.department
  head_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  campus_id        uuid REFERENCES campuses(id),
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('departments');
CREATE UNIQUE INDEX ux_departments_name ON departments (lower(name));
CREATE UNIQUE INDEX ux_departments_code ON departments (upper(code));

INSERT INTO departments (name, code, description) VALUES
  ('Academics',          'ACAD',    'Teaching staff, subject departments and classroom programmes'),
  ('Accounts',           'ACCT',    'Fees, payments, budgets and purchasing'),
  ('Administration',     'ADMIN',   'School administration, facilities and compliance'),
  ('Front Office',       'FRONT',   'Reception, admissions counselling and visitor desk'),
  ('Health',             'HEALTH',  'Infirmary and school nurse'),
  ('Housekeeping',       'HOUSE',   'Cleaning, upkeep and event set-up'),
  ('Human Resources',    'HR',      'Recruitment, staff records, leave and payroll inputs'),
  ('Laboratory',         'LAB',     'Science and computing labs'),
  ('Leadership',         'LEAD',    'Principal and senior leadership'),
  ('Library',            'LIB',     'Library and reading programmes'),
  ('Outdoor Programmes', 'OUTDOOR', 'Outdoor learning and residential programmes'),
  ('Security',           'SEC',     'Gates, visitors and campus security'),
  ('Student Support',    'SUPPORT', 'Counselling and student wellbeing'),
  ('Transport',          'TRANS',   'Buses, drivers, attendants and routes')
ON CONFLICT DO NOTHING;

CREATE VIEW employee_departments AS
SELECT e.id AS employee_id, d.id AS department_id
  FROM employees e
  JOIN departments d ON d.id = COALESCE(
         (SELECT d1.id FROM departments d1
           WHERE lower(d1.name) = lower(btrim(e.department))
              OR lower(btrim(e.department)) = ANY (SELECT lower(a) FROM unnest(d1.aliases) a)
           LIMIT 1),
         (SELECT d2.id FROM departments d2
           WHERE lower(d2.name) = 'academics'
             AND (e.employee_type = 'teaching'
                  OR EXISTS (SELECT 1 FROM subjects s WHERE upper(s.code) = upper(btrim(e.department))))))
 WHERE e.deleted_at IS NULL;

CREATE TABLE job_cards (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                    text NOT NULL UNIQUE,                    -- JC-0001
  title                   text NOT NULL,
  description             text,
  category                text NOT NULL DEFAULT 'Other' CHECK (category IN
                            ('Maintenance', 'IT', 'Event support', 'Academic', 'Administrative', 'Transport',
                             'Housekeeping', 'Procurement', 'HR', 'Other')),
  priority                text NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')),
  from_department_id      uuid NOT NULL REFERENCES departments(id),
  to_department_id        uuid NOT NULL REFERENCES departments(id),
  raised_by               uuid REFERENCES users(id),
  assigned_to_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  assigned_by             uuid REFERENCES users(id),
  assigned_at             timestamptz,
  campus_id               uuid REFERENCES campuses(id),
  location                text,
  due_on                  date,
  status                  text NOT NULL DEFAULT 'Open' CHECK (status IN
                            ('Open', 'Assigned', 'In Progress', 'On Hold', 'Completed', 'Closed', 'Cancelled', 'Reopened')),
  started_at              timestamptz,
  completed_at            timestamptz,
  closed_at               timestamptz,
  closed_by               uuid REFERENCES users(id),
  estimated_hours         numeric(6,1) CHECK (estimated_hours >= 0),
  actual_hours            numeric(6,1) CHECK (actual_hours >= 0),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (from_department_id <> to_department_id)
);
SELECT attach_updated_at('job_cards');
CREATE INDEX ix_job_cards_to ON job_cards (to_department_id, status);
CREATE INDEX ix_job_cards_from ON job_cards (from_department_id, status);
CREATE INDEX ix_job_cards_assignee ON job_cards (assigned_to_employee_id) WHERE assigned_to_employee_id IS NOT NULL;
CREATE INDEX ix_job_cards_raised_by ON job_cards (raised_by);
CREATE INDEX ix_job_cards_due ON job_cards (due_on) WHERE status NOT IN ('Completed', 'Closed', 'Cancelled');

CREATE TABLE job_card_updates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id      uuid NOT NULL REFERENCES job_cards(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id),
  kind         text NOT NULL CHECK (kind IN ('created', 'comment', 'status', 'assignment', 'edit', 'attachment')),
  from_status  text,
  to_status    text,
  body         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_job_card_updates_card ON job_card_updates (card_id, created_at);
