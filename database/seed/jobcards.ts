/**
 * SAMPLE DATA — Job Cards: department heads and inter-department job cards
 * with their update histories over the last ~6 weeks. Dates are relative to
 * today; no event that "happened" is stamped in the future. All fictional.
 */
import { bulkInsert, type Db, type SeedContext } from './context.js';

// Department → head (employee code) and home campus.
const HEADS: Record<string, [string, string]> = {
  Academics: ['EMP-1021', 'gdv'], Accounts: ['EMP-3031', 'gdv'], Administration: ['EMP-3040', 'gdv'],
  'Front Office': ['EMP-3002', 'gdv'], Health: ['EMP-7014', 'gdv'], Housekeeping: ['EMP-5005', 'gdv'],
  'Human Resources': ['EMP-3025', 'gdv'], Laboratory: ['EMP-5104', 'gdv'], Leadership: ['EMP-1001', 'gdv'],
  Library: ['EMP-5120', 'gdv'], 'Outdoor Programmes': ['EMP-8001', 'plc'], Security: ['EMP-4022', 'gdv'],
  'Student Support': ['EMP-6011', 'gdv'], Transport: ['EMP-2015', 'gdv'],
};

type St = 'Open' | 'Assigned' | 'In Progress' | 'On Hold' | 'Completed' | 'Closed' | 'Cancelled' | 'Reopened';
// [from, to, title, description, category, priority, location, assignee code | null, status, age (days), due after (days), est. hours, note]
type Card = [string, string, string, string, string, string, string | null, string | null, St, number, number | null, number | null, string | null];

