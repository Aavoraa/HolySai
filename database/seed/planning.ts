/**
 * Budget & Planning — SAMPLE budget plans across departments and categories in
 * every workflow state. Only the Super Admin decides: approved / rejected plans
 * are decided by the superadmin user, and approved amounts are added to the
 * matching budgets row exactly as the live workflow does. Dates are relative to
 * today; nothing that "happened" is in the future.
 */
import type { Db, SeedContext } from './context.js';
import { randomUUID } from 'node:crypto';
import { bulkInsert } from './context.js';

type Status = 'Draft' | 'Submitted' | 'Under Review' | 'Approved' | 'Rejected';
interface PlanSeed {
  title: string;
  campus: 'gdv' | 'vdv' | 'plc';
  department: string;
  category: string;
  by: 'principal' | 'finance' | 'hr' | 'office';
  /** Days ago the plan was prepared. */
  createdAgo: number;
  /** Plan period: start offset from today (days) and length in months. */
  start: number;
  months: number;
  status: Status;
  lines: [item: string, qty: number, unitCost: number][];
  justification: string;
  /** Days ago it was submitted (Submitted and later). */
  submittedAgo?: number;
  /** Days ago the Super Admin decided (Approved / Rejected). */
  decidedAgo?: number;
  /** Approved amount as a share of the request (default 1). */
  approvedShare?: number;
  note?: string;
}

