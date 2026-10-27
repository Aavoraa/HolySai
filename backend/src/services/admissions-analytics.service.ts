/**
 * Admissions analytics — every figure is computed from enquiries,
 * enquiry_stage_history, follow_ups, admissions and referrals.
 * "This academic year" = enquiries recorded against the current academic year.
 */
import type { Request } from 'express';
import { many, one, query, tx } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { likeTerm, limitOffset, orderBy, type Pagination } from '../utils/pagination.js';
import { badRequest, notFound } from '../utils/errors.js';
import { audit } from './audit.service.js';
import { addFollowUp, createLead, fmtWhen, reachSql } from './admissions.service.js';

const CUR_YEAR = `(SELECT id FROM academic_years WHERE is_current)`;

/** CTE `e`: current-year enquiries with `reach` (1 = New Lead … 9 = Enrolled) and `enrolled_at`. */
function enquiryCte(campusId?: string) {
  const w = new Where().add('x.deleted_at IS NULL').add(`(x.academic_year_id = ${CUR_YEAR} OR x.academic_year_id IS NULL)`);
  w.addIf(campusId, 'x.campus_id = ?');
  const sql = `e AS (
    SELECT x.*, ${reachSql('x')} AS reach,
           (SELECT max(h.changed_at) FROM enquiry_stage_history h WHERE h.enquiry_id = x.id AND h.to_stage = 'Enrolled') AS enrolled_at
      FROM enquiries x ${w.sql})`;
  return { sql, params: w.params };
}

const FUNNEL_STEPS: [string, number][] = [['Enquiry', 1], ['Qualified', 3], ['Visit', 5], ['Application', 6], ['Assessment', 7], ['Offer', 8], ['Admission', 9]];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabels(n = 6) {
  const out: { key: string; label: string }[] = [];
  const now = new Date();
  const kolkata = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(kolkata.getFullYear(), kolkata.getMonth() - i, 1);
    out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MONTHS[d.getMonth()] });
  }
  return out;
}

async function funnel(cte: { sql: string; params: unknown[] }) {
  const f = await one(
    `WITH ${cte.sql} SELECT ${FUNNEL_STEPS.map(([, r], i) => `count(*) FILTER (WHERE reach >= ${r})::int AS s${i}`).join(', ')} FROM e`,
    cte.params);
  const rows = FUNNEL_STEPS.map(([label], i) => ({ label, value: Number(f?.[`s${i}`] ?? 0) }));
  const steps = rows.slice(1).map((r, i) => ({
    from: rows[i].label, to: r.label,
    pct: rows[i].value ? Math.round((r.value / rows[i].value) * 100) : 0,
    lost: rows[i].value - r.value,
  }));
  const meaningful = steps.filter((s) => rows.find((r) => r.label === s.from)!.value > 0);
  const biggestDrop = meaningful.length ? meaningful.reduce((a, b) => (b.pct < a.pct ? b : a)) : null;
  const strongest = meaningful.length ? meaningful.reduce((a, b) => (b.pct > a.pct ? b : a)) : null;
  return { rows, steps, biggestDrop, strongest };
}

async function monthly(campusId?: string, n = 6) {
  const months = monthLabels(n);
  const w = new Where().add('x.deleted_at IS NULL');
  w.addIf(campusId, 'x.campus_id = ?');
  const rows = await many<{ m: string; enquiries: number; applications: number; admissions: number }>(
    `WITH months AS (SELECT to_char(d, 'YYYY-MM') AS m FROM generate_series(date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - interval '${n - 1} months',
                                                                        date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata'), interval '1 month') d),
          enq AS (SELECT to_char(x.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS m, count(*)::int AS n FROM enquiries x ${w.sql} GROUP BY 1),
          app AS (SELECT to_char(a.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS m, count(*)::int AS n
                    FROM admissions a JOIN enquiries x ON x.id = a.enquiry_id ${w.sql} GROUP BY 1),
          adm AS (SELECT to_char(h.changed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS m, count(DISTINCT h.enquiry_id)::int AS n
                    FROM enquiry_stage_history h JOIN enquiries x ON x.id = h.enquiry_id ${w.sql} AND h.to_stage = 'Enrolled' GROUP BY 1)
     SELECT months.m, COALESCE(enq.n, 0) AS enquiries, COALESCE(app.n, 0) AS applications, COALESCE(adm.n, 0) AS admissions
       FROM months LEFT JOIN enq USING (m) LEFT JOIN app USING (m) LEFT JOIN adm USING (m) ORDER BY months.m`,
    w.params);
  const by = new Map(rows.map((r) => [r.m, r]));
  return {
    labels: months.map((m) => m.label),
    enquiries: months.map((m) => by.get(m.key)?.enquiries ?? 0),
    applications: months.map((m) => by.get(m.key)?.applications ?? 0),
    admissions: months.map((m) => by.get(m.key)?.admissions ?? 0),
  };
}