const CARDS: Card[] = [
  ['Academics', 'Administration', 'Projector not working in R-204', 'The ceiling projector in Grade 5A turns off after 10 minutes. Needed for Maths lessons.', 'Maintenance', 'High', 'R-204 (Grade 5A)', 'EMP-3040', 'Closed', 40, 3, 2, null],
  ['Academics', 'Laboratory', 'Prepare titration kits for Grade 10', '18 burettes, pipettes and phenolphthalein for the practical on Thursday.', 'Academic', 'Medium', 'Lab-1 (Science)', 'EMP-5104', 'Closed', 38, 4, 3, null],
  ['Front Office', 'Housekeeping', 'Set up reception for parent orientation', 'Chairs for 60, water dispenser and welcome table at the main reception.', 'Event support', 'Medium', 'Main reception', 'EMP-5011', 'Closed', 36, 2, 4, null],
  ['Human Resources', 'Accounts', 'Release September overtime for drivers', 'Overtime sheet for 9 drivers attached to the payroll inputs. Please process before the 5th.', 'Administrative', 'High', null, 'EMP-3031', 'Closed', 35, 5, 3, null],
  ['Transport', 'Administration', 'Bus R-12 AC repair approval', 'Rear AC unit on the Route 12 bus is leaking; vendor quote needs approval.', 'Transport', 'High', 'Transport yard', 'EMP-3040', 'Completed', 33, 4, 2, null],
  ['Leadership', 'Front Office', 'Circulate Diwali holiday notice', 'Prepare and send the holiday notice to all parents via the app and noticeboard.', 'Administrative', 'Medium', null, 'EMP-3018', 'Closed', 32, 3, 1, null],
  ['Academics', 'Library', 'Reading list books for Grade 6 English', 'Need 30 copies of the term reading list titles issued to 6B by next week.', 'Academic', 'Low', 'Library', 'EMP-5120', 'Closed', 31, 7, 4, null],
  ['Administration', 'Security', 'Visitor parking marking near Gate 2', 'Cone off and mark visitor parking for the inspection day.', 'Administrative', 'Medium', 'Gate 2', 'EMP-4007', 'Closed', 29, 3, 2, null],
  ['Student Support', 'Health', 'Health check for counselling referrals', 'Basic health screening for three Grade 7 students referred this week.', 'Other', 'Medium', 'Infirmary', 'EMP-7014', 'Completed', 27, 3, 2, null],
  ['Accounts', 'Human Resources', 'Bank details missing for two new staff', 'Payroll cannot be run for EMP-2061 and one housekeeping joiner without verified bank details.', 'HR', 'High', null, 'EMP-3025', 'Closed', 26, 3, 1, null],
  ['Front Office', 'Transport', 'Add new admission to Route 7', 'New Grade 3 admission needs pickup from Vadavalli junction from next Monday.', 'Transport', 'Medium', null, 'EMP-2015', 'Completed', 24, 4, 1, null],
  ['Academics', 'Housekeeping', 'Deep clean art room after exhibition', 'Paint spills on the floor and tables after the art exhibition.', 'Housekeeping', 'Low', 'Art room', 'EMP-5011', 'Closed', 23, 2, 3, null],
  ['Leadership', 'Academics', 'Submit Term 1 moderation samples', 'Each subject lead to submit three moderated scripts per grade for review.', 'Academic', 'High', null, 'EMP-1044', 'In Progress', 21, 14, 6, null],
  ['Laboratory', 'Accounts', 'Purchase replacement microscopes', 'Four student microscopes beyond repair; quotes attached for approval.', 'Procurement', 'Medium', 'Lab-1 (Science)', 'EMP-3031', 'On Hold', 20, 10, 2, 'Waiting for the third vendor quote before approval.'],
  ['Transport', 'Human Resources', 'Background check renewal for 3 drivers', 'Police verification for Route 2, 9 and 15 drivers expires this month.', 'HR', 'Urgent', null, 'EMP-3025', 'In Progress', 19, 7, 3, null],
  ['Academics', 'Administration', 'Smartboard calibration in Lab-2', 'Touch is offset by 3 cm on the computing lab board.', 'IT', 'Medium', 'Lab-2 (Computing)', null, 'Open', 18, 5, 1, null],
  ['Front Office', 'Administration', 'Replace faulty visitor badge printer', 'Badge printer jams on every third print at the front desk.', 'IT', 'Medium', 'Main reception', 'EMP-3040', 'Assigned', 16, 6, 1, null],
  ['Human Resources', 'Leadership', 'Approve revised staff leave policy', 'Draft policy with the new casual leave carry-forward rule for sign-off.', 'Administrative', 'Medium', null, 'EMP-1001', 'Assigned', 15, 18, 2, null],
  ['Security', 'Administration', 'CCTV camera 6 offline', 'Camera covering the rear gate has been offline since Saturday night.', 'Maintenance', 'Urgent', 'Rear gate', 'EMP-3040', 'In Progress', 14, 2, 3, null],
  ['Academics', 'Transport', 'Bus for Grade 8 field trip', 'Two buses for the Grade 8 science centre visit, 9:00 to 14:00.', 'Transport', 'Medium', 'Regional Science Centre', 'EMP-2015', 'Completed', 13, 8, 5, null],
  ['Housekeeping', 'Accounts', 'Monthly cleaning supplies purchase', 'Floor cleaner, mops and hand wash for October.', 'Procurement', 'Low', 'Store room', 'EMP-3031', 'Closed', 12, 5, 1, null],
  ['Administration', 'Housekeeping', 'Prepare auditorium for PTM', 'Seating in rows by grade, registration tables at the entrance.', 'Event support', 'High', 'Auditorium', 'EMP-5005', 'Completed', 11, 3, 4, null],
  ['Leadership', 'Human Resources', 'Schedule substitute cover for Ms. Anitha', 'Social Studies cover for 9A and 7C while Ms. Anitha is on leave.', 'HR', 'High', null, 'EMP-3025', 'Reopened', 10, 3, 2, 'Cover for 7C on Thursday is still missing.'],
  ['Front Office', 'Accounts', 'Fee receipt correction for HS-2026-1041', 'Receipt shows Term 2 instead of Term 1; parent has asked for a corrected copy.', 'Administrative', 'Medium', null, null, 'Open', 9, 12, 1, null],
  ['Academics', 'Student Support', 'Counselling referral — Grade 7B', 'Student showing withdrawal in class for two weeks; please schedule a session.', 'Academic', 'High', null, 'EMP-6011', 'In Progress', 8, 10, 2, null],
  ['Outdoor Programmes', 'Transport', 'Transport for Pollachi residential camp', 'Coach for 32 students and 4 staff, Gandhipuram to Pollachi campus.', 'Transport', 'Medium', 'Pollachi campus', null, 'Open', 8, 12, 4, null],
  ['Transport', 'Housekeeping', 'Clean buses before inspection', 'All 7 buses to be cleaned inside before the RTO inspection.', 'Housekeeping', 'High', 'Transport yard', 'EMP-5011', 'In Progress', 7, 9, 6, null],
  ['Library', 'Administration', 'Fix leaking roof above reference section', 'Water dripping onto the shelves after rain; books moved temporarily.', 'Maintenance', 'Urgent', 'Library', null, 'Open', 6, 2, 3, null],
  ['Human Resources', 'Front Office', 'Interview room booking and reception', 'Candidates for the Physics post arriving 10:00–13:00; please receive and seat them.', 'Event support', 'Low', 'Conference room', 'EMP-3002', 'Completed', 6, 2, 3, null],
  ['Accounts', 'Leadership', 'Sign-off on Q2 expense report', 'Q2 expenses report ready for the Principal\'s review and signature.', 'Administrative', 'Medium', null, null, 'Open', 5, 8, 1, null],
  ['Academics', 'Laboratory', 'Set up robotics kits for club', 'Six robotics kits charged and laid out for Friday club.', 'Academic', 'Low', 'Lab-2 (Computing)', 'EMP-5104', 'Assigned', 4, 4, 2, null],
  ['Leadership', 'Security', 'Extra guard for Annual Day rehearsals', 'One additional guard at Gate 1 from 15:00 to 19:00 during rehearsals.', 'Event support', 'Medium', 'Gate 1', 'EMP-4022', 'Assigned', 3, 5, 4, null],
  ['Front Office', 'Housekeeping', 'Water dispenser leaking at reception', 'Dispenser near the waiting area is leaking onto the floor.', 'Maintenance', 'Medium', 'Main reception', null, 'Cancelled', 3, 1, 1, 'Vendor replaced the unit directly; no longer needed.'],
  ['Transport', 'Accounts', 'Diesel advance for Route 15', 'Fuel card limit reached; advance needed for the rest of the week.', 'Procurement', 'Urgent', null, 'EMP-3031', 'In Progress', 2, 3, 1, null],
  ['Student Support', 'Academics', 'Learning support plan inputs — Grade 5A', 'Class teacher inputs needed for two students\' learning support plans.', 'Academic', 'Medium', null, null, 'Open', 2, 6, 2, null],
  ['Administration', 'Transport', 'Vehicle documents for compliance audit', 'Fitness, insurance and permit copies for all vehicles.', 'Administrative', 'High', null, null, 'Open', 1, 4, 2, null],
  ['Health', 'Housekeeping', 'Sanitise infirmary after fever cases', 'Full sanitisation of beds and surfaces in the infirmary.', 'Housekeeping', 'High', 'Infirmary', 'EMP-5005', 'Assigned', 1, 1, 2, null],
  ['Academics', 'Front Office', 'Print and send PTM slips for Grade 5', 'Appointment slips for 5A–5C parents with the teacher time slots.', 'Administrative', 'Medium', 'Main reception', 'EMP-3018', 'In Progress', 4, 5, 2, null],
  ['Leadership', 'Front Office', 'Visitor log summary for the inspection', 'Monthly visitor counts and purpose summary for the last term.', 'Administrative', 'High', null, null, 'Open', 1, 4, 2, null],
  ['Front Office', 'Human Resources', 'Update staff directory at reception', 'Directory board still lists two staff who left last term.', 'HR', 'Low', 'Main reception', null, 'Open', 0, 7, 1, null],
];