const PLANS: PlanSeed[] = [
  {
    title: 'Term 2 science lab consumables', campus: 'gdv', department: 'Laboratory', category: 'Academics', by: 'principal',
    createdAgo: 41, start: -20, months: 4, status: 'Approved', submittedAgo: 38, decidedAgo: 34,
    lines: [['Chemistry reagents kit', 6, 8500], ['Glassware replacement set', 4, 6200], ['Biology slides & specimens', 3, 7400], ['Safety goggles & gloves', 120, 180]],
    justification: 'Grade 9–10 practical syllabus needs a full reagent restock before the Term 2 practical assessments.',
    note: 'Approved in full — keep the stock register updated.',
  },
  {
    title: 'Smart classroom projector refresh', campus: 'gdv', department: 'Academics', category: 'Technology', by: 'principal',
    createdAgo: 36, start: -10, months: 3, status: 'Approved', submittedAgo: 33, decidedAgo: 27, approvedShare: 0.8,
    lines: [['Laser projector (4,000 lumens)', 6, 68000], ['Ceiling mounts & cabling', 6, 4500], ['Installation', 1, 18000]],
    justification: 'Six Grade 6–8 classrooms still run lamp projectors that fail weekly; laser units cut lamp costs to zero.',
    note: 'Approved for five rooms this term; the sixth room moves to next year’s technology budget.',
  },
  {
    title: 'Bus fleet tyre replacement', campus: 'gdv', department: 'Transport', category: 'Transport', by: 'office',
    createdAgo: 30, start: -14, months: 2, status: 'Approved', submittedAgo: 29, decidedAgo: 25,
    lines: [['Bus tyres (10R20)', 24, 21500], ['Wheel alignment & balancing', 6, 3200]],
    justification: 'Fitness certificate renewal flagged tread depth below limit on six buses (R4, R7, R9, R12, R15, R18).',
    note: 'Safety-critical — approved in full.',
  },
  {
    title: 'Annual Day 2026 production', campus: 'gdv', department: 'Student Support', category: 'Student activities', by: 'principal',
    createdAgo: 22, start: 21, months: 2, status: 'Submitted', submittedAgo: 6,
    lines: [['Stage, sound & lighting hire', 1, 145000], ['Costumes & props', 1, 62000], ['Printing — invitations & programmes', 1500, 22], ['Photography & video', 1, 35000]],
    justification: 'Annual Day for 1,200 families; vendor quotes attached in the Documents folder "Annual Day 2026".',
  },
  {
    title: 'Library new-book acquisition', campus: 'gdv', department: 'Library', category: 'Academics', by: 'principal',
    createdAgo: 12, start: 3, months: 5, status: 'Submitted', submittedAgo: 3,
    lines: [['Fiction & graded readers', 220, 380], ['Reference & Cambridge IGCSE texts', 60, 1450], ['Periodical subscriptions (annual)', 8, 2400]],
    justification: 'Circulation rose 18% this year; the Grade 9–10 IGCSE reference shelf is short of current editions.',
  },
  {
    title: 'Staff CPD — Cambridge assessment workshops', campus: 'gdv', department: 'Human Resources', category: 'Academics', by: 'hr',
    createdAgo: 18, start: 10, months: 3, status: 'Under Review', submittedAgo: 15,
    lines: [['Cambridge PDQ workshop seats', 12, 14500], ['Travel & accommodation', 12, 4200], ['Substitute cover days', 24, 1800]],
    justification: 'Twelve IGCSE teachers need the assessment-for-learning workshop before the board moderation window.',
  },
  {
    title: 'Admissions open-house campaign', campus: 'vdv', department: 'Front Office', category: 'Marketing & admissions', by: 'office',
    createdAgo: 26, start: -5, months: 2, status: 'Rejected', submittedAgo: 24, decidedAgo: 19,
    lines: [['Digital ads (Meta & Google)', 1, 85000], ['Hoardings — 3 sites', 3, 28000], ['Open-house refreshments', 400, 120]],
    justification: 'Velachery enquiries for Grade 1 are 12% behind last year.',
    note: 'Hoardings duplicate the group campaign already running. Resubmit with digital ads only and the referral drive.',
  },
  {
    title: 'Campus CCTV expansion — east block', campus: 'vdv', department: 'Security', category: 'Facilities', by: 'office',
    createdAgo: 15, start: 7, months: 2, status: 'Submitted', submittedAgo: 9,
    lines: [['4MP dome cameras', 16, 5200], ['16-channel NVR with 8 TB', 1, 38000], ['Cabling & installation', 1, 24000]],
    justification: 'The new east block corridors and stairwells have no coverage; the safeguarding audit flagged it.',
  },
  {
    title: 'Water purifier & cooler replacement', campus: 'plc', department: 'Housekeeping', category: 'Facilities', by: 'office',
    createdAgo: 48, start: -35, months: 1, status: 'Approved', submittedAgo: 46, decidedAgo: 43,
    lines: [['RO + UV purifier (50 L/h)', 3, 18500], ['Stainless steel water cooler', 3, 21000], ['Plumbing & electrical', 1, 9500]],
    justification: 'Water test in August failed TDS limits at two of three points.',
    note: 'Approved — share the post-installation water test report.',
  },
  {
    title: 'Inter-school sports meet hosting', campus: 'plc', department: 'Outdoor Programmes', category: 'Student activities', by: 'principal',
    createdAgo: 10, start: 30, months: 1, status: 'Draft',
    lines: [['Ground marking & equipment', 1, 26000], ['Medals & trophies', 1, 18000], ['Refreshments for 8 schools', 320, 90]],
    justification: 'Pallikaranai hosts the zonal meet this year.',
  },
  {
    title: 'Payroll & HR software licence renewal', campus: 'gdv', department: 'Human Resources', category: 'Technology', by: 'hr',
    createdAgo: 55, start: -40, months: 12, status: 'Approved', submittedAgo: 53, decidedAgo: 50,
    lines: [['Annual licence (200 employees)', 1, 96000], ['Biometric device AMC', 4, 4500]],
    justification: 'Renewal due; vendor holding last year’s price.',
    note: 'Approved at last year’s rate.',
  },
  {
    title: 'Teacher laptops — new joiners', campus: 'vdv', department: 'Academics', category: 'Technology', by: 'principal',
    createdAgo: 20, start: 5, months: 1, status: 'Rejected', submittedAgo: 17, decidedAgo: 12,
    lines: [['Laptop (i5, 16 GB)', 8, 62000]],
    justification: 'Eight new teachers joined in June without devices.',
    note: 'Use the refurbished pool from the Gandhi Nagar refresh first; resubmit for any shortfall.',
  },
  {
    title: 'Fuel price buffer — Q3', campus: 'gdv', department: 'Transport', category: 'Transport', by: 'finance',
    createdAgo: 8, start: 12, months: 3, status: 'Submitted', submittedAgo: 2,
    lines: [['Diesel buffer (litres)', 6000, 94], ['Route optimisation consultant', 1, 40000]],
    justification: 'Transport is running 12% over its run rate on fuel; this buffers Q3 while routes are re-planned.',
  },
  {
    title: 'Exam stationery & answer booklets', campus: 'gdv', department: 'Academics', category: 'Academics', by: 'finance',
    createdAgo: 5, start: 25, months: 2, status: 'Draft',
    lines: [['Answer booklets (32 pp)', 9000, 9], ['OMR sheets', 3000, 4], ['Question-paper printing', 1, 28000]],
    justification: 'Term-end examinations for Grades 1–10.',
  },
  {
    title: 'Counselling room refurbishment', campus: 'vdv', department: 'Student Support', category: 'Facilities', by: 'principal',
    createdAgo: 33, start: -12, months: 2, status: 'Approved', submittedAgo: 31, decidedAgo: 21, approvedShare: 0.75,
    lines: [['Soundproofing panels', 1, 48000], ['Soft seating & rugs', 1, 36000], ['Sensory corner kit', 1, 22000]],
    justification: 'The current room is a partitioned store; sessions are audible from the corridor.',
    note: 'Approved for soundproofing and seating; buy the sensory kit from the activities budget next term.',
  },
  {
    title: 'Front office visitor kiosk', campus: 'plc', department: 'Front Office', category: 'Technology', by: 'office',
    createdAgo: 14, start: 14, months: 1, status: 'Under Review', submittedAgo: 11,
    lines: [['Visitor kiosk with badge printer', 1, 72000], ['Annual software subscription', 1, 18000]],
    justification: 'Brings Pallikaranai in line with the visitor process at Gandhi Nagar.',
  },
];