const pctDelta = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

export async function dashboard(campusId?: string) {
  const cte = enquiryCte(campusId);
  const k = await one(
    `WITH ${cte.sql}
     SELECT count(*)::int AS enquiries,
            count(*) FILTER (WHERE reach >= 3)::int AS qualified,
            count(*) FILTER (WHERE reach >= 9)::int AS admitted,
            count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS "enq30",
            count(*) FILTER (WHERE created_at >= now() - interval '60 days' AND created_at < now() - interval '30 days')::int AS "enqPrev30",
            count(*) FILTER (WHERE enrolled_at >= now() - interval '30 days')::int AS "adm30",
            count(*) FILTER (WHERE enrolled_at >= now() - interval '60 days' AND enrolled_at < now() - interval '30 days')::int AS "admPrev30",
            COALESCE(sum(acquisition_cost), 0)::numeric AS spend,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM enrolled_at - created_at) / 86400) FILTER (WHERE enrolled_at IS NOT NULL) AS "medianDays",
            (SELECT count(*)::int FROM follow_ups f JOIN e e2 ON e2.id = f.enquiry_id WHERE f.follow_up_type = 'Campus Visit' AND f.status = 'Completed') AS visits,
            (SELECT count(*)::int FROM follow_ups f JOIN e e2 ON e2.id = f.enquiry_id WHERE f.follow_up_type = 'Campus Visit' AND f.status = 'Scheduled'
                AND f.scheduled_at >= date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
                AND f.scheduled_at < (date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') + interval '7 days') AT TIME ZONE 'Asia/Kolkata') AS "visitsThisWeek",
            (SELECT count(*)::int FROM admissions a JOIN e e2 ON e2.id = a.enquiry_id) AS applications,
            (SELECT count(*)::int FROM admissions a JOIN e e2 ON e2.id = a.enquiry_id
              WHERE a.status NOT IN ('Enrolled', 'Rejected', 'Withdrawn')
                AND EXISTS (SELECT 1 FROM documents d WHERE d.owner_type = 'admission' AND d.owner_id = a.id AND d.category <> 'Admission form' AND d.status <> 'Verified' AND d.deleted_at IS NULL)) AS "awaitingDocuments",
            count(*) FILTER (WHERE reach >= 8)::int AS offers,
            (SELECT count(*)::int FROM admissions a JOIN e e2 ON e2.id = a.enquiry_id
              WHERE a.status = 'Offer Made' AND a.offer_expires_on BETWEEN current_date AND current_date + 7) AS "offersExpiring"
       FROM e`,
    cte.params);
  const target = await one<{ value: unknown }>(`SELECT value FROM system_settings WHERE key = 'admissions.target'`);
  const enquiries = k?.enquiries ?? 0;
  const admitted = k?.admitted ?? 0;
  const spend = Number(k?.spend ?? 0);
  const [fun, sources, trend, attention] = await Promise.all([
    funnel(cte),
    many(`WITH ${cte.sql} SELECT source AS label, count(*)::int AS value FROM e GROUP BY source ORDER BY value DESC, source`, cte.params),
    monthly(campusId),
    attentionItems(campusId),
  ]);
  return {
    kpis: {
      enquiries, qualified: k?.qualified ?? 0, qualifiedPct: enquiries ? Math.round((k!.qualified / enquiries) * 100) : 0,
      visits: k?.visits ?? 0, visitsThisWeek: k?.visitsThisWeek ?? 0,
      applications: k?.applications ?? 0, awaitingDocuments: k?.awaitingDocuments ?? 0,
      offers: k?.offers ?? 0, offersExpiring: k?.offersExpiring ?? 0,
      admitted, target: target ? Number(target.value) : null,
      conversion: enquiries ? Math.round((admitted / enquiries) * 1000) / 10 : 0,
      spend, cpa: admitted ? Math.round(spend / admitted) : null,
      enquiriesDelta: pctDelta(k?.enq30 ?? 0, k?.enqPrev30 ?? 0),
      admittedDelta: pctDelta(k?.adm30 ?? 0, k?.admPrev30 ?? 0),
      medianDaysToAdmit: k?.medianDays != null ? Math.round(Number(k.medianDays)) : null,
    },
    funnel: fun.rows,
    funnelSteps: fun.steps,
    insights: { biggestDrop: fun.biggestDrop, strongest: fun.strongest, medianDaysToAdmit: k?.medianDays != null ? Math.round(Number(k.medianDays)) : null },
    sources,
    monthly: trend,
    attention,
  };
}