const HOUR = 3600_000;

export async function seed(db: Db, ctx: SeedContext): Promise<void> {
  const E = ctx.employees;
  const depts = await db.query<{ id: string; name: string }>('SELECT id, name FROM departments');
  const D: Record<string, string> = Object.fromEntries(depts.rows.map((r) => [r.name, r.id]));
  for (const [name, [code, campus]] of Object.entries(HEADS)) {
    if (!D[name]) continue;
    await db.query('UPDATE departments SET head_employee_id = $2, campus_id = $3 WHERE id = $1', [D[name], E[code] ?? null, ctx.campuses[campus]?.id ?? null]);
  }

  // Users who can act for a department: the head first, then any member with an account.
  const people = await db.query<{ department_id: string; user_id: string; full_name: string; is_head: boolean }>(
    `SELECT d.id AS department_id, e.user_id, e.full_name, (e.id = d.head_employee_id) AS is_head
       FROM departments d JOIN employees e ON e.id = d.head_employee_id OR e.id IN (SELECT employee_id FROM employee_departments WHERE department_id = d.id)
      WHERE e.user_id IS NOT NULL ORDER BY (e.id = d.head_employee_id) DESC, e.full_name`);
  const actor: Record<string, string | null> = {};
  for (const p of people.rows) if (!(p.department_id in actor)) actor[p.department_id] = p.user_id;
  const empInfo = await db.query<{ id: string; full_name: string; user_id: string | null }>('SELECT id, full_name, user_id FROM employees');
  const EI = Object.fromEntries(empInfo.rows.map((r) => [r.id, r]));

  const now = ctx.now.getTime() - 5 * 60_000;
  const clamp = (t: number) => new Date(Math.min(t, now));
  const cards: unknown[][] = [];
  const updates: unknown[][] = [];
  CARDS.forEach((c, i) => {
    const [from, to, title, desc, category, priority, location, assigneeCode, status, age, dueAfter, est, note] = c;
    const fromId = D[from];
    const toId = D[to];
    if (!fromId || !toId) return;
    const id = crypto.randomUUID();
    const code = `JC-${String(i + 1).padStart(4, '0')}`;
    const createdDate = ctx.day(-age);
    const created = ctx.at(createdDate, `${String(8 + (i % 6)).padStart(2, '0')}:${String((i * 17) % 60).padStart(2, '0')}`).getTime();
    const raiser = actor[fromId] ?? null;
    const receiver = actor[toId] ?? null;
    const assignee = assigneeCode ? E[assigneeCode] ?? null : null;
    const assigneeUser = assignee ? EI[assignee]?.user_id ?? null : null;
    const dueOn = dueAfter == null ? null : ctx.day(-age + dueAfter);
    const span = Math.max(1, Math.min(age, dueAfter ?? 3)) * 24 * HOUR; // how long the work took
    const t = {
      assigned: clamp(created + 2 * HOUR), started: clamp(created + 0.2 * span + 3 * HOUR),
      completed: clamp(created + 0.8 * span + 4 * HOUR), closed: clamp(created + 0.8 * span + 22 * HOUR),
    };
    const reached = (s: St) => {
      const order: St[] = ['Open', 'Assigned', 'In Progress', 'Completed', 'Closed'];
      const eff: Record<St, number> = { Open: 0, Assigned: 1, 'In Progress': 2, 'On Hold': 2, Completed: 3, Closed: 4, Reopened: 3, Cancelled: 0 };
      return eff[status] >= order.indexOf(s);
    };
    const log = (at: Date, user: string | null, kind: string, body: string | null, fromS: string | null, toS: string | null) =>
      updates.push([id, user, kind, fromS, toS, body, at]);
    const fromName = from;
    log(new Date(created), raiser, 'created', `Raised for ${to}`, null, 'Open');
    let cur: string = 'Open';
    if (assignee && reached('Assigned')) {
      log(t.assigned, receiver, 'assignment', `Assigned to ${EI[assignee]?.full_name ?? 'staff'}`, cur, 'Assigned');
      cur = 'Assigned';
    }
    if (reached('In Progress')) {
      log(t.started, assigneeUser ?? receiver, 'status', null, cur, 'In Progress');
      cur = 'In Progress';
      if (i % 3 === 0) log(clamp(t.started.getTime() + 2 * HOUR), assigneeUser ?? receiver, 'comment', 'Started on this today; will update once done.', null, null);
    }
    if (status === 'On Hold') {
      log(clamp(t.started.getTime() + 5 * HOUR), receiver, 'status', note, cur, 'On Hold');
      cur = 'On Hold';
    }
    let actual: number | null = null;
    if (reached('Completed')) {
      actual = est == null ? null : Math.round(est * (0.7 + ctx.rand() * 0.8) * 2) / 2;
      log(t.completed, assigneeUser ?? receiver, 'status', 'Done — please check and close.', cur, 'Completed');
      cur = 'Completed';
    }
    if (status === 'Closed') {
      log(t.closed, raiser, 'status', i % 2 ? 'Thank you, all sorted.' : null, cur, 'Closed');
      cur = 'Closed';
    }
    if (status === 'Reopened') {
      log(t.closed, raiser, 'status', note, cur, 'Reopened');
      cur = 'Reopened';
    }
    if (status === 'Cancelled') {
      log(clamp(created + 6 * HOUR), raiser, 'status', note, cur, 'Cancelled');
      cur = 'Cancelled';
    }
    if ((status === 'Open' && age >= 5) || (status === 'Assigned' && age >= 10)) {
      log(clamp(created + 2 * 24 * HOUR), raiser, 'comment', `Any update on this? ${fromName} is waiting on it.`, null, null);
    }
    const last = updates.length ? (updates[updates.length - 1][6] as Date) : new Date(created);
    cards.push([
      id, code, title, desc, category, priority, fromId, toId, raiser, assignee, assignee && reached('Assigned') ? receiver : null,
      assignee && reached('Assigned') ? t.assigned : null, ctx.campuses[HEADS[to]?.[1] ?? 'gdv']?.id ?? null, location, dueOn, status,
      reached('In Progress') ? t.started : null, reached('Completed') && status !== 'Reopened' ? t.completed : null,
      status === 'Closed' || status === 'Cancelled' ? (status === 'Closed' ? t.closed : clamp(created + 6 * HOUR)) : null,
      status === 'Closed' || status === 'Cancelled' ? raiser : null, est, actual, new Date(created), last,
    ]);
  });

  await bulkInsert(db, 'job_cards', [
    'id', 'code', 'title', 'description', 'category', 'priority', 'from_department_id', 'to_department_id', 'raised_by',
    'assigned_to_employee_id', 'assigned_by', 'assigned_at', 'campus_id', 'location', 'due_on', 'status', 'started_at', 'completed_at',
    'closed_at', 'closed_by', 'estimated_hours', 'actual_hours', 'created_at', 'updated_at',
  ], cards);
  await bulkInsert(db, 'job_card_updates', ['card_id', 'user_id', 'kind', 'from_status', 'to_status', 'body', 'created_at'], updates);
}
