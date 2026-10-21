/**
 * SAMPLE DATA — admissions & CRM domain. Owned by the admissions module.
 *
 * Enquiries (leads) with stage history, follow-ups and campus visits,
 * applications with documents, Student Master records for enrolled
 * applicants, parent referrals, communications, alumni, vendors, partners.
 * The 12 leads from the wireframe (LD-4412 … LD-4355) are reproduced exactly;
 * ~40 more are generated over the last six months so the funnel, source and
 * monthly charts are derived from real rows. Every record is fictional.
 */
import { addDays, bulkInsert, type Db, type SeedContext } from './context.js';

const STAGES = ['New Lead', 'Contacted', 'Qualified', 'Visit Scheduled', 'Visit Completed', 'Application', 'Assessment', 'Offer', 'Enrolled'] as const;
type Stage = (typeof STAGES)[number] | 'Lost';

/** Typical spend per enquiry by channel (INR) — marketing spend is the sum of these. */
const COST: Record<string, number> = { WhatsApp: 350, Website: 420, 'Meta Ads': 1350, Referral: 150, Google: 1100, 'Walk-in': 80, Instagram: 900, Phone: 60 };

interface LeadSpec {
  code: string; parent: string; student: string; gender: 'M' | 'F'; grade: number; source: string; campaign: string;
  campus: 'gdv' | 'vdv'; stage: Stage; reached: number; counsellor: 'EMP-3002' | 'EMP-3018' | null; daysAgo: number;
  next: string; nextAt?: [number, string] | null; score: number; transport: boolean; curriculum: string; phone: string;
  referrer?: string; lostReason?: string; appStatus?: string;
}

const curriculumFor = (g: number) => (g <= 6 ? 'Cambridge Primary' : g <= 8 ? 'Cambridge Lower Secondary' : g <= 10 ? 'IGCSE' : 'AS Level');

// ---- The wireframe leads -----------------------------------------------------
const WIREFRAME: LeadSpec[] = [
  { code: 'LD-4412', parent: 'Ramesh Iyer', student: 'Nila Iyer', gender: 'F', grade: 4, source: 'WhatsApp', campaign: 'Sep Admissions', campus: 'gdv', stage: 'Visit Scheduled', reached: 3, counsellor: 'EMP-3002', daysAgo: 6, next: 'Campus visit {+1}, 10:00', nextAt: [1, '10:00'], score: 82, transport: true, curriculum: 'Cambridge Primary', phone: '+91 98844 21007' },
  { code: 'LD-4409', parent: 'Fatima Basheer', student: 'Zoya Basheer', gender: 'F', grade: 6, source: 'Meta Ads', campaign: 'IGCSE Awareness', campus: 'gdv', stage: 'Qualified', reached: 2, counsellor: 'EMP-3018', daysAgo: 7, next: 'Call back {0}', nextAt: [0, '16:00'], score: 71, transport: false, curriculum: 'Cambridge Lower Secondary', phone: '+91 90420 33518' },
  { code: 'LD-4405', parent: 'Gowtham Pillai', student: 'Advik Pillai', gender: 'M', grade: 1, source: 'Referral', campaign: 'Parent referral', campus: 'vdv', stage: 'Application', reached: 5, counsellor: 'EMP-3002', daysAgo: 9, next: 'Document upload pending', nextAt: [-1, '11:00'], score: 88, transport: true, curriculum: 'Cambridge Primary', phone: '+91 97910 88245', referrer: 'Gayathri N.', appStatus: 'Submitted' },
  { code: 'LD-4398', parent: 'Sunitha Rao', student: 'Meghna Rao', gender: 'F', grade: 9, source: 'Website', campaign: 'Organic', campus: 'gdv', stage: 'Assessment', reached: 6, counsellor: 'EMP-3018', daysAgo: 12, next: 'Assessment {+2}, 09:30', nextAt: [2, '09:30'], score: 76, transport: true, curriculum: 'IGCSE', phone: '+91 98650 41192', appStatus: 'Assessment Scheduled' },
  { code: 'LD-4391', parent: 'Arun Venkat', student: 'Ira Venkat', gender: 'F', grade: 2, source: 'Google', campaign: 'Search — CBSE alt', campus: 'gdv', stage: 'Contacted', reached: 1, counsellor: 'EMP-3002', daysAgo: 13, next: 'Share fee structure', nextAt: [-1, '12:00'], score: 54, transport: false, curriculum: 'Cambridge Primary', phone: '+91 96770 12063' },
  { code: 'LD-4388', parent: 'Divya Menon', student: 'Kabir Menon', gender: 'M', grade: 11, source: 'Walk-in', campaign: 'Walk-in', campus: 'gdv', stage: 'Offer', reached: 7, counsellor: 'EMP-3018', daysAgo: 15, next: 'Offer expires {+5}', nextAt: [5, '17:00'], score: 91, transport: true, curriculum: 'AS Level', phone: '+91 94440 77310', appStatus: 'Offer Made' },
  { code: 'LD-4380', parent: 'Sabari Nathan', student: 'Tara Nathan', gender: 'F', grade: 5, source: 'WhatsApp', campaign: 'Sep Admissions', campus: 'vdv', stage: 'New Lead', reached: 0, counsellor: null, daysAgo: 5, next: 'First contact overdue', nextAt: [-4, '10:00'], score: 44, transport: true, curriculum: 'Cambridge Primary', phone: '+91 99620 55841' },
  { code: 'LD-4376', parent: 'Nandini Gupta', student: 'Reyansh Gupta', gender: 'M', grade: 3, source: 'Instagram', campaign: 'Campus reel', campus: 'gdv', stage: 'Visit Completed', reached: 4, counsellor: 'EMP-3002', daysAgo: 16, next: 'Send application link', nextAt: [1, '11:00'], score: 79, transport: false, curriculum: 'Cambridge Primary', phone: '+91 98408 66124' },
  { code: 'LD-4371', parent: 'Hari Shankar', student: 'Vedh Shankar', gender: 'M', grade: 8, source: 'Referral', campaign: 'Alumni referral', campus: 'gdv', stage: 'Enrolled', reached: 8, counsellor: 'EMP-3018', daysAgo: 26, next: 'Onboarding complete', nextAt: null, score: 95, transport: true, curriculum: 'Cambridge Lower Secondary', phone: '+91 90031 22987', appStatus: 'Enrolled' },
  { code: 'LD-4366', parent: 'Preethi Balan', student: 'Anvi Balan', gender: 'F', grade: 7, source: 'Website', campaign: 'Organic', campus: 'gdv', stage: 'Qualified', reached: 2, counsellor: 'EMP-3002', daysAgo: 18, next: 'Schedule visit', nextAt: [0, '12:00'], score: 68, transport: true, curriculum: 'Cambridge Lower Secondary', phone: '+91 97890 44120' },
  { code: 'LD-4362', parent: 'Mohammed Anis', student: 'Ayaan Anis', gender: 'M', grade: 10, source: 'Meta Ads', campaign: 'IGCSE Awareness', campus: 'gdv', stage: 'Application', reached: 5, counsellor: 'EMP-3018', daysAgo: 20, next: 'Transcript pending', nextAt: [1, '15:00'], score: 73, transport: false, curriculum: 'IGCSE', phone: '+91 95000 71263', appStatus: 'Under Review' },
  { code: 'LD-4355', parent: 'Lavanya Suresh', student: 'Mihika Suresh', gender: 'F', grade: 1, source: 'WhatsApp', campaign: 'Sep Admissions', campus: 'vdv', stage: 'Contacted', reached: 1, counsellor: 'EMP-3002', daysAgo: 22, next: 'Awaiting parent reply', nextAt: [-3, '10:30'], score: 51, transport: true, curriculum: 'Cambridge Primary', phone: '+91 99400 38851' },
];

