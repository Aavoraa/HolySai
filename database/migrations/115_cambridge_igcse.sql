-- =============================================================================
-- 115 CAMBRIDGE IGCSE — grade scale & boundaries, IGCSE syllabuses (components,
-- topics, per-section topic coverage), student Core/Extended tier entries, and
-- an optional link from an assessment to a syllabus component.
--
-- Grading follows the classic Cambridge IGCSE letters A* to G, with U below G.
-- Grades 9–10 follow IGCSE syllabuses; lower grades keep Cambridge Primary /
-- Lower Secondary stage tracking (curriculum_stages / learning_objectives), but
-- their marks are reported on the same A*–G/U letters.
--
-- The percentage boundaries seeded here are INDICATIVE school defaults.
-- Cambridge International publishes component grade thresholds for each exam
-- series, so the boundaries are editable (permission grading.manage).
-- Defaults must match backend/src/services/grading-shared.ts.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Grade scales and boundaries
-- ---------------------------------------------------------------------------
CREATE TABLE grade_scales (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL UNIQUE,                   -- cambridge_igcse_a_star_g
  name         text NOT NULL,
  description  text,
  is_default   boolean NOT NULL DEFAULT false,
  -- Cambridge tier rules: {"Core":{"highest":"C","lowest":"G"},"Extended":{"highest":"A*","lowest":"E"}}
  tier_rules   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('grade_scales');
CREATE UNIQUE INDEX ux_grade_scales_one_default ON grade_scales (is_default) WHERE is_default;

CREATE TABLE grade_boundaries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scale_id     uuid NOT NULL REFERENCES grade_scales(id) ON DELETE CASCADE,
  grade        text NOT NULL,                          -- A*, A … G, U
  min_percent  numeric(5,2) NOT NULL CHECK (min_percent BETWEEN 0 AND 100),
  points       int NOT NULL DEFAULT 0,                 -- rank value: A* 8 … G 1, U 0
  description  text,
  tone         text,                                   -- UI colour hint (success/info/neutral/warning/critical)
  sort_order   int NOT NULL,                           -- 1 = best grade
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scale_id, grade)
);
SELECT attach_updated_at('grade_boundaries');

