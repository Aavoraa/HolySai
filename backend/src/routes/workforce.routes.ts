import { Router, type Request, type Response } from 'express';
import { requireAny, requirePermission } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { created, ok, paged } from '../utils/response.js';
import * as V from '../validators/workforce.validators.js';
import * as wf from '../services/workforce.service.js';
import * as roster from '../services/workforce-roster.service.js';
import * as leave from '../services/workforce-leave.service.js';
import * as payroll from '../services/workforce-payroll.service.js';
import * as me from '../services/workforce-self.service.js';

/**
 * Workforce & payroll. Mounted at /api behind authentication.
 *   /workforce/*  HR screens (hr.read / hr.manage); approve / reject = approvals.decide (Super Admin only)
 *   /payroll/*, /payslips/*  payroll (payroll.read / payroll.manage); approve / return = approvals.decide
 *   /me/*  staff self-service (selfservice.use) — always the signed-in employee
 */
const r = Router();

const READ = requirePermission('hr.read');
const MANAGE = requirePermission('hr.manage');
const APPROVE = requirePermission('approvals.decide');
const PAY_READ = requirePermission('payroll.read');
const PAY_MANAGE = requirePermission('payroll.manage');
const PAY_APPROVE = requirePermission('approvals.decide');
const PAY_RELEASE = requireAny('payroll.manage', 'approvals.decide');
const SELF = requirePermission('selfservice.use');
const idParam = validate(V.idParam, 'params');

// =============================================================================
// Workforce 360 — dashboard and employee directory
// =============================================================================
r.get('/workforce/summary', READ, validate(V.summaryQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  return ok(res, await wf.workforceSummary(f.campusId, f.employeeType), 'Workforce summary');
});

r.get('/workforce/departments', READ, validate(V.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await wf.departments(v(req, 'query').campusId), 'Departments'));