// ---- Generated leads: [daysAgo, source, stage, reached, grade, campus, referrer?, lostReason?, appStatus?]
type Gen = [number, string, Stage, number, number, 'gdv' | 'vdv', string?, string?, string?];
const GENERATED: Gen[] = [
  [165, 'Website', 'Enrolled', 8, 3, 'gdv'],
  [160, 'Referral', 'Enrolled', 8, 5, 'gdv', 'Gayathri N.'],
  [158, 'WhatsApp', 'Lost', 1, 2, 'gdv', undefined, 'Chose a school closer to home'],
  [150, 'Google', 'Lost', 2, 7, 'gdv', undefined, 'Fee structure above budget'],
  [150, 'WhatsApp', 'Enrolled', 8, 5, 'gdv'],
  [146, 'Meta Ads', 'Enrolled', 8, 6, 'gdv'],
  [140, 'Walk-in', 'Enrolled', 8, 1, 'vdv'],
  [135, 'Referral', 'Enrolled', 8, 4, 'vdv', 'Ranjith Kumar'],
  [128, 'Instagram', 'Lost', 1, 2, 'gdv', undefined, 'No response after three attempts'],
  [124, 'WhatsApp', 'Enrolled', 8, 8, 'gdv'],
  [118, 'Website', 'Lost', 5, 9, 'gdv', undefined, 'Application not successful', 'Rejected'],
  [112, 'Referral', 'Lost', 3, 3, 'gdv', 'Prakash S.', 'Relocated to another city'],
  [108, 'Meta Ads', 'Lost', 2, 5, 'gdv', undefined, 'Looking for a CBSE school'],
  [102, 'WhatsApp', 'Enrolled', 8, 2, 'vdv'],
  [96, 'Google', 'Enrolled', 8, 10, 'gdv'],
  [90, 'Referral', 'Enrolled', 8, 6, 'gdv', 'Ranjith Kumar'],
  [86, 'Phone', 'Lost', 0, 1, 'gdv', undefined, 'Enquiry was for a different school'],
  [80, 'Referral', 'Lost', 4, 4, 'gdv', 'Ranjith Kumar', 'Transport route not available'],
  [74, 'Website', 'Enrolled', 8, 7, 'gdv'],
  [70, 'Meta Ads', 'Lost', 1, 8, 'gdv', undefined, 'Fee structure above budget'],
  [66, 'Referral', 'Enrolled', 8, 1, 'gdv', 'Gayathri N.'],
  [60, 'WhatsApp', 'Lost', 3, 5, 'gdv', undefined, 'Did not attend campus visit'],
  [55, 'Walk-in', 'Enrolled', 8, 9, 'gdv'],
  [50, 'Google', 'Lost', 2, 3, 'gdv', undefined, 'Chose a school closer to home'],
  [46, 'Referral', 'Enrolled', 8, 8, 'gdv', 'Vimal Chandran'],
  [42, 'Website', 'Lost', 7, 6, 'gdv', undefined, 'Declined offer — joined another school', 'Withdrawn'],
  [38, 'WhatsApp', 'Offer', 7, 4, 'gdv', undefined, undefined, 'Accepted'],
  [34, 'Meta Ads', 'Lost', 0, 2, 'gdv', undefined, 'Duplicate enquiry'],
  [31, 'Referral', 'Lost', 4, 2, 'gdv', 'Vimal Chandran', 'Postponed to next academic year'],
  [28, 'WhatsApp', 'Application', 5, 6, 'vdv', undefined, undefined, 'Under Review'],
  [25, 'Website', 'Visit Completed', 4, 5, 'gdv'],
  [23, 'Instagram', 'Contacted', 1, 1, 'gdv'],
  [21, 'Google', 'Qualified', 2, 7, 'gdv'],
  [19, 'Referral', 'Assessment', 6, 3, 'gdv', 'Gayathri N.', undefined, 'Assessment Scheduled'],
  [14, 'WhatsApp', 'Visit Scheduled', 3, 5, 'gdv'],
  [10, 'Meta Ads', 'Visit Scheduled', 3, 7, 'gdv'],
  [8, 'Website', 'Visit Scheduled', 3, 9, 'gdv'],
  [6, 'WhatsApp', 'Visit Scheduled', 3, 1, 'vdv'],
  [4, 'Google', 'New Lead', 0, 4, 'gdv'],
  [3, 'Referral', 'Contacted', 1, 9, 'gdv', 'Prakash S.'],
  [2, 'WhatsApp', 'New Lead', 0, 2, 'gdv'],
  [1, 'Walk-in', 'Qualified', 2, 8, 'gdv'],
];