INSERT INTO grade_scales (key, name, description, is_default, tier_rules)
VALUES ('cambridge_igcse_a_star_g', 'Cambridge IGCSE (A* to G)',
        'Classic Cambridge IGCSE letter grades A* to G, with U below G. Indicative percentage boundaries — Cambridge sets component thresholds for each exam series.',
        true, '{"Core":{"highest":"C","lowest":"G"},"Extended":{"highest":"A*","lowest":"E"}}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO grade_boundaries (scale_id, grade, min_percent, points, description, tone, sort_order)
SELECT gs.id, b.grade, b.min_percent, b.points, b.description, b.tone, b.sort_order
  FROM grade_scales gs
 CROSS JOIN (VALUES
   ('A*', 90, 8, 'Exceptional',  'success',  1),
   ('A',  80, 7, 'Excellent',    'success',  2),
   ('B',  70, 6, 'Very good',    'info',     3),
   ('C',  60, 5, 'Good',         'info',     4),
   ('D',  50, 4, 'Satisfactory', 'neutral',  5),
   ('E',  40, 3, 'Pass',         'warning',  6),
   ('F',  30, 2, 'Weak pass',    'warning',  7),
   ('G',  20, 1, 'Minimal pass', 'critical', 8),
   ('U',   0, 0, 'Ungraded',     'critical', 9)
 ) AS b(grade, min_percent, points, description, tone, sort_order)
 WHERE gs.key = 'cambridge_igcse_a_star_g'
ON CONFLICT (scale_id, grade) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Syllabuses (Cambridge IGCSE, mapped to the school's subjects)
-- ---------------------------------------------------------------------------
CREATE TABLE syllabuses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id         uuid NOT NULL REFERENCES subjects(id),
  stage              text NOT NULL DEFAULT 'IGCSE',
  awarding_body      text NOT NULL DEFAULT 'Cambridge International',
  syllabus_code      text,                             -- 0580; NULL for school-assessed subjects
  title              text NOT NULL,                    -- Cambridge IGCSE Mathematics
  exam_series_years  text,                             -- 2025-2027
  tiered             boolean NOT NULL DEFAULT false,   -- Core / Extended entry
  grading            text NOT NULL DEFAULT 'A*-G',
  notes              text,
  is_active          boolean NOT NULL DEFAULT true,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('syllabuses');
CREATE UNIQUE INDEX ux_syllabuses_code ON syllabuses (syllabus_code) WHERE syllabus_code IS NOT NULL;
CREATE INDEX ix_syllabuses_subject ON syllabuses (subject_id);

CREATE TABLE syllabus_components (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  syllabus_id        uuid NOT NULL REFERENCES syllabuses(id) ON DELETE CASCADE,
  paper_no           text NOT NULL,                    -- 2, 4, Component 3
  name               text NOT NULL,                    -- Paper 2 (Extended)
  tier               text NOT NULL DEFAULT 'All' CHECK (tier IN ('Core', 'Extended', 'All')),
  duration_minutes   int CHECK (duration_minutes > 0),
  max_marks          numeric(6,2) CHECK (max_marks > 0),
  weighting_percent  numeric(5,2) CHECK (weighting_percent BETWEEN 0 AND 100),
  assessment_type    text NOT NULL DEFAULT 'written' CHECK (assessment_type IN ('written', 'practical', 'coursework', 'oral', 'listening')),
  option_group       text,                             -- components candidates choose between (e.g. Practical: Paper 5 or 6)
  notes              text,
  sort_order         int NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (syllabus_id, paper_no)
);
SELECT attach_updated_at('syllabus_components');

CREATE TABLE syllabus_topics (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  syllabus_id    uuid NOT NULL REFERENCES syllabuses(id) ON DELETE CASCADE,
  unit_no        int NOT NULL,
  code           text,                                 -- 1, 2.13, B3
  title          text NOT NULL,
  subtopics      text,
  tier           text NOT NULL DEFAULT 'All' CHECK (tier IN ('Core', 'Extended', 'All')),
  planned_hours  numeric(5,1) CHECK (planned_hours >= 0),
  planned_weeks  numeric(4,1) CHECK (planned_weeks >= 0),
  sort_order     int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('syllabus_topics');
CREATE INDEX ix_syllabus_topics_syllabus ON syllabus_topics (syllabus_id, sort_order);
CREATE UNIQUE INDEX ux_syllabus_topics_code ON syllabus_topics (syllabus_id, code) WHERE code IS NOT NULL;

CREATE TABLE syllabus_topic_coverage (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id     uuid NOT NULL REFERENCES syllabus_topics(id) ON DELETE CASCADE,
  section_id   uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'Not started' CHECK (status IN ('Not started', 'In progress', 'Covered')),
  covered_on   date,
  teacher_id   uuid REFERENCES employees(id),
  notes        text,
  updated_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (topic_id, section_id)
);
SELECT attach_updated_at('syllabus_topic_coverage');
CREATE INDEX ix_syllabus_coverage_section ON syllabus_topic_coverage (section_id);

-- Core / Extended entry per student per syllabus (Grade 9–10).
CREATE TABLE student_syllabus_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  syllabus_id  uuid NOT NULL REFERENCES syllabuses(id) ON DELETE CASCADE,
  tier         text CHECK (tier IN ('Core', 'Extended')),   -- NULL for untiered syllabuses
  exam_series  text,                                        -- May/June 2027
  updated_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, syllabus_id)
);
SELECT attach_updated_at('student_syllabus_entries');
CREATE INDEX ix_syllabus_entries_syllabus ON student_syllabus_entries (syllabus_id);

-- An assessment may mirror a syllabus paper; grading then applies the tier
-- (paper tier, or the student's entry tier for an "All" component).
ALTER TABLE assessments ADD COLUMN syllabus_component_id uuid REFERENCES syllabus_components(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Re-grade existing data on the new scale (deployed databases held grades on
-- the old A*/A+/A/B+/B/C/D/E school scale). Untiered: no entries exist yet.
-- ---------------------------------------------------------------------------
UPDATE assessment_marks m
   SET grade = (SELECT b.grade FROM grade_boundaries b JOIN grade_scales gs ON gs.id = b.scale_id AND gs.is_default
                 WHERE b.min_percent <= LEAST(100, 100.0 * m.marks / a.max_marks)
                 ORDER BY b.min_percent DESC LIMIT 1)
  FROM assessments a
 WHERE a.id = m.assessment_id AND m.marks IS NOT NULL;
UPDATE assessment_marks SET grade = NULL WHERE marks IS NULL AND grade IS NOT NULL;

UPDATE student_academic_records r
   SET grade = (SELECT b.grade FROM grade_boundaries b JOIN grade_scales gs ON gs.id = b.scale_id AND gs.is_default
                 WHERE b.min_percent <= r.score
                 ORDER BY b.min_percent DESC LIMIT 1);
