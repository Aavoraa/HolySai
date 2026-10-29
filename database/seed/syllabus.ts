/**
 * Cambridge IGCSE syllabuses for Grades 9–10 — SAMPLE data.
 *
 * Syllabus codes are real Cambridge IGCSE codes mapped to the school's subjects.
 * Component (paper) durations, marks and weightings are EDITABLE DEFAULTS that
 * reflect the general shape of each syllabus — always check them against the
 * current Cambridge syllabus document for the exam series being taught.
 * Where a figure was not certain it is left blank rather than guessed.
 *
 * Grade scale rows (A*–G, U) are inserted by migration 115, not here.
 * Runs after the academics seed: assessment marks and term results were
 * generated with the same default IGCSE scale (backend/src/services/grading-shared.ts);
 * the two IGCSE Physics mocks are linked to their Extended papers here and re-graded
 * with the Extended tier rule (A*–E, below E is U).
 */
import type { Db, SeedContext } from './context.js';
import { bulkInsert } from './context.js';
import { gradeFromScale, DEFAULT_SCALE } from '../../backend/src/services/grading-shared.js';

type Tier = 'Core' | 'Extended' | 'All';
type CType = 'written' | 'practical' | 'coursework' | 'oral' | 'listening';
// [paper, name, tier, minutes, max marks, weighting %, type, option group]
type Comp = [string, string, Tier, number | null, number | null, number | null, CType, string | null];
// [unit, code, title, subtopics, tier, planned hours]
type Topic = [number, string, string, string, Tier, number];

interface Def {
  key: string;
  subject: string;
  code: string | null;
  title: string;
  body?: string;
  series: string | null;
  tiered: boolean;
  notes: string;
  components: Comp[];
  topics: Topic[];
}

const CHECK = 'Component details are editable defaults — check them against the current Cambridge syllabus document for your exam series.';

const SCIENCE_PAPERS: Comp[] = [
  ['1', 'Paper 1 (Core) — Multiple choice', 'Core', 45, 40, 30, 'written', null],
  ['2', 'Paper 2 (Extended) — Multiple choice', 'Extended', 45, 40, 30, 'written', null],
  ['3', 'Paper 3 (Core) — Theory', 'Core', 75, 80, 50, 'written', null],
  ['4', 'Paper 4 (Extended) — Theory', 'Extended', 75, 80, 50, 'written', null],
  ['5', 'Paper 5 — Practical test', 'All', null, 40, 20, 'practical', 'Practical (Paper 5 or 6)'],
  ['6', 'Paper 6 — Alternative to practical', 'All', 60, 40, 20, 'written', 'Practical (Paper 5 or 6)'],
];