const FATHERS = ['Karthik Raja', 'Senthil Kumar', 'Vivek Anand', 'Naveen Prasad', 'Suresh Babu', 'Rajesh Kannan', 'Anand Krishnan', 'Pradeep Mohan',
  'Ganesh Ram', 'Dinesh Kumar', 'Sathish Varma', 'Manoj Pillai', 'Harish Chandra', 'Vignesh Raman', 'Ashok Nair', 'Bala Murugan', 'Kiran Rao',
  'Srinivasan V.', 'Rahul Menon', 'Arvind Iyer', 'Deepak Sharma'];
const MOTHERS = ['Kavya Raja', 'Priya Senthil', 'Deepa Anand', 'Anitha Prasad', 'Revathi Babu', 'Shalini Kannan', 'Meena Krishnan', 'Radhika Mohan',
  'Swathi Ram', 'Nisha Kumar', 'Pooja Varma', 'Sangeetha Pillai', 'Janani Chandra', 'Aishwarya Raman', 'Lakshmi Nair', 'Bhuvana Murugan', 'Hema Rao',
  'Vidya Srinivasan', 'Anjali Menon', 'Keerthana Iyer', 'Rekha Sharma'];
export const GIRLS = ['Aadhya', 'Diya', 'Ishani', 'Kavya', 'Myra', 'Navya', 'Riya', 'Saanvi', 'Tanvi', 'Vaishnavi', 'Anika', 'Pranavi', 'Sahana', 'Yazhini', 'Mithra', 'Charvi', 'Nivedha', 'Oviya', 'Harshini', 'Lekha', 'Suhana'];
export const BOYS = ['Aarav', 'Dhruv', 'Ishaan', 'Kiaan', 'Nakul', 'Pranav', 'Rohan', 'Sai Krishna', 'Tejas', 'Vihaan', 'Arjun', 'Kavin', 'Mithran', 'Nilan', 'Sharvesh', 'Yuvan', 'Adhvik', 'Hrithik', 'Jeevan', 'Lohith', 'Surya'];
const CAMPAIGNS: Record<string, string[]> = {
  WhatsApp: ['Sep Admissions', 'Summer Admissions', 'WhatsApp AI'], Website: ['Organic', 'Admissions page'], 'Meta Ads': ['IGCSE Awareness', 'Early Years Open House'],
  Referral: ['Parent referral'], Google: ['Search — CBSE alt', 'Search — Cambridge school'], 'Walk-in': ['Walk-in'], Instagram: ['Campus reel'], Phone: ['Phone enquiry'],
};

