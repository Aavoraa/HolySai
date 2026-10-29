/**
 * HR letters: Letter of Appointment (onboarding), Relieving Letter and Experience Letter.
 * Issuing one numbers it (HS/HR/AL|RL|EL/YYYY/NNN) and keeps the employee's details and the
 * letter's fields as printed, so a reprint matches the original even after a promotion.
 */
import type { Request } from 'express';
import { many, one, query, tx } from '../config/db.js';
import { Where } from '../utils/sql.js';
import { badRequest, notFound } from '../utils/errors.js';
import { audit } from './audit.service.js';

export type LetterType = 'onboarding' | 'relieving' | 'experience';
const PREFIX: Record<LetterType, string> = { onboarding: 'AL', relieving: 'RL', experience: 'EL' };
export const LETTER_NAMES: Record<LetterType, string> = {
  onboarding: 'Letter of Appointment', relieving: 'Relieving Letter', experience: 'Experience Letter',
};

export interface LetterInput {
  type: LetterType; issuedOn: string; signatoryName: string; signatoryTitle: string;
  joiningDate?: string; designation?: string; department?: string; monthlyGross?: number; probationMonths?: number;
  reportingTo?: string; lastWorkingDay?: string; resignationDate?: string; duesCleared?: boolean; conduct?: string; notes?: string;
}

const EMP_SQL = `
  SELECT e.id, e.employee_code AS code, e.full_name AS "fullName", e.gender, e.designation, e.department,
         to_char(e.join_date, 'YYYY-MM-DD') AS "joinDate", e.employment_status AS "employmentStatus", e.basic_salary::float AS basic,
         e.campus_id AS "campusId", cp.name AS "campusName", cp.short_name AS campus, cp.address AS "campusAddress"
    FROM employees e LEFT JOIN campuses cp ON cp.id = e.campus_id`;

async function employee(id: string) {
  const e = await one(`${EMP_SQL} WHERE e.id = $1 AND e.deleted_at IS NULL`, [id]);
  if (!e) throw notFound('Employee not found', 'EMPLOYEE_NOT_FOUND');
  return e;
}

/** What the letter form starts with: the employee, their monthly gross and a suggested signatory. */
export async function letterDefaults(employeeId: string) {
  const e = await employee(employeeId);
  const [allowances, principal, letters] = await Promise.all([
    one<{ total: number }>(
      `SELECT COALESCE(sum(amount), 0)::float AS total FROM allowances
        WHERE employee_id = $1 AND frequency = 'Monthly' AND status = 'Approved'`, [employeeId]),
    one<{ name: string; title: string }>(
      `SELECT full_name AS name, designation AS title FROM employees
        WHERE campus_id = $1 AND deleted_at IS NULL AND employment_status = 'active' AND designation ILIKE '%principal%'
        ORDER BY (designation ILIKE 'principal') DESC LIMIT 1`, [e.campusId]),
    listLetters({ employeeId }),
  ]);
  return {
    employee: e,
    monthlyGross: Math.round(e.basic + (allowances?.total ?? 0)),
    signatory: principal ?? { name: '', title: 'Principal' },
    letters,
  };
}

export async function listLetters(f: { employeeId?: string; campusId?: string; type?: LetterType; q?: string }) {
  const w = new Where();
  w.addIf(f.employeeId, 'l.employee_id = ?');
  w.addIf(f.campusId, 'e.campus_id = ?');
  w.addIf(f.type, 'l.letter_type = ?');
  if (f.q) w.add('(e.full_name ILIKE ? OR e.employee_code ILIKE ? OR l.ref_no ILIKE ?)', `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
  return many(
    `SELECT l.id, l.letter_type AS type, l.ref_no AS "refNo", to_char(l.issued_on, 'YYYY-MM-DD') AS "issuedOn", l.created_at AS "createdAt",
            e.id AS "employeeId", e.full_name AS employee, e.employee_code AS code, e.designation, cp.short_name AS campus,
            u.full_name AS "issuedBy"
       FROM hr_letters l JOIN employees e ON e.id = l.employee_id LEFT JOIN campuses cp ON cp.id = e.campus_id
       LEFT JOIN users u ON u.id = l.issued_by ${w.sql}
      ORDER BY l.created_at DESC LIMIT 500`, w.params);
}

/** Issues a letter: checks the dates make sense, numbers it and records it. */
export async function issueLetter(req: Request, employeeId: string, b: LetterInput) {
  const e = await employee(employeeId);
  if (b.type === 'onboarding') {
    if (!b.joiningDate) throw badRequest('Enter the date of joining', 'VALIDATION_ERROR', [{ field: 'joiningDate', message: 'Required' }]);
  } else {
    if (!b.lastWorkingDay) throw badRequest('Enter the last working day', 'VALIDATION_ERROR', [{ field: 'lastWorkingDay', message: 'Required' }]);
    if (e.joinDate && b.lastWorkingDay < e.joinDate) {
      throw badRequest('The last working day is before the date of joining', 'VALIDATION_ERROR', [{ field: 'lastWorkingDay', message: 'Before the joining date' }]);
    }
    if (b.resignationDate && b.resignationDate > b.lastWorkingDay) {
      throw badRequest('The resignation date is after the last working day', 'VALIDATION_ERROR', [{ field: 'resignationDate', message: 'After the last working day' }]);
    }
  }
  const year = b.issuedOn.slice(0, 4);
  return tx(async (db) => {
    await query(`SELECT pg_advisory_xact_lock(hashtext('hr_letters.ref'))`, [], db);
    const prefix = `HS/HR/${PREFIX[b.type]}/${year}/`;
    const last = await one<{ n: number }>(
      `SELECT COALESCE(max(substring(ref_no FROM '([0-9]+)$')::int), 0) AS n FROM hr_letters WHERE ref_no LIKE $1`, [`${prefix}%`], db);
    const refNo = `${prefix}${String((last?.n ?? 0) + 1).padStart(3, '0')}`;
    // Keep the employee as they were on the day of issue.
    const snapshot = {
      code: e.code, fullName: e.fullName, gender: e.gender, designation: b.designation ?? e.designation, department: b.department ?? e.department,
      joinDate: e.joinDate, campusName: e.campusName, campusAddress: e.campusAddress,
    };
    const { type: _t, issuedOn: _i, ...fields } = b;
    const row = await one<{ id: string }>(
      `INSERT INTO hr_letters (employee_id, letter_type, ref_no, issued_on, details, issued_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [employeeId, b.type, refNo, b.issuedOn, JSON.stringify({ ...fields, employee: snapshot }), req.user!.id], db);
    await audit(req, {
      action: 'create', module: 'hr', entityType: 'employee', entityId: employeeId,
      description: `Issued ${LETTER_NAMES[b.type]} ${refNo} to ${e.fullName}`, metadata: { letterId: row!.id, refNo },
    }, db);
    return { id: row!.id, refNo };
  });
}

/** One issued letter, with everything needed to print it. */
export async function getLetter(id: string) {
  const l = await one(
    `SELECT l.id, l.letter_type AS type, l.ref_no AS "refNo", to_char(l.issued_on, 'YYYY-MM-DD') AS "issuedOn", l.details,
            l.employee_id AS "employeeId", u.full_name AS "issuedBy", l.created_at AS "createdAt"
       FROM hr_letters l LEFT JOIN users u ON u.id = l.issued_by WHERE l.id = $1`, [id]);
  if (!l) throw notFound('Letter not found', 'LETTER_NOT_FOUND');
  return { ...l, title: LETTER_NAMES[l.type as LetterType] };
}
