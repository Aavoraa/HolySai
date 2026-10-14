/**
 * SAMPLE DATA — transport, families, students, attendance, academic records,
 * Student 360 development record, GPS tracking profiles and location history.
 *
 * GPS coordinates are GENERATED sample points around each campus. They are not
 * real children's locations.
 */
import { addDays, bulkInsert, kolkataTime, type Db, type SeedContext, type SeedStudent } from './context.js';
import { EMPLOYEES, SECTION_PLAN } from './core-org.js';
import { BOYS, GIRLS } from './admissions.js';

// ---------------------------------------------------------------------------
// Transport network (sample coordinates near each campus)
// ---------------------------------------------------------------------------
type Stop = [name: string, lat: number, lng: number, pickup: string, drop: string];
export const ROUTES: {
  code: string; name: string; area: string; campus: string; bus: string; reg: string; capacity: number;
  driver: string; attendant: string | null; status: string; delay: number; eta: string; stops: Stop[];
}[] = [
  { code: 'R12', name: 'Route 12', area: 'Guduvanchery East', campus: 'gdv', bus: 'Bus 12', reg: 'TN 09 BX 4412', capacity: 40, driver: 'EMP-2031', attendant: 'EMP-2044', status: 'At campus', delay: 0, eta: 'Arrived 08:29',
    stops: [['Lake View Avenue', 12.8561, 80.0812, '07:52', '15:48'], ['Temple Road Junction', 12.8532, 80.0764, '07:58', '15:42'], ['Anna Nagar Gate', 12.8508, 80.0716, '08:06', '15:35'], ['Bypass Signal', 12.8481, 80.0668, '08:14', '15:28']] },
  { code: 'R04', name: 'Route 4', area: 'Urapakkam', campus: 'gdv', bus: 'Bus 4', reg: 'TN 09 BX 2208', capacity: 45, driver: 'EMP-2032', attendant: 'EMP-2045', status: 'Delayed', delay: 9, eta: '9 min',
    stops: [['Urapakkam Station', 12.8672, 80.0690, '07:40', '16:05'], ['Karanaipuducherry', 12.8621, 80.0668, '07:48', '15:58'], ['Vallancheri Main Road', 12.8555, 80.0644, '07:58', '15:50'], ['Nandivaram Junction', 12.8512, 80.0631, '08:08', '15:42']] },
  { code: 'R07', name: 'Route 7', area: 'Vandalur', campus: 'gdv', bus: 'Bus 7', reg: 'TN 09 BX 3310', capacity: 35, driver: 'EMP-2033', attendant: 'EMP-2046', status: 'At campus', delay: 0, eta: 'Arrived 08:24',
    stops: [['Vandalur Zoo Gate', 12.8914, 80.0810, '07:35', '16:10'], ['Kolapakkam', 12.8808, 80.0749, '07:47', '15:58'], ['Mannivakkam', 12.8699, 80.0702, '07:59', '15:46']] },
  { code: 'R09', name: 'Route 9', area: 'Maraimalai Nagar', campus: 'gdv', bus: 'Bus 9', reg: 'TN 09 BX 5521', capacity: 40, driver: 'EMP-2034', attendant: 'EMP-2047', status: 'En route', delay: 0, eta: '4 min',
    stops: [['Maraimalai Nagar Bus Stand', 12.7963, 80.0253, '07:38', '16:12'], ['Kattankulathur', 12.8190, 80.0402, '07:52', '15:58'], ['Potheri', 12.8296, 80.0470, '08:04', '15:46']] },
  { code: 'R02', name: 'Route 2', area: 'Singaperumal Koil', campus: 'gdv', bus: 'Bus 2', reg: 'TN 09 BX 1104', capacity: 35, driver: 'EMP-2035', attendant: 'EMP-2048', status: 'At campus', delay: 0, eta: 'Arrived 08:21',
    stops: [['Singaperumal Koil Temple', 12.7614, 80.0073, '07:25', '16:20'], ['Mahindra World City Gate', 12.7382, 79.9937, '07:40', '16:05'], ['Chettipunyam', 12.7847, 80.0192, '07:55', '15:50']] },
  { code: 'R15', name: 'Route 15', area: 'Chengalpattu', campus: 'gdv', bus: 'Bus 15', reg: 'TN 09 BX 6607', capacity: 30, driver: 'EMP-2036', attendant: 'EMP-2049', status: 'Maintenance', delay: 0, eta: 'Depot',
    stops: [['Chengalpattu New Bus Stand', 12.6921, 79.9766, '07:10', '16:35'], ['Paranur', 12.7282, 79.9911, '07:28', '16:18']] },
  { code: 'V01', name: 'Vadavalli Route 1', area: 'Vadavalli & R.S. Puram', campus: 'vdv', bus: 'Bus V1', reg: 'TN 38 CK 1201', capacity: 32, driver: 'EMP-2061', attendant: null, status: 'At campus', delay: 0, eta: 'Arrived 08:18',
    stops: [['R.S. Puram DB Road', 11.0104, 76.9492, '07:30', '16:05'], ['Lawley Road', 11.0152, 76.9361, '07:42', '15:55'], ['Vadavalli Junction', 11.0247, 76.9139, '07:55', '15:45']] },
];

// ---------------------------------------------------------------------------
// Students — reproduces the wireframe's deterministic roster
// ---------------------------------------------------------------------------
const FIRST = ['Aditya', 'Sanjana', 'Karthik', 'Meenakshi', 'Rohan', 'Divya', 'Arjun', 'Lakshmi', 'Vikram', 'Ananya', 'Hari', 'Nithya', 'Surya', 'Pooja', 'Manoj', 'Keerthi', 'Rahul', 'Swetha', 'Vishnu', 'Anjali', 'Naveen', 'Ishita', 'Aravind', 'Shreya', 'Gokul', 'Bhavana', 'Dinesh', 'Varsha', 'Praveen', 'Nandhini', 'Sathish', 'Tanya', 'Mohan', 'Reshma', 'Balaji', 'Harini'];
const LAST = ['Kumar', 'Raman', 'Subramani', 'Natarajan', 'Venkatesh', 'Iyer', 'Pillai', 'Chandran', 'Selvam', 'Murthy', 'Anand', 'Prasad'];
// More names for the generated records that fill every section.
const EXTRA_FIRST = ['Abinaya', 'Akash', 'Bharath', 'Charan', 'Deepika', 'Gayathri', 'Hemanth', 'Janani', 'Kavin', 'Madhan', 'Nila', 'Oviya',
  'Pranav', 'Ragini', 'Sabari', 'Thenmozhi', 'Uday', 'Vaishnavi', 'Yazhini', 'Kiran', 'Lavanya', 'Mithran', 'Pavithra', 'Sriram', 'Tharun', 'Yamini'];
const EXTRA_LAST = ['Balan', 'Menon', 'Krishnan', 'Rajan', 'Sekar', 'Ganesan', 'Mani', 'Shankar', 'Ravi', 'Srinivasan'];
const FEMALE = new Set(['Abinaya', 'Deepika', 'Gayathri', 'Janani', 'Nila', 'Oviya', 'Ragini', 'Thenmozhi', 'Vaishnavi', 'Yazhini', 'Lavanya', 'Pavithra', 'Yamini', 'Sanjana', 'Meenakshi', 'Divya', 'Lakshmi', 'Ananya', 'Nithya', 'Pooja', 'Keerthi', 'Swetha', 'Anjali', 'Ishita', 'Shreya', 'Bhavana', 'Varsha', 'Nandhini', 'Tanya', 'Reshma', 'Harini']);
const HOUSES = ['Emerald', 'Sapphire', 'Amber', 'Coral'];
const FATHER = ['Suresh', 'Ramesh', 'Mahesh', 'Senthil', 'Balaji', 'Murali', 'Venkat', 'Prakash', 'Ganesan', 'Arun', 'Vijay', 'Karthikeyan', 'Saravanan', 'Mohan'];
const MOTHER = ['Lakshmi', 'Priya', 'Deepa', 'Revathi', 'Kavitha', 'Uma', 'Anitha', 'Geetha', 'Malathi', 'Sangeetha', 'Vidya', 'Radha'];