const DEFS: Def[] = [
  {
    key: 'MAT', subject: 'MAT', code: '0580', title: 'Cambridge IGCSE Mathematics', series: '2025-2027', tiered: true,
    notes: `Core candidates take Papers 1 and 3 (grades C–G); Extended candidates take Papers 2 and 4 (grades A*–E). ${CHECK}`,
    components: [
      ['1', 'Paper 1 (Core) — Non-calculator', 'Core', 90, 80, 50, 'written', null],
      ['2', 'Paper 2 (Extended) — Non-calculator', 'Extended', 120, 100, 50, 'written', null],
      ['3', 'Paper 3 (Core) — Calculator', 'Core', 90, 80, 50, 'written', null],
      ['4', 'Paper 4 (Extended) — Calculator', 'Extended', 120, 100, 50, 'written', null],
    ],
    topics: [
      [1, '1', 'Number', 'Types of number, sets, powers and roots, fractions, decimals and percentages, ordering, standard form, estimation, bounds, ratio and proportion, rates, percentages, using a calculator, time, money, exponential growth and decay, surds (Extended).', 'All', 30],
      [2, '2', 'Algebra and graphs', 'Introduction to algebra, algebraic manipulation, algebraic fractions, indices, equations, inequalities, sequences, proportion, graphs in practical situations, graphs of functions, sketching curves.', 'All', 34],
      [2, '2E', 'Functions and differentiation', 'Function notation, inverse and composite functions, the gradient of a curve, derivatives and stationary points.', 'Extended', 10],
      [3, '3', 'Coordinate geometry', 'Coordinates, drawing linear graphs, gradient, length and midpoint, equations of straight lines, parallel and perpendicular lines.', 'All', 12],
      [4, '4', 'Geometry', 'Geometrical terms, constructions, scale drawings, similarity, symmetry, angles, circle theorems.', 'All', 20],
      [5, '5', 'Mensuration', 'Units of measure, area and perimeter, circles, arcs and sectors, surface area and volume, compound shapes.', 'All', 14],
      [6, '6', 'Trigonometry', 'Pythagoras’ theorem, right-angled triangles, exact values and trigonometric functions, non-right-angled triangles, 3D Pythagoras and trigonometry (Extended).', 'All', 16],
      [7, '7', 'Transformations and vectors', 'Transformations, vectors in two dimensions, magnitude of a vector, vector geometry (Extended).', 'All', 10],
      [8, '8', 'Probability', 'Introduction to probability, relative and expected frequencies, probability of combined events, conditional probability (Extended).', 'All', 10],
      [9, '9', 'Statistics', 'Classifying data, interpreting statistical data, averages and range, statistical charts and diagrams, scatter diagrams, cumulative frequency and histograms (Extended).', 'All', 12],
    ],
  },
  {
    key: 'ENG', subject: 'ENG', code: '0500', title: 'Cambridge IGCSE First Language English', series: '2024-2026', tiered: false,
    notes: `Untiered — graded A*–G. Candidates take Paper 1 and either Paper 2 or Component 3 (coursework). Cambridge IGCSE English as a Second Language (0510 / 0511) is the alternative for students not yet working at first-language level. ${CHECK}`,
    components: [
      ['1', 'Paper 1 — Reading', 'All', 120, 80, 50, 'written', null],
      ['2', 'Paper 2 — Directed writing and composition', 'All', 120, 80, 50, 'written', 'Writing (Paper 2 or Component 3)'],
      ['3', 'Component 3 — Coursework portfolio', 'All', null, 80, 50, 'coursework', 'Writing (Paper 2 or Component 3)'],
    ],
    topics: [
      [1, 'R1', 'Reading for explicit and implicit meaning', 'Short-answer comprehension of non-fiction and fiction texts; selecting and using relevant information.', 'All', 14],
      [2, 'R2', 'Summary writing', 'Selecting relevant points and writing a concise, fluent summary in own words.', 'All', 10],
      [3, 'R3', 'Writers’ effect and use of language', 'Analysing how writers achieve effects through word choice, imagery and structure.', 'All', 14],
      [4, 'R4', 'Extended response to reading', 'Responding to a text in a given form (letter, report, speech) using and developing ideas from it.', 'All', 10],
      [5, 'W1', 'Directed writing', 'Argumentative and discursive writing evaluating ideas from one or two texts.', 'All', 14],
      [6, 'W2', 'Descriptive writing', 'Composition: precise, vivid description with controlled structure.', 'All', 10],
      [7, 'W3', 'Narrative writing', 'Composition: plot, characterisation and a controlled, engaging narrative voice.', 'All', 10],
    ],
  },
  {
    key: 'SCI', subject: 'SCI', code: '0653', title: 'Cambridge IGCSE Combined Science', series: '2025-2027', tiered: true,
    notes: `Grade 9 Science prepares for Combined Science (single award, covering biology, chemistry and physics). Core: Papers 1 and 3; Extended: Papers 2 and 4; all candidates take Paper 5 or 6. ${CHECK}`,
    components: SCIENCE_PAPERS,
    topics: [
      [1, 'B1', 'Characteristics of living organisms', 'Characteristics of living organisms; cell structure and organisation; levels of organisation.', 'All', 6],
      [2, 'B2', 'Cells, biological molecules and enzymes', 'Movement into and out of cells, biological molecules, enzyme action and factors affecting it.', 'All', 10],
      [3, 'B3', 'Plant nutrition and transport', 'Photosynthesis, leaf structure, mineral requirements, transport in plants.', 'All', 10],
      [4, 'B4', 'Human nutrition, transport and gas exchange', 'Diet, digestive system, heart and circulation, gas exchange and respiration.', 'All', 12],
      [5, 'B5', 'Coordination, reproduction and ecology', 'Nervous and hormonal control, reproduction, organisms and their environment.', 'All', 12],
      [6, 'C1', 'States of matter and atomic structure', 'Particle model, elements, compounds and mixtures, atomic structure and the Periodic Table, bonding.', 'All', 10],
      [7, 'C2', 'Stoichiometry and chemical reactions', 'Formulae, equations, the mole (Extended), physical and chemical changes, rates of reaction.', 'All', 12],
      [8, 'C3', 'Acids, bases, salts and the Periodic Table', 'Acids and bases, preparation of salts, Periodic Table trends, metals and reactivity.', 'All', 12],
      [9, 'C4', 'Organic chemistry and the environment', 'Fuels, alkanes and alkenes, air and water.', 'All', 8],
      [10, 'P1', 'Motion, forces and energy', 'Speed and acceleration, mass and weight, density, forces, energy, work and power, pressure.', 'All', 12],
      [11, 'P2', 'Thermal physics and waves', 'Kinetic particle model, thermal processes, general wave properties, light, the electromagnetic spectrum, sound.', 'All', 12],
      [12, 'P3', 'Electricity and magnetism', 'Simple phenomena of magnetism, electrical quantities, circuits, electrical safety.', 'All', 12],
    ],
  },
  {
    key: 'PHY', subject: 'PHY', code: '0625', title: 'Cambridge IGCSE Physics', series: '2026-2028', tiered: true,
    notes: `Core: Papers 1 and 3 (grades C–G); Extended: Papers 2 and 4 (grades A*–E); all candidates take Paper 5 (practical test) or Paper 6 (alternative to practical). ${CHECK}`,
    components: SCIENCE_PAPERS,
    topics: [
      [1, '1', 'Motion, forces and energy', 'Physical quantities and measurement, motion, mass and weight, density, forces, momentum (Extended), energy, work and power, pressure.', 'All', 30],
      [2, '2', 'Thermal physics', 'Kinetic particle model of matter, thermal properties and temperature, transfer of thermal energy.', 'All', 14],
      [3, '3', 'Waves', 'General properties of waves, light (reflection, refraction, lenses, dispersion), electromagnetic spectrum, sound.', 'All', 18],
      [4, '4', 'Electricity and magnetism', 'Simple phenomena of magnetism, electrical quantities, electric circuits, electrical safety, electromagnetic effects.', 'All', 28],
      [5, '5', 'Nuclear physics', 'The nuclear model of the atom, radioactivity, half-life, safety precautions.', 'All', 10],
      [6, '6', 'Space physics', 'The Earth and the Solar System, stars and the Universe.', 'All', 8],
    ],
  },
  {
    key: 'CMP', subject: 'CMP', code: '0478', title: 'Cambridge IGCSE Computer Science', series: '2026-2028', tiered: false,
    notes: `Untiered — graded A*–G. Paper 2 includes pseudocode and programming questions; practical programming is taught throughout. ${CHECK}`,
    components: [
      ['1', 'Paper 1 — Computer systems', 'All', 105, 75, 50, 'written', null],
      ['2', 'Paper 2 — Algorithms, programming and logic', 'All', 105, 75, 50, 'written', null],
    ],
    topics: [
      [1, '1', 'Data representation', 'Number systems, text, sound and images, data storage and compression.', 'All', 12],
      [2, '2', 'Data transmission', 'Types and methods of data transmission, error detection, encryption.', 'All', 8],
      [3, '3', 'Hardware', 'Computer architecture, input and output devices, data storage, network hardware.', 'All', 10],
      [4, '4', 'Software', 'Types of software and interrupts, types of programming language, translators and IDEs.', 'All', 6],
      [5, '5', 'The internet and its uses', 'The internet and the World Wide Web, digital currency, cyber security.', 'All', 8],
      [6, '6', 'Automated and emerging technologies', 'Automated systems, robotics, artificial intelligence.', 'All', 6],
      [7, '7', 'Algorithm design and problem-solving', 'Program development life cycle, decomposition, flowcharts and pseudocode, validation, testing, trace tables.', 'All', 16],
      [8, '8', 'Programming', 'Programming concepts, arrays, file handling.', 'All', 24],
      [9, '9', 'Databases', 'Single-table databases, primary keys, SQL.', 'All', 6],
      [10, '10', 'Boolean logic', 'Logic gates, truth tables, logic expressions and circuits.', 'All', 8],
    ],
  },
  {
    key: 'GEO', subject: 'SST', code: '0460', title: 'Cambridge IGCSE Geography', series: '2027-2029', tiered: false,
    notes: `Grade 9–10 Social Studies prepares for Geography (History 0470 is offered as the alternative). Untiered — graded A*–G. Candidates take Papers 1 and 2 and either Component 3 (coursework) or Paper 4. ${CHECK}`,
    components: [
      ['1', 'Paper 1 — Geographical themes', 'All', 105, 75, 45, 'written', null],
      ['2', 'Paper 2 — Geographical skills', 'All', 90, 60, 27.5, 'written', null],
      ['3', 'Component 3 — Coursework', 'All', null, 60, 27.5, 'coursework', 'Fieldwork (Component 3 or Paper 4)'],
      ['4', 'Paper 4 — Alternative to coursework', 'All', 90, 60, 27.5, 'written', 'Fieldwork (Component 3 or Paper 4)'],
    ],
    topics: [
      [1, '1', 'Population and settlement', 'Population dynamics, migration, population structure, population density and distribution, settlements and service provision, urban settlements, urbanisation.', 'All', 26],
      [2, '2', 'The natural environment', 'Earthquakes and volcanoes, rivers, coasts, weather, climate and natural vegetation.', 'All', 30],
      [3, '3', 'Economic development', 'Development, food production, industry, tourism, energy, water, environmental risks of economic development.', 'All', 28],
      [4, '4', 'Geographical skills', 'Map reading (grid references, scale, contours), graphs and diagrams, photographs.', 'All', 14],
      [5, '5', 'Fieldwork and geographical investigation', 'Hypotheses, data collection methods, presenting and analysing results, conclusions and evaluation.', 'All', 12],
    ],
  },
  {
    key: 'HIS', subject: 'SST', code: '0470', title: 'Cambridge IGCSE History', series: '2027-2029', tiered: false,
    notes: `Alternative humanities route for Social Studies students (Core content Option B: the 20th century, plus one depth study). Untiered — graded A*–G. ${CHECK}`,
    components: [
      ['1', 'Paper 1 — Structured questions', 'All', 120, 60, 40, 'written', null],
      ['2', 'Paper 2 — Document questions', 'All', 120, 50, 33, 'written', null],
      ['3', 'Component 3 — Coursework', 'All', null, 40, 27, 'coursework', 'Depth study (Component 3 or Paper 4)'],
      ['4', 'Paper 4 — Alternative to coursework', 'All', 60, 40, 27, 'written', 'Depth study (Component 3 or Paper 4)'],
    ],
    topics: [
      [1, 'B1', 'Were the peace treaties of 1919–23 fair?', 'Aims of the peacemakers, the Treaty of Versailles, impact on Germany, the other treaties.', 'All', 10],
      [2, 'B2', 'To what extent was the League of Nations a success?', 'Aims and organisation, successes in the 1920s, the Depression, Manchuria and Abyssinia.', 'All', 10],
      [3, 'B3', 'Why had international peace collapsed by 1939?', 'Hitler’s foreign policy, appeasement, the Nazi–Soviet Pact.', 'All', 10],
      [4, 'B4', 'Who was to blame for the Cold War?', 'Yalta and Potsdam, Soviet expansion in Eastern Europe, the US reaction, the Berlin Blockade.', 'All', 10],
      [5, 'B5', 'How effectively did the USA contain the spread of Communism?', 'Korea, Cuba and Vietnam.', 'All', 10],
      [6, 'D1', 'Depth study: Germany, 1918–45', 'The Weimar Republic, the rise of Hitler, the Nazi regime and life in Nazi Germany.', 'All', 16],
    ],
  },
  {
    key: 'ART', subject: 'ART', code: '0400', title: 'Cambridge IGCSE Art & Design', series: '2026-2028', tiered: false,
    notes: `Untiered — graded A*–G. A coursework portfolio and an externally set assignment completed under supervised conditions. Marks are left blank here — check the current syllabus for the mark totals. ${CHECK}`,
    components: [
      ['1', 'Component 1 — Coursework', 'All', null, null, 50, 'coursework', null],
      ['2', 'Component 2 — Externally set assignment', 'All', null, null, 50, 'practical', null],
    ],
    topics: [
      [1, 'AO1', 'Record ideas, observations and insights', 'Drawing and recording from first-hand observation; photography; annotation.', 'All', 20],
      [2, 'AO2', 'Explore and select resources, media and processes', 'Experimenting with media, techniques and processes; refining work.', 'All', 20],
      [3, 'AO3', 'Develop ideas through investigation', 'Contextual research, artist studies, developing ideas.', 'All', 20],
      [4, 'AO4', 'Present a personal and coherent response', 'Final outcome realising intentions; presenting the portfolio.', 'All', 20],
    ],
  },
  {
    key: 'HIN', subject: 'HIN', code: '0549', title: 'Cambridge IGCSE Hindi as a Second Language', series: '2026-2028', tiered: false,
    notes: `Untiered — graded A*–G. Durations, marks and weightings are not filled in — enter them from the current Cambridge syllabus document. ${CHECK}`,
    components: [
      ['1', 'Paper 1 — Reading and writing', 'All', null, null, null, 'written', null],
      ['2', 'Paper 2 — Listening', 'All', null, null, null, 'listening', null],
      ['3', 'Component 3 — Speaking', 'All', null, null, null, 'oral', null],
    ],
    topics: [
      [1, '1', 'Everyday activities', 'Home life, school routine, food and health.', 'All', 10],
      [2, '2', 'Personal and social life', 'Self, family, friends, leisure and celebrations.', 'All', 10],
      [3, '3', 'The world around us', 'Home town, environment, travel and transport.', 'All', 10],
      [4, '4', 'The world of work and the international world', 'Education, careers, the wider world, culture.', 'All', 10],
    ],
  },
  {
    key: 'TAM', subject: 'TAM', code: null, title: 'Tamil — school language programme (Grades 9–10)', body: 'School-assessed (state language)', series: null, tiered: false,
    notes: 'No Cambridge IGCSE Tamil syllabus is offered, so Tamil is taught and assessed by the school as the state language. Marks are reported on the same A*–G/U letters for consistency. Check Cambridge’s current list of language syllabuses if an external qualification is needed.',
    components: [
      ['1', 'Paper 1 — Prose, poetry and comprehension', 'All', 120, 80, 50, 'written', null],
      ['2', 'Paper 2 — Grammar and composition', 'All', 120, 80, 40, 'written', null],
      ['3', 'Oral assessment', 'All', 15, 20, 10, 'oral', null],
    ],
    topics: [
      [1, '1', 'Prose (உரைநடை)', 'Prescribed prose lessons, comprehension and summary.', 'All', 20],
      [2, '2', 'Poetry (செய்யுள்)', 'Prescribed poems including Thirukkural couplets; appreciation and memorisation.', 'All', 20],
      [3, '3', 'Grammar (இலக்கணம்)', 'Ezhuthu, sol and yappu essentials; sentence analysis.', 'All', 18],
      [4, '4', 'Composition', 'Letters, essays and report writing.', 'All', 14],
      [5, '5', 'Supplementary reader and oral', 'Short stories, reading aloud and speaking.', 'All', 10],
    ],
  },
];

