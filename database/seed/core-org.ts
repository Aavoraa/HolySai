/**
 * SAMPLE DATA — organisation, RBAC, demo users, staff, academic structure.
 */
import bcrypt from 'bcryptjs';
import { PERMISSIONS, ROLES, permissionsFor } from '../../backend/src/config/rbac.js';
import { bulkInsert, type Db, type SeedContext } from './context.js';

export const CAMPUSES = [
  { code: 'gdv', name: 'Holy Sai International', place: 'Guduvanchery', short: 'Guduvanchery', curriculum: 'Cambridge Primary → A Level', established: 2011, lat: 12.8458, lng: 80.0625, address: 'GST Road, Guduvanchery, Chengalpattu District, Tamil Nadu' },
  { code: 'vdv', name: 'Holy Sai Preparatory', place: 'Vadavalli', short: 'Vadavalli', curriculum: 'Cambridge Primary → Lower Secondary', established: 2016, lat: 11.0286, lng: 76.9058, address: 'Thondamuthur Road, Vadavalli, Coimbatore, Tamil Nadu' },
  { code: 'plc', name: 'Outdoor Learning Centre', place: 'Pollachi', short: 'Pollachi', curriculum: 'Experiential / Residential programmes', established: 2021, lat: 10.6582, lng: 77.0083, address: 'Aliyar Road, Pollachi, Coimbatore District, Tamil Nadu' },
];

export const SUBJECTS = [
  { code: 'ENG', name: 'English', stage: 'All' },
  { code: 'MAT', name: 'Mathematics', stage: 'All' },
  { code: 'SCI', name: 'Science', stage: 'Primary & Lower Secondary' },
  { code: 'TAM', name: 'Tamil', stage: 'All' },
  { code: 'SST', name: 'Social Studies', stage: 'Primary & Lower Secondary' },
  { code: 'CMP', name: 'Computing', stage: 'All' },
  { code: 'PHY', name: 'Physics', stage: 'IGCSE' },
  { code: 'ART', name: 'Art and Design', stage: 'All' },
  { code: 'HIN', name: 'Hindi', stage: 'All' },
];

/** [code, name, dept, designation, type, category, campus, shift, todayStatus, basic, workload, cpd, userHandle?] */
/** Classes and sections per campus: [campus, grades, sections]. */
export const SECTION_PLAN: [string, number[], string[]][] = [
  ['gdv', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], ['A', 'B', 'C']],
  ['vdv', [1, 2, 3, 4, 5, 6, 7, 8, 9], ['A', 'B']],
  ['plc', [6, 7, 8, 9], ['A']],
];