const addMonths = (iso: string, months: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export async function seed(db: Db, ctx: SeedContext) {
  const U = ctx.users;
  const names = new Map<string, string>(
    (await db.query('SELECT id, full_name FROM users WHERE id = ANY($1)', [Object.values(U)])).rows.map((r) => [r.id, r.full_name]),
  );
  const yr = (await db.query(`SELECT starts_on::text AS s, ends_on::text AS e FROM academic_years WHERE id = $1`, [ctx.yearId])).rows[0];
  const clampDate = (iso: string) => (iso < yr.s ? yr.s : iso > yr.e ? yr.e : iso);

  const planRows: unknown[][] = [];
  const lineRows: unknown[][] = [];
  const eventRows: unknown[][] = [];
  const budgetAdds: { campus: string; category: string; amount: number; row: unknown[] }[] = [];

  PLANS.forEach((p, i) => {
    const code = `BP-${String(i + 1).padStart(4, '0')}`;
    const requested = Math.round(p.lines.reduce((a, [, q, c]) => a + q * c, 0) * 100) / 100;
    const decided = p.status === 'Approved' || p.status === 'Rejected';
    const approved = p.status !== 'Approved' ? null : p.approvedShare ? Math.floor((requested * p.approvedShare) / 1000) * 1000 : requested;
    const creator = U[p.by];
    const superadmin = U.superadmin;
    const createdAt = ctx.at(ctx.day(-p.createdAgo), '10:15');
    const submittedAt = p.submittedAgo != null ? ctx.at(ctx.day(-p.submittedAgo), '11:40') : null;
    const decidedAt = decided && p.decidedAgo != null ? ctx.at(ctx.day(-p.decidedAgo), '16:20') : null;
    const start = clampDate(ctx.day(p.start));
    const end = clampDate(addMonths(start, p.months));
    const id = randomUUID();
    planRows.push([
      id, code, p.title, ctx.yearId, ctx.campuses[p.campus].id, p.department, p.category, start, end < start ? start : end,
      requested, approved, p.justification, p.status,
      submittedAt ? creator : null, submittedAt, decided ? superadmin : null, decidedAt, decided ? p.note ?? null : null,
      creator, createdAt, decidedAt ?? submittedAt ?? createdAt, null,
    ]);
    p.lines.forEach(([item, qty, unit], pos) => lineRows.push([id, pos, item, qty, unit, Math.round(qty * unit * 100) / 100, createdAt]));
    const ev = (action: string, from: string | null, to: string, at: Date, actor: string, amount: number | null, note: string | null = null) =>
      eventRows.push([id, action, from, to, amount, note, actor, names.get(actor) ?? 'System', at]);
    ev('created', null, 'Draft', createdAt, creator, requested);
    if (submittedAt) ev('submitted', 'Draft', 'Submitted', submittedAt, creator, requested);
    const reviewed = p.status === 'Under Review' || decided;
    if (reviewed && submittedAt) {
      const reviewAt = new Date(Math.min(submittedAt.getTime() + 86400000, (decidedAt ?? ctx.now).getTime() - 3600000));
      ev('review', 'Submitted', 'Under Review', reviewAt, superadmin, requested);
    }
    if (decidedAt) ev(p.status === 'Approved' ? 'approved' : 'rejected', 'Under Review', p.status, decidedAt, superadmin, approved ?? requested, p.note ?? null);
    if (approved) budgetAdds.push({ campus: p.campus, category: p.category, amount: approved, row: planRows[planRows.length - 1] });
  });

  // Approved plans flowed into the Budgets page: add to (or open) the matching budget line.
  for (const b of budgetAdds) {
    const r = await db.query(
      `INSERT INTO budgets (academic_year_id, campus_id, category, allocated, owner) VALUES ($1, $2, $3, $4, NULL)
       ON CONFLICT (academic_year_id, campus_id, category) DO UPDATE SET allocated = budgets.allocated + EXCLUDED.allocated
       RETURNING id`, [ctx.yearId, ctx.campuses[b.campus].id, b.category, b.amount]);
    b.row[b.row.length - 1] = r.rows[0].id;
  }

  await bulkInsert(db, 'budget_plans', [
    'id', 'code', 'title', 'academic_year_id', 'campus_id', 'department', 'category', 'period_start', 'period_end',
    'amount_requested', 'amount_approved', 'justification', 'status',
    'submitted_by', 'submitted_at', 'decided_by', 'decided_at', 'decision_note',
    'created_by', 'created_at', 'updated_at', 'budget_id',
  ], planRows);
  await bulkInsert(db, 'budget_plan_lines', ['plan_id', 'position', 'item', 'quantity', 'unit_cost', 'amount', 'created_at'], lineRows);
  await bulkInsert(db, 'budget_plan_events', ['plan_id', 'action', 'from_status', 'to_status', 'amount', 'note', 'actor_id', 'actor_name', 'created_at'], eventRows);
}