/** "Follow-ups needing attention" — unassigned leads, overdue follow-ups, expiring offers, stalled documents, unhosted visits. */
export async function attentionItems(campusId?: string) {
  const w = new Where().add('e.deleted_at IS NULL').add(`e.stage NOT IN ('Enrolled', 'Lost')`);
  w.addIf(campusId, 'e.campus_id = ?');
  const [unassigned, expiring, stalled, overdue, visits] = await Promise.all([
    many(`SELECT e.code, e.created_at AS "createdAt", e.next_action_at < now() AS overdue FROM enquiries e ${w.sql} AND e.counsellor_id IS NULL ORDER BY e.created_at LIMIT 5`, w.params),
    many(`SELECT e.code, e.grade_applied AS grade, e.curriculum, co.full_name AS counsellor, a.offer_expires_on AS "expiresOn",
                 (a.offer_expires_on - current_date) AS days
            FROM admissions a JOIN enquiries e ON e.id = a.enquiry_id LEFT JOIN employees co ON co.id = e.counsellor_id
            ${w.sql} AND a.status = 'Offer Made' AND a.offer_expires_on <= current_date + 7 ORDER BY a.offer_expires_on LIMIT 5`, w.params),
    many(`SELECT e.code, (current_date - (a.created_at AT TIME ZONE 'Asia/Kolkata')::date) AS days
            FROM admissions a JOIN enquiries e ON e.id = a.enquiry_id
            ${w.sql} AND a.status IN ('Submitted', 'Under Review')
              AND EXISTS (SELECT 1 FROM documents d WHERE d.owner_type = 'admission' AND d.owner_id = a.id AND d.category <> 'Admission form' AND d.status = 'Pending' AND d.deleted_at IS NULL)
              AND a.created_at < now() - interval '3 days'
            ORDER BY a.created_at LIMIT 5`, w.params),
    one(`SELECT count(*)::int AS n FROM follow_ups f JOIN enquiries e ON e.id = f.enquiry_id ${w.sql} AND f.status = 'Scheduled' AND f.scheduled_at < now()`, w.params),
    one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE f.assigned_to IS NULL)::int AS unhosted
           FROM follow_ups f JOIN enquiries e ON e.id = f.enquiry_id
          ${w.sql} AND f.follow_up_type = 'Campus Visit' AND f.status = 'Scheduled'
            AND f.scheduled_at >= date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
            AND f.scheduled_at < (date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') + interval '7 days') AT TIME ZONE 'Asia/Kolkata'`, w.params),
  ]);
  const items: { tone: string; icon: string; title: string; meta: string; lead?: string; route?: string }[] = [];
  for (const u of unassigned) {
    items.push({ tone: 'critical', icon: 'alertCircle', title: `${u.code} — no counsellor assigned`, meta: `Created ${fmtWhen(u.createdAt).split(',')[0]}${u.overdue ? ' · first contact overdue' : ''}`, lead: u.code });
  }
  for (const x of expiring) {
    items.push({ tone: 'warning', icon: 'clock', title: `${x.code} — offer ${x.days < 0 ? 'expired' : x.days === 0 ? 'expires today' : `expires in ${x.days} day${x.days === 1 ? '' : 's'}`}`, meta: `${x.grade}${x.curriculum ? ` ${x.curriculum}` : ''} · ${x.counsellor ?? 'Unassigned'}`, lead: x.code });
  }
  for (const s of stalled) {
    items.push({ tone: 'warning', icon: 'fileText', title: `${s.code} — documents not uploaded`, meta: `Application stalled ${s.days} days`, lead: s.code });
  }
  if (overdue?.n) items.push({ tone: 'warning', icon: 'clock', title: `${overdue.n} follow-up${overdue.n === 1 ? '' : 's'} overdue`, meta: 'Across open leads', route: '/leads?overdue=true' });
  if (visits?.n) items.push({ tone: 'info', icon: 'calendar', title: `${visits.n} campus visit${visits.n === 1 ? '' : 's'} this week`, meta: visits.unhosted ? `${visits.unhosted} need a host confirmation` : 'All visits have a host', route: '/visits' });
  return items;
}