function buildGenerated(ctx: SeedContext): LeadSpec[] {
  return GENERATED.map(([daysAgo, source, stage, reached, grade, campus, referrer, lostReason, appStatus], i) => {
    const fatherLed = i % 3 !== 1;
    const parent = fatherLed ? FATHERS[i % FATHERS.length] : MOTHERS[i % MOTHERS.length];
    const surname = parent.split(' ').slice(-1)[0].replace('.', '') === 'V' ? 'Srinivasan' : parent.split(' ').slice(-1)[0];
    const gender: 'M' | 'F' = i % 2 === 0 ? 'M' : 'F';
    const first = gender === 'M' ? BOYS[i % BOYS.length] : GIRLS[i % GIRLS.length];
    const open = stage !== 'Lost' && stage !== 'Enrolled';
    const counsellor: LeadSpec['counsellor'] = i % 5 === 3 ? 'EMP-3018' : i % 2 === 0 ? 'EMP-3002' : 'EMP-3018';
    let next = 'Closed';
    let nextAt: [number, string] | null = null;
    if (stage === 'Enrolled') next = 'Onboarding complete';
    else if (stage === 'Lost') next = 'Closed — lost';
    else if (stage === 'New Lead') { next = 'First contact due'; nextAt = [0, '15:00']; }
    else if (stage === 'Contacted') { next = 'Follow-up call'; nextAt = [1, '11:00']; }
    else if (stage === 'Qualified') { next = 'Schedule visit'; nextAt = [2, '12:00']; }
    else if (stage === 'Visit Completed') { next = 'Send application link'; nextAt = [-2, '10:00']; }
    else if (stage === 'Application') { next = 'Documents under review'; nextAt = [2, '10:00']; }
    else if (stage === 'Assessment') { next = 'Assessment {+3}, 10:00'; nextAt = [3, '10:00']; }
    else if (stage === 'Offer') { next = 'Offer accepted — ready to enrol'; nextAt = [1, '10:00']; }
    const digits = String(9000000000 + ((i * 7919 + 1234567) % 999999999)).slice(0, 10);
    return {
      code: `LD-${4100 + i * 6}`, parent, student: `${first} ${surname}`, gender, grade, source,
      campaign: CAMPAIGNS[source][i % CAMPAIGNS[source].length], campus, stage, reached, counsellor,
      daysAgo, next, nextAt: open ? nextAt : null, transport: i % 3 !== 2, curriculum: curriculumFor(grade),
      score: stage === 'Enrolled' ? 80 + (i % 16) : stage === 'Lost' ? 25 + (i % 25) : 45 + ((i * 13) % 45),
      phone: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`, referrer, lostReason, appStatus: appStatus ?? (stage === 'Enrolled' ? 'Enrolled' : undefined),
    };
  });
}

export async function seed(db: Db, ctx: SeedContext): Promise<void> {
  const nowMs = ctx.now.getTime();
  const DAY = 86_400_000;
  const past = (d: Date) => (d.getTime() > nowMs - 60_000 ? new Date(nowMs - 60_000) : d);
  const fillDate = (text: string) => text.replace(/\{([+-]?\d+)\}/g, (_m, n) => {
    const d = new Date(`${ctx.day(Number(n))}T00:00:00Z`);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  });
  const counsellorUser: Record<string, string | null> = {
    'EMP-3002': ctx.users.office ?? null,
    'EMP-3018': null,
  };

  await db.query(`INSERT INTO system_settings (key, value, description, is_public) VALUES
                    ('admissions.target', '120', 'Admissions target for the current academic year', false),
                    ('admissions.referral_reward', '5000', 'Recognition credited to a referring family per enrolment (INR)', false)
                  ON CONFLICT (key) DO NOTHING`);

  // Referring parents are looked up by name (families created by the core seed).
  const parentRows = (await db.query(
    `SELECT p.id, p.full_name FROM parents p WHERE p.full_name = ANY($1)`,
    [['Gayathri N.', 'Ranjith Kumar', 'Vimal Chandran', 'Prakash S.', 'Sudha Raman']],
  )).rows as { id: string; full_name: string }[];
  const parentId = Object.fromEntries(parentRows.map((p) => [p.full_name, p.id])) as Record<string, string>;

  const leads = [...WIREFRAME, ...buildGenerated(ctx)];
  const leadIds: Record<string, string> = {};
  const created: Record<string, Date> = {};
  /** Timestamp at which each stage index was reached. */
  const stageAt: Record<string, Date[]> = {};

  for (const [i, l] of leads.entries()) {
    const hh = String(8 + (i % 10)).padStart(2, '0');
    const c = ctx.at(ctx.day(-l.daysAgo), `${hh}:${String((i * 17) % 60).padStart(2, '0')}`);
    created[l.code] = c;
    // Stage timeline — enrolled leads take 14–30 days end to end (median ≈ 21).
    const steps = l.reached;
    const span = l.stage === 'Enrolled'
      ? Math.min(l.daysAgo - 0.5, 14 + ((i * 5) % 17))
      : Math.min(Math.max(l.daysAgo - 0.6, 0.2), Math.max(1, steps * 3));
    const at: Date[] = [c];
    for (let s = 1; s <= steps; s++) at.push(past(new Date(c.getTime() + (span * DAY * s) / steps)));
    stageAt[l.code] = at;

    const cost = Math.round(COST[l.source] * (0.85 + ((i * 37) % 30) / 100));
    const email = `${l.parent.toLowerCase().replace(/[^a-z]+/g, '.').replace(/\.$/, '')}@example.com`;
    const dobYear = 2026 - (l.grade + 5) - (i % 2);
    const r = await db.query(
      `INSERT INTO enquiries (code, campus_id, academic_year_id, parent_name, phone, email, student_name, student_dob, grade_applied,
                              curriculum, source, campaign, stage, lead_score, counsellor_id, transport_required, next_action,
                              next_action_at, lost_reason, referred_by_parent_id, acquisition_cost, notes, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id`,
      [l.code, ctx.campuses[l.campus].id, ctx.yearId, l.parent, l.phone, email, l.student, `${dobYear}-${String(1 + (i % 12)).padStart(2, '0')}-${String(3 + (i % 25)).padStart(2, '0')}`,
        `Grade ${l.grade}`, l.curriculum, l.source, l.campaign, l.stage, l.score, l.counsellor ? ctx.employees[l.counsellor] : null,
        l.transport, fillDate(l.next), l.nextAt ? ctx.at(ctx.day(l.nextAt[0]), l.nextAt[1]) : null, l.lostReason ?? null,
        l.referrer ? parentId[l.referrer] ?? null : null, cost,
        l.code === 'LD-4412' ? 'Prefers a weekend campus visit' : null, ctx.users.office, c, at[at.length - 1]],
    );
    leadIds[l.code] = r.rows[0].id;
  }

  // ---- Stage history -------------------------------------------------------------
  const history: unknown[][] = [];
  const NOTES: Record<string, string> = {
    Contacted: 'First call completed', Qualified: 'Budget, grade and curriculum fit confirmed', 'Visit Scheduled': 'Campus visit booked',
    'Visit Completed': 'Family toured the campus', Application: 'Online application submitted', Assessment: 'Entrance assessment booked',
    Offer: 'Offer letter issued', Enrolled: 'Fees paid — Student Master created',
  };
  for (const l of leads) {
    const id = leadIds[l.code];
    const at = stageAt[l.code];
    const by = l.counsellor ? counsellorUser[l.counsellor] ?? ctx.users.office : ctx.users.office;
    history.push([id, null, 'New Lead', null, 'Lead created', at[0]]);
    for (let s = 1; s <= l.reached; s++) history.push([id, STAGES[s - 1], STAGES[s], by, NOTES[STAGES[s]], at[s]]);
    if (l.stage === 'Lost') {
      const lostAt = past(new Date(at[at.length - 1].getTime() + 2 * DAY));
      history.push([id, STAGES[l.reached], 'Lost', by, l.lostReason ?? 'Closed', lostAt]);
      await db.query('UPDATE enquiries SET updated_at = $2 WHERE id = $1', [id, lostAt]);
    }
  }
  await bulkInsert(db, 'enquiry_stage_history', ['enquiry_id', 'from_stage', 'to_stage', 'changed_by', 'note', 'changed_at'], history);

  // ---- Follow-ups & campus visits ------------------------------------------------
  const fu: unknown[][] = [];
  const emp = (code: string | null) => (code ? ctx.employees[code] : null);
  for (const [i, l] of leads.entries()) {
    const id = leadIds[l.code];
    const at = stageAt[l.code];
    const who = emp(l.counsellor);
    // Completed first contact
    if (l.reached >= 1) fu.push([id, i % 2 ? 'Call' : 'WhatsApp', at[1], at[1], 'Parent reached', 'Introduced the school and programmes', 'Completed', who]);
    if (l.reached >= 2) fu.push([id, 'Call', at[2], at[2], 'Qualified', 'Discussed grade, curriculum and fees', 'Completed', who]);
    // Campus visit — completed for anyone who reached Visit Completed
    if (l.reached >= 4) fu.push([id, 'Campus Visit', at[4], at[4], 'Visit completed', 'Toured classrooms, library and transport desk', 'Completed', who]);
    if (l.stage === 'Lost' && l.reached === 3) {
      const t = past(new Date(at[3].getTime() + DAY));
      fu.push([id, 'Campus Visit', t, null, 'No-show', 'Family did not arrive for the visit', 'Missed', who]);
    }
    if (l.stage === 'Lost' || l.stage === 'Enrolled') continue;
    // Open next action
    if (l.stage === 'Visit Scheduled') continue; // handled below
    if (l.nextAt) {
      const type = /visit/i.test(l.next) ? 'Campus Visit' : /assessment/i.test(l.next) ? 'Meeting' : /document|transcript|application link|fee structure/i.test(l.next) ? 'Email' : /reply/i.test(l.next) ? 'WhatsApp' : 'Call';
      fu.push([id, type, ctx.at(ctx.day(l.nextAt[0]), l.nextAt[1]), null, null, fillDate(l.next), 'Scheduled', who]);
    }
  }
  // Wireframe lead LD-4412: visit tomorrow 10:00 hosted by Kavitha S.
  fu.push([leadIds['LD-4412'], 'Campus Visit', ctx.at(ctx.day(1), '10:00'), null, null, 'Weekday visit requested; parent prefers weekends if rescheduled', 'Scheduled', emp('EMP-3002')]);
  // Generated Visit Scheduled leads — including a weekend visit and two without a host.
  const dow = new Date(`${ctx.today}T00:00:00Z`).getUTCDay();
  const toSat = (6 - dow + 7) % 7 || 7;
  const visitPlan: [number, string, string | null][] = [[toSat, '10:00', 'EMP-3002'], [1, '11:30', null], [2, '09:30', 'EMP-3018'], [Math.min(3, toSat + 1), '14:00', null]];
  const scheduledLeads = leads.filter((l) => l.stage === 'Visit Scheduled' && l.code !== 'LD-4412');
  scheduledLeads.forEach((l, k) => {
    const [off, time, host] = visitPlan[k % visitPlan.length];
    const when = ctx.at(ctx.day(off), time);
    fu.push([leadIds[l.code], 'Campus Visit', when, null, null, 'Campus tour and counsellor meeting', 'Scheduled', emp(host)]);
    const label = new Date(`${ctx.day(off)}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    l.next = `Campus visit ${label}, ${time}`;
  });
  for (const l of scheduledLeads) {
    const v = fu.find((x) => x[0] === leadIds[l.code] && x[1] === 'Campus Visit' && x[6] === 'Scheduled')!;
    await db.query('UPDATE enquiries SET next_action = $2, next_action_at = $3 WHERE id = $1', [leadIds[l.code], l.next, v[2]]);
  }
  await bulkInsert(db, 'follow_ups', ['enquiry_id', 'follow_up_type', 'scheduled_at', 'completed_at', 'outcome', 'notes', 'status', 'assigned_to'],
    fu.map((r) => [...r]));

  // ---- Applications, documents, Student Master for enrolled ------------------------
  const maxNo = (await db.query(`SELECT COALESCE(max(substring(admission_no FROM 9)::int), 1000) AS n FROM students WHERE admission_no ~ '^HS-2026-[0-9]+$'`)).rows[0].n as number;
  const maxPar = (await db.query(`SELECT COALESCE(max(substring(parent_code FROM 5)::int), 0) AS n FROM parents WHERE parent_code ~ '^PAR-[0-9]+$'`)).rows[0].n as number;
  let admSeq = Number(maxNo) + 1;
  let parSeq = Number(maxPar) + 1;
  let appSeq = 101;
  const docRows: unknown[][] = [];
  const DOCS = ['Birth certificate', 'Previous report card', 'Address proof', 'Photograph'];
  const PREV = ['Little Flower Matriculation', 'Sunshine Montessori', 'Vidya Mandir', 'St. Joseph’s School', 'Kendriya Vidyalaya', 'Green Valley Public School'];

  for (const [i, l] of leads.entries()) {
    if (l.reached < 5) continue;
    const at = stageAt[l.code];
    const status = l.appStatus ?? 'Submitted';
    const enquiryId = leadIds[l.code];
    const [first, ...rest] = l.student.split(' ');
    const last = rest.join(' ') || first;
    const dob = (await db.query('SELECT student_dob FROM enquiries WHERE id = $1', [enquiryId])).rows[0].student_dob as string;
    const assessmentAt = l.reached >= 6 ? (status === 'Assessment Scheduled' ? ctx.at(ctx.day(l.code === 'LD-4398' ? 2 : 3), l.code === 'LD-4398' ? '09:30' : '10:00') : at[6]) : null;
    const score = l.reached >= 7 ? 62 + ((i * 11) % 35) : status === 'Rejected' ? 38 : null;
    const offerExp = l.reached >= 7 ? (l.code === 'LD-4388' ? ctx.day(5) : addDays(at[7].toISOString().slice(0, 10), 14)) : null;
    const decided = ['Offer Made', 'Accepted', 'Enrolled', 'Rejected', 'Withdrawn'].includes(status);
    const decidedAt = decided ? (status === 'Rejected' ? past(new Date(at[5].getTime() + 6 * DAY)) : at[Math.min(7, at.length - 1)]) : null;

    let studentId: string | null = null;
    if (status === 'Enrolled') {
      const sectionId = ctx.sections[`${l.campus}:${l.grade}:A`];
      const admittedOn = at[8].toISOString().slice(0, 10);
      const admNo = `HS-2026-${admSeq++}`;
      const s = await db.query(
        `INSERT INTO students (admission_no, first_name, last_name, date_of_birth, gender, campus_id, section_id, academic_year_id,
                               phone, admitted_on, created_by, updated_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12) RETURNING id`,
        [admNo, first, last, dob, l.gender, ctx.campuses[l.campus].id, sectionId, ctx.yearId, l.phone, admittedOn, ctx.users.office, at[8]],
      );
      studentId = s.rows[0].id;
      const roll = (await db.query('SELECT count(*)::int + 1 AS n FROM enrollments WHERE section_id = $1', [sectionId])).rows[0].n;
      await db.query('INSERT INTO enrollments (student_id, section_id, academic_year_id, roll_no, enrolled_on) VALUES ($1,$2,$3,$4,$5)',
        [studentId, sectionId, ctx.yearId, roll, admittedOn]);
      const code = `PAR-${String(parSeq++).padStart(4, '0')}`;
      const p = await db.query(
        `INSERT INTO parents (parent_code, full_name, phone, email, preferred_channel, engagement_score, created_by)
         VALUES ($1,$2,$3,$4,'whatsapp',$5,$6) RETURNING id`,
        [code, l.parent, l.phone, `${l.parent.toLowerCase().replace(/[^a-z]+/g, '.').replace(/\.$/, '')}@example.com`, 60 + (i % 30), ctx.users.office],
      );
      const fem = MOTHERS.includes(l.parent) || ['Divya Menon', 'Fatima Basheer', 'Sunitha Rao', 'Nandini Gupta', 'Preethi Balan', 'Lavanya Suresh'].includes(l.parent);
      await db.query('INSERT INTO student_guardians (student_id, parent_id, relationship, is_primary) VALUES ($1,$2,$3,true)',
        [studentId, p.rows[0].id, fem ? 'Mother' : 'Father']);
      await db.query(`INSERT INTO student_tracking_profiles (student_id, tracking_enabled, tracking_status) VALUES ($1, false, 'disabled')`, [studentId]);
      await db.query(
        `INSERT INTO student_timeline_events (student_id, occurred_on, title, body, category, tone, created_by)
         VALUES ($1,$2,'Admitted',$3,'admission','teal',$4)`,
        [studentId, admittedOn, `Enrolled from admissions lead ${l.code}`, ctx.users.office],
      );
      // Make the new student visible to later domain seeds (fees etc.).
      const campus = ctx.campuses[l.campus];
      const st = {
        id: studentId!, admissionNo: admNo, fullName: `${first} ${last}`, firstName: first, lastName: last, gender: l.gender as 'M' | 'F',
        campusCode: l.campus, campusId: campus.id, classId: ctx.classes[`${l.campus}:${l.grade}`], sectionId, gradeLevel: l.grade,
        grade: `Grade ${l.grade}`, section: 'A', house: 'Emerald', targetAttendance: 95, targetAverage: 72, targetTrend: 0,
        risk: 'On Track', feeProfile: 'Paid' as const, routeCode: null, home: { lat: campus.lat, lng: campus.lng },
        parentId: p.rows[0].id as string,
      };
      ctx.students.push(st);
      ctx.studentByNo[admNo] = st;
    }

    const app = await db.query(
      `INSERT INTO admissions (application_no, enquiry_id, campus_id, academic_year_id, student_name, date_of_birth, gender, grade_applied,
                               previous_school, status, documents_complete, assessment_at, assessment_score, offer_expires_on, fee_paid,
                               student_id, decided_by, decided_at, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
      [`APP-2026-${String(appSeq++).padStart(4, '0')}`, enquiryId, ctx.campuses[l.campus].id, ctx.yearId, l.student, dob, l.gender,
        `Grade ${l.grade}`, l.grade > 1 ? PREV[i % PREV.length] : null, status,
        !['Submitted', 'Under Review'].includes(status),
        assessmentAt, score, offerExp, status === 'Enrolled' || status === 'Accepted',
        studentId, decided ? ctx.users.principal : null, decidedAt, ctx.users.office, at[5], decidedAt ?? at[at.length - 1]],
    );
    const appId = app.rows[0].id;
    if (studentId) await db.query('UPDATE students SET created_at = $2 WHERE id = $1', [studentId, at[8]]);

    DOCS.forEach((name, d) => {
      let st = 'Verified';
      if (status === 'Submitted') st = l.code === 'LD-4405' ? 'Pending' : d % 2 ? 'Submitted' : 'Verified';
      if (status === 'Under Review') st = l.code === 'LD-4362' && d === 1 ? 'Pending' : 'Verified';
      docRows.push(['admission', appId, name, 'Admission', st, ctx.day(-Math.max(0, l.daysAgo - 2)),
        st === 'Verified' ? ctx.users.office : null, st === 'Verified' ? at[5] : null, at[5]]);
    });
  }
  await bulkInsert(db, 'documents', ['owner_type', 'owner_id', 'name', 'category', 'status', 'requested_on', 'verified_by', 'verified_at', 'created_at'], docRows);

  // ---- Communications ------------------------------------------------------------
  const comms: unknown[][] = [];
  for (const [i, l] of leads.entries()) {
    const id = leadIds[l.code];
    const at = stageAt[l.code];
    const by = l.counsellor ? counsellorUser[l.counsellor] ?? ctx.users.office : ctx.users.office;
    const cName = l.counsellor === 'EMP-3002' ? 'Kavitha S.' : 'Ravi Thangaraj';
    if (l.source === 'WhatsApp') {
      comms.push(['WhatsApp', 'inbound', id, l.parent, 'Admission enquiry received', `Enquiry for ${`Grade ${l.grade}`}`, 'Delivered', null, at[0]]);
      comms.push(['WhatsApp', 'outbound', id, l.parent, 'WhatsApp AI answered the first enquiry', 'Shared programme overview and visit slots', 'Delivered', null, new Date(at[0].getTime() + (8 + (i % 20)) * 1000)]);
    } else if (['Meta Ads', 'Google', 'Instagram', 'Website'].includes(l.source)) {
      comms.push(['Note', 'internal', id, l.parent, `${l.source} — ${l.campaign}`, 'Source recorded automatically', 'Internal', null, at[0]]);
    } else {
      comms.push(['Note', 'internal', id, l.parent, `${l.source} enquiry recorded`, null, 'Internal', ctx.users.office, at[0]]);
    }
    if (l.reached >= 1) comms.push(['Call', 'outbound', id, l.parent, 'Discussed transport and fee structure', `${cName} · ${3 + (i % 8)} min`, 'Completed', by, at[1]]);
    if (l.reached >= 3) comms.push(['WhatsApp', 'outbound', id, l.parent, 'Visit reminder sent', null, 'Delivered', by, past(new Date(at[3].getTime() + 3600_000))]);
    if (l.reached >= 5) comms.push(['Email', 'outbound', id, l.parent, 'Application received — document checklist', null, 'Opened', by, at[5]]);
    if (l.reached >= 7) comms.push(['Email', 'outbound', id, l.parent, 'Offer letter issued', null, 'Opened', by, at[7]]);
    if (l.stage === 'Contacted' && l.code === 'LD-4355') comms.push(['Call', 'outbound', id, l.parent, 'Follow-up call — awaiting decision', null, 'No answer', by, ctx.at(ctx.day(-3), '10:35')]);
    if (l.code === 'LD-4412') comms.push(['Note', 'internal', id, 'Kavitha S.', 'Lead LD-4412 prefers weekend campus visit', null, 'Internal', ctx.users.office, ctx.at(ctx.day(-1), '16:10')]);
  }
  // CRM relationships beyond admissions (vendors, alumni, partners)
  comms.push(['Email', 'outbound', null, 'CleanSpace Facility Management', 'Contract renewal — revised scope', null, 'Opened', ctx.users.office, ctx.at(ctx.day(-1), '11:15')]);
  comms.push(['Call', 'outbound', null, 'Sri Lakshmi Transport Services', 'Bus 4 brake inspection schedule', null, 'Completed', ctx.users.office, ctx.at(ctx.day(-2), '15:40')]);
  comms.push(['Email', 'outbound', null, 'Divya Sundaram (Alumni)', 'Career talk follow-up and mentoring invite', null, 'Opened', ctx.users.principal, ctx.at(ctx.day(-4), '10:05')]);
  comms.push(['Note', 'internal', null, 'Cambridge International', 'Centre affiliation review — documents checklist prepared', null, 'Internal', ctx.users.principal, ctx.at(ctx.day(-6), '12:30')]);
  await bulkInsert(db, 'communications', ['channel', 'direction', 'enquiry_id', 'counterpart', 'subject', 'body', 'status', 'sent_by', 'occurred_at'], comms);

  // ---- Referrals -------------------------------------------------------------------
  const refRows: unknown[][] = [];
  for (const l of leads) {
    if (!l.referrer || !parentId[l.referrer]) continue;
    const status = l.stage === 'Enrolled' ? 'Enrolled' : l.stage === 'Lost' ? 'Lost' : l.reached >= 1 ? 'Contacted' : 'Submitted';
    const reward = status === 'Enrolled' ? (l.referrer === 'Vimal Chandran' ? 'Pending' : 'Credited') : 'Not eligible';
    refRows.push([parentId[l.referrer], leadIds[l.code], l.student, status, reward, status === 'Enrolled' ? 5000 : 0, created[l.code]]);
  }
  // A referral that has not yet become a lead
  if (parentId['Sudha Raman']) refRows.push([parentId['Sudha Raman'], null, 'Neighbour’s son — Grade 3', 'Submitted', 'Not eligible', 0, ctx.at(ctx.day(-2), '18:20')]);
  await bulkInsert(db, 'referrals', ['referrer_parent_id', 'enquiry_id', 'referred_name', 'status', 'reward_status', 'reward_amount', 'created_at'], refRows);

  // ---- Alumni ------------------------------------------------------------------------
  const alumni: unknown[][] = [
    ['Divya Sundaram', 2019, 'NIT Trichy', 'Product engineer, Bengaluru', 'High', 'Career talk — Aug 2026'],
    ['Aravind Krishnan', 2018, 'University of Melbourne', 'Architect, Melbourne', 'Medium', 'Alumni meet — Jan 2026'],
    ['Nithya Balan', 2020, 'CMC Vellore', 'Medical intern', 'High', 'Mentoring 2 students'],
    ['Sanjay Rao', 2017, 'IIT Madras', 'Founder, climate-tech', 'High', 'Innovation Lab mentor'],
    ['Meera Joseph', 2021, 'Ashoka University', 'Undergraduate — Economics', 'Low', 'Newsletter only'],
  ];
  const UNIS = ['Anna University', 'VIT Vellore', 'SRM Institute', 'University of Toronto', 'Loyola College', 'NIT Trichy', 'Christ University',
    'University of Edinburgh', 'IIT Madras', 'Madras Christian College', 'PSG College of Technology', 'National University of Singapore'];
  const CAREERS = ['Undergraduate — Computer Science', 'Undergraduate — Commerce', 'Software engineer', 'Data analyst', 'Undergraduate — Design',
    'Chartered accountancy trainee', 'Research assistant', 'Undergraduate — Biotechnology'];
  const LASTS = ['Alumni meet — Jan 2026', 'Newsletter only', 'Career talk — Aug 2026', 'Mentoring 1 student', 'Referred a family', 'Sports day guest'];
  const AL_NAMES = ['Harini Suresh', 'Vishal Menon', 'Aparna Iyer', 'Rohit Chandran', 'Kavin Raj', 'Sneha Pillai', 'Adarsh Kumar', 'Lavanya Mohan',
    'Pranav Srinivasan', 'Deepika Nair', 'Gautham Rao', 'Swetha Ramesh', 'Nikhil Varma', 'Shruthi Balaji', 'Arjun Prakash', 'Keerthi Anand',
    'Rahul Senthil', 'Pavithra Ganesh', 'Siddharth Raman', 'Janani Murali', 'Tarun Venkat', 'Bhavya Krishnan', 'Manish Babu', 'Ritu Sharma', 'Yash Gupta'];
  AL_NAMES.forEach((n, k) => alumni.push([n, 2017 + (k % 9), UNIS[k % UNIS.length], CAREERS[k % CAREERS.length],
    ['High', 'Medium', 'Low', 'Low', 'Medium'][k % 5], LASTS[k % LASTS.length]]));
  await bulkInsert(db, 'alumni', ['full_name', 'batch_year', 'university', 'career', 'engagement', 'last_engagement', 'email'],
    alumni.map((a) => [...a, `${String(a[0]).toLowerCase().replace(/[^a-z]+/g, '.')}@alumni.example.com`]));

  // ---- Vendors & partners --------------------------------------------------------------
  await bulkInsert(db, 'vendors', ['name', 'category', 'contact_person', 'phone', 'email', 'contract_start', 'contract_end', 'contract_value', 'status'], [
    ['Sri Lakshmi Transport Services', 'Transport maintenance', 'K. Rajendran', '+91 94441 20981', 'accounts@srilakshmi.example.com', '2026-04-01', '2027-03-31', 1840000, 'Active'],
    ['BrightLearn Educational Supplies', 'Books & materials', 'Asha M.', '+91 98400 55120', 'orders@brightlearn.example.com', '2026-06-01', '2027-05-31', 960000, 'Active'],
    ['CleanSpace Facility Management', 'Housekeeping', 'Vinoth B.', '+91 90030 77421', 'ops@cleanspace.example.com', '2026-01-01', '2026-12-31', 2240000, 'Renewal due'],
    ['SecureGate Systems', 'Access control & CCTV', 'Praveen N.', '+91 97100 31456', 'support@securegate.example.com', '2025-09-01', '2027-08-31', 1420000, 'Active'],
  ]);
  await bulkInsert(db, 'partners', ['name', 'partner_type', 'since_year', 'status', 'note'], [
    ['Cambridge International', 'Curriculum authority', 2011, 'Active', 'Centre affiliation review Nov 2026'],
    ['Anna University Innovation Cell', 'Institution', 2023, 'Active', 'Mentors 3 Innovation Lab projects'],
    ['District Sports Academy', 'Partner', 2022, 'Active', 'Athletics coaching, 2 days a week'],
    ['Wellbeing First Counselling', 'Partner', 2024, 'Active', 'External counselling referrals'],
  ]);
}