export const EMPLOYEES: [string, string, string, string, 'teaching' | 'non_teaching', string, string, string, string, number, number, number, string?][] = [
  ['EMP-1001', 'Dr. Meera Krishnan', 'Leadership', 'Principal', 'teaching', 'Leadership', 'gdv', 'General 08:00–16:00', 'Present', 145000, 4, 40, 'principal'],
  ['EMP-1021', 'Ms. Priya Raghavan', 'Academics', 'Teacher — Mathematics', 'teaching', 'Teachers', 'gdv', 'General 08:00–16:00', 'Present', 42000, 26, 18, 'teacher'],
  ['EMP-1044', 'Mr. Ganesh Venkat', 'Academics', 'Teacher — Science', 'teaching', 'Teachers', 'gdv', 'General 08:00–16:00', 'Present', 44000, 28, 22, 'teacher2'],
  ['EMP-1088', 'Ms. Anitha Devi', 'Academics', 'Teacher — Social Studies', 'teaching', 'Teachers', 'gdv', 'General 08:00–16:00', 'On Leave', 40000, 24, 14],
  ['EMP-1092', 'Ms. Lalitha Ramesh', 'Academics', 'Teacher — English', 'teaching', 'Teachers', 'gdv', 'General 08:00–16:00', 'Present', 41000, 27, 16],
  ['EMP-1096', 'Mr. Ravi Shankar', 'Academics', 'Physical Education Coach', 'teaching', 'Teachers', 'gdv', 'General 07:00–15:00', 'Present', 36000, 30, 8],
  ['EMP-1098', 'Ms. Nirmala Priya', 'Academics', 'Teacher — Art and Design', 'teaching', 'Teachers', 'gdv', 'General 08:00–16:00', 'Present', 35000, 18, 10],
  ['EMP-1103', 'Mr. Karthik Murugan', 'Academics', 'Teacher — Tamil', 'teaching', 'Teachers', 'gdv', 'General 08:00–16:00', 'Late', 38000, 25, 9],
  ['EMP-6003', 'Mr. Sathish Kumar', 'Academics', 'Computing & Lab', 'teaching', 'Teachers', 'gdv', 'General 08:00–16:00', 'Present', 46000, 22, 26],
  ['EMP-6011', 'Ms. Deepa Venkat', 'Student Support', 'School Counsellor', 'teaching', 'Teachers', 'gdv', 'General 08:00–16:00', 'Present', 48000, 12, 31],
  ['EMP-7002', 'Ms. Kalaiselvi M.', 'Academics', 'Teacher — Tamil', 'teaching', 'Teachers', 'vdv', 'General 08:00–16:00', 'Present', 39000, 25, 12],
  ['EMP-7005', 'Mr. Arul Prakash', 'Academics', 'Teacher — Mathematics & Science', 'teaching', 'Teachers', 'vdv', 'General 08:00–16:00', 'Present', 40000, 26, 11],
  ['EMP-8001', 'Mr. Dinakaran S.', 'Outdoor Programmes', 'Programme Lead', 'teaching', 'Teachers', 'plc', 'Residential 06:00–18:00', 'Present', 43000, 20, 15],
  ['EMP-2015', 'Murugan P.', 'Transport', 'Transport Supervisor', 'non_teaching', 'Drivers & Attendants', 'gdv', 'Split 06:00–10:00 / 14:00–18:00', 'Present', 32000, 0, 6, 'staff'],
  ['EMP-2031', 'Selvaraj K.', 'Transport', 'Driver — Route 12', 'non_teaching', 'Drivers & Attendants', 'gdv', 'Split 06:00–10:00 / 14:00–18:00', 'Present', 24000, 0, 4],
  ['EMP-2044', 'Lakshmi A.', 'Transport', 'Bus Attendant — Route 12', 'non_teaching', 'Drivers & Attendants', 'gdv', 'Split 06:00–10:00 / 14:00–18:00', 'Present', 16000, 0, 3],
  ['EMP-2032', 'Ilango M.', 'Transport', 'Driver — Route 4', 'non_teaching', 'Drivers & Attendants', 'gdv', 'Split 06:00–10:00 / 14:00–18:00', 'Present', 24000, 0, 4],
  ['EMP-2045', 'Vasanthi P.', 'Transport', 'Bus Attendant — Route 4', 'non_teaching', 'Drivers & Attendants', 'gdv', 'Split 06:00–10:00 / 14:00–18:00', 'Present', 16000, 0, 2],
  ['EMP-2033', 'Ravi S.', 'Transport', 'Driver — Route 7', 'non_teaching', 'Drivers & Attendants', 'gdv', 'Split 06:00–10:00 / 14:00–18:00', 'Present', 24000, 0, 4],
  ['EMP-2046', 'Meena K.', 'Transport', 'Bus Attendant — Route 7', 'non_teaching', 'Drivers & Attendants', 'gdv', 'Split 06:00–10:00 / 14:00–18:00', 'Present', 16000, 0, 3],
  ['EMP-2034', 'Kannan T.', 'Transport', 'Driver — Route 9', 'non_teaching', 'Drivers & Attendants', 'gdv', 'Split 06:00–10:00 / 14:00–18:00', 'Present', 24000, 0, 4],
  ['EMP-2047', 'Jothi R.', 'Transport', 'Bus Attendant — Route 9', 'non_teaching', 'Drivers & Attendants', 'gdv', 'Split 06:00–10:00 / 14:00–18:00', 'Present', 16000, 0, 2],
  ['EMP-2035', 'Prakash D.', 'Transport', 'Driver — Route 2', 'non_teaching', 'Drivers & Attendants', 'gdv', 'Split 06:00–10:00 / 14:00–18:00', 'Present', 24000, 0, 4],
  ['EMP-2048', 'Suganya M.', 'Transport', 'Bus Attendant — Route 2', 'non_teaching', 'Drivers & Attendants', 'gdv', 'Split 06:00–10:00 / 14:00–18:00', 'Present', 16000, 0, 2],
  ['EMP-2036', 'Manikandan V.', 'Transport', 'Driver — Route 15', 'non_teaching', 'Drivers & Attendants', 'gdv', 'Split 06:00–10:00 / 14:00–18:00', 'Present', 24000, 0, 4],
  ['EMP-2049', 'Revathi S.', 'Transport', 'Bus Attendant — Route 15', 'non_teaching', 'Drivers & Attendants', 'gdv', 'Split 06:00–10:00 / 14:00–18:00', 'Absent', 16000, 0, 2],
  ['EMP-2061', 'Senthil V.', 'Transport', 'Driver — Vadavalli Route 1', 'non_teaching', 'Drivers & Attendants', 'vdv', 'Split 06:00–10:00 / 14:00–18:00', 'Present', 23000, 0, 3],
  ['EMP-3002', 'Kavitha S.', 'Front Office', 'Admissions Counsellor', 'non_teaching', 'Reception & Admin', 'gdv', 'General 08:30–17:00', 'Present', 30000, 0, 9, 'office'],
  ['EMP-3018', 'Ravi Thangaraj', 'Front Office', 'Admissions Counsellor', 'non_teaching', 'Reception & Admin', 'gdv', 'General 08:30–17:00', 'Late', 30000, 0, 7],
  ['EMP-3025', 'Lakshmi Narayanan', 'Human Resources', 'HR Manager', 'non_teaching', 'Reception & Admin', 'gdv', 'General 08:30–17:00', 'Present', 52000, 0, 12, 'hr'],
  ['EMP-3031', 'Rajesh Iyer', 'Accounts', 'Finance Manager', 'non_teaching', 'Reception & Admin', 'gdv', 'General 08:30–17:00', 'Present', 55000, 0, 10, 'finance'],
  ['EMP-3040', 'Anand Rao', 'Administration', 'School Administrator', 'non_teaching', 'Reception & Admin', 'gdv', 'General 08:30–17:00', 'Present', 60000, 0, 14, 'schooladmin'],
  ['EMP-4007', 'Devendran M.', 'Security', 'Gate Security — Main', 'non_teaching', 'Security', 'gdv', 'Night 20:00–06:00', 'Present', 20000, 0, 5],
  ['EMP-4019', 'Saravanan R.', 'Security', 'Gate Security — Rear', 'non_teaching', 'Security', 'gdv', 'Day 06:00–14:00', 'Absent', 20000, 0, 5],
  ['EMP-4022', 'Balu K.', 'Security', 'Gate Security — Main (Day)', 'non_teaching', 'Security', 'gdv', 'Day 06:00–14:00', 'Present', 20000, 0, 4],
  ['EMP-5005', 'Rekha J.', 'Housekeeping', 'Housekeeping Lead', 'non_teaching', 'Housekeeping', 'gdv', 'Day 07:00–15:00', 'Present', 18000, 0, 2],
  ['EMP-5011', 'Ponni S.', 'Housekeeping', 'Housekeeping Staff', 'non_teaching', 'Housekeeping', 'gdv', 'Day 07:00–15:00', 'Present', 15000, 0, 1],
  ['EMP-5104', 'Meenal R.', 'Laboratory', 'Lab Assistant', 'non_teaching', 'Lab Staff', 'gdv', 'General 08:00–16:00', 'Present', 22000, 0, 6],
  ['EMP-5120', 'Uma Sundar', 'Library', 'Librarian', 'non_teaching', 'Library Staff', 'gdv', 'General 08:00–16:00', 'Present', 28000, 0, 11],
  ['EMP-7014', 'Nurse Shanthi R.', 'Health', 'School Nurse', 'non_teaching', 'Reception & Admin', 'gdv', 'Day 07:30–16:30', 'Present', 30000, 0, 15],
];