r.get('/workforce/employees', READ, validate(V.employeeListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await wf.listEmployees(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Employees retrieved');
});

r.post('/workforce/employees', MANAGE, validate(V.employeeCreateSchema), async (req: Request, res: Response) =>
  created(res, await wf.createEmployee(req, v(req)), 'Employee created'));

r.get('/workforce/employees/:id', READ, idParam, async (req: Request, res: Response) =>
  ok(res, await wf.getEmployeeProfile(v(req, 'params').id, { payroll: req.user!.permissions.has('payroll.read') }), 'Employee profile'));

r.put('/workforce/employees/:id', MANAGE, idParam, validate(V.employeeUpdateSchema), async (req: Request, res: Response) => {
  await wf.updateEmployee(req, v(req, 'params').id, v(req));
  return ok(res, null, 'Employee updated');
});

r.delete('/workforce/employees/:id', MANAGE, idParam, async (req: Request, res: Response) => {
  await wf.archiveEmployee(req, v(req, 'params').id);
  return ok(res, null, 'Employee archived');
});

// =============================================================================
// Staff attendance
// =============================================================================
r.get('/workforce/attendance', READ, validate(V.attendanceQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await wf.attendanceRegister(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Staff attendance register');
});

r.get('/workforce/attendance/summary', READ, validate(V.attendanceSummaryQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  return ok(res, await wf.attendanceSummary(f.date, f.campusId), 'Staff attendance summary');
});

r.put('/workforce/attendance', MANAGE, validate(V.attendanceMarkSchema), async (req: Request, res: Response) =>
  ok(res, await wf.markAttendance(req, v(req)), 'Attendance saved'));

// =============================================================================
// Shifts & rosters
// =============================================================================
r.get('/workforce/shifts', READ, validate(V.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await roster.listShifts(v(req, 'query').campusId), 'Shifts'));

r.post('/workforce/shifts', MANAGE, validate(V.shiftSchema), async (req: Request, res: Response) =>
  created(res, await roster.saveShift(req, null, v(req)), 'Shift created'));

r.put('/workforce/shifts/:id', MANAGE, idParam, validate(V.shiftSchema), async (req: Request, res: Response) =>
  ok(res, await roster.saveShift(req, v(req, 'params').id, v(req)), 'Shift updated'));

r.get('/workforce/roster', READ, validate(V.rosterQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  return ok(res, await roster.getRoster(f.weekStart, f.campusId), 'Roster');
});

r.post('/workforce/roster', MANAGE, validate(V.rosterEntrySchema), async (req: Request, res: Response) =>
  ok(res, await roster.upsertRosterEntry(req, v(req)), 'Roster updated'));

r.post('/workforce/roster/publish', MANAGE, validate(V.publishSchema), async (req: Request, res: Response) => {
  const b = v(req);
  const out = await roster.publishRoster(req, b.weekStart, b.campusId);
  return ok(res, out, `Roster published to ${out.notified} staff app user(s)`);
});

r.delete('/workforce/roster/:id', MANAGE, idParam, async (req: Request, res: Response) => {
  await roster.deleteRosterEntry(req, v(req, 'params').id);
  return ok(res, null, 'Roster line removed');
});

r.post('/workforce/roster/:id/flag-cover', MANAGE, idParam, validate(V.flagCoverSchema), async (req: Request, res: Response) => {
  await roster.flagCover(req, v(req, 'params').id, v(req).reason);
  return ok(res, null, 'Cover requested');
});

r.post('/workforce/roster/:id/assign-cover', MANAGE, idParam, validate(V.coverSchema), async (req: Request, res: Response) => {
  const out = await roster.assignCover(req, v(req, 'params').id, v(req).coverEmployeeId);
  return ok(res, out, `Cover assigned — ${out.coveredBy}`);
});

// =============================================================================
// Leave
// =============================================================================
r.get('/workforce/leave-types', requireAny('hr.read', 'selfservice.use'), async (_req: Request, res: Response) =>
  ok(res, await leave.leaveTypes(), 'Leave types'));

r.get('/workforce/leave-requests/summary', READ, validate(V.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await leave.leaveSummary(v(req, 'query').campusId), 'Leave summary'));

r.get('/workforce/leave-requests', READ, validate(V.leaveListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await leave.listLeave(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Leave requests');
});

r.post('/workforce/leave-requests', MANAGE, validate(V.leaveCreateSchema), async (req: Request, res: Response) => {
  const b = v(req);
  const out = await leave.createLeave(req, b.employeeId, b);
  return created(res, out, `Leave request ${out.code} submitted`);
});

r.patch('/workforce/leave-requests/:id', MANAGE, idParam, validate(V.leaveUpdateSchema), async (req: Request, res: Response) => {
  await leave.updateLeaveCover(req, v(req, 'params').id, v(req).coverArrangement);
  return ok(res, await leave.getLeave(v(req, 'params').id), 'Cover arrangement saved');
});

r.post('/workforce/leave-requests/:id/review', MANAGE, idParam, async (req: Request, res: Response) => {
  await leave.reviewLeave(req, v(req, 'params').id);
  return ok(res, await leave.getLeave(v(req, 'params').id), 'Moved to review');
});

r.post('/workforce/leave-requests/:id/approve', APPROVE, idParam, validate(V.decisionSchema), async (req: Request, res: Response) => {
  const out = await leave.approveLeave(req, v(req, 'params').id, v(req).note);
  const l = await leave.getLeave(v(req, 'params').id);
  return ok(res, { ...l, ...out }, `${l!.code} approved${out.rosterLinesFlagged ? ` — ${out.rosterLinesFlagged} roster line(s) need cover` : ''}`);
});

r.post('/workforce/leave-requests/:id/reject', APPROVE, idParam, validate(V.rejectSchema), async (req: Request, res: Response) => {
  await leave.rejectLeave(req, v(req, 'params').id, v(req).note);
  const l = await leave.getLeave(v(req, 'params').id);
  return ok(res, l, `${l!.code} rejected`);
});

// =============================================================================
// Overtime
// =============================================================================
r.get('/workforce/overtime/summary', READ, validate(V.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await leave.overtimeSummary(v(req, 'query').campusId), 'Overtime summary'));

r.get('/workforce/overtime', READ, validate(V.overtimeListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await leave.listOvertime(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Overtime entries');
});

r.post('/workforce/overtime', MANAGE, validate(V.overtimeCreateSchema), async (req: Request, res: Response) => {
  const b = v(req);
  return created(res, await leave.createOvertime(req, b.employeeId, b), 'Overtime claim submitted');
});

r.post('/workforce/overtime/:id/review', MANAGE, idParam, async (req: Request, res: Response) => {
  await leave.reviewOvertime(req, v(req, 'params').id);
  return ok(res, null, 'Overtime moved to review');
});

r.post('/workforce/overtime/:id/approve', APPROVE, idParam, validate(V.decisionSchema), async (req: Request, res: Response) => {
  await leave.approveOvertime(req, v(req, 'params').id, v(req).note);
  return ok(res, null, 'Overtime approved');
});

r.post('/workforce/overtime/:id/reject', APPROVE, idParam, validate(V.rejectSchema), async (req: Request, res: Response) => {
  await leave.rejectOvertime(req, v(req, 'params').id, v(req).note);
  return ok(res, null, 'Overtime rejected');
});

// =============================================================================
// Workload & CPD
// =============================================================================
r.get('/workforce/workload', READ, validate(V.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await roster.workload(v(req, 'query').campusId), 'Teaching workload'));

r.get('/workforce/cpd/summary', READ, validate(V.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await roster.cpdSummary(v(req, 'query').campusId), 'CPD summary'));

r.get('/workforce/cpd/records', READ, validate(V.cpdRecordsQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  return ok(res, await roster.cpdRecords(f.employeeId, f.status), 'CPD records');
});

r.get('/workforce/cpd', READ, validate(V.cpdListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await roster.cpdList(f);
  return paged(res, rows, total, f.page, f.pageSize, 'CPD by employee');
});

r.post('/workforce/cpd', MANAGE, validate(V.cpdCreateSchema), async (req: Request, res: Response) => {
  const out = await roster.createCpd(req, v(req));
  return created(res, out, `Training recorded for ${out.created} employee(s)`);
});

r.patch('/workforce/cpd/:id', MANAGE, idParam, validate(V.cpdUpdateSchema), async (req: Request, res: Response) => {
  await roster.updateCpd(req, v(req, 'params').id, v(req));
  return ok(res, null, 'CPD record updated');
});

// =============================================================================
// Payroll — seven-stage run
// =============================================================================
r.get('/payroll/runs', PAY_READ, validate(V.runListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await payroll.listRuns(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Payroll runs');
});

r.post('/payroll/runs', PAY_MANAGE, validate(V.runCreateSchema), async (req: Request, res: Response) => {
  const b = v(req);
  const run = await payroll.createRun(req, b.campusId, b.payMonth);
  return created(res, await payroll.getRun(req, run!.id), 'Payroll run opened');
});

r.get('/payroll/runs/:id', PAY_READ, idParam, async (req: Request, res: Response) =>
  ok(res, await payroll.getRun(req, v(req, 'params').id), 'Payroll run'));

const stage = (fn: (req: Request, id: string) => Promise<unknown>, message: string) =>
  async (req: Request, res: Response) => {
    const id = v(req, 'params').id;
    const out = await fn(req, id);
    return ok(res, { ...(await payroll.getRun(req, id)), result: out ?? null }, message);
  };

r.post('/payroll/runs/:id/inputs', PAY_MANAGE, idParam, stage(payroll.collectInputs, 'Inputs collected'));
r.post('/payroll/runs/:id/calculate', PAY_MANAGE, idParam, stage(payroll.calculateRun, 'Payroll calculated'));
r.post('/payroll/runs/:id/submit', PAY_MANAGE, idParam, stage(payroll.submitRun, 'Submitted for approval'));
r.post('/payroll/runs/:id/approve', PAY_APPROVE, idParam, stage(payroll.approveRun, 'Payroll approved'));
r.post('/payroll/runs/:id/return', PAY_APPROVE, idParam, validate(V.returnSchema),
  stage((req, id) => payroll.returnRun(req, id, v(req).note), 'Payroll returned for changes'));
r.post('/payroll/runs/:id/release', PAY_RELEASE, idParam, stage(payroll.releaseRun, 'Payslips released'));
r.post('/payroll/runs/:id/pay', PAY_RELEASE, idParam, stage(payroll.markPaid, 'Payroll marked as paid'));

r.get('/payslips/summary', PAY_READ, validate(V.campusQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await payroll.payslipSummary(v(req, 'query').campusId), 'Payslip summary'));

r.get('/payslips', PAY_READ, validate(V.payslipListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await payroll.listPayslips(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Payslips');
});

r.get('/payslips/:id', PAY_READ, idParam, async (req: Request, res: Response) =>
  ok(res, await payroll.getPayslip(req, v(req, 'params').id), 'Payslip'));

// =============================================================================
// Staff self-service — own data only (req.user.employeeId)
// =============================================================================
r.get('/me/employee', SELF, async (req: Request, res: Response) =>
  ok(res, await me.myEmployee(me.selfId(req)), 'My employee record'));

r.get('/me/attendance', SELF, validate(V.selfAttendanceQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  return ok(res, await me.myAttendance(me.selfId(req), f.from, f.to), 'My attendance');
});

r.post('/me/attendance/check-in', SELF, async (req: Request, res: Response) =>
  ok(res, await me.checkIn(req, me.selfId(req)), 'Checked in'));

r.post('/me/attendance/check-out', SELF, async (req: Request, res: Response) =>
  ok(res, await me.checkOut(req, me.selfId(req)), 'Checked out'));

r.get('/me/roster', SELF, validate(V.selfRosterQuery, 'query'), async (req: Request, res: Response) =>
  ok(res, await me.myRoster(me.selfId(req), v(req, 'query').weekStart), 'My roster'));

r.get('/me/leave-balances', SELF, async (req: Request, res: Response) =>
  ok(res, await me.myLeaveBalances(me.selfId(req)), 'My leave balances'));

r.get('/me/leave-requests', SELF, async (req: Request, res: Response) =>
  ok(res, await me.myLeaveRequests(me.selfId(req)), 'My leave requests'));

r.post('/me/leave-requests', SELF, validate(V.selfLeaveSchema), async (req: Request, res: Response) => {
  const out = await leave.createLeave(req, me.selfId(req), v(req));
  return created(res, out, `Request ${out.code} submitted — awaiting review`);
});

r.post('/me/leave-requests/:id/cancel', SELF, idParam, async (req: Request, res: Response) => {
  await leave.cancelOwnLeave(req, me.selfId(req), v(req, 'params').id);
  return ok(res, null, 'Leave request withdrawn');
});

r.get('/me/overtime', SELF, async (req: Request, res: Response) =>
  ok(res, await me.myOvertime(me.selfId(req)), 'My overtime'));

r.post('/me/overtime', SELF, validate(V.selfOvertimeSchema), async (req: Request, res: Response) =>
  created(res, await leave.createOvertime(req, me.selfId(req), v(req)), 'Overtime claim submitted'));

r.get('/me/payslips', SELF, async (req: Request, res: Response) =>
  ok(res, await me.myPayslips(me.selfId(req)), 'My payslips'));

r.get('/me/payslips/:id', SELF, idParam, async (req: Request, res: Response) =>
  ok(res, await payroll.getPayslip(req, v(req, 'params').id, me.selfId(req)), 'My payslip'));

r.get('/me/tasks', SELF, async (req: Request, res: Response) => {
  me.selfId(req);
  return ok(res, await me.myTasks(req), 'My tasks');
});

r.get('/me/requests', SELF, async (req: Request, res: Response) =>
  ok(res, await me.myRequests(me.selfId(req)), 'My requests'));

export default r;
