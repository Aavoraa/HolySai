-- =============================================================================
-- 112 BUDGET & PLANNING
-- Departments prepare budget plans (with line items) and submit them; only the
-- Super Admin approves (optionally for a lower amount) or rejects. An approved
-- plan adds its approved amount to the matching budgets row (year + campus +
-- category), so it flows straight into the Budgets page.
-- Workflow: Draft → Submitted → Under Review → Approved / Rejected
--           (a rejected plan can be reopened as a Draft and resubmitted).
-- =============================================================================

CREATE TABLE budget_plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE,                 -- BP-0001
  title             text NOT NULL,
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id),
  campus_id         uuid NOT NULL REFERENCES campuses(id),
  department        text NOT NULL,
  category          text NOT NULL,                        -- matches budgets.category
  period_start      date NOT NULL,
  period_end        date NOT NULL,
  amount_requested  numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_requested >= 0),
  amount_approved   numeric(14,2) CHECK (amount_approved IS NULL OR amount_approved >= 0),
  justification     text,
  status            text NOT NULL DEFAULT 'Draft'
                    CHECK (status IN ('Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected')),
  submitted_by      uuid REFERENCES users(id),
  submitted_at      timestamptz,
  decided_by        uuid REFERENCES users(id),
  decided_at        timestamptz,
  decision_note     text,
  budget_id         uuid REFERENCES budgets(id) ON DELETE SET NULL,  -- the budget line the approval was added to
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK (amount_approved IS NULL OR amount_approved <= amount_requested)
);
SELECT attach_updated_at('budget_plans');
CREATE INDEX ix_budget_plans_status ON budget_plans (status, submitted_at);
CREATE INDEX ix_budget_plans_year_campus ON budget_plans (academic_year_id, campus_id, category);

CREATE TABLE budget_plan_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES budget_plans(id) ON DELETE CASCADE,
  position    int NOT NULL DEFAULT 0,
  item        text NOT NULL,
  quantity    numeric(12,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cost   numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  amount      numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('budget_plan_lines');
CREATE INDEX ix_budget_plan_lines_plan ON budget_plan_lines (plan_id, position);

-- Status history shown on the plan detail (the audit trail keeps the full record).
CREATE TABLE budget_plan_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      uuid NOT NULL REFERENCES budget_plans(id) ON DELETE CASCADE,
  action       text NOT NULL,                             -- created | updated | submitted | review | approved | rejected | reopened
  from_status  text,
  to_status    text,
  amount       numeric(14,2),
  note         text,
  actor_id     uuid REFERENCES users(id),
  actor_name   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_budget_plan_events_plan ON budget_plan_events (plan_id, created_at);