/** Demo sign-in accounts (sample). Emails contain ".demo@" so the sign-in screen can list them outside production. */
export const DEMO_USERS: { handle: string; role: string; email: string; phone: string; name: string; title: string; campus: string }[] = [
  { handle: 'principal', role: 'principal', email: 'meera.krishnan.demo@holysai.edu', phone: '+919840000001', name: 'Dr. Meera Krishnan', title: 'Principal', campus: 'gdv' },
  { handle: 'teacher', role: 'teacher', email: 'priya.raghavan.demo@holysai.edu', phone: '+919840000002', name: 'Ms. Priya Raghavan', title: 'Grade 5A Class Teacher · Mathematics', campus: 'gdv' },
  { handle: 'parent', role: 'parent', email: 'ranjith.kumar.demo@parents.holysai.edu', phone: '+919840722110', name: 'Ranjith Kumar', title: 'Parent of Aditya (5A) and Surya (5A)', campus: 'gdv' },
  { handle: 'office', role: 'office', email: 'kavitha.s.demo@holysai.edu', phone: '+919840000004', name: 'Kavitha S.', title: 'Front Office & Admissions', campus: 'gdv' },
  { handle: 'staff', role: 'staff', email: 'murugan.p.demo@holysai.edu', phone: '+919840000005', name: 'Murugan P.', title: 'Transport Supervisor', campus: 'gdv' },
  { handle: 'superadmin', role: 'super_admin', email: 'admin.demo@holysai.edu', phone: '+919840000006', name: 'System Administrator', title: 'Platform Administration', campus: 'gdv' },
  { handle: 'schooladmin', role: 'school_admin', email: 'anand.rao.demo@holysai.edu', phone: '+919840000007', name: 'Anand Rao', title: 'School Administrator', campus: 'gdv' },
  { handle: 'management', role: 'management', email: 'srinivasan.demo@holysai.edu', phone: '+919840000008', name: 'Mr. K. Srinivasan', title: 'Trustee, Holy Sai Educational Trust', campus: 'gdv' },
  { handle: 'hr', role: 'hr', email: 'lakshmi.n.demo@holysai.edu', phone: '+919840000009', name: 'Lakshmi Narayanan', title: 'HR Manager', campus: 'gdv' },
  { handle: 'finance', role: 'finance', email: 'rajesh.iyer.demo@holysai.edu', phone: '+919840000010', name: 'Rajesh Iyer', title: 'Finance Manager', campus: 'gdv' },
  { handle: 'student', role: 'student', email: 'aditya.kumar.demo@students.holysai.edu', phone: '+919840000011', name: 'Aditya Kumar', title: 'Student, Grade 5A', campus: 'gdv' },
  { handle: 'parent2', role: 'parent', email: 'sudha.raman.demo@parents.holysai.edu', phone: '+919841055831', name: 'Sudha Raman', title: 'Parent of Sanjana, Grade 7B', campus: 'gdv' },
  { handle: 'teacher2', role: 'teacher', email: 'ganesh.venkat.demo@holysai.edu', phone: '+919840000013', name: 'Mr. Ganesh Venkat', title: 'Grade 7B Class Teacher · Science', campus: 'gdv' },
];

