/**
 * SAMPLE DATA — parent contact log. Owned by the parent-log module.
 * ~70 manual contact entries over the last 60 days (parents walking in or
 * calling to reach the Principal, teachers approaching the Principal, contacts
 * to the office and staff) plus a handful of gate visitors whose phone matches
 * a parent, so the automatic "visitor" source shows up in the unified log.
 * Everything is fictional and dated relative to ctx.today; nothing is in the future.
 */
import { bulkInsert, type Db, type SeedContext } from './context.js';

const MIN = 60_000;

interface ParentRow { id: string; full_name: string; phone: string; children: { id: string; campusId: string; classTeacherId: string | null; grade: number }[] }
interface EmpRow { id: string; code: string; full_name: string; user_id: string | null; campus_id: string; employee_type: string; designation: string }

type Outcome = 'Met' | 'Spoke on call' | 'Not available' | 'Callback scheduled' | 'Message left' | 'Resolved' | 'Escalated' | 'Pending';
const CLOSING: Outcome[] = ['Met', 'Spoke on call', 'Resolved'];

export async function seed(db: Db, ctx: SeedContext): Promise<void> {
  const now = ctx.now.getTime();
  const U = ctx.users;

  const parents = (await db.query<ParentRow>(
    `SELECT p.id, p.full_name, p.phone,
            COALESCE(json_agg(json_build_object('id', s.id, 'campusId', s.campus_id, 'classTeacherId', sec.class_teacher_id, 'grade', c.grade_level)
                              ORDER BY s.full_name) FILTER (WHERE s.id IS NOT NULL), '[]') AS children
       FROM parents p
       JOIN student_guardians sg ON sg.parent_id = p.id
       JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL
       LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
      WHERE p.deleted_at IS NULL
      GROUP BY p.id ORDER BY p.parent_code`)).rows;
  if (!parents.length) return;
  const emps = (await db.query<EmpRow>(
    `SELECT id, employee_code AS code, full_name, user_id, campus_id, employee_type, designation FROM employees
      WHERE deleted_at IS NULL AND employment_status <> 'exited' ORDER BY employee_code`)).rows;
  const empById = new Map(emps.map((e) => [e.id, e]));
  const E = (code: string) => emps.find((e) => e.code === code) ?? emps[0];
  const principal = E('EMP-1001');
  const priya = E('EMP-1021');
  const office = E('EMP-3002');
  const transport = E('EMP-2015');
  const nurse = E('EMP-7014');
  const counsellor = E('EMP-6011');
  const teachers = emps.filter((e) => e.employee_type === 'teaching' && e.id !== principal.id);
  const byName = (n: string) => parents.find((p) => p.full_name === n);
  const ranjith = byName('Ranjith Kumar') ?? parents[0];

  /** Timestamp `offset` days from today at hh:mm, pulled back if it would be in the future. */
  const when = (offset: number, hhmm: string) => {
    const t = ctx.at(ctx.day(offset), hhmm).getTime();
    return new Date(Math.min(t, now - ctx.int(5, 90) * MIN));
  };
  const randTime = () => `${String(ctx.int(8, 16)).padStart(2, '0')}:${String(ctx.int(0, 11) * 5).padStart(2, '0')}`;

  interface Entry {
    at: Date; kind: 'parent' | 'teacher' | 'staff' | 'other'; parent?: ParentRow; emp?: EmpRow; name?: string; phone?: string;
    studentId?: string | null; campusId?: string | null;
    target: 'principal' | 'staff' | 'office' | 'class_teacher' | 'management'; targetEmp?: EmpRow | null;
    channel: string; purpose: string; summary: string; outcome: Outcome; followUp?: string | null; note?: string | null;
    resolvedAfterMin?: number; loggedBy: string;
  }
  const entries: Entry[] = [];
  const add = (e: Entry) => entries.push(e);

  // ---------------------------------------------------------------------------
  // Scripted repeat contacts
  // ---------------------------------------------------------------------------
  const others = parents.filter((p) => p.id !== ranjith.id);
  const pA = others[3 % others.length];
  const pB = others[11 % others.length];
  const pC = others[19 % others.length];
  const pD = ranjith;

  // A — keeps trying to reach the Principal about the evening bus; never gets through (repeat alert).
  const busTrail: [number, string, string, Outcome, string][] = [
    [-12, '08:20', 'Walk-in', 'Not available', 'Came to meet the Principal about the evening bus reaching the stop 40 minutes late. Principal in a CBSE inspection meeting.'],
    [-10, '12:40', 'Phone call', 'Message left', 'Called again about the late evening bus. Message left with the PA.'],
    [-7, '15:55', 'Phone call', 'Callback scheduled', 'Asked for the Principal; promised a callback by Friday about the bus delay.'],
    [-4, '08:10', 'Walk-in', 'Not available', 'Walked in at drop-off to see the Principal; Principal on campus round. Upset that no one called back.'],
    [-1, '13:15', 'Phone call', 'Pending', 'Fifth attempt about the late bus. Asked for a written reply from the Principal.'],
  ];
  for (const [d, t, ch, out, s] of busTrail) {
    add({ at: when(d, t), kind: 'parent', parent: pA, studentId: pA.children[0]?.id, target: 'principal', targetEmp: principal, channel: ch,
      purpose: 'Complaint', summary: s, outcome: out, followUp: out === 'Callback scheduled' || out === 'Pending' ? ctx.day(d + 2 > 0 ? 0 : d + 2) : null, loggedBy: U.office });
  }
  // B — fee concession, escalated, still open (repeat alert).
  const feeTrail: [number, string, string, Outcome, string][] = [
    [-9, '10:05', 'Walk-in', 'Not available', 'Wants to meet the Principal about a fee concession after a job loss. Principal away at the Vadavalli campus.'],
    [-8, '11:30', 'Phone call', 'Message left', 'Followed up on the concession request; message left.'],
    [-5, '09:40', 'Email', 'Escalated', 'Wrote to the Principal with documents for the concession. Forwarded to the Finance Manager.'],
    [-2, '14:20', 'Walk-in', 'Pending', 'Came in again for the concession decision. Front office asked them to wait for the Principal’s reply.'],
  ];
  for (const [d, t, ch, out, s] of feeTrail) {
    add({ at: when(d, t), kind: 'parent', parent: pB, studentId: pB.children[0]?.id, target: 'principal', targetEmp: principal, channel: ch,
      purpose: 'Fees', summary: s, outcome: out, followUp: out === 'Pending' ? ctx.day(1) : out === 'Escalated' ? ctx.day(-1) : null, loggedBy: U.office });
  }
  // C — admission of a younger sibling; four attempts a month ago, finally met (no alert).
  const sibTrail: [number, string, string, Outcome, string][] = [
    [-44, '09:15', 'Phone call', 'Not available', 'Asked to speak to the Principal about a sibling admission for Grade 1.'],
    [-42, '10:50', 'Walk-in', 'Not available', 'Walked in for the sibling admission; Principal in assembly.'],
    [-39, '12:10', 'Phone call', 'Callback scheduled', 'Callback set for Monday about the sibling seat.'],
    [-36, '11:00', 'Walk-in', 'Met', 'Met the Principal. Sibling seat confirmed subject to the entrance interaction.'],
  ];
  for (const [d, t, ch, out, s] of sibTrail) {
    add({ at: when(d, t), kind: 'parent', parent: pC, studentId: pC.children[0]?.id, target: 'principal', targetEmp: principal, channel: ch,
      purpose: 'Admission', summary: s, outcome: out, resolvedAfterMin: out === 'Met' ? 30 : undefined, loggedBy: U.office });
  }
  // D — the demo parent: maths support with the class teacher, then the Principal.
  const dTrail: [number, string, string, string, Outcome, string][] = [
    [-20, '15:40', 'Walk-in', 'class_teacher', 'Met', 'Met Ms. Priya at dismissal about Aditya’s fractions practice.'],
    [-13, '16:05', 'Phone call', 'class_teacher', 'Message left', 'Called the class teacher about extra worksheets; message left with the staff room.'],
    [-6, '08:15', 'Walk-in', 'principal', 'Callback scheduled', 'Asked to meet the Principal about moving Aditya to the Maths enrichment group. Callback offered.'],
    [-3, '09:20', 'Phone call', 'class_teacher', 'Spoke on call', 'Spoke with Ms. Priya; enrichment worksheets agreed for two weeks.'],
  ];
  for (const [d, t, ch, tk, out, s] of dTrail) {
    add({ at: when(d, t), kind: 'parent', parent: pD, studentId: pD.children[0]?.id, target: tk as Entry['target'], targetEmp: tk === 'principal' ? principal : priya,
      channel: ch, purpose: 'Academic', summary: s, outcome: out, followUp: out === 'Callback scheduled' ? ctx.day(-2) : null,
      resolvedAfterMin: CLOSING.includes(out) ? 15 : undefined, loggedBy: tk === 'class_teacher' ? U.teacher : U.office });
  }

  // ---------------------------------------------------------------------------
  // Teachers approaching the Principal
  // ---------------------------------------------------------------------------
  const teacherAsks: [string, string, string, Outcome][] = [
    ['Leave', 'Walk-in', 'Requested two days’ leave for a family function; wanted the Principal’s approval before applying.', 'Met'],
    ['Meeting request', 'Message', 'Asked for time to discuss the Grade 5 Maths Olympiad selection.', 'Met'],
    ['Behaviour', 'Walk-in', 'Wanted to discuss repeated disruptive behaviour in class with the Principal.', 'Not available'],
    ['Academic', 'Walk-in', 'Raised the shortage of lab periods for the Science practical schedule.', 'Met'],
    ['Complaint', 'Walk-in', 'Concern about substitution load this week.', 'Escalated'],
    ['General', 'Phone call', 'Called from the field trip venue to update the Principal on the return time.', 'Spoke on call'],
    ['Health', 'Walk-in', 'Informed the Principal about a student who fainted in the morning assembly.', 'Met'],
    ['Meeting request', 'Walk-in', 'Wanted to meet about the timetable change for the IGCSE batch.', 'Callback scheduled'],
    ['Leave', 'Message', 'Requested permission for a half-day on Friday.', 'Resolved'],
  ];
  teacherAsks.forEach(([purpose, ch, s, out], i) => {
    const t = i === 0 || i === 6 ? priya : teachers[(i * 5) % teachers.length];
    const d = -ctx.int(1, 55);
    add({ at: when(d, randTime()), kind: 'teacher', emp: t, campusId: t.campus_id, target: 'principal', targetEmp: principal, channel: ch,
      purpose, summary: s, outcome: out, followUp: out === 'Callback scheduled' ? ctx.day(Math.min(0, d + 3)) : null,
      resolvedAfterMin: CLOSING.includes(out) ? ctx.int(10, 240) : undefined, loggedBy: t.id === priya.id ? U.teacher : U.principal });
  });
  // A non-teaching staff member to the office / Principal
  add({ at: when(-15, '07:50'), kind: 'staff', emp: transport, campusId: transport.campus_id, target: 'principal', targetEmp: principal, channel: 'Walk-in',
    purpose: 'Transport', summary: 'Reported that bus TN-09 needs a new driver from next week and asked for approval to reassign.', outcome: 'Met', resolvedAfterMin: 20, loggedBy: U.principal });
  add({ at: when(-26, '14:30'), kind: 'staff', emp: nurse, campusId: nurse.campus_id, target: 'principal', targetEmp: principal, channel: 'Walk-in',
    purpose: 'Health', summary: 'Wanted approval for the vision screening camp dates.', outcome: 'Met', resolvedAfterMin: 15, loggedBy: U.office });

  // ---------------------------------------------------------------------------
  // Others (not parents or staff)
  // ---------------------------------------------------------------------------
  add({ at: when(-33, '11:20'), kind: 'other', name: 'Mr. Selvam (alumni association)', phone: '+91 98410 55210', target: 'principal', targetEmp: principal,
    channel: 'Phone call', purpose: 'Meeting request', summary: 'Wants to meet the Principal about the alumni day.', outcome: 'Callback scheduled', followUp: ctx.day(-30), loggedBy: U.office });
  add({ at: when(-18, '10:10'), kind: 'other', name: 'Ward councillor’s office', phone: '+91 94442 10087', target: 'management', channel: 'Letter',
    purpose: 'General', summary: 'Letter about road works near the main gate; requested a meeting with management.', outcome: 'Escalated', loggedBy: U.office });
  add({ at: when(-5, '12:00'), kind: 'other', name: 'Prospective parent (walk-in)', phone: '+91 90030 41178', target: 'office', targetEmp: office,
    channel: 'Walk-in', purpose: 'Admission', summary: 'Asked about Grade 3 seats for next year.', outcome: 'Resolved', resolvedAfterMin: 25, loggedBy: U.office });

  // ---------------------------------------------------------------------------
  // General volume — parents to the Principal, office, class teachers and staff
  // ---------------------------------------------------------------------------
  const SUMMARIES: Record<string, string[]> = {
    Academic: ['Asked about the unit test syllabus.', 'Concerned about a drop in Science marks.', 'Wanted extra practice material for English writing.', 'Asked how to support homework at home.'],
    Fees: ['Asked for the term-2 fee breakup.', 'Requested an extension for the second instalment.', 'Receipt for the last payment not received.'],
    Transport: ['Asked to change the pickup stop for two weeks.', 'Bus arrived late in the morning.', 'Wanted the route for a new address.'],
    Admission: ['Enquired about a sibling seat.', 'Asked for the transfer certificate process.'],
    Complaint: ['Unhappy with the canteen food quality.', 'Child’s water bottle lost twice this month.', 'Complained about heavy school bags.'],
    Behaviour: ['Concern about teasing in the bus.', 'Wanted to discuss a playground fight.'],
    Health: ['Informed about a food allergy.', 'Child unwell after PE; wanted the nurse’s note.'],
    Leave: ['Informed about a week-long family trip.', 'Requested leave for a medical procedure.'],
    'Meeting request': ['Wants a meeting about overall progress.', 'Requested a slot outside PTM hours.'],
    General: ['Asked about the annual day dress code.', 'Wanted the date of the next circular on exams.', 'Asked about the lost-and-found.'],
  };
  const purposes = Object.keys(SUMMARIES);
  const pool = parents.filter((p) => ![pA.id, pB.id, pC.id].includes(p.id));
  for (let i = 0; i < 44; i++) {
    const p = pool[ctx.int(0, pool.length - 1)];
    const child = p.children[ctx.int(0, p.children.length - 1)];
    const r = ctx.rand();
    const target: Entry['target'] = r < 0.3 ? 'principal' : r < 0.55 ? 'office' : r < 0.85 ? 'class_teacher' : 'staff';
    const purpose = target === 'staff' ? ctx.pick(['Transport', 'Health', 'Behaviour']) : ctx.pick(purposes);
    const targetEmp = target === 'principal' ? principal
      : target === 'office' ? office
        : target === 'class_teacher' ? (child?.classTeacherId ? empById.get(child.classTeacherId) ?? priya : priya)
          : purpose === 'Transport' ? transport : purpose === 'Health' ? nurse : counsellor;
    const channel = ctx.pick(['Walk-in', 'Walk-in', 'Phone call', 'Phone call', 'Phone call', 'WhatsApp', 'Email', 'Message']);
    const d = -ctx.int(0, 59);
    const recent = d > -7;
    const ok = ctx.rand() < (recent ? 0.5 : 0.85);
    const outcome: Outcome = ok
      ? (channel === 'Walk-in' ? 'Met' : channel === 'Phone call' ? 'Spoke on call' : 'Resolved')
      : channel === 'Walk-in' ? ctx.pick<Outcome>(['Not available', 'Pending'])
        : channel === 'Phone call' ? ctx.pick<Outcome>(['Message left', 'Callback scheduled', 'Not available']) : 'Pending';
    add({
      at: when(d, randTime()), kind: 'parent', parent: p, studentId: child?.id ?? null, campusId: child?.campusId,
      target, targetEmp, channel, purpose, summary: ctx.pick(SUMMARIES[purpose]), outcome,
      followUp: outcome === 'Callback scheduled' || outcome === 'Pending' ? ctx.day(Math.min(d + ctx.int(1, 4), 3)) : null,
      resolvedAfterMin: ok ? ctx.int(5, 60) : undefined,
      loggedBy: target === 'class_teacher' && targetEmp.user_id ? targetEmp.user_id : U.office,
    });
  }
  // A few earlier "pending" items that were later resolved by hand.
  entries.filter((e) => e.outcome === 'Pending' && e.at.getTime() < now - 10 * 86_400_000).forEach((e) => {
    e.outcome = 'Resolved'; e.resolvedAfterMin = ctx.int(600, 3000); e.note = 'Followed up by phone; family satisfied.';
  });

  // ---------------------------------------------------------------------------
  // Insert (codes in chronological order)
  // ---------------------------------------------------------------------------
  entries.sort((a, b) => a.at.getTime() - b.at.getTime());
  const defaultCampus = principal.campus_id;
  const rows = entries.map((e, i) => {
    const closed = CLOSING.includes(e.outcome);
    const resolvedAt = closed ? new Date(Math.min(e.at.getTime() + (e.resolvedAfterMin ?? 30) * MIN, now - MIN)) : null;
    const campus = e.campusId ?? (e.studentId ? e.parent?.children.find((c) => c.id === e.studentId)?.campusId : null) ?? e.parent?.children[0]?.campusId ?? defaultCampus;
    return [
      `CL-${String(i + 1).padStart(4, '0')}`, campus, e.kind, e.parent?.id ?? null, e.emp?.id ?? null,
      e.parent?.full_name ?? e.emp?.full_name ?? e.name, e.parent?.phone ?? e.phone ?? null, e.studentId ?? null,
      e.target, e.targetEmp?.id ?? null, e.targetEmp?.user_id ?? null, e.channel, e.purpose, e.summary, e.outcome, e.note ?? null,
      e.followUp ?? null, resolvedAt, resolvedAt ? e.loggedBy : null, e.loggedBy, e.at, e.at,
    ];
  });
  await bulkInsert(db, 'contact_log_entries',
    ['code', 'campus_id', 'contact_kind', 'parent_id', 'employee_id', 'contact_name', 'contact_phone', 'student_id',
      'target_kind', 'target_employee_id', 'target_user_id', 'channel', 'purpose_category', 'summary', 'outcome', 'resolution_note',
      'follow_up_on', 'resolved_at', 'resolved_by', 'logged_by', 'occurred_at', 'created_at'],
    rows);

  // ---------------------------------------------------------------------------
  // Gate visitors who are parents (matched to parents by phone in contact_log_v)
  // ---------------------------------------------------------------------------
  const spaced = (ph: string) => {
    const d = ph.replace(/\D/g, '').slice(-10);
    return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  };
  const visits: [ParentRow, string, EmpRow, number, string, string | null, 'Completed' | 'Denied'][] = [
    [pA, 'Parent meeting — evening bus delay', principal, -11, '09:05', null, 'Denied'],
    [pB, 'Meet Principal — fee concession', principal, -3, '10:15', null, 'Denied'],
    [pC, 'Parent meeting — sibling admission', principal, -36, '10:50', '11:35', 'Completed'],
    [ranjith, 'Parent meeting — Grade 5', priya, -20, '15:30', '16:00', 'Completed'],
    [pool[2 % pool.length], 'Collect transfer certificate', office, -14, '11:10', '11:30', 'Completed'],
    [pool[7 % pool.length], 'Parent meeting — counsellor', counsellor, -8, '14:00', '14:40', 'Completed'],
  ];
  const visitorRows = visits
    .map(([p, purpose, host, d, inT, outT, status], i) => {
      const inAt = when(d, inT);
      const outAt = outT ? new Date(Math.min(ctx.at(ctx.day(d), outT).getTime(), now - MIN)) : status === 'Denied' ? new Date(inAt.getTime() + 10 * MIN) : null;
      return [p.children[0]?.campusId ?? defaultCampus, `V-31${String(i + 1).padStart(2, '0')}`, p.full_name, spaced(p.phone), purpose, host.id,
        inAt, outAt, status, U.office, inAt];
    });
  await bulkInsert(db, 'visitors',
    ['campus_id', 'badge_no', 'full_name', 'phone', 'purpose', 'host_employee_id', 'checked_in_at', 'checked_out_at', 'status', 'created_by', 'created_at'],
    visitorRows);
}