function seeded(i: number) {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

interface Spec {
  no: string; first: string; last: string; gender: 'M' | 'F'; campus: string; grade: number; section: string; house: string;
  att: number; avg: number; trend: number; risk: string; fee: 'Paid' | 'Partial' | 'Overdue'; route: string | null;
}

function buildSpecs(): Spec[] {
  const specs: Spec[] = [];
  for (let i = 0; i < 48; i++) {
    const r1 = seeded(i + 1), r2 = seeded(i + 40), r3 = seeded(i + 90), r4 = seeded(i + 130);
    const att = Math.round(80 + r1 * 19);
    const avg = Math.round(50 + r2 * 44);
    const trend = Math.round((r3 - 0.5) * 16);
    const risk = att < 82 || avg < 55 ? 'At Risk' : att < 86 || avg < 62 || trend < -6 ? 'Developing Risk' : 'On Track';
    const first = FIRST[i % FIRST.length];
    const campus = r4 > 0.82 ? 'vdv' : 'gdv';
    specs.push({
      no: `HS-2026-${1041 + i}`, first, last: LAST[(i * 5) % LAST.length], gender: FEMALE.has(first) ? 'F' : 'M',
      campus, grade: campus === 'vdv' ? 3 + Math.floor(r1 * 7) : 3 + Math.floor(r1 * 8), section: campus === 'vdv' ? ['A', 'B'][Math.floor(r2 * 2)] : ['A', 'B', 'C'][Math.floor(r2 * 3)],
      house: HOUSES[Math.floor(r3 * 4)], att, avg, trend, risk,
      fee: r4 > 0.78 ? 'Overdue' : r4 > 0.58 ? 'Partial' : 'Paid',
      route: r4 > 0.3 ? (campus === 'vdv' ? 'V01' : ['R12', 'R04', 'R07', 'R09', 'R02', 'R15'][Math.floor(r1 * 6)]) : null,
    });
  }
  // Named records used throughout the wireframe
  const set = (no: string, o: Partial<Spec>) => Object.assign(specs.find((s) => s.no === no)!, o);
  set('HS-2026-1041', { first: 'Aditya', last: 'Kumar', gender: 'M', campus: 'gdv', grade: 5, section: 'A', house: 'Emerald', att: 94, avg: 78, trend: 4, risk: 'On Track', fee: 'Partial', route: 'R12' });
  set('HS-2026-1042', { first: 'Sanjana', last: 'Raman', gender: 'F', campus: 'gdv', grade: 7, section: 'B', house: 'Sapphire', att: 79, avg: 54, trend: -11, risk: 'At Risk', fee: 'Overdue', route: 'R04' });
  set('HS-2026-1043', { first: 'Karthik', last: 'Subramani', gender: 'M', campus: 'gdv', grade: 9, section: 'A', house: 'Amber', att: 86, avg: 63, trend: -7, risk: 'Developing Risk', fee: 'Paid', route: null });
  const roster: [string, string, string, 'M' | 'F', number, string, string?][] = [
    ['HS-2026-1055', 'Bhavana', 'Iyer', 'F', 5, 'A'], ['HS-2026-1058', 'Dinesh', 'Selvam', 'M', 5, 'A', 'R04'],
    ['HS-2026-1061', 'Gokul', 'Anand', 'M', 6, 'B'], ['HS-2026-1064', 'Harini', 'Prasad', 'F', 4, 'C'],
    ['HS-2026-1067', 'Ishita', 'Murthy', 'F', 6, 'C'], ['HS-2026-1070', 'Keerthi', 'Pillai', 'F', 8, 'B'],
    ['HS-2026-1073', 'Manoj', 'Natarajan', 'M', 7, 'C'], ['HS-2026-1076', 'Nithya', 'Venkatesh', 'F', 5, 'A'],
    ['HS-2026-1079', 'Praveen', 'Raman', 'M', 10, 'A'], ['HS-2026-1082', 'Reshma', 'Chandran', 'F', 5, 'A'],
    ['HS-2026-1085', 'Surya', 'Kumar', 'M', 5, 'A', 'R12'], ['HS-2026-1088', 'Tanya', 'Subramani', 'F', 7, 'B'],
  ];
  for (const [no, first, last, gender, grade, section, route] of roster) {
    set(no, { first, last, gender, grade, section, campus: 'gdv', ...(route ? { route } : {}), ...(route === undefined && specs.find((s) => s.no === no)!.route === 'V01' ? { route: 'R07' } : {}) });
  }
  set('HS-2026-1058', { att: 88, risk: 'Developing Risk' });
  set('HS-2026-1073', { att: 81, avg: 60, trend: -6, risk: 'At Risk' });
  set('HS-2026-1082', { att: 90, avg: 66, trend: -4, risk: 'Developing Risk' });
  set('HS-2026-1085', { att: 96, avg: 81, trend: 3, risk: 'On Track', fee: 'Paid' });
  // Extra records: Varsha & Vishnu from the wireframe, two Pollachi residential students,
  // and the brief's example student at the Coimbatore (Vadavalli) campus.
  specs.push(
    { no: 'HS-2026-1089', first: 'Varsha', last: 'Iyer', gender: 'F', campus: 'gdv', grade: 4, section: 'A', house: 'Coral', att: 92, avg: 74, trend: 2, risk: 'On Track', fee: 'Paid', route: 'R09' },
    { no: 'HS-2026-1090', first: 'Vishnu', last: 'Murthy', gender: 'M', campus: 'gdv', grade: 9, section: 'A', house: 'Amber', att: 91, avg: 82, trend: 5, risk: 'On Track', fee: 'Paid', route: 'R02' },
    { no: 'HS-2026-1091', first: 'Aarav', last: 'Kumar', gender: 'M', campus: 'vdv', grade: 6, section: 'A', house: 'Sapphire', att: 95, avg: 84, trend: 3, risk: 'On Track', fee: 'Paid', route: 'V01' },
    { no: 'HS-2026-1092', first: 'Kavya', last: 'Balan', gender: 'F', campus: 'plc', grade: 8, section: 'A', house: 'Emerald', att: 97, avg: 79, trend: 1, risk: 'On Track', fee: 'Paid', route: null },
    { no: 'HS-2026-1093', first: 'Rithvik', last: 'Menon', gender: 'M', campus: 'plc', grade: 8, section: 'A', house: 'Coral', att: 93, avg: 71, trend: -2, risk: 'On Track', fee: 'Partial', route: null },
  );
  // Generated names repeat once the first-name list wraps; keep every full name unique.
  // Named wireframe records keep their names; generated ones are renamed.
  const named = new Set(['HS-2026-1041', 'HS-2026-1042', 'HS-2026-1043', ...roster.map((r) => r[0]), ...specs.slice(48).map((s) => s.no)]);
  const seen = new Set(specs.filter((s) => named.has(s.no)).map((s) => `${s.first} ${s.last}`));
  specs.forEach((sp, idx) => {
    if (named.has(sp.no)) return;
    let k = 1;
    while (seen.has(sp.first + ' ' + sp.last)) sp.last = LAST[(LAST.indexOf(sp.last) + k++ + idx) % LAST.length];
    seen.add(sp.first + ' ' + sp.last);
  });

  // Every section gets at least MIN_PER_SECTION students, so each class has a usable roster
  // (attendance, marks entry, Paper Correction). Generated deterministically after the named
  // records, with new admission numbers from HS-2026-1094.
  const MIN_PER_SECTION = 5;
  const count: Record<string, number> = {};
  for (const sp of specs) count[`${sp.campus}:${sp.grade}:${sp.section}`] = (count[`${sp.campus}:${sp.grade}:${sp.section}`] ?? 0) + 1;
  // Admissions enrols a few applicants later with these first names; keep generated names distinct from them.
  const taken = new Set([...GIRLS, ...BOYS]);
  const firsts = [...FIRST, ...EXTRA_FIRST].filter((f) => !taken.has(f));
  const lasts = [...LAST, ...EXTRA_LAST];
  let next = 1094, n = 0;
  for (const [campus, grades, sections] of SECTION_PLAN) {
    for (const grade of grades) {
      for (const section of sections) {
        const key = `${campus}:${grade}:${section}`;
        for (let k = count[key] ?? 0; k < MIN_PER_SECTION; k++, n++) {
          const r1 = seeded(n + 501), r2 = seeded(n + 701), r3 = seeded(n + 901), r4 = seeded(n + 1101);
          let first = firsts[Math.floor(r1 * firsts.length)];
          let last = lasts[Math.floor(r2 * lasts.length)];
          for (let j = 1; seen.has(`${first} ${last}`); j++) {
            first = firsts[(firsts.indexOf(first) + j) % firsts.length];
            if (j % firsts.length === 0) last = lasts[(lasts.indexOf(last) + 1) % lasts.length];
          }
          seen.add(`${first} ${last}`);
          const att = Math.round(80 + r3 * 19);
          const avg = Math.round(50 + r4 * 44);
          const trend = Math.round((seeded(n + 1301) - 0.5) * 16);
          specs.push({
            no: `HS-2026-${next++}`, first, last, gender: FEMALE.has(first) ? 'F' : 'M', campus, grade, section,
            house: HOUSES[Math.floor(seeded(n + 1501) * 4)], att, avg, trend,
            risk: att < 82 || avg < 55 ? 'At Risk' : att < 86 || avg < 62 || trend < -6 ? 'Developing Risk' : 'On Track',
            fee: r4 > 0.85 ? 'Overdue' : r4 > 0.65 ? 'Partial' : 'Paid',
            route: campus === 'plc' || r3 < 0.3 ? null : campus === 'vdv' ? 'V01' : ['R12', 'R04', 'R07', 'R09', 'R02', 'R15'][Math.floor(r1 * 6)],
          });
        }
      }
    }
  }
  return specs;
}

// Named guardians from the wireframe (primary guardian first)
const NAMED_GUARDIANS: Record<string, [string, string, string][]> = {
  'HS-2026-1041': [['Ranjith Kumar', 'Father', '+91 98407 22110'], ['Sujatha Kumar', 'Mother', '+91 98407 22111']],
  'HS-2026-1085': [['Ranjith Kumar', 'Father', '+91 98407 22110'], ['Sujatha Kumar', 'Mother', '+91 98407 22111']],
  'HS-2026-1042': [['Sudha Raman', 'Mother', '+91 98410 55831']],
  'HS-2026-1043': [['Vimal Chandran', 'Guardian', '+91 90031 44902']],
  'HS-2026-1064': [['Gayathri N.', 'Mother', '+91 97890 11234']],
  'HS-2026-1061': [['Gayathri N.', 'Guardian', '+91 97890 11234']],
  'HS-2026-1089': [['Prakash S.', 'Father', '+91 94440 76521']],
  'HS-2026-1091': [['Rajiv Kumar', 'Father', '+91 94430 11820'], ['Anupama Kumar', 'Mother', '+91 94430 11821']],
};

const TERMS = ['Term 1', 'Term 2', 'Term 3', 'Mid Yr', 'Term 4', 'Current'];
const SUBJECTS_FOR = (grade: number) => (grade >= 10 ? ['ENG', 'MAT', 'PHY', 'TAM', 'SST', 'CMP'] : ['ENG', 'MAT', 'SCI', 'TAM', 'SST', 'CMP']);
const ADITYA_SUBJECTS: Record<string, [number, number, number, string]> = {
  ENG: [82, 3, 85, 'EMP-1092'], MAT: [74, 6, 80, 'EMP-1021'], SCI: [80, 2, 82, 'EMP-1044'],
  TAM: [88, 1, 88, 'EMP-1103'], SST: [71, -3, 78, 'EMP-1088'], CMP: [86, 8, 85, 'EMP-6003'],
};
const ADITYA_TERM = [68, 71, 70, 75, 76, 78];

function gradeFor(score: number) {
  return score >= 90 ? 'A*' : score >= 85 ? 'A+' : score >= 78 ? 'A' : score >= 72 ? 'B+' : score >= 65 ? 'B' : score >= 55 ? 'C' : score >= 45 ? 'D' : 'E';
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export async function seedStudents(db: Db, ctx: SeedContext) {
  // ---- Transport --------------------------------------------------------------
  for (const r of ROUTES) {
    const v = await db.query(
      `INSERT INTO vehicles (campus_id, bus_no, registration_no, capacity, gps_device_id, fitness_expiry, insurance_expiry, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [ctx.campuses[r.campus].id, r.bus, r.reg, r.capacity, `GPS-${r.code}-${ctx.int(1000, 9999)}`,
        ['R04', 'R15'].includes(r.code) ? ctx.day(5) : ctx.day(ctx.int(90, 300)), ctx.day(ctx.int(60, 330)), r.status === 'Maintenance' ? 'maintenance' : 'active'],
    );
    const tr = await db.query(
      `INSERT INTO transport_routes (campus_id, code, name, area, vehicle_id, driver_id, attendant_id, run_status, delay_minutes, eta_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [ctx.campuses[r.campus].id, r.code, r.name, r.area, v.rows[0].id, ctx.employees[r.driver], r.attendant ? ctx.employees[r.attendant] : null, r.status, r.delay, r.eta],
    );
    ctx.routes[r.code] = tr.rows[0].id;
    ctx.stops[r.code] = [];
    let seq = 1;
    for (const [name, lat, lng, pickup, drop] of r.stops) {
      const s = await db.query(
        'INSERT INTO route_stops (route_id, sequence, name, latitude, longitude, pickup_time, drop_time) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [tr.rows[0].id, seq++, name, lat, lng, pickup, drop],
      );
      ctx.stops[r.code].push(s.rows[0].id);
    }
    const campus = ctx.campuses[r.campus];
    await db.query(
      'INSERT INTO route_stops (route_id, sequence, name, latitude, longitude, pickup_time, drop_time) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [tr.rows[0].id, seq, `${campus.name} campus`, campus.lat, campus.lng, r.eta.startsWith('Arrived') ? r.eta.slice(8) : '08:30', '15:20'],
    );
    // Recent bus GPS trail (sample)
    const trail = r.stops.map(([, lat, lng, t]) => [v.rows[0].id, lat, lng, ctx.int(18, 42), ctx.int(0, 359), kolkataTime(ctx.today, t)]);
    trail.push([v.rows[0].id, campus.lat, campus.lng, 0, 0, kolkataTime(ctx.today, '08:28')]);
    await bulkInsert(db, 'vehicle_locations', ['vehicle_id', 'latitude', 'longitude', 'speed_kmph', 'heading', 'recorded_at'],
      r.status === 'Maintenance' ? [] : trail.filter((t) => (t[5] as Date) <= ctx.now));
  }

  // ---- Students & families -------------------------------------------------------
  const specs = buildSpecs();
  const parentByName: Record<string, string> = {};
  let parentSeq = 1;
  const parentUser: Record<string, string> = { 'Ranjith Kumar': ctx.users.parent, 'Sudha Raman': ctx.users.parent2 };

  async function ensureParent(name: string, phone: string) {
    if (parentByName[name]) return parentByName[name];
    const code = `PAR-${String(parentSeq++).padStart(4, '0')}`;
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/\.$/, '');
    const r = await db.query(
      `INSERT INTO parents (user_id, parent_code, full_name, phone, email, occupation, address, preferred_channel, engagement_score,
                            last_contact_at, last_contact_channel)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() - make_interval(hours => $10), $11) RETURNING id`,
      [parentUser[name] ?? null, code, name, phone, `${slug}@example.com`,
        ctx.pick(['Software engineer', 'Doctor', 'Business owner', 'Teacher', 'Bank officer', 'Civil engineer', 'Pharmacist', 'Government service', 'Chartered accountant']),
        null, ctx.pick(['whatsapp', 'whatsapp', 'whatsapp', 'sms', 'email']),
        name === 'Ranjith Kumar' ? 86 : name === 'Sudha Raman' ? 42 : name === 'Vimal Chandran' ? 68 : name === 'Gayathri N.' ? 91 : name === 'Prakash S.' ? 55 : ctx.int(38, 96),
        ctx.int(2, 400), ctx.pick(['WhatsApp', 'Call', 'Email', 'SMS', 'WhatsApp'])],
    );
    parentByName[name] = r.rows[0].id;
    ctx.parents[code] = r.rows[0].id;
    return r.rows[0].id;
  }

  const sectionRolls: Record<string, number> = {};
  for (const sp of specs) {
    const campus = ctx.campuses[sp.campus];
    const secKey = `${sp.campus}:${sp.grade}:${sp.section}`;
    const sectionId = ctx.sections[secKey];
    const classId = ctx.classes[`${sp.campus}:${sp.grade}`];
    if (!sectionId) throw new Error(`Missing section ${secKey} for ${sp.no}`);

    // Home location: near the student's bus stop, or within ~4 km of campus.
    let home: { lat: number; lng: number };
    let stopIndex = 0;
    if (sp.route) {
      const route = ROUTES.find((r) => r.code === sp.route)!;
      stopIndex = sp.no === 'HS-2026-1041' || sp.no === 'HS-2026-1085' ? 0 : ctx.int(0, route.stops.length - 1);
      const st = route.stops[stopIndex];
      home = { lat: st[1] + (ctx.rand() - 0.5) * 0.004, lng: st[2] + (ctx.rand() - 0.5) * 0.004 };
    } else {
      home = { lat: campus.lat + (ctx.rand() - 0.5) * 0.06, lng: campus.lng + (ctx.rand() - 0.5) * 0.06 };
    }
    if (sp.no === 'HS-2026-1085') home = { lat: 12.8563, lng: 80.0815 }; // siblings share a home
    if (sp.no === 'HS-2026-1041') home = { lat: 12.8563, lng: 80.0815 };

    const dobYear = new Date(ctx.today).getUTCFullYear() - (sp.grade + 5) - (ctx.rand() > 0.6 ? 1 : 0);
    const dob = sp.no === 'HS-2026-1041' ? '2015-03-14' : `${dobYear}-${String(ctx.int(1, 12)).padStart(2, '0')}-${String(ctx.int(1, 28)).padStart(2, '0')}`;
    const admitted = sp.no === 'HS-2026-1041' ? '2021-06-08' : addDays(ctx.yearStart, -365 * ctx.int(0, Math.max(0, sp.grade - 1)) - ctx.int(0, 6));
    const area = sp.route ? ROUTES.find((r) => r.code === sp.route)!.area : CAMPUSES_PLACE[sp.campus];
    const s = await db.query(
      `INSERT INTO students (admission_no, first_name, last_name, date_of_birth, gender, blood_group, campus_id, section_id,
                             academic_year_id, house, address, city, pincode, admitted_on, risk_level, counsellor_id, medical_notes, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [sp.no, sp.first, sp.last, dob, sp.gender, ctx.pick(['A+', 'B+', 'O+', 'AB+', 'O-', 'B-']), campus.id, sectionId, ctx.yearId, sp.house,
        sp.no === 'HS-2026-1041' ? 'No. 18, Lake View Avenue, Guduvanchery' : `No. ${ctx.int(2, 140)}, ${ctx.pick(['Gandhi Street', 'Nehru Nagar', 'Temple View Road', 'Park Avenue', 'Bharathi Street', 'Lake Road'])}, ${area}`,
        sp.campus === 'gdv' ? 'Chengalpattu' : 'Coimbatore', sp.campus === 'gdv' ? '603202' : sp.campus === 'vdv' ? '641041' : '642001',
        admitted, sp.risk, ctx.employees['EMP-6011'],
        sp.no === 'HS-2026-1041' ? 'Mild dust allergy. Carries no medication.' : null,
        sp.no === 'HS-2026-1041' ? ctx.users.student : null],
    );
    const id = s.rows[0].id;
    sectionRolls[secKey] = (sectionRolls[secKey] ?? 0) + 1;
    await db.query('INSERT INTO enrollments (student_id, section_id, academic_year_id, roll_no, enrolled_on) VALUES ($1,$2,$3,$4,$5)',
      [id, sectionId, ctx.yearId, sectionRolls[secKey], ctx.yearStart]);

    // Guardians
    const named = NAMED_GUARDIANS[sp.no];
    const guardians = named ?? [[`${ctx.pick(FATHER)} ${sp.last}`, 'Father', `+91 9${ctx.int(100000000, 999999999)}`] as [string, string, string]];
    if (!named && ctx.rand() > 0.55) guardians.push([`${ctx.pick(MOTHER)} ${sp.last}`, 'Mother', `+91 9${ctx.int(100000000, 999999999)}`]);
    let primaryParent: string | undefined;
    for (let g = 0; g < guardians.length; g++) {
      const [name, rel, phone] = guardians[g];
      const pid = await ensureParent(name, phone);
      if (g === 0) primaryParent = pid;
      await db.query('INSERT INTO student_guardians (student_id, parent_id, relationship, is_primary, can_pickup, can_view_tracking) VALUES ($1,$2,$3,$4,true,true)',
        [id, pid, rel, g === 0]);
    }

    if (sp.route) {
      await db.query('INSERT INTO student_transport (student_id, route_id, stop_id, valid_from) VALUES ($1,$2,$3,$4)',
        [id, ctx.routes[sp.route], ctx.stops[sp.route][stopIndex], ctx.yearStart]);
    }

    const st: SeedStudent = {
      id, admissionNo: sp.no, fullName: `${sp.first} ${sp.last}`, firstName: sp.first, lastName: sp.last, gender: sp.gender,
      campusCode: sp.campus, campusId: campus.id, classId, sectionId, gradeLevel: sp.grade, grade: `Grade ${sp.grade}`, section: sp.section,
      house: sp.house, targetAttendance: sp.att, targetAverage: sp.avg, targetTrend: sp.trend, risk: sp.risk, feeProfile: sp.fee,
      routeCode: sp.route, home, parentId: primaryParent,
    };
    ctx.students.push(st);
    ctx.studentByNo[sp.no] = st;
  }

  await seedAttendance(db, ctx);
  await seedAcademicRecords(db, ctx);
  await seedDevelopment(db, ctx);
  await seedTracking(db, ctx);
  await seedGateAndBoarding(db, ctx);
  await seedStaffAttendance(db, ctx);
}

const CAMPUSES_PLACE: Record<string, string> = { gdv: 'Guduvanchery', vdv: 'Vadavalli', plc: 'Pollachi' };

// ---------------------------------------------------------------------------
async function seedAttendance(db: Db, ctx: SeedContext) {
  const days = ctx.schoolDays(ctx.yearStart, ctx.today);
  const rows: unknown[][] = [];
  const todayDow = new Date(`${ctx.today}T00:00:00Z`).getUTCDay();
  for (const s of ctx.students) {
    for (const d of days) {
      const isToday = d === ctx.today;
      // Grade 5A is left unmarked today so the teacher can mark it in the demo.
      if (isToday && s.sectionId === ctx.sections['gdv:5:A']) continue;
      if (isToday && todayDow === 0) continue;
      const roll = ctx.rand() * 100;
      const absentRate = 100 - s.targetAttendance;
      let status: string;
      if (roll < absentRate * 0.8) status = 'absent';
      else if (roll < absentRate) status = 'leave';
      else if (roll < absentRate + (s.routeCode === 'R04' ? 9 : 4)) status = 'late';
      else status = 'present';
      if (isToday && s.admissionNo === 'HS-2026-1042') status = 'absent';
      if (isToday && s.admissionNo === 'HS-2026-1043') status = 'late';
      const arrival = status === 'late' ? `08:${ctx.int(46, 59)}` : status === 'present' ? `08:${String(ctx.int(10, 44)).padStart(2, '0')}` : null;
      rows.push([s.id, s.sectionId, d, status, arrival, status === 'leave' ? 'Approved leave' : null, 'teacher',
        ctx.users.teacher, status === 'absent' ? kolkataTime(d, '09:20') : null]);
    }
  }
  await bulkInsert(db, 'attendance_records',
    ['student_id', 'section_id', 'attendance_date', 'status', 'arrival_time', 'remarks', 'source', 'marked_by', 'parent_notified_at'], rows);
}

async function seedAcademicRecords(db: Db, ctx: SeedContext) {
  const rows: unknown[][] = [];
  const teacherFor: Record<string, string> = { ENG: 'EMP-1092', MAT: 'EMP-1021', SCI: 'EMP-1044', TAM: 'EMP-1103', SST: 'EMP-1088', CMP: 'EMP-6003', PHY: 'EMP-1044' };
  for (const s of ctx.students) {
    const subs = SUBJECTS_FOR(s.gradeLevel);
    for (const code of subs) {
      const isAditya = s.admissionNo === 'HS-2026-1041';
      const offset = isAditya ? 0 : Math.round((ctx.rand() - 0.5) * 18);
      const current = isAditya ? ADITYA_SUBJECTS[code][0] : clamp(s.targetAverage + offset, 30, 99);
      const trend = isAditya ? ADITYA_SUBJECTS[code][1] : s.targetTrend + Math.round((ctx.rand() - 0.5) * 4);
      for (let t = 0; t < TERMS.length; t++) {
        let score: number;
        if (t === 5) score = current;
        else if (t === 4) score = clamp(current - trend, 25, 100);
        else if (isAditya) score = clamp(ADITYA_TERM[t] + (ADITYA_SUBJECTS[code][0] - 78) + Math.round((ctx.rand() - 0.5) * 3), 30, 100);
        else score = clamp(current - trend - Math.round((4 - t) * (trend / 3)) + Math.round((ctx.rand() - 0.5) * 6), 25, 100);
        const target = isAditya ? ADITYA_SUBJECTS[code][2] : clamp(Math.round(current / 5) * 5 + 5, 50, 95);
        rows.push([s.id, ctx.yearId, ctx.subjects[code], TERMS[t], t + 1, score, gradeFor(score), target,
          ctx.employees[isAditya ? ADITYA_SUBJECTS[code][3] : teacherFor[code]]]);
      }
    }
  }
  await bulkInsert(db, 'student_academic_records',
    ['student_id', 'academic_year_id', 'subject_id', 'term', 'term_order', 'score', 'grade', 'target_score', 'teacher_id'], rows);
}

// ---------------------------------------------------------------------------
async function seedDevelopment(db: Db, ctx: SeedContext) {
  const A = ctx.studentByNo['HS-2026-1041'];
  const emp = (n: string) => ctx.employeeByName[n];

  // Activities
  const acts: [string, string, string][] = [
    ['Robotics Club', 'Club', 'EMP-6003'], ['Inter-house Debate', 'Competition', 'EMP-1092'], ['Junior Football', 'Sport', 'EMP-1096'],
    ['Eco Club', 'Service', 'EMP-1044'], ['School Choir', 'Club', 'EMP-1098'], ['Chess Club', 'Club', 'EMP-1021'],
    ['Athletics', 'Sport', 'EMP-1096'], ['Young Coders', 'Club', 'EMP-6003'], ['Art Studio', 'Club', 'EMP-1098'],
  ];
  const actId: Record<string, string> = {};
  for (const [name, cat, coord] of acts) {
    actId[name] = (await db.query('INSERT INTO activities (name, category, coordinator_id) VALUES ($1,$2,$3) RETURNING id', [name, cat, ctx.employees[coord]])).rows[0].id;
  }
  const sa: unknown[][] = [
    [A.id, actId['Robotics Club'], 'Member', '2025-06-10', 46], [A.id, actId['Inter-house Debate'], 'Speaker', '2025-08-04', 12],
    [A.id, actId['Junior Football'], 'Midfielder', '2024-07-08', 68], [A.id, actId['Eco Club'], 'Volunteer', '2026-01-12', 20],
  ];
  for (const s of ctx.students) {
    if (s.id === A.id) continue;
    const n = ctx.int(1, 3);
    const chosen = new Set<string>();
    for (let i = 0; i < n; i++) chosen.add(ctx.pick(acts)[0]);
    for (const name of chosen) sa.push([s.id, actId[name], ctx.pick(['Member', 'Member', 'Captain', 'Volunteer']), addDays(ctx.yearStart, -ctx.int(0, 500)), ctx.int(4, 60)]);
  }
  await bulkInsert(db, 'student_activities', ['student_id', 'activity_id', 'role', 'since', 'hours'], sa);

  // Achievements
  const ach: unknown[][] = [
    [A.id, 'District Robotics Challenge — 2nd place', 'Competition', 'District', '2026-08-12', true],
    [A.id, 'Cambridge Science Quiz — School finalist', 'Academic', 'School', '2026-07-04', true],
    [A.id, 'Best Speaker, Junior Debate', 'Co-curricular', 'School', '2026-02-22', true],
    [A.id, 'Perfect attendance — Term 2', 'Attendance', 'School', '2025-11-30', true],
  ];
  const ACH = ['Inter-house Athletics — 100 m gold', 'Spell Bee — School finalist', 'Art Exhibition — featured work', 'Math Olympiad — merit certificate', 'Science Expo — best model', 'Chess — district quarter-finalist'];
  for (const s of ctx.students) {
    if (s.id === A.id || ctx.rand() > 0.55) continue;
    ach.push([s.id, ctx.pick(ACH), ctx.pick(['Competition', 'Academic', 'Co-curricular', 'Sports']), ctx.pick(['School', 'School', 'District', 'State']), ctx.day(-ctx.int(10, 300)), ctx.rand() > 0.15]);
  }
  await bulkInsert(db, 'achievements', ['student_id', 'title', 'achievement_type', 'level', 'achieved_on', 'is_verified'], ach);

  // Behaviour
  const beh: unknown[][] = [
    [A.id, ctx.day(-8), 'Positive', 'Helped a new classmate settle into the group project.', emp('Ms. Priya Raghavan')],
    [A.id, ctx.day(-20), 'Note', 'Late submission of Social Studies assignment.', emp('Ms. Anitha Devi')],
    [A.id, ctx.day(-33), 'Positive', 'Led the house assembly presentation confidently.', emp('Ms. Deepa Venkat')],
  ];
  const NOTES: [string, string][] = [
    ['Positive', 'Showed excellent teamwork during the science practical.'], ['Positive', 'Volunteered to help organise the class library.'],
    ['Note', 'Homework incomplete twice this week.'], ['Concern', 'Appeared withdrawn during group activities; counsellor informed.'],
    ['Positive', 'Consistently punctual and well prepared.'], ['Note', 'Needs reminders to bring sports kit.'],
  ];
  for (const s of ctx.students) {
    if (s.id === A.id) continue;
    for (let i = 0; i < ctx.int(0, 2); i++) {
      const [t, note] = s.risk === 'At Risk' && i === 0 ? NOTES[3] : ctx.pick(NOTES);
      beh.push([s.id, ctx.day(-ctx.int(2, 80)), t, note, ctx.employees[ctx.pick(['EMP-1021', 'EMP-1044', 'EMP-1092', 'EMP-1088'])]]);
    }
  }
  await bulkInsert(db, 'behaviour_records', ['student_id', 'recorded_on', 'record_type', 'note', 'recorded_by'], beh);

  // Skills with evidence (Talent Discovery)
  const aditya: [string, number, string, string[]][] = [
    ['Creativity', 88, 'High', ['Robotics prototype scored 2nd of 34 teams at district level (Aug 2026)', 'Two teacher observations cite original problem framing in Science', 'Highest elective engagement: 46 lab hours in Robotics Club']],
    ['Collaboration', 84, 'High', ['Peer feedback in 3 group projects rated "shares work fairly"', 'Behaviour note: supported a new classmate', 'Football squad attendance 96% across two seasons']],
    ['Communication', 82, 'Medium', ['Best Speaker, Junior Debate (Feb 2026)', 'English score 82 with an upward trend of +3', 'Led house assembly presentation (Aug 2026)']],
    ['Critical Thinking', 76, 'Medium', ['Computing score 86 with +8 trend', 'Mathematics improved 6 points after applied-measurement approach']],
    ['Leadership', 64, 'Emerging', ['One assembly lead role recorded', 'No formal captaincy or mentoring role yet — suggest a structured opportunity']],
  ];
  const skills: unknown[][] = aditya.map(([n, v, c, e]) => [A.id, n, v, c, JSON.stringify(e), ctx.day(-5)]);
  for (const s of ctx.students) {
    if (s.id === A.id) continue;
    for (const n of ['Communication', 'Creativity', 'Leadership', 'Critical Thinking', 'Collaboration']) {
      const v = clamp(Math.round(s.targetAverage + (ctx.rand() - 0.5) * 30), 35, 97);
      skills.push([s.id, n, v, v >= 82 ? 'High' : v >= 68 ? 'Medium' : 'Emerging', JSON.stringify([`Teacher rubric assessment — ${n.toLowerCase()} ${v}/100`]), ctx.day(-ctx.int(5, 40))]);
    }
  }
  await bulkInsert(db, 'student_skills', ['student_id', 'skill', 'score', 'confidence', 'evidence', 'assessed_on'], skills);

  const INTERESTS = ['Robotics', 'Football', 'Reading', 'Music', 'Painting', 'Coding', 'Chess', 'Astronomy', 'Dance', 'Nature', 'Cricket', 'Theatre'];
  const ints: unknown[][] = [[A.id, 'Robotics'], [A.id, 'Football'], [A.id, 'Public speaking'], [A.id, 'Environment']];
  for (const s of ctx.students) {
    if (s.id === A.id) continue;
    new Set([ctx.pick(INTERESTS), ctx.pick(INTERESTS)]).forEach((i) => ints.push([s.id, i]));
  }
  await bulkInsert(db, 'student_interests', ['student_id', 'interest'], ints);

  // Wellbeing check-ins
  const well: unknown[][] = [[A.id, ctx.day(-12), 'Settled', 'No concerns flagged this term. Sleep and appetite reported normal at the last review.', false, emp('Ms. Deepa Venkat')]];
  for (const s of ctx.students) {
    if (s.id === A.id) continue;
    const mood = s.risk === 'At Risk' ? ctx.pick(['Anxious', 'Low', 'Unsettled']) : ctx.pick(['Settled', 'Settled', 'Positive']);
    well.push([s.id, ctx.day(-ctx.int(3, 40)), mood, s.risk === 'At Risk' ? 'Follow-up agreed with class teacher.' : 'Routine check-in.', s.risk === 'At Risk', emp('Ms. Deepa Venkat')]);
  }
  await bulkInsert(db, 'wellbeing_checkins', ['student_id', 'checked_on', 'mood', 'notes', 'is_confidential', 'recorded_by'], well);

  await bulkInsert(db, 'teacher_observations', ['student_id', 'employee_id', 'observed_on', 'observation'], [
    [A.id, emp('Ms. Priya Raghavan'), ctx.day(-11), 'Aditya is strongest when a task has a making or building element. Fractions clicked once we used the workshop measuring activity.'],
    [A.id, emp('Mr. Sathish Kumar'), ctx.day(-19), 'Picks up block-based logic faster than the class median. Ready for an extension track next term.'],
    [ctx.studentByNo['HS-2026-1042'].id, emp('Mr. Ganesh Venkat'), ctx.day(-4), 'Sanjana has missed several practicals; she engages well when present. Family contact recommended.'],
    [ctx.studentByNo['HS-2026-1082'].id, emp('Ms. Priya Raghavan'), ctx.day(-6), 'Reshma understands the work in class but homework returns have dropped for three weeks.'],
  ]);

  // Early Warning signals (wireframe) — stage 0 Signal … 5 Closed
  const sig: [string, string, string, string, number, string, number, string | null, string | null][] = [
    ['SIG-341', 'HS-2026-1042', 'Attendance fell to 79% with 4 unexplained absences', 'attendance', 1, 'EMP-1044', -3, null, null],
    ['SIG-338', 'HS-2026-1043', 'Mathematics down 7 points across two assessments', 'academic', 2, 'EMP-1088', -6, 'accepted', 'Two small-group maths clinics per week'],
    ['SIG-334', 'HS-2026-1073', 'Participation in class activities declined markedly', 'wellbeing', 3, 'EMP-6011', -9, 'accepted', 'Counsellor check-ins twice a week'],
    ['SIG-329', 'HS-2026-1058', 'Repeated late arrivals linked to Route 4 delays', 'transport', 4, 'EMP-2015', -12, 'accepted', 'Route 4 pickup moved 10 minutes earlier'],
    ['SIG-321', 'HS-2026-1082', 'Homework submission rate 40% over three weeks', 'academic', 1, 'EMP-1021', -15, null, null],
    ['INT-118', 'HS-2026-1041', 'Social Studies trend -3 over two assessments', 'academic', 4, 'EMP-1088', -23, 'accepted', 'Weekly reading support, 2 sessions'],
  ];
  for (const [code, no, signal, type, stage, owner, raised, decision, action] of sig) {
    await db.query(
      `INSERT INTO early_warning_signals (code, student_id, signal, signal_type, stage, owner_id, raised_on, review_decision, action_plan,
                                          next_review_on, reviewed_by, reviewed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [code, ctx.studentByNo[no].id, signal, type, stage, ctx.employees[owner], ctx.day(raised), decision, action,
        decision ? ctx.day(ctx.int(2, 10)) : null, decision ? ctx.users.teacher : null, decision ? ctx.at(ctx.day(raised + 1), '15:00') : null],
    );
  }
  // Signals for other at-risk students (awaiting review)
  let n = 342;
  for (const s of ctx.students.filter((x) => x.risk === 'At Risk' && !['HS-2026-1042', 'HS-2026-1073'].includes(x.admissionNo))) {
    await db.query(
      `INSERT INTO early_warning_signals (code, student_id, signal, signal_type, stage, owner_id, raised_on) VALUES ($1,$2,$3,$4,0,$5,$6)`,
      [`SIG-${n++}`, s.id, s.targetAttendance < 82 ? `Attendance at ${s.targetAttendance}% — below the 82% threshold` : `Average score ${s.targetAverage} — below the expected band`,
        s.targetAttendance < 82 ? 'attendance' : 'academic', ctx.employees['EMP-1021'], ctx.day(-ctx.int(1, 6))],
    );
  }
  // A few closed signals this term
  for (const s of ctx.students.filter((x) => x.risk === 'On Track').slice(0, 6)) {
    await db.query(
      `INSERT INTO early_warning_signals (code, student_id, signal, signal_type, stage, owner_id, raised_on, review_decision, action_plan, closed_at)
       VALUES ($1,$2,'Attendance dip in the first month','attendance',5,$3,$4,'accepted','Parent meeting and weekly check-in', $5)`,
      [`SIG-${n++}`, s.id, ctx.employees['EMP-6011'], ctx.day(-ctx.int(40, 80)), ctx.at(ctx.day(-ctx.int(5, 30)), '14:00')],
    );
  }

  // Student documents
  const docs: unknown[][] = [
    ['student', A.id, A.id, 'Birth certificate', 'Identity', 'Verified', '2021-06-08'],
    ['student', A.id, A.id, 'Previous school transfer certificate', 'Admission', 'Verified', '2021-06-08'],
    ['student', A.id, A.id, 'Immunisation record', 'Health', 'Verified', '2021-06-11'],
    ['student', A.id, A.id, 'Address proof (renewal)', 'Identity', 'Pending', null],
  ];
  for (const s of ctx.students) {
    if (s.id === A.id) continue;
    docs.push(['student', s.id, s.id, 'Birth certificate', 'Identity', 'Verified', null]);
    docs.push(['student', s.id, s.id, 'Immunisation record', 'Health', ctx.rand() > 0.2 ? 'Verified' : 'Pending', null]);
  }
  await bulkInsert(db, 'documents', ['owner_type', 'owner_id', 'student_id', 'name', 'category', 'status', 'requested_on'],
    docs.map((d) => [d[0], d[1], d[2], d[3], d[4], d[5], d[5] === 'Pending' ? ctx.day(-16) : null]));

  // Curated growth timeline (Aditya from the wireframe; admission for everyone)
  const tl: unknown[][] = [
    [A.id, '2021-06-08', 'Admitted to Grade 1', 'Enrolled through a parent referral from the Guduvanchery campus open day.', 'admission', 'teal'],
    [A.id, '2023-03-15', 'Cambridge Primary checkpoint', 'Above expectation in Science and Mathematics.', 'academic', 'neutral'],
    [A.id, '2026-08-14', 'Rainwater sensor prototype', 'Team of three. Prototype entered in the District Robotics Challenge.', 'activity', 'amber'],
  ];
  for (const s of ctx.students) {
    if (s.id === A.id) continue;
    tl.push([s.id, addDays(ctx.yearStart, -365 * Math.max(0, s.gradeLevel - 3)), `Admitted to ${s.grade}`, `Joined ${s.campusCode === 'gdv' ? 'Guduvanchery' : s.campusCode === 'vdv' ? 'Vadavalli' : 'Pollachi'} campus`, 'admission', 'teal']);
  }
  await bulkInsert(db, 'student_timeline_events', ['student_id', 'occurred_on', 'title', 'body', 'category', 'tone'], tl);

  // Infirmary & counselling (safety module owns the screens; Student 360 shows counts)
  await bulkInsert(db, 'infirmary_visits', ['student_id', 'visited_at', 'reason', 'action_taken', 'outcome', 'attended_by', 'parent_informed'], [
    [ctx.studentByNo['HS-2026-1061'].id, ctx.at(ctx.today, '10:15'), 'Headache', 'Rest 30 min, parent informed', 'Returned to class', ctx.employees['EMP-7014'], true],
    [ctx.studentByNo['HS-2026-1089'].id, ctx.at(ctx.today, '11:02'), 'Minor cut — playground', 'Dressing applied', 'Returned to class', ctx.employees['EMP-7014'], false],
    [ctx.studentByNo['HS-2026-1073'].id, ctx.at(ctx.today, '11:40'), 'Fever 100.4°F', 'Parent asked to collect', 'Awaiting pickup', ctx.employees['EMP-7014'], true],
    [A.id, ctx.at(ctx.day(-40), '12:10'), 'Sneezing — dust allergy', 'Antihistamine not given; rest', 'Returned to class', ctx.employees['EMP-7014'], true],
    [A.id, ctx.at(ctx.day(-75), '09:30'), 'Grazed knee — football', 'Cleaned and dressed', 'Returned to class', ctx.employees['EMP-7014'], false],
  ].filter((r) => (r[1] as Date) <= ctx.now));
  await bulkInsert(db, 'counselling_sessions', ['student_id', 'counsellor_id', 'session_on', 'reason', 'status', 'notes'], [
    [ctx.studentByNo['HS-2026-1073'].id, ctx.employees['EMP-6011'], ctx.at(ctx.day(-7), '11:00'), 'Participation decline', 'Completed', 'Confidential session notes.'],
    [ctx.studentByNo['HS-2026-1073'].id, ctx.employees['EMP-6011'], ctx.at(ctx.day(2), '11:00'), 'Follow-up', 'Scheduled', null],
    [ctx.studentByNo['HS-2026-1042'].id, ctx.employees['EMP-6011'], ctx.at(ctx.day(1), '12:00'), 'Attendance and wellbeing', 'Scheduled', null],
  ]);
}

// ---------------------------------------------------------------------------
// GPS tracking (SAMPLE coordinates)
// ---------------------------------------------------------------------------
function lerp(a: { lat: number; lng: number }, b: { lat: number; lng: number }, t: number) {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

async function seedTracking(db: Db, ctx: SeedContext) {
  const profiles: unknown[][] = [];
  const locs: unknown[][] = [];
  const specialStatus: Record<string, string> = { 'HS-2026-1070': 'paused', 'HS-2026-1076': 'offline', 'HS-2026-1088': 'disabled', 'HS-2026-1093': 'offline' };
  const absentToday = new Set(
    (await db.query(`SELECT student_id FROM attendance_records WHERE attendance_date = $1 AND status IN ('absent', 'leave')`, [ctx.today])).rows.map((r) => r.student_id),
  );
  const nowMs = ctx.now.getTime();
  const isSchoolDay = ctx.schoolDays(ctx.today, ctx.today).length > 0;

  // Every tracked student carries an ID-card GPS tag (GPS00 + admission suffix);
  // a few spare tags sit in the store and one is away for repair.
  const tagRows = ctx.students.map((s) => [`GPS00${s.admissionNo.slice(-4)}`, `864521${s.admissionNo.slice(-4).padStart(9, '0')}`, `HS-TAG-${s.admissionNo.slice(-4)}`,
    'id_card_tag', '1.4.2', ctx.campuses[s.campusCode].id, 'assigned', true]);
  const spareCampus = ctx.campuses[ctx.students[0].campusCode].id;
  for (let i = 1; i <= 6; i++) tagRows.push([`GPS00900${i}`, `864521${String(9000 + i).padStart(9, '0')}`, `HS-TAG-900${i}`, 'id_card_tag', '1.4.2', spareCampus, 'available', true]);
  tagRows.push(['GPS009007', `864521${String(9007).padStart(9, '0')}`, 'HS-TAG-9007', 'id_card_tag', '1.3.9', spareCampus, 'maintenance', true]);
  const tags = await bulkInsert(db, 'gps_devices',
    ['device_code', 'imei', 'serial_number', 'device_type', 'firmware_version', 'campus_id', 'status', 'is_sample_data'], tagRows, 'RETURNING id, device_code');
  const tagFor = new Map(tags.map((t) => [t.device_code as string, t.id as string]));
  await bulkInsert(db, 'device_assignments', ['student_id', 'device_id', 'assigned_at', 'notes'],
    ctx.students.map((s) => [s.id, tagFor.get(`GPS00${s.admissionNo.slice(-4)}`), ctx.at(ctx.yearStart, '10:00'), 'Issued with ID card']));

  for (const s of ctx.students) {
    const status = specialStatus[s.admissionNo] ?? 'active';
    const deviceId = tagFor.get(`GPS00${s.admissionNo.slice(-4)}`);
    ctx.int(100, 999); // formerly the tag number; kept so the rest of the seed stays identical
    profiles.push([s.id, status !== 'disabled', status, s.routeCode ? 'bus_rfid' : 'id_card_tag', s.parentId, ctx.at(ctx.yearStart, '10:00'), true]);
    if (status === 'disabled') continue;

    const campus = ctx.campuses[s.campusCode];
    const school = { lat: campus.lat + (ctx.rand() - 0.5) * 0.0012, lng: campus.lng + (ctx.rand() - 0.5) * 0.0012 };
    const acc = () => Math.round(5 + ctx.rand() * 20);
    const push = (date: string, hhmm: string, p: { lat: number; lng: number }, st: string, label: string | null, source = 'sample') => {
      const t = ctx.at(date, hhmm);
      if (t.getTime() > nowMs) return;
      locs.push([s.id, source === 'bus' || source === 'gate' ? null : deviceId, p.lat.toFixed(6), p.lng.toFixed(6), acc(), st, label, source, ctx.int(35, 100), t]);
    };

    // The brief's example: Aarav Kumar on a field visit in Coimbatore.
    if (s.admissionNo === 'HS-2026-1091') {
      const tripDay = nowMs >= ctx.at(ctx.today, '10:32').getTime() && isSchoolDay ? ctx.today : ctx.schoolDays(addDays(ctx.today, -7), addDays(ctx.today, -1)).pop()!;
      push(tripDay, '07:30', s.home, 'at_home', 'Home — R.S. Puram');
      push(tripDay, '07:55', { lat: 11.0247, lng: 76.9139 }, 'in_transit', 'Vadavalli Junction', 'bus');
      push(tripDay, '08:18', school, 'at_school', 'Vadavalli campus');
      push(tripDay, '09:30', school, 'at_school', 'Vadavalli campus');
      push(tripDay, '10:00', { lat: 11.0168, lng: 76.9558 }, 'on_trip', 'Field visit — Coimbatore');
      push(tripDay, '10:15', { lat: 11.0171, lng: 76.9562 }, 'on_trip', 'Field visit — Coimbatore');
      push(tripDay, '10:30', { lat: 11.0178, lng: 76.9571 }, 'on_trip', 'Field visit — Coimbatore');
      push(tripDay, '10:32', { lat: 11.0168, lng: 76.9558 }, 'on_trip', 'Field visit — Coimbatore');
      // The group stays at the visit venue for the rest of the school day.
      for (let m = 10 * 60 + 45; m <= 17 * 60 + 30; m += 15) {
        const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        push(tripDay, hhmm, { lat: 11.0168, lng: 76.9558 }, 'on_trip', 'Field visit — Coimbatore');
      }
      continue;
    }

    // Previous 6 school days: a compact daily pattern
    const pastDays = ctx.schoolDays(addDays(ctx.today, -10), addDays(ctx.today, -1)).slice(-6);
    for (const d of pastDays) {
      push(d, '07:15', s.home, 'at_home', 'Home');
      push(d, `07:${ctx.int(45, 59)}`, lerp(s.home, school, 0.5), 'in_transit', null, s.routeCode ? 'bus' : 'device');
      push(d, '10:30', school, 'at_school', `${campus.name} campus`, 'gate');
      push(d, '16:30', s.home, 'at_home', 'Home');
    }

    if (!isSchoolDay || absentToday.has(s.id) || status === 'offline') {
      // Stayed home today (or device offline since yesterday evening)
      if (status !== 'offline') {
        push(ctx.today, '07:00', s.home, 'at_home', 'Home');
        push(ctx.today, '09:30', s.home, 'at_home', 'Home');
        push(ctx.today, '12:30', s.home, 'at_home', 'Home');
      }
      continue;
    }

    // Today: home → in transit → school, then a ping every 30 minutes at school, then home.
    const leave = ['07:05', '07:10', '07:20', '07:25'][ctx.int(0, 3)];
    push(ctx.today, '06:50', s.home, 'at_home', 'Home');
    push(ctx.today, leave, s.home, 'at_home', 'Home');
    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      const mins = 7 * 60 + Number(leave.slice(3)) + i * 12;
      const hhmm = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      const p = lerp(s.home, school, i / (steps + 1));
      push(ctx.today, hhmm, { lat: p.lat + (ctx.rand() - 0.5) * 0.0015, lng: p.lng + (ctx.rand() - 0.5) * 0.0015 }, 'in_transit', i === steps ? 'Approaching campus' : null, s.routeCode ? 'bus' : 'device');
    }
    const arrive = s.routeCode === 'R04' ? '08:47' : `08:${ctx.int(15, 35)}`;
    push(ctx.today, arrive, school, 'at_school', `${campus.name} campus`, 'gate');
    for (let m = 9 * 60; m <= 15 * 60 + 30; m += 30) {
      push(ctx.today, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
        { lat: school.lat + (ctx.rand() - 0.5) * 0.0008, lng: school.lng + (ctx.rand() - 0.5) * 0.0008 }, 'at_school', `${campus.name} campus`);
    }
    push(ctx.today, '15:50', lerp(school, s.home, 0.4), 'in_transit', null, s.routeCode ? 'bus' : 'device');
    push(ctx.today, '16:10', lerp(school, s.home, 0.8), 'in_transit', null, s.routeCode ? 'bus' : 'device');
    push(ctx.today, '16:25', s.home, 'at_home', 'Home');
  }

  await bulkInsert(db, 'student_tracking_profiles',
    ['student_id', 'tracking_enabled', 'tracking_status', 'device_type', 'consent_given_by', 'consent_given_at', 'is_sample_data'], profiles);
  await bulkInsert(db, 'student_locations',
    ['student_id', 'device_id', 'latitude', 'longitude', 'accuracy', 'location_status', 'place_label', 'source', 'battery_pct', 'recorded_at'], locs);
  // Each tag was last heard from when it sent its most recent sample point.
  await db.query(`UPDATE gps_devices d SET last_seen_at = x.recorded_at, last_battery_pct = x.battery_pct
                    FROM (SELECT DISTINCT ON (device_id) device_id, recorded_at, battery_pct FROM student_locations
                           WHERE device_id IS NOT NULL ORDER BY device_id, recorded_at DESC) x
                   WHERE x.device_id = d.id`);
}

async function seedGateAndBoarding(db: Db, ctx: SeedContext) {
  const present = (await db.query(
    `SELECT student_id, arrival_time FROM attendance_records WHERE attendance_date = $1 AND status IN ('present', 'late')`, [ctx.today])).rows;
  const arrivalBy = new Map(present.map((r) => [r.student_id, String(r.arrival_time).slice(0, 5)]));
  const gate: unknown[][] = [];
  const board: unknown[][] = [];
  for (const s of ctx.students) {
    let arrival = arrivalBy.get(s.id);
    // Grade 5A is unmarked, but the gate still saw them arrive.
    if (!arrival && s.sectionId === ctx.sections['gdv:5:A'] && ctx.schoolDays(ctx.today, ctx.today).length) {
      arrival = s.admissionNo === 'HS-2026-1041' ? '08:31' : `08:${ctx.int(20, 44)}`;
      if (['HS-2026-1082', 'HS-2026-1058'].includes(s.admissionNo)) arrival = `08:${ctx.int(46, 55)}`;
    }
    if (!arrival) continue;
    gate.push([s.id, s.campusId, 'Main Gate', 'in', s.admissionNo === 'HS-2026-1041' ? 'RFID' : ctx.pick(['RFID', 'RFID', 'RFID', 'Face']),
      ctx.at(ctx.today, arrival), ctx.at(ctx.today, arrival)]);
    if (s.routeCode) {
      const route = ROUTES.find((r) => r.code === s.routeCode)!;
      if (route.status === 'Maintenance') continue;
      const stopIdx = 0;
      board.push([s.id, ctx.routes[s.routeCode], ctx.stops[s.routeCode][stopIdx], 'boarded', ctx.at(ctx.today, route.stops[stopIdx][3]), ctx.employees[route.attendant ?? route.driver], 'RFID', ctx.at(ctx.today, route.stops[stopIdx][3])]);
      // Buses still on the road have not dropped their students yet.
      if (route.status === 'At campus') {
        board.push([s.id, ctx.routes[s.routeCode], null, 'deboarded', ctx.at(ctx.today, arrival), ctx.employees[route.attendant ?? route.driver], 'RFID', null]);
      }
    }
  }
  // Past days' gate log (last 5 school days)
  for (const d of ctx.schoolDays(addDays(ctx.today, -8), addDays(ctx.today, -1)).slice(-5)) {
    for (const s of ctx.students) {
      if (ctx.rand() < 0.08) continue;
      gate.push([s.id, s.campusId, 'Main Gate', 'in', 'RFID', ctx.at(d, `08:${ctx.int(10, 50)}`), ctx.at(d, '08:50')]);
      gate.push([s.id, s.campusId, ctx.rand() > 0.9 ? 'Rear Gate' : 'Main Gate', 'out', 'RFID', ctx.at(d, `15:${ctx.int(20, 50)}`), ctx.at(d, '15:55')]);
    }
  }
  await bulkInsert(db, 'gate_events', ['student_id', 'campus_id', 'gate', 'direction', 'method', 'occurred_at', 'parent_notified_at'],
    gate.filter((g) => (g[5] as Date) <= ctx.now));
  await bulkInsert(db, 'boarding_events', ['student_id', 'route_id', 'stop_id', 'event_type', 'occurred_at', 'confirmed_by', 'method', 'parent_notified_at'],
    board.filter((b) => (b[4] as Date) <= ctx.now));
}

async function seedStaffAttendance(db: Db, ctx: SeedContext) {
  const rows: unknown[][] = [];
  const days = ctx.schoolDays(addDays(ctx.today, -45), ctx.today, true);
  for (const [code, , , , , , , shift, todayStatus] of EMPLOYEES) {
    const start = (shift.match(/(\d{2}:\d{2})/) ?? ['', '08:00'])[1];
    for (const d of days) {
      const isToday = d === ctx.today;
      const status = isToday ? todayStatus : ctx.rand() < 0.04 ? 'Absent' : ctx.rand() < 0.05 ? 'On Leave' : ctx.rand() < 0.08 ? 'Late' : 'Present';
      const [h, m] = start.split(':').map(Number);
      const inMin = h * 60 + m - 10 + (status === 'Late' ? ctx.int(15, 40) : ctx.int(0, 12));
      const checkIn = ['Present', 'Late'].includes(status) ? `${String(Math.floor(inMin / 60)).padStart(2, '0')}:${String(inMin % 60).padStart(2, '0')}` : null;
      const checkOut = checkIn && !isToday ? `${String(Math.min(23, Math.floor(inMin / 60) + 8)).padStart(2, '0')}:${String(ctx.int(0, 59)).padStart(2, '0')}` : null;
      rows.push([ctx.employees[code], d, status, checkIn, checkOut, 'biometric']);
    }
  }
  await bulkInsert(db, 'staff_attendance', ['employee_id', 'attendance_date', 'status', 'check_in', 'check_out', 'source'], rows);
}

// ---------------------------------------------------------------------------
// Top-up for an existing database: adds students to every section that has fewer
// than `min`, without touching anything already there (npm run db:top-up).
// New students get a guardian, an enrolment, attendance since the start of the year
// and term results, like the seeded ones; transport and GPS are left out.
// ---------------------------------------------------------------------------
export async function topUpSections(db: Db, ctx: SeedContext, min = 5) {
  const year = (await db.query('SELECT id, starts_on::text AS starts FROM academic_years WHERE is_current')).rows[0];
  if (!year) throw new Error('No current academic year.');
  ctx.yearId = year.id;
  ctx.yearStart = year.starts;
  for (const r of (await db.query('SELECT id, code FROM subjects')).rows) ctx.subjects[r.code] = r.id;
  for (const r of (await db.query('SELECT id, employee_code FROM employees')).rows) ctx.employees[r.employee_code] = r.id;
  const teacher = (await db.query("SELECT id FROM users WHERE email = 'priya.raghavan.demo@holysai.edu'")).rows[0]
    ?? (await db.query("SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = 'teacher' LIMIT 1")).rows[0];
  ctx.users.teacher = teacher?.id ?? null;

  const sections = (await db.query(
    `SELECT sec.id, sec.name, c.id AS class_id, c.grade_level, cp.id AS campus_id, cp.code, cp.latitude, cp.longitude,
            (SELECT count(*)::int FROM students s WHERE s.section_id = sec.id AND s.deleted_at IS NULL AND s.status = 'active') AS n,
            (SELECT COALESCE(max(roll_no), 0)::int FROM enrollments e WHERE e.section_id = sec.id) AS last_roll
       FROM sections sec JOIN classes c ON c.id = sec.class_id JOIN campuses cp ON cp.id = c.campus_id
      WHERE sec.academic_year_id = $1
      ORDER BY cp.code, c.grade_level, sec.name`, [ctx.yearId])).rows;
  const seen = new Set((await db.query("SELECT first_name || ' ' || last_name AS n FROM students")).rows.map((r) => r.n as string));
  let nextNo = Number((await db.query(
    String.raw`SELECT COALESCE(max(substring(admission_no from '\d+$')::int), 1093) AS n FROM students WHERE admission_no LIKE 'HS-2026-%'`)).rows[0].n) + 1;
  let nextParent = Number((await db.query(
    String.raw`SELECT COALESCE(max(substring(parent_code from '\d+$')::int), 0) AS n FROM parents`)).rows[0].n) + 1;

  const firsts = [...FIRST, ...EXTRA_FIRST];
  const lasts = [...LAST, ...EXTRA_LAST];
  const added: SeedStudent[] = [];
  for (const sec of sections) {
    let roll = sec.last_roll as number;
    for (let k = sec.n as number; k < min; k++) {
      let first = ctx.pick(firsts), last = ctx.pick(lasts);
      for (let j = 0; seen.has(`${first} ${last}`); j++) {
        first = ctx.pick(firsts);
        if (j % 20 === 19) last = ctx.pick(lasts);
      }
      seen.add(`${first} ${last}`);
      const grade = sec.grade_level as number;
      const att = ctx.int(80, 99), avg = ctx.int(50, 94), trend = ctx.int(-8, 8);
      const risk = att < 82 || avg < 55 ? 'At Risk' : att < 86 || avg < 62 || trend < -6 ? 'Developing Risk' : 'On Track';
      const gender: 'M' | 'F' = FEMALE.has(first) ? 'F' : 'M';
      const no = `HS-2026-${nextNo++}`;
      const place = CAMPUSES_PLACE[sec.code] ?? 'Campus';
      const dob = `${new Date(ctx.today).getUTCFullYear() - (grade + 5)}-${String(ctx.int(1, 12)).padStart(2, '0')}-${String(ctx.int(1, 28)).padStart(2, '0')}`;
      const s = await db.query(
        `INSERT INTO students (admission_no, first_name, last_name, date_of_birth, gender, blood_group, campus_id, section_id,
                               academic_year_id, house, address, city, pincode, admitted_on, risk_level)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [no, first, last, dob, gender, ctx.pick(['A+', 'B+', 'O+', 'AB+', 'O-', 'B-']), sec.campus_id, sec.id, ctx.yearId,
          ctx.pick(HOUSES), `No. ${ctx.int(2, 140)}, ${ctx.pick(['Gandhi Street', 'Nehru Nagar', 'Temple View Road', 'Park Avenue', 'Bharathi Street', 'Lake Road'])}, ${place}`,
          sec.code === 'gdv' ? 'Chengalpattu' : 'Coimbatore', sec.code === 'gdv' ? '603202' : sec.code === 'vdv' ? '641041' : '642001',
          ctx.yearStart, risk],
      );
      const id = s.rows[0].id as string;
      await db.query('INSERT INTO enrollments (student_id, section_id, academic_year_id, roll_no, enrolled_on) VALUES ($1,$2,$3,$4,$5)',
        [id, sec.id, ctx.yearId, ++roll, ctx.yearStart]);
      const guardian = `${ctx.pick(FATHER)} ${last}`;
      const p = await db.query(
        `INSERT INTO parents (parent_code, full_name, phone, email, preferred_channel, engagement_score)
         VALUES ($1,$2,$3,$4,'whatsapp',$5) RETURNING id`,
        [`PAR-${String(nextParent++).padStart(4, '0')}`, guardian, `+91 9${ctx.int(100000000, 999999999)}`,
          `${guardian.toLowerCase().replace(/[^a-z]+/g, '.')}.${no.slice(-4)}@example.com`, ctx.int(38, 96)],
      );
      await db.query('INSERT INTO student_guardians (student_id, parent_id, relationship, is_primary, can_pickup, can_view_tracking) VALUES ($1,$2,$3,true,true,true)',
        [id, p.rows[0].id, 'Father']);
      added.push({
        id, admissionNo: no, fullName: `${first} ${last}`, firstName: first, lastName: last, gender,
        campusCode: sec.code, campusId: sec.campus_id, classId: sec.class_id, sectionId: sec.id, gradeLevel: grade, grade: `Grade ${grade}`,
        section: sec.name, house: '', targetAttendance: att, targetAverage: avg, targetTrend: trend, risk, feeProfile: 'Paid',
        routeCode: null, home: { lat: Number(sec.latitude), lng: Number(sec.longitude) }, parentId: p.rows[0].id,
      });
    }
  }
  ctx.students = added;
  if (added.length) {
    await seedAttendance(db, ctx);
    await seedAcademicRecords(db, ctx);
  }
  return { added: added.length, sections: sections.length };
}

// ---------------------------------------------------------------------------
// Student 360 fill: gives EVERY active student the development record a profile
// needs — skills (the skill web), activities, an achievement, behaviour notes,
// interests, a wellbeing check-in, a teacher observation, timeline entries and
// documents. Only what a student is missing is added; existing rows are never
// changed, so it is safe to run on any database and to run again.
// Covers students added after seedDevelopment: admissions enrolments, top-ups and
// students created in the app.
// ---------------------------------------------------------------------------
const SKILLS = ['Communication', 'Creativity', 'Leadership', 'Critical Thinking', 'Collaboration'];
const FILL_ACH: [string, string][] = [
  ['Inter-house Athletics — 100 m gold', 'Sports'], ['Spell Bee — school finalist', 'Academic'], ['Art Exhibition — featured work', 'Co-curricular'],
  ['Math Olympiad — merit certificate', 'Competition'], ['Science Expo — best model', 'Competition'], ['Chess — district quarter-finalist', 'Competition'],
  ['Story-writing contest — runner-up', 'Co-curricular'], ['Perfect attendance — Term 1', 'Attendance'], ['Quiz Club — house champions', 'Academic'],
];
const FILL_NOTES: [string, string][] = [
  ['Positive', 'Showed excellent teamwork during the science practical.'], ['Positive', 'Volunteered to help organise the class library.'],
  ['Positive', 'Consistently punctual and well prepared.'], ['Positive', 'Helped a classmate catch up after an absence.'],
  ['Note', 'Homework incomplete twice this week.'], ['Note', 'Needs reminders to bring sports kit.'],
];
const OBSERVATIONS = [
  (n: string) => `${n} takes part readily in class discussions and explains reasoning clearly.`,
  (n: string) => `${n} works well in groups and is ready to take the lead on a small task.`,
  (n: string) => `${n} is curious during practical work and asks thoughtful questions.`,
  (n: string) => `${n}'s written work is neat and well organised; steady progress this term.`,
  (n: string) => `${n} responds well to feedback and corrects mistakes independently.`,
];
const INTERESTS_FILL = ['Robotics', 'Football', 'Reading', 'Music', 'Painting', 'Coding', 'Chess', 'Astronomy', 'Dance', 'Nature', 'Cricket', 'Theatre'];

export async function fillStudentProfiles(db: Db, ctx: SeedContext) {
  const rows = (await db.query(
    `SELECT s.id, s.first_name, s.risk_level, s.admitted_on::text AS admitted_on, c.name AS class_name, cp.code AS campus,
            sec.class_teacher_id,
            (SELECT ta.employee_id FROM teacher_assignments ta WHERE ta.section_id = sec.id LIMIT 1) AS subject_teacher,
            (SELECT round(avg(score))::int FROM student_academic_records r WHERE r.student_id = s.id AND r.term = 'Current') AS avg,
            (SELECT count(*)::int FROM student_skills x WHERE x.student_id = s.id) AS skills,
            (SELECT count(*)::int FROM student_activities x WHERE x.student_id = s.id) AS activities,
            (SELECT count(*)::int FROM achievements x WHERE x.student_id = s.id) AS achievements,
            (SELECT count(*)::int FROM behaviour_records x WHERE x.student_id = s.id) AS behaviour,
            (SELECT count(*)::int FROM student_interests x WHERE x.student_id = s.id) AS interests,
            (SELECT count(*)::int FROM wellbeing_checkins x WHERE x.student_id = s.id) AS wellbeing,
            (SELECT count(*)::int FROM teacher_observations x WHERE x.student_id = s.id) AS observations,
            (SELECT count(*)::int FROM student_timeline_events x WHERE x.student_id = s.id AND x.category = 'admission') AS admitted_event,
            (SELECT count(*)::int FROM student_timeline_events x WHERE x.student_id = s.id AND x.category <> 'admission') AS other_events,
            (SELECT count(*)::int FROM documents x WHERE x.student_id = s.id) AS documents,
            (SELECT array_agg(x.skill) FROM student_skills x WHERE x.student_id = s.id) AS have_skills
       FROM students s
       JOIN sections sec ON sec.id = s.section_id
       JOIN classes c ON c.id = sec.class_id
       JOIN campuses cp ON cp.id = c.campus_id
      WHERE s.deleted_at IS NULL AND s.status = 'active'`)).rows;
  const acts = (await db.query('SELECT id FROM activities ORDER BY name')).rows.map((r) => r.id as string);
  const teachers = (await db.query(
    "SELECT id FROM employees WHERE employee_type = 'teaching' AND deleted_at IS NULL ORDER BY employee_code")).rows.map((r) => r.id as string);
  const counsellor = (await db.query("SELECT id FROM employees WHERE employee_code = 'EMP-6011'")).rows[0]?.id ?? teachers[0] ?? null;
  const yearStart = (await db.query('SELECT starts_on::text AS s FROM academic_years WHERE is_current')).rows[0]?.s ?? ctx.day(-120);

  const skills: unknown[][] = [], sa: unknown[][] = [], ach: unknown[][] = [], beh: unknown[][] = [], ints: unknown[][] = [];
  const well: unknown[][] = [], obs: unknown[][] = [], tl: unknown[][] = [], docs: unknown[][] = [];
  const termOne = addDays(yearStart, 70);
  for (const s of rows) {
    const avg = (s.avg as number | null) ?? ctx.int(60, 85);
    const atRisk = s.risk_level === 'At Risk';
    const teacher = s.class_teacher_id ?? s.subject_teacher ?? (teachers.length ? ctx.pick(teachers) : null);
    if (s.skills < 3) {
      const have = new Set<string>(s.have_skills ?? []);
      for (const n of SKILLS) {
        if (have.has(n)) continue;
        const v = clamp(Math.round(avg + (ctx.rand() - 0.5) * 30), 35, 97);
        skills.push([s.id, n, v, v >= 82 ? 'High' : v >= 68 ? 'Medium' : 'Emerging',
          JSON.stringify([`Teacher rubric assessment — ${n.toLowerCase()} ${v}/100`, `Class work and participation, ${s.class_name}`]), ctx.day(-ctx.int(5, 40))]);
      }
    }
    if (!s.activities && acts.length) {
      const chosen = new Set<string>();
      for (let i = ctx.int(1, 3); i > 0; i--) chosen.add(ctx.pick(acts));
      for (const a of chosen) sa.push([s.id, a, ctx.pick(['Member', 'Member', 'Captain', 'Volunteer']), addDays(yearStart, -ctx.int(0, 300)), ctx.int(4, 60)]);
    }
    if (!s.achievements) {
      const [title, type] = ctx.pick(FILL_ACH);
      ach.push([s.id, title, type, ctx.pick(['School', 'School', 'District', 'State']), ctx.day(-ctx.int(10, 120)), true]);
    }
    if (!s.behaviour && teacher) {
      beh.push([s.id, ctx.day(-ctx.int(2, 40)), 'Positive', ctx.pick(FILL_NOTES.slice(0, 4))[1], teacher]);
      const [t, note] = atRisk ? ['Concern', 'Appeared withdrawn during group activities; counsellor informed.'] : ctx.pick(FILL_NOTES);
      beh.push([s.id, ctx.day(-ctx.int(41, 90)), t, note, teacher]);
    }
    if (!s.interests) new Set([ctx.pick(INTERESTS_FILL), ctx.pick(INTERESTS_FILL)]).forEach((i) => ints.push([s.id, i]));
    if (!s.wellbeing) {
      well.push([s.id, ctx.day(-ctx.int(3, 40)), atRisk ? ctx.pick(['Anxious', 'Low', 'Unsettled']) : ctx.pick(['Settled', 'Settled', 'Positive']),
        atRisk ? 'Follow-up agreed with class teacher.' : 'Routine check-in.', atRisk, counsellor]);
    }
    if (!s.observations && teacher) {
      const text = atRisk ? `${s.first_name} needs encouragement to complete work on time; a check-in with home is suggested.` : ctx.pick(OBSERVATIONS)(s.first_name);
      obs.push([s.id, teacher, ctx.day(-ctx.int(3, 30)), text]);
    }
    const place = CAMPUSES_PLACE[s.campus as string] ?? 'the';
    if (!s.admitted_event) tl.push([s.id, s.admitted_on ?? yearStart, `Admitted to ${s.class_name}`, `Joined ${place} campus`, 'admission', 'teal']);
    if (!s.other_events) {
      if (termOne <= ctx.today) tl.push([s.id, termOne, 'Term 1 results', `Average ${avg}/100 across subjects.`, 'academic', avg >= 75 ? 'teal' : avg >= 60 ? 'neutral' : 'amber']);
      tl.push([s.id, ctx.day(-ctx.int(5, 45)), 'Skills profile reviewed', 'Class teacher updated the skills rubric with recent evidence.', 'talent', 'neutral']);
    }
    if (!s.documents) {
      docs.push(['student', s.id, s.id, 'Birth certificate', 'Identity', 'Verified', null]);
      docs.push(['student', s.id, s.id, 'Immunisation record', 'Health', 'Verified', null]);
    }
  }
  await bulkInsert(db, 'student_skills', ['student_id', 'skill', 'score', 'confidence', 'evidence', 'assessed_on'], skills, 'ON CONFLICT DO NOTHING');
  await bulkInsert(db, 'student_activities', ['student_id', 'activity_id', 'role', 'since', 'hours'], sa, 'ON CONFLICT DO NOTHING');
  await bulkInsert(db, 'achievements', ['student_id', 'title', 'achievement_type', 'level', 'achieved_on', 'is_verified'], ach);
  await bulkInsert(db, 'behaviour_records', ['student_id', 'recorded_on', 'record_type', 'note', 'recorded_by'], beh);
  await bulkInsert(db, 'student_interests', ['student_id', 'interest'], ints, 'ON CONFLICT DO NOTHING');
  await bulkInsert(db, 'wellbeing_checkins', ['student_id', 'checked_on', 'mood', 'notes', 'is_confidential', 'recorded_by'], well);
  await bulkInsert(db, 'teacher_observations', ['student_id', 'employee_id', 'observed_on', 'observation'], obs);
  await bulkInsert(db, 'student_timeline_events', ['student_id', 'occurred_on', 'title', 'body', 'category', 'tone'], tl);
  await bulkInsert(db, 'documents', ['owner_type', 'owner_id', 'student_id', 'name', 'category', 'status', 'requested_on'], docs);
  return {
    students: rows.length, skills: skills.length, activities: sa.length, achievements: ach.length, behaviour: beh.length,
    interests: ints.length, wellbeing: well.length, observations: obs.length, timeline: tl.length, documents: docs.length,
  };
}