/** Which syllabuses each IGCSE grade's sections follow (from the seeded subjects per grade). */
const BY_GRADE: Record<number, string[]> = {
  9: ['ENG', 'MAT', 'SCI', 'GEO', 'CMP', 'TAM'],
  10: ['ENG', 'MAT', 'PHY', 'GEO', 'CMP', 'TAM'],
};
/** Syllabuses students are entered for (the school-assessed Tamil course has no external entry). */
const ENTERED = ['ENG', 'MAT', 'SCI', 'PHY', 'GEO', 'CMP'];

export async function seed(db: Db, ctx: SeedContext) {
  const subjects: Record<string, string> = {};
  for (const r of (await db.query('SELECT id, code FROM subjects')).rows) subjects[r.code] = r.id;
  const admin = ctx.users.principal ?? null;

  // ---- Syllabuses, components, topics ------------------------------------------
  const syl: Record<string, { id: string; tiered: boolean; topics: { id: string; tier: Tier }[]; comps: Record<string, string> }> = {};
  for (const d of DEFS) {
    if (!subjects[d.subject]) continue;
    // Grades that teach it (BY_GRADE); offered-but-untimetabled syllabuses keep both IGCSE years.
    const grades = [9, 10].filter((g) => BY_GRADE[g]?.includes(d.key));
    const r = await db.query(
      `INSERT INTO syllabuses (subject_id, stage, awarding_body, syllabus_code, title, exam_series_years, tiered, grading, notes, is_active, created_by, grade_levels)
       VALUES ($1,'IGCSE',$2,$3,$4,$5,$6,'A*-G',$7,true,$8,$9) RETURNING id`,
      [subjects[d.subject], d.body ?? 'Cambridge International', d.code, d.title, d.series, d.tiered, d.notes, admin, grades.length ? grades : [9, 10]],
    );
    const id = r.rows[0].id as string;
    const comps = await bulkInsert(db, 'syllabus_components',
      ['syllabus_id', 'paper_no', 'name', 'tier', 'duration_minutes', 'max_marks', 'weighting_percent', 'assessment_type', 'option_group', 'notes', 'sort_order'],
      d.components.map(([paper, name, tier, mins, max, w, type, group], i) => [id, paper, name, tier, mins, max, w, type, group,
        d.code ? 'Editable default — check against the current Cambridge syllabus document.' : 'School-defined component.', i + 1]),
      'RETURNING id, paper_no');
    const topics = await bulkInsert(db, 'syllabus_topics',
      ['syllabus_id', 'unit_no', 'code', 'title', 'subtopics', 'tier', 'planned_hours', 'planned_weeks', 'sort_order'],
      d.topics.map(([unit, code, title, subs, tier, hours], i) => [id, unit, code, title, subs, tier, hours, Math.round((hours / 4) * 2) / 2, i + 1]),
      'RETURNING id, tier');
    syl[d.key] = {
      id, tiered: d.tiered,
      topics: topics.map((t) => ({ id: t.id, tier: t.tier })),
      comps: Object.fromEntries(comps.map((c) => [c.paper_no, c.id])),
    };
  }

  // ---- Topic coverage for Grade 9–10 sections ------------------------------------
  const sections = (await db.query(
    `SELECT sec.id, c.grade_level, cp.code AS campus, sec.name, sec.class_teacher_id
       FROM sections sec JOIN classes c ON c.id = sec.class_id JOIN campuses cp ON cp.id = c.campus_id
      WHERE sec.academic_year_id = $1 AND c.grade_level IN (9, 10)
      ORDER BY cp.code, c.grade_level, sec.name`, [ctx.yearId],
  )).rows as { id: string; grade_level: number; campus: string; name: string; class_teacher_id: string | null }[];
  const teachers: Record<string, string> = {};
  for (const t of (await db.query('SELECT section_id, subject_id, employee_id FROM teacher_assignments WHERE academic_year_id = $1', [ctx.yearId])).rows) {
    teachers[`${t.section_id}:${t.subject_id}`] = t.employee_id;
  }
  const yearStart = ctx.yearStart || ctx.day(-130);
  const daysIntoYear = Math.max(10, Math.round((Date.parse(ctx.today) - Date.parse(yearStart)) / 86400000));
  const coverage: unknown[][] = [];
  for (const sec of sections) {
    for (const key of BY_GRADE[sec.grade_level] ?? []) {
      const s = syl[key];
      if (!s) continue;
      const def = DEFS.find((d) => d.key === key)!;
      const teacher = teachers[`${sec.id}:${subjects[def.subject]}`] ?? sec.class_teacher_id;
      // Two-year course: Grade 10 is in its second year (most topics done), Grade 9 has just started.
      const share = sec.grade_level === 10 ? 0.55 + ctx.rand() * 0.2 : 0.12 + ctx.rand() * 0.18;
      const done = Math.min(s.topics.length - 1, Math.max(sec.grade_level === 10 ? 2 : 0, Math.round(s.topics.length * share)));
      s.topics.forEach((t, i) => {
        if (i < done) {
          // Grade 10: spread over last year and this year; Grade 9: this year only. Always in the past.
          const span = sec.grade_level === 10 ? daysIntoYear + 300 : daysIntoYear;
          const back = Math.max(3, Math.round(span - ((i + 1) / (done + 1)) * span) + ctx.int(-4, 4));
          coverage.push([t.id, sec.id, 'Covered', ctx.day(-back), teacher, null, admin]);
        } else if (i === done) {
          coverage.push([t.id, sec.id, 'In progress', null, teacher, 'Teaching this fortnight.', admin]);
        }
      });
    }
  }
  if (coverage.length) {
    await bulkInsert(db, 'syllabus_topic_coverage', ['topic_id', 'section_id', 'status', 'covered_on', 'teacher_id', 'notes', 'updated_by'], coverage);
  }

  // ---- Core / Extended entries for Grade 9–10 students -----------------------------
  const year = (await db.query('SELECT ends_on::text AS ends FROM academic_years WHERE id = $1', [ctx.yearId])).rows[0];
  const finalYear = Number(String(year?.ends ?? ctx.today).slice(0, 4));
  const students = (await db.query(
    `SELECT s.id, c.grade_level,
            (SELECT avg(r.score)::float FROM student_academic_records r WHERE r.student_id = s.id AND r.academic_year_id = $1) AS avg
       FROM students s JOIN sections sec ON sec.id = s.section_id JOIN classes c ON c.id = sec.class_id
      WHERE s.deleted_at IS NULL AND s.status = 'active' AND sec.academic_year_id = $1 AND c.grade_level IN (9, 10)`,
    [ctx.yearId],
  )).rows as { id: string; grade_level: number; avg: number | null }[];
  const entries: unknown[][] = [];
  for (const st of students) {
    const series = `May/June ${st.grade_level === 10 ? finalYear : finalYear + 1}`;
    for (const key of BY_GRADE[st.grade_level] ?? []) {
      if (!ENTERED.includes(key) || !syl[key]) continue;
      // Mostly Extended; students averaging under 55 (or a few borderline ones) are entered for Core.
      const avg = st.avg ?? 70;
      const tier = syl[key].tiered ? (avg < 55 || (avg < 62 && ctx.rand() < 0.4) ? 'Core' : 'Extended') : null;
      entries.push([st.id, syl[key].id, tier, series, admin]);
    }
  }
  if (entries.length) await bulkInsert(db, 'student_syllabus_entries', ['student_id', 'syllabus_id', 'tier', 'exam_series', 'updated_by'], entries);

  // ---- Link the IGCSE Physics mocks to their Extended papers and re-grade -----------
  const phy = syl.PHY;
  if (phy) {
    for (const [code, paper] of [['AS-3290', '2'], ['AS-3288', '4']] as const) {
      const a = (await db.query('UPDATE assessments SET syllabus_component_id = $2 WHERE code = $1 RETURNING id, max_marks::float AS max', [code, phy.comps[paper]])).rows[0];
      if (!a) continue;
      const marks = (await db.query('SELECT id, marks::float AS marks FROM assessment_marks WHERE assessment_id = $1 AND marks IS NOT NULL', [a.id])).rows;
      for (const m of marks) {
        await db.query('UPDATE assessment_marks SET grade = $2 WHERE id = $1', [m.id, gradeFromScale(DEFAULT_SCALE, (100 * m.marks) / a.max, 'Extended')]);
      }
    }
  }
}