// ---------------------------------------------------------------------------
// Conversion analytics
// ---------------------------------------------------------------------------
export async function conversion(campusId?: string) {
  const cte = enquiryCte(campusId);
  const [k, bySource, byCounsellor, fun, trend] = await Promise.all([
    one(`WITH ${cte.sql}
         SELECT count(*)::int AS enquiries, count(*) FILTER (WHERE reach >= 9)::int AS admitted,
                COALESCE(sum(acquisition_cost), 0)::numeric AS spend,
                count(*) FILTER (WHERE stage = 'Lost')::int AS lost,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM enrolled_at - created_at) / 86400) FILTER (WHERE enrolled_at IS NOT NULL) AS "medianDays",
                count(*) FILTER (WHERE reach >= 9 AND enrolled_at >= now() - interval '90 days')::int AS "adm90",
                count(*) FILTER (WHERE created_at >= now() - interval '90 days')::int AS "enq90",
                count(*) FILTER (WHERE reach >= 9 AND enrolled_at < now() - interval '90 days')::int AS "admBefore",
                count(*) FILTER (WHERE created_at < now() - interval '90 days')::int AS "enqBefore"
           FROM e`, cte.params),
    many(`WITH ${cte.sql}
          SELECT source, count(*)::int AS enquiries,
                 count(*) FILTER (WHERE reach >= 3)::int AS qualified,
                 count(*) FILTER (WHERE reach >= 6)::int AS applications,
                 count(*) FILTER (WHERE reach >= 9)::int AS enrolled,
                 COALESCE(sum(acquisition_cost), 0)::numeric AS spend
            FROM e GROUP BY source ORDER BY source`, cte.params),
    many(`WITH ${cte.sql}
          SELECT COALESCE(co.full_name, 'Unassigned') AS counsellor, co.id AS "counsellorId",
                 count(*)::int AS leads,
                 count(*) FILTER (WHERE e.stage NOT IN ('Enrolled', 'Lost'))::int AS open,
                 count(*) FILTER (WHERE reach >= 3)::int AS qualified,
                 count(*) FILTER (WHERE reach >= 5)::int AS visited,
                 count(*) FILTER (WHERE reach >= 9)::int AS enrolled,
                 count(*) FILTER (WHERE e.stage = 'Lost')::int AS lost,
                 (SELECT count(*)::int FROM follow_ups f JOIN e e2 ON e2.id = f.enquiry_id
                   WHERE f.status = 'Scheduled' AND f.scheduled_at < now() AND e2.counsellor_id IS NOT DISTINCT FROM co.id) AS overdue,
                 (SELECT round(avg(extract(epoch FROM (h.changed_at - e2.created_at)) / 3600))::int
                    FROM e e2 JOIN enquiry_stage_history h ON h.enquiry_id = e2.id AND h.to_stage = 'Contacted'
                   WHERE e2.counsellor_id IS NOT DISTINCT FROM co.id) AS "hoursToContact"
            FROM e LEFT JOIN employees co ON co.id = e.counsellor_id
           GROUP BY co.id, co.full_name ORDER BY enrolled DESC, leads DESC`, cte.params),
    funnel(cte),
    monthly(campusId),
  ]);
  const enquiries = k?.enquiries ?? 0;
  const admitted = k?.admitted ?? 0;
  const spend = Number(k?.spend ?? 0);
  const recent = k?.enq90 ? (k.adm90 / k.enq90) * 100 : null;
  const before = k?.enqBefore ? (k.admBefore / k.enqBefore) * 100 : null;
  const lostReasons = await many(
    `WITH ${cte.sql} SELECT COALESCE(lost_reason, 'Not recorded') AS label, count(*)::int AS value FROM e WHERE stage = 'Lost' GROUP BY 1 ORDER BY value DESC LIMIT 6`,
    cte.params);
  return {
    kpis: {
      enquiries, admitted, lost: k?.lost ?? 0,
      conversion: enquiries ? Math.round((admitted / enquiries) * 1000) / 10 : 0,
      conversionDelta: recent != null && before != null ? Math.round((recent - before) * 10) / 10 : null,
      cpa: admitted ? Math.round(spend / admitted) : null,
      medianDaysToAdmit: k?.medianDays != null ? Math.round(Number(k.medianDays)) : null,
      spend,
    },
    sources: bySource.map((s) => ({
      ...s,
      spend: Number(s.spend),
      conversion: s.enquiries ? Math.round((s.enrolled / s.enquiries) * 100) : 0,
      cpa: s.enrolled ? Math.round(Number(s.spend) / s.enrolled) : null,
      costPerLead: s.enquiries ? Math.round(Number(s.spend) / s.enquiries) : null,
    })),
    counsellors: byCounsellor.map((c) => ({ ...c, conversion: c.leads ? Math.round((c.enrolled / c.leads) * 100) : 0 })),
    funnel: fun.rows,
    stages: fun.steps,
    monthly: trend,
    lostReasons,
  };
}