export async function seedOrg(db: Db, ctx: SeedContext, demoPassword: string) {
  // ---- Campuses & academic years ------------------------------------------
  for (const c of CAMPUSES) {
    const r = await db.query(
      `INSERT INTO campuses (code, name, place, short_name, curriculum, established, latitude, longitude, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [c.code, c.name, c.place, c.short, c.curriculum, c.established, c.lat, c.lng, c.address],
    );
    ctx.campuses[c.code] = { id: r.rows[0].id, lat: c.lat, lng: c.lng, name: c.name };
    await db.query(
      `INSERT INTO geofences (campus_id, name, zone_type, latitude, longitude, radius_m) VALUES ($1, $2, 'campus', $3, $4, 350)`,
      [r.rows[0].id, `${c.short} campus`, c.lat, c.lng],
    );
  }
  const years = [
    ['2026–27', '2026-06-01', '2027-04-30', true, false],
    ['2025–26', '2025-06-02', '2026-04-30', false, true],
    ['2024–25', '2024-06-03', '2025-04-30', false, true],
  ];
  for (const [label, s, e, cur, locked] of years) {
    const r = await db.query(
      'INSERT INTO academic_years (label, starts_on, ends_on, is_current, is_locked) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [label, s, e, cur, locked],
    );
    if (cur) { ctx.yearId = r.rows[0].id; ctx.yearStart = s as string; }
  }

  // ---- RBAC -------------------------------------------------------------------
  const permIds: Record<string, string> = {};
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    const r = await db.query('INSERT INTO permissions (key, module, description) VALUES ($1,$2,$3) RETURNING id', [key, key.split('.')[0], description]);
    permIds[key] = r.rows[0].id;
  }
  for (const role of ROLES) {
    const r = await db.query(
      'INSERT INTO roles (key, name, description, home_route, scope) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [role.key, role.name, role.description, role.homeRoute, role.scope],
    );
    ctx.roles[role.key] = r.rows[0].id;
    await bulkInsert(db, 'role_permissions', ['role_id', 'permission_id'], permissionsFor(role).map((p) => [r.rows[0].id, permIds[p]]));
  }

  // ---- System settings ----------------------------------------------------------
  const settings: [string, unknown, string, boolean][] = [
    ['school.name', 'Holy Sai International School', 'School display name', true],
    ['school.tagline', 'Growing Minds. Inspiring Futures.', 'Tagline on the sign-in screen', true],
    ['school.product_name', 'Holy Sai Smart School 360', 'Product name', true],
    ['school.timezone', 'Asia/Kolkata', 'School timezone', true],
    ['school.currency', 'INR', 'Currency for all money values', true],
    ['school.languages', ['en', 'ta', 'hi'], 'Interface languages', true],
    ['attendance.cutoff_time', '08:45', 'Arrivals after this time are marked Late', false],
    ['attendance.absence_alert_channels', ['whatsapp', 'push'], 'Channels for absence alerts to parents', false],
    ['tracking.stale_after_minutes', 30, 'Location older than this is shown as last known', false],
    ['tracking.parent_history_days', 7, 'How many days of history a parent can view', false],
    ['tracking.sample_data', true, 'Tracking coordinates are generated sample data (development)', false],
    ['finance.late_fee_per_day', 50, 'Late fee after due date (INR/day)', false],
    ['auth.session_days', 7, 'Refresh-token lifetime in days', false],
    ['early_warning.attendance_threshold', 82, 'Attendance % below which a signal is raised', false],
    ['early_warning.score_drop_threshold', 5, 'Score drop (points) across two assessments that raises a signal', false],
  ];
  for (const [key, value, description, isPublic] of settings) {
    await db.query('INSERT INTO system_settings (key, value, description, is_public) VALUES ($1,$2,$3,$4)', [key, JSON.stringify(value), description, isPublic]);
  }

  // ---- Users --------------------------------------------------------------------
  const hash = await bcrypt.hash(demoPassword, 12);
  for (const u of DEMO_USERS) {
    const r = await db.query(
      `INSERT INTO users (email, phone, password_hash, full_name, title, role_id, campus_id, last_login_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() - interval '1 day') RETURNING id`,
      [u.email, u.phone, hash, u.name, u.title, ctx.roles[u.role], ctx.campuses[u.campus].id],
    );
    ctx.users[u.handle] = r.rows[0].id;
  }

  // ---- Employees ----------------------------------------------------------------
  for (const [code, name, dept, designation, type, category, campus, shift, , basic, workload, cpd, handle] of EMPLOYEES) {
    const first = name.replace(/^(Dr\.|Mr\.|Ms\.|Nurse)\s+/, '').split(' ')[0].toLowerCase();
    const r = await db.query(
      `INSERT INTO employees (user_id, employee_code, full_name, gender, phone, email, campus_id, department, designation,
                              employee_type, category, shift_name, join_date, basic_salary, workload_periods, cpd_hours,
                              background_verified, bank_account_masked)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [
        handle ? ctx.users[handle] : null, code, name,
        /^(Ms\.|Nurse)|Lakshmi|Vasanthi|Meena|Jothi|Suganya|Revathi|Kavitha|Rekha|Ponni|Meenal|Uma|Kalaiselvi/.test(name) ? 'F' : 'M',
        `+9194${String(ctx.int(10000000, 99999999))}`, `${first}.${code.slice(4)}@holysai.edu`,
        ctx.campuses[campus].id, dept, designation, type, category, shift,
        ctx.day(-ctx.int(200, 4000)), basic, workload, cpd, ctx.rand() > 0.08, `XXXXXX${ctx.int(1000, 9999)}`,
      ],
    );
    const id = r.rows[0].id;
    ctx.employees[code] = id;
    ctx.employeeByName[name] = id;
    if (type === 'teaching') {
      await db.query('INSERT INTO teachers (employee_id, qualification, specialisation, is_mentor) VALUES ($1,$2,$3,$4)',
        [id, ctx.pick(['M.Sc., B.Ed.', 'M.A., B.Ed.', 'B.Sc., B.Ed.', 'M.Ed.', 'Ph.D.']), designation.split('— ')[1] ?? dept, ['EMP-6003', 'EMP-1044', 'EMP-6011', 'EMP-7002', 'EMP-1092'].includes(code)]);
    } else {
      await db.query('INSERT INTO non_teaching_staff (employee_id, staff_category, licence_no_masked, licence_expiry) VALUES ($1,$2,$3,$4)',
        [id, category, designation.startsWith('Driver') ? `TN09XXXX${ctx.int(1000, 9999)}` : null, designation.startsWith('Driver') ? ctx.day(ctx.int(60, 900)) : null]);
    }
  }

  // ---- Subjects, classes, sections (plan: SECTION_PLAN) -------------------------
  for (const s of SUBJECTS) {
    const r = await db.query('INSERT INTO subjects (code, name, stage, is_core) VALUES ($1,$2,$3,$4) RETURNING id', [s.code, s.name, s.stage, !['ART', 'HIN'].includes(s.code)]);
    ctx.subjects[s.code] = r.rows[0].id;
  }
  const stageFor = (g: number) => (g <= 6 ? 'Cambridge Primary' : g <= 8 ? 'Cambridge Lower Secondary' : g <= 10 ? 'Cambridge IGCSE' : g === 11 ? 'Cambridge AS Level' : 'Cambridge A Level');
  const plan = SECTION_PLAN;
  const classTeacher: Record<string, string> = {
    'gdv:5:A': 'EMP-1021', 'gdv:7:B': 'EMP-1044', 'gdv:9:A': 'EMP-1088', 'gdv:6:B': 'EMP-1092', 'gdv:4:C': 'EMP-1098',
    'gdv:6:C': 'EMP-1103', 'gdv:8:B': 'EMP-6003', 'gdv:10:A': 'EMP-1096', 'gdv:7:C': 'EMP-6011',
    'vdv:4:A': 'EMP-7002', 'vdv:6:A': 'EMP-7005', 'plc:8:A': 'EMP-8001',
  };
  let room = 101;
  for (const [campus, grades, secs] of plan) {
    for (const g of grades) {
      const r = await db.query('INSERT INTO classes (campus_id, name, grade_level, stage) VALUES ($1,$2,$3,$4) RETURNING id',
        [ctx.campuses[campus].id, `Grade ${g}`, g, stageFor(g)]);
      ctx.classes[`${campus}:${g}`] = r.rows[0].id;
      for (const s of secs) {
        const key = `${campus}:${g}:${s}`;
        const sr = await db.query(
          'INSERT INTO sections (class_id, academic_year_id, name, class_teacher_id, room, capacity) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
          [r.rows[0].id, ctx.yearId, s, classTeacher[key] ? ctx.employees[classTeacher[key]] : null,
            key === 'gdv:5:A' ? 'R-204' : `R-${campus === 'gdv' ? '' : campus.toUpperCase() + '-'}${room++}`, 35],
        );
        ctx.sections[key] = sr.rows[0].id;
      }
    }
  }

  // ---- Teacher assignments (drives teacher data scope) ------------------------
  const assign: [string, string, string, number][] = [
    ['EMP-1021', 'gdv:5:A', 'MAT', 7], ['EMP-1021', 'gdv:6:B', 'MAT', 6], ['EMP-1021', 'gdv:6:C', 'MAT', 6], ['EMP-1021', 'gdv:7:A', 'MAT', 6],
    ['EMP-1044', 'gdv:5:A', 'SCI', 6], ['EMP-1044', 'gdv:7:B', 'SCI', 6], ['EMP-1044', 'gdv:9:A', 'SCI', 6], ['EMP-1044', 'gdv:10:A', 'PHY', 6],
    ['EMP-1092', 'gdv:5:A', 'ENG', 7], ['EMP-1092', 'gdv:6:B', 'ENG', 6], ['EMP-1092', 'gdv:8:B', 'ENG', 6],
    ['EMP-1088', 'gdv:5:A', 'SST', 5], ['EMP-1088', 'gdv:9:A', 'SST', 5], ['EMP-1088', 'gdv:7:C', 'SST', 5],
    ['EMP-1103', 'gdv:5:A', 'TAM', 5], ['EMP-1103', 'gdv:4:C', 'TAM', 5], ['EMP-1103', 'gdv:6:C', 'TAM', 5],
    ['EMP-6003', 'gdv:5:A', 'CMP', 3], ['EMP-6003', 'gdv:8:B', 'CMP', 3], ['EMP-6003', 'gdv:10:A', 'CMP', 3],
    ['EMP-1098', 'gdv:5:A', 'ART', 2], ['EMP-1098', 'gdv:4:A', 'ART', 2],
    ['EMP-7002', 'vdv:4:A', 'TAM', 5], ['EMP-7005', 'vdv:6:A', 'MAT', 6], ['EMP-7005', 'vdv:3:A', 'SCI', 5],
  ];
  await bulkInsert(db, 'teacher_assignments', ['employee_id', 'section_id', 'subject_id', 'academic_year_id', 'periods_per_week'],
    assign.map(([e, s, sub, p]) => [ctx.employees[e], ctx.sections[s], ctx.subjects[sub], ctx.yearId, p]));
}