// ---------------------------------------------------------------------------
// Enquiries (raw capture) summary
// ---------------------------------------------------------------------------
export async function enquirySummary(campusId?: string) {
  const w = new Where().add('x.deleted_at IS NULL');
  w.addIf(campusId, 'x.campus_id = ?');
  const month = `date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`;
  const k = await one(
    `WITH m AS (
       SELECT x.*,
              (SELECT min(c.occurred_at) FROM communications c
                WHERE c.enquiry_id = x.id AND c.channel = 'WhatsApp' AND c.direction = 'outbound' AND c.sent_by IS NULL) AS ai_reply_at
         FROM enquiries x ${w.sql} AND x.created_at >= ${month})
     SELECT count(*)::int AS "thisMonth",
            count(*) FILTER (WHERE ai_reply_at IS NOT NULL)::int AS "aiAnswered",
            count(*) FILTER (WHERE source = 'WhatsApp' AND ai_reply_at IS NULL)::int AS "needingHuman",
            count(*) FILTER (WHERE counsellor_id IS NULL AND stage NOT IN ('Enrolled', 'Lost'))::int AS unassigned,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ai_reply_at - created_at)) FILTER (WHERE ai_reply_at IS NOT NULL) AS "medianReplySeconds",
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM enquiries y WHERE y.id <> m.id AND y.deleted_at IS NULL
                 AND regexp_replace(y.phone, '\\D', '', 'g') = regexp_replace(m.phone, '\\D', '', 'g')))::int AS duplicates
       FROM m`,
    w.params);
  const prev = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM enquiries x ${w.sql}
        AND x.created_at >= ${month} - interval '1 month'
        AND x.created_at < now() - interval '1 month'`, w.params);
  const channels = await many(
    `SELECT source AS label, count(*)::int AS value FROM enquiries x ${w.sql} AND x.created_at >= ${month} GROUP BY source ORDER BY value DESC`, w.params);
  const humans = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM enquiries x ${w.sql} AND x.created_at >= ${month} AND x.source <> 'WhatsApp'`, w.params);
  return {
    thisMonth: k?.thisMonth ?? 0,
    monthDelta: pctDelta(k?.thisMonth ?? 0, prev?.n ?? 0),
    aiAnswered: k?.aiAnswered ?? 0,
    aiAnsweredPct: k?.thisMonth ? Math.round((k.aiAnswered / k.thisMonth) * 100) : 0,
    medianReplySeconds: k?.medianReplySeconds != null ? Math.round(Number(k.medianReplySeconds)) : null,
    needingHuman: (k?.needingHuman ?? 0) + (humans?.n ?? 0),
    unassigned: k?.unassigned ?? 0,
    duplicates: k?.duplicates ?? 0,
    channels,
  };
}

// ---------------------------------------------------------------------------
// Campus visits (follow-ups of type 'Campus Visit')
// ---------------------------------------------------------------------------
const WEEK_START = `(date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`;
const WEEK_END = `((date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') + interval '7 days') AT TIME ZONE 'Asia/Kolkata')`;

export async function listVisits(f: Pagination & { campusId?: string; range?: string; status?: string; unhosted?: boolean }) {
  const w = new Where().add(`f.follow_up_type = 'Campus Visit'`).add('e.deleted_at IS NULL');
  w.addIf(f.campusId, 'e.campus_id = ?');
  w.addIf(f.status, 'f.status = ?');
  if (f.unhosted) w.add(`f.assigned_to IS NULL AND f.status = 'Scheduled'`);
  if (f.range === 'week') w.add(`f.scheduled_at >= ${WEEK_START} AND f.scheduled_at < ${WEEK_END}`);
  if (f.range === 'upcoming') w.add(`f.scheduled_at >= now()`);
  if (f.range === 'past') w.add(`f.scheduled_at < now()`);
  if (f.q) w.add('(e.student_name ILIKE ? OR e.parent_name ILIKE ? OR e.code ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT f.id, f.scheduled_at AS "scheduledAt", f.completed_at AS "completedAt", f.status, f.outcome, f.notes,
            f.assigned_to AS "hostId", h.full_name AS host,
            (f.status = 'Scheduled' AND f.scheduled_at < now()) AS overdue,
            e.id AS "enquiryId", e.code, e.parent_name AS family, e.student_name AS "studentName", e.grade_applied AS grade,
            e.stage, e.phone, cp.short_name AS "campusName", count(*) OVER() AS total
       FROM follow_ups f
       JOIN enquiries e ON e.id = f.enquiry_id
       JOIN campuses cp ON cp.id = e.campus_id
       LEFT JOIN employees h ON h.id = f.assigned_to
      ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, { when: 'f.scheduled_at', scheduledAt: 'f.scheduled_at', family: 'e.parent_name', grade: 'e.grade_applied', host: 'h.full_name', status: 'f.status' }, 'when')}
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params);
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function visitSummary(campusId?: string) {
  const cte = enquiryCte(campusId);
  const k = await one(
    `WITH ${cte.sql}, v AS (SELECT f.* FROM follow_ups f JOIN e ON e.id = f.enquiry_id WHERE f.follow_up_type = 'Campus Visit')
     SELECT (SELECT count(*)::int FROM v WHERE status <> 'Cancelled' AND scheduled_at >= ${WEEK_START} AND scheduled_at < ${WEEK_END}) AS "thisWeek",
            (SELECT count(*)::int FROM v WHERE status = 'Scheduled' AND assigned_to IS NULL AND scheduled_at >= now()) AS "needHost",
            (SELECT count(*)::int FROM v WHERE status = 'Scheduled' AND scheduled_at >= now()) AS upcoming,
            (SELECT count(*)::int FROM v WHERE status = 'Completed') AS completed,
            (SELECT count(*)::int FROM v WHERE status = 'Missed') AS missed,
            (SELECT count(*)::int FROM e WHERE reach >= 5) AS visited,
            (SELECT count(*)::int FROM e WHERE reach >= 6) AS applied,
            (SELECT count(*)::int FROM v WHERE status = 'Completed' AND completed_at >= now() - interval '90 days') AS "completed90",
            (SELECT count(*)::int FROM v WHERE status = 'Missed' AND scheduled_at >= now() - interval '90 days') AS "missed90"`,
    cte.params);
  const done = (k?.completed ?? 0) + (k?.missed ?? 0);
  const recentDone = (k?.completed90 ?? 0) + (k?.missed90 ?? 0);
  const noShow = done ? Math.round((k!.missed / done) * 100) : 0;
  const noShowRecent = recentDone ? Math.round((k!.missed90 / recentDone) * 100) : null;
  return {
    thisWeek: k?.thisWeek ?? 0,
    needHost: k?.needHost ?? 0,
    upcoming: k?.upcoming ?? 0,
    completed: k?.completed ?? 0,
    visitToApplication: k?.visited ? Math.round((k.applied / k.visited) * 100) : 0,
    noShowRate: noShow,
    noShowDelta: noShowRecent != null ? noShowRecent - noShow : null,
  };
}

export async function scheduleVisit(req: Request, input: { enquiryId: string; scheduledAt: string; hostId?: string | null; notes?: string }) {
  return addFollowUp(req, input.enquiryId, {
    type: 'Campus Visit', scheduledAt: input.scheduledAt,
    notes: input.notes || 'Campus tour and counsellor meeting',
    assignedTo: input.hostId === undefined ? undefined : input.hostId,
  });
}

// ---------------------------------------------------------------------------
// Parent referrals
// ---------------------------------------------------------------------------
const REF_YEAR = `(r.enquiry_id IS NULL AND r.created_at >= (SELECT starts_on - interval '6 months' FROM academic_years WHERE is_current)
                   OR EXISTS (SELECT 1 FROM enquiries q WHERE q.id = r.enquiry_id AND q.deleted_at IS NULL
                              AND (q.academic_year_id = ${CUR_YEAR} OR q.academic_year_id IS NULL)))`;

export async function referralSummary(campusId?: string) {
  const w = new Where().add(REF_YEAR);
  if (campusId) w.add('(r.enquiry_id IS NULL OR EXISTS (SELECT 1 FROM enquiries q WHERE q.id = r.enquiry_id AND q.campus_id = ?))', campusId);
  const k = await one(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE r.status = 'Enrolled')::int AS converted,
            count(DISTINCT r.referrer_parent_id)::int AS families,
            count(*) FILTER (WHERE r.created_at >= now() - interval '90 days')::int AS "recent",
            count(*) FILTER (WHERE r.created_at < now() - interval '90 days' AND r.created_at >= now() - interval '180 days')::int AS "previous",
            COALESCE(sum(r.reward_amount) FILTER (WHERE r.reward_status = 'Credited'), 0)::numeric AS "rewardsCredited",
            count(*) FILTER (WHERE r.reward_status = 'Pending')::int AS "rewardsPending"
       FROM referrals r ${w.sql}`, w.params);
  const base = await one<{ n: number }>(`SELECT count(*)::int AS n FROM parents WHERE deleted_at IS NULL`);
  const cte = enquiryCte(campusId);
  const cost = await one(
    `WITH ${cte.sql} SELECT COALESCE(sum(acquisition_cost), 0)::numeric AS spend, count(*) FILTER (WHERE reach >= 9)::int AS enrolled
       FROM e WHERE source = 'Referral'`, cte.params);
  const families = await many(
    `SELECT p.id AS "parentId", p.full_name AS parent,
            (SELECT string_agg(s.full_name || ' (' || COALESCE(c.name, '') || COALESCE(sec.name, '') || ')', ', ' ORDER BY s.full_name)
               FROM student_guardians sg JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL AND s.status = 'active'
               LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
              WHERE sg.parent_id = p.id) AS child,
            count(*)::int AS referred,
            count(*) FILTER (WHERE r.status = 'Enrolled')::int AS converted,
            count(*) FILTER (WHERE r.reward_status = 'Pending')::int AS pending,
            count(*) FILTER (WHERE r.reward_status = 'Credited')::int AS credited,
            COALESCE(sum(r.reward_amount) FILTER (WHERE r.reward_status = 'Credited'), 0)::numeric AS "rewardCredited"
       FROM referrals r JOIN parents p ON p.id = r.referrer_parent_id
      ${w.sql}
      GROUP BY p.id ORDER BY converted DESC, referred DESC, p.full_name`, w.params);
  const total = k?.total ?? 0;
  const enrolled = cost?.enrolled ?? 0;
  return {
    kpis: {
      total, converted: k?.converted ?? 0,
      conversion: total ? Math.round((k!.converted / total) * 100) : 0,
      families: k?.families ?? 0, parentBase: base?.n ?? 0,
      familiesPct: base?.n ? Math.round(((k?.families ?? 0) / base.n) * 1000) / 10 : 0,
      delta: pctDelta(k?.recent ?? 0, k?.previous ?? 0),
      cpa: enrolled ? Math.round(Number(cost!.spend) / enrolled) : null,
      rewardsCredited: Number(k?.rewardsCredited ?? 0), rewardsPending: k?.rewardsPending ?? 0,
    },
    families: families.map((f) => ({ ...f, recognition: f.pending > 0 ? 'Pending' : f.credited > 0 ? 'Acknowledged' : 'Not yet eligible' })),
  };
}

export async function listReferrals(f: Pagination & { status?: string; rewardStatus?: string; campusId?: string }) {
  const w = new Where();
  w.addIf(f.status, 'r.status = ?');
  w.addIf(f.rewardStatus, 'r.reward_status = ?');
  if (f.campusId) w.add('(e.campus_id = ? OR e.id IS NULL)', f.campusId);
  if (f.q) w.add('(p.full_name ILIKE ? OR r.referred_name ILIKE ? OR e.code ILIKE ?)', likeTerm(f.q), likeTerm(f.q), likeTerm(f.q));
  const { limit, offset } = limitOffset(f);
  const rows = await many(
    `SELECT r.id, r.referred_name AS "referredName", r.status, r.reward_status AS "rewardStatus", r.reward_amount AS "rewardAmount",
            r.created_at AS "createdAt", p.id AS "parentId", p.full_name AS "parentName",
            e.id AS "enquiryId", e.code AS "leadCode", e.stage, e.grade_applied AS grade, count(*) OVER() AS total
       FROM referrals r JOIN parents p ON p.id = r.referrer_parent_id
       LEFT JOIN enquiries e ON e.id = r.enquiry_id AND e.deleted_at IS NULL
      ${w.sql}
      ORDER BY ${orderBy(f.sort, f.dir, { created: 'r.created_at', createdAt: 'r.created_at', parent: 'p.full_name', status: 'r.status', referredName: 'r.referred_name' }, 'created')}
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params);
  return { rows: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function referrerOptions(q: string) {
  return many(
    `SELECT p.id, p.full_name AS "fullName", p.parent_code AS "parentCode",
            (SELECT string_agg(s.full_name, ', ' ORDER BY s.full_name) FROM student_guardians sg
               JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL WHERE sg.parent_id = p.id) AS children
       FROM parents p
      WHERE p.deleted_at IS NULL AND (p.full_name ILIKE $1 OR p.parent_code ILIKE $1)
      ORDER BY p.full_name LIMIT 20`, [likeTerm(q)]);
}

export async function createReferral(req: Request, input: { referrerParentId: string; referredName: string; createLead: boolean; lead?: { campusId: string; parentName: string; phone: string; gradeApplied: string } }) {
  const parent = await one<{ id: string; full_name: string }>('SELECT id, full_name FROM parents WHERE id = $1 AND deleted_at IS NULL', [input.referrerParentId]);
  if (!parent) throw badRequest('Referring parent not found', 'PARENT_NOT_FOUND', [{ field: 'referrerParentId', message: 'Choose a parent' }]);
  let enquiryId: string | null = null;
  let code: string | null = null;
  if (input.createLead && input.lead) {
    const lead = await createLead(req, {
      campusId: input.lead.campusId, parentName: input.lead.parentName, phone: input.lead.phone, studentName: input.referredName,
      gradeApplied: input.lead.gradeApplied, source: 'Referral', campaign: 'Parent referral', leadScore: 70,
      transportRequired: false, referredByParentId: parent.id, notes: `Referred by ${parent.full_name}`,
    });
    enquiryId = lead.id;
    code = lead.code;
  }
  const r = await one<{ id: string }>(
    `INSERT INTO referrals (referrer_parent_id, enquiry_id, referred_name, status) VALUES ($1,$2,$3,'Submitted') RETURNING id`,
    [parent.id, enquiryId, input.referredName]);
  await audit(req, { action: 'create', module: 'admissions', description: `Referral from ${parent.full_name}: ${input.referredName}${code ? ` (${code})` : ''}`, entityType: 'referral', entityId: r!.id });
  return { id: r!.id, enquiryId, leadCode: code };
}

export async function setReward(req: Request, id: string, rewardStatus: 'Pending' | 'Credited') {
  return tx(async (db) => {
    const r = await one(`SELECT r.*, p.full_name FROM referrals r JOIN parents p ON p.id = r.referrer_parent_id WHERE r.id = $1 FOR UPDATE OF r`, [id], db);
    if (!r) throw notFound('Referral not found', 'REFERRAL_NOT_FOUND');
    if (r.status !== 'Enrolled') throw badRequest('Only referrals that led to an enrolment earn recognition', 'NOT_ELIGIBLE');
    if (r.reward_status === rewardStatus) throw badRequest(`Recognition is already ${rewardStatus.toLowerCase()}`, 'NO_CHANGE');
    const reward = await one<{ value: unknown }>(`SELECT value FROM system_settings WHERE key = 'admissions.referral_reward'`, [], db);
    await query(
      `UPDATE referrals SET reward_status = $2, reward_amount = CASE WHEN reward_amount > 0 THEN reward_amount ELSE $3 END WHERE id = $1`,
      [id, rewardStatus, Number(reward?.value ?? 0) || 0], db);
    await audit(req, { action: rewardStatus === 'Credited' ? 'approve' : 'update', module: 'admissions', description: `Referral recognition for ${r.full_name} marked ${rewardStatus}`, entityType: 'referral', entityId: id }, db);
  });
}

