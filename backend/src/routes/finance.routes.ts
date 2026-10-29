import { Router, type Request, type Response } from 'express';
import { requireAny, requirePermission } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { ok, created, paged } from '../utils/response.js';
import { notFound } from '../utils/errors.js';
import { audit } from '../services/audit.service.js';
import { authorizeStudent, isGuardianOf, resolveStudentId } from '../services/access.service.js';
import * as fees from '../services/finance-fees.service.js';
import * as ops from '../services/finance-ops.service.js';
import * as V from '../validators/finance.validators.js';
import { assertDecider } from '../services/approvals-guard.js';
import { upload } from '../services/documents.service.js';

/**
 * Finance domain routes. Mounted at /api behind authentication.
 * Staff screens live under /finance/*; the Parent 360 fee endpoints under /family/*.
 *   read      finance.read
 *   write     finance.manage
 *   review    finance.manage (moving a request to Under Review prepares it; it is not a decision)
 *   decisions approvals.decide — approve / reject belong to the Super Admin only
 *   family    fees.pay_own (own children only; 404 otherwise)
 */
const r = Router();
const READ = requirePermission('finance.read');
const MANAGE = requirePermission('finance.manage');
const APPROVE = requirePermission('approvals.decide');
const PAY_OWN = requirePermission('fees.pay_own');
const ALLOW_READ = requireAny('finance.read', 'hr.read');
const ALLOW_MANAGE = requireAny('finance.manage', 'hr.manage');

const idP = validate(V.idParam, 'params');
const campusQ = validate(V.campusQuery, 'query');
const campus = (req: Request) => v<{ campusId?: string }>(req, 'query').campusId;

// ---- Lookups -----------------------------------------------------------------
r.get('/finance/lookups', ALLOW_READ, async (_req: Request, res: Response) => ok(res, await fees.lookups(), 'Finance lookups'));

// ---- Fee collection dashboard & reminders ----------------------------------------
r.get('/finance/fees/summary', READ, campusQ, async (req: Request, res: Response) =>
  ok(res, await fees.feeDashboard(req.user!, campus(req)), 'Fee collection summary'));

r.get('/finance/fees/reminders/audience', READ, campusQ, async (req: Request, res: Response) =>
  ok(res, await fees.reminderAudience(req.user!, campus(req)), 'Reminder audience'));

r.post('/finance/fees/reminders', MANAGE, validate(V.reminderSend), async (req: Request, res: Response) => {
  const out = await fees.sendReminders(req, v(req));
  return ok(res, out, `Reminders queued for ${out.students} account(s)`);
});

// ---- Fee structures -------------------------------------------------------------
r.get('/finance/fee-structures/summary', READ, campusQ, async (req: Request, res: Response) =>
  ok(res, await fees.structureSummary(campus(req)), 'Fee structure summary'));

r.get('/finance/fee-structures', READ, validate(V.structureListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await fees.listStructures(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Fee structures retrieved');
});

r.post('/finance/fee-structures', MANAGE, validate(V.structureCreate), async (req: Request, res: Response) =>
  created(res, await fees.createStructures(req, v(req)), 'Fee structure created'));

r.patch('/finance/fee-structures/:id', MANAGE, idP, validate(V.structureUpdate), async (req: Request, res: Response) =>
  ok(res, await fees.updateStructure(req, v(req, 'params').id, v(req)), 'Fee structure updated'));

r.post('/finance/fee-structures/:id/apply', MANAGE, idP, async (req: Request, res: Response) => {
  const out = await fees.applyStructure(req, v(req, 'params').id);
  return ok(res, out, `Applied to ${out.applied} student account(s)`);
});

// ---- Student accounts -------------------------------------------------------------
r.get('/finance/accounts', READ, validate(V.accountListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await fees.listAccounts(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Student accounts retrieved');
});

r.get('/finance/accounts/:studentId', READ, validate(V.studentParam, 'params'), async (req: Request, res: Response) => {
  const id = await authorizeStudent(req, v(req, 'params').studentId);
  const data = await fees.getAccount(id);
  await audit(req, { action: 'view', module: 'finance', entityType: 'student', entityId: id, description: `Viewed fee ledger of ${data.student.fullName}` });
  return ok(res, data, 'Student account');
});

r.post('/finance/accounts/:studentId/payments', MANAGE, validate(V.studentParam, 'params'), validate(V.counterPayment),
  async (req: Request, res: Response) => {
    const id = await authorizeStudent(req, v(req, 'params').studentId);
    const receipt = await fees.counterPayment(req, id, v(req));
    return created(res, receipt, `Payment recorded — receipt ${receipt.receiptNo}`);
  });

r.post('/finance/accounts/:studentId/charges', MANAGE, validate(V.studentParam, 'params'), validate(V.chargeCreate),
  async (req: Request, res: Response) => {
    const id = await authorizeStudent(req, v(req, 'params').studentId);
    return created(res, await fees.raiseCharge(req, id, v(req)), 'Charge raised');
  });

// ---- Payments & receipts ------------------------------------------------------------
r.get('/finance/payments/summary', READ, campusQ, async (req: Request, res: Response) =>
  ok(res, await fees.paymentSummary(req.user!, campus(req)), 'Payment summary'));

r.get('/finance/payments/export', READ, validate(V.paymentListQuery, 'query'), async (req: Request, res: Response) => {
  const csv = await fees.exportPayments(req.user!, v(req, 'query'));
  await audit(req, { action: 'export', module: 'finance', entityType: 'fee_payment', description: 'Exported the payment register' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="payments-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send(String.fromCharCode(0xfeff) + csv);
});

r.get('/finance/payments', READ, validate(V.paymentListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await fees.listPayments(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Payments retrieved');
});

r.get('/finance/payments/:id/receipt', READ, idP, async (req: Request, res: Response) => {
  const receipt = await fees.getReceipt(v(req, 'params').id);
  await authorizeStudent(req, receipt.studentId);
  return ok(res, receipt, 'Receipt');
});

r.post('/finance/payments/:id/send-receipt', MANAGE, idP, async (req: Request, res: Response) => {
  const receipt = await fees.getReceipt(v(req, 'params').id);
  await authorizeStudent(req, receipt.studentId);
  const out = await fees.sendReceipt(req, receipt.id);
  return ok(res, out, `Receipt ${receipt.receiptNo} queued on WhatsApp`);
});

// ---- Concessions & scholarships ---------------------------------------------------------
r.get('/finance/concessions/summary', READ, campusQ, async (req: Request, res: Response) =>
  ok(res, await fees.concessionSummary(req.user!, campus(req)), 'Concession summary'));

r.get('/finance/concessions', READ, validate(V.concessionListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await fees.listConcessions(req.user!, f);
  return paged(res, rows, total, f.page, f.pageSize, 'Concessions retrieved');
});

r.post('/finance/concessions', MANAGE, validate(V.concessionCreate), async (req: Request, res: Response) => {
  const input = v(req);
  await authorizeStudent(req, input.studentId);
  return created(res, await fees.createConcession(req, input), 'Concession requested');
});

r.post('/finance/concessions/:id/review', MANAGE, idP, async (req: Request, res: Response) =>
  ok(res, await fees.reviewConcession(req, v(req, 'params').id), 'Concession moved to review'));

r.post('/finance/concessions/:id/approve', APPROVE, idP, async (req: Request, res: Response) =>
  ok(res, await fees.decideConcession(req, v(req, 'params').id, 'Approved'), 'Concession approved and applied'));

r.post('/finance/concessions/:id/reject', APPROVE, idP, validate(V.reasonBody), async (req: Request, res: Response) =>
  ok(res, await fees.decideConcession(req, v(req, 'params').id, 'Rejected', v(req).reason), 'Concession rejected'));

r.get('/finance/scholarships', READ, async (_req: Request, res: Response) => ok(res, await ops.listScholarships(), 'Scholarships'));

r.post('/finance/scholarships', MANAGE, validate(V.scholarshipCreate), async (req: Request, res: Response) =>
  created(res, await ops.createScholarship(req, v(req)), 'Scholarship round opened'));

r.patch('/finance/scholarships/:id', MANAGE, idP, validate(V.scholarshipUpdate), async (req: Request, res: Response) =>
  ok(res, await ops.updateScholarship(req, v(req, 'params').id, v(req).status), 'Scholarship updated'));

// ---- Expenses ----------------------------------------------------------------------------
r.get('/finance/expenses/summary', READ, campusQ, async (req: Request, res: Response) =>
  ok(res, await ops.expenseSummary(campus(req)), 'Expense summary'));

r.get('/finance/expenses', READ, validate(V.expenseListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await ops.listExpenses(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Expenses retrieved');
});

r.post('/finance/expenses', MANAGE, validate(V.expenseCreate), async (req: Request, res: Response) =>
  created(res, await ops.createExpense(req, v(req)), 'Expense raised'));

r.post('/finance/expenses/:id/submit', MANAGE, idP, async (req: Request, res: Response) =>
  ok(res, await ops.transitionExpense(req, v(req, 'params').id, 'submit'), 'Expense submitted'));
r.post('/finance/expenses/:id/review', MANAGE, idP, async (req: Request, res: Response) =>
  ok(res, await ops.transitionExpense(req, v(req, 'params').id, 'review'), 'Expense moved to review'));
r.post('/finance/expenses/:id/approve', APPROVE, idP, async (req: Request, res: Response) =>
  ok(res, await ops.transitionExpense(req, v(req, 'params').id, 'approve'), 'Expense approved'));
r.post('/finance/expenses/:id/reject', APPROVE, idP, validate(V.reasonBody), async (req: Request, res: Response) =>
  ok(res, await ops.transitionExpense(req, v(req, 'params').id, 'reject', v(req).reason), 'Expense rejected'));
r.post('/finance/expenses/:id/pay', MANAGE, idP, async (req: Request, res: Response) =>
  ok(res, await ops.transitionExpense(req, v(req, 'params').id, 'pay'), 'Expense marked paid'));

// ---- Reimbursements --------------------------------------------------------------------------
r.get('/finance/reimbursements/summary', READ, campusQ, async (req: Request, res: Response) =>
  ok(res, await ops.reimbursementSummary(campus(req)), 'Reimbursement summary'));

r.get('/finance/reimbursements', READ, validate(V.reimbursementListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await ops.listReimbursements(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Reimbursements retrieved');
});

// Multipart: the claim fields plus its receipt in "file" (required).
r.post('/finance/reimbursements', MANAGE, upload.single('file'), validate(V.reimbursementCreate), async (req: Request, res: Response) =>
  created(res, await ops.createReimbursement(req, v(req), req.file), 'Claim recorded'));

r.get('/finance/reimbursements/:id/receipt', READ, idP, async (req: Request, res: Response) => {
  const f = await ops.openReimbursementReceipt(req, v(req, 'params').id);
  res.setHeader('Content-Type', f.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  f.stream.on('error', (err) => { req.log?.error({ err }, 'receipt download failed'); res.destroy(err); });
  f.stream.pipe(res);
});
r.post('/finance/reimbursements/:id/review', MANAGE, idP, async (req: Request, res: Response) =>
  ok(res, await ops.transitionReimbursement(req, v(req, 'params').id, 'review'), 'Claim moved to review'));
r.post('/finance/reimbursements/:id/approve', APPROVE, idP, async (req: Request, res: Response) =>
  ok(res, await ops.transitionReimbursement(req, v(req, 'params').id, 'approve'), 'Claim approved'));
r.post('/finance/reimbursements/:id/reject', APPROVE, idP, validate(V.reasonBody), async (req: Request, res: Response) =>
  ok(res, await ops.transitionReimbursement(req, v(req, 'params').id, 'reject', { reason: v(req).reason }), 'Claim rejected'));
r.post('/finance/reimbursements/:id/pay', MANAGE, idP, validate(V.payBody), async (req: Request, res: Response) =>
  ok(res, await ops.transitionReimbursement(req, v(req, 'params').id, 'pay', { payrollRunId: v(req).payrollRunId }), 'Claim marked paid'));

// ---- Allowances (Finance and HR share this screen) ----------------------------------------------
r.get('/finance/allowances/summary', ALLOW_READ, campusQ, async (req: Request, res: Response) =>
  ok(res, await ops.allowanceSummary(campus(req)), 'Allowance summary'));

r.get('/finance/allowances', ALLOW_READ, validate(V.allowanceListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await ops.listAllowances(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Allowances retrieved');
});

r.post('/finance/allowances', ALLOW_MANAGE, validate(V.allowanceCreate), async (req: Request, res: Response) => {
  const out = await ops.createAllowance(req, v(req));
  return created(res, out, `Allowance proposed for ${out.employees} employee(s)`);
});

r.post('/finance/allowances/decide', ALLOW_MANAGE, validate(V.allowanceDecision), async (req: Request, res: Response) => {
  const input = v(req);
  // Approving / rejecting a proposal is the Super Admin's; stopping an approved allowance is not a decision.
  if (input.decision !== 'Stopped') assertDecider(req.user, 'Approving or rejecting an allowance');
  const out = await ops.decideAllowance(req, input);
  return ok(res, out, `${input.allowanceType}: ${input.decision.toLowerCase()} for ${out.updated} employee(s)`);
});

// ---- Budgets -------------------------------------------------------------------------------
r.get('/finance/budgets', READ, campusQ, async (req: Request, res: Response) => ok(res, await ops.budgets(campus(req)), 'Budgets'));
r.post('/finance/budgets', MANAGE, validate(V.budgetUpsert), async (req: Request, res: Response) =>
  ok(res, await ops.upsertBudget(req, v(req)), 'Budget saved'));
r.patch('/finance/budgets/:id', MANAGE, idP, validate(V.budgetUpdate), async (req: Request, res: Response) =>
  ok(res, await ops.updateBudget(req, v(req, 'params').id, v(req)), 'Budget updated'));

// ---- Reconciliation -----------------------------------------------------------------------------
r.get('/finance/reconciliation/summary', READ, async (_req: Request, res: Response) => ok(res, await ops.reconSummary(), 'Reconciliation summary'));

r.get('/finance/reconciliation/lines', READ, validate(V.reconListQuery, 'query'), async (req: Request, res: Response) => {
  const f = v(req, 'query');
  const { rows, total } = await ops.listReconLines(f);
  return paged(res, rows, total, f.page, f.pageSize, 'Statement lines retrieved');
});

r.get('/finance/reconciliation/lines/:id/candidates', READ, idP, async (req: Request, res: Response) =>
  ok(res, await ops.reconCandidates(v(req, 'params').id), 'Candidate payments'));

r.post('/finance/reconciliation/run', MANAGE, async (req: Request, res: Response) => {
  const out = await ops.runReconciliation(req);
  return ok(res, out, `Reconciliation run — ${out.matched} matched, ${out.exceptions} exception(s)`);
});

r.post('/finance/reconciliation/lines/:id/match', MANAGE, idP, validate(V.matchBody), async (req: Request, res: Response) =>
  ok(res, await ops.matchLine(req, v(req, 'params').id, v(req).paymentId, v(req).note), 'Line matched'));
r.post('/finance/reconciliation/lines/:id/exception', MANAGE, idP, validate(V.noteBody), async (req: Request, res: Response) =>
  ok(res, await ops.flagLine(req, v(req, 'params').id, 'Exception', v(req).note), 'Flagged as exception'));
r.post('/finance/reconciliation/lines/:id/resolve', MANAGE, idP, validate(V.noteBody), async (req: Request, res: Response) =>
  ok(res, await ops.flagLine(req, v(req, 'params').id, 'Resolved', v(req).note), 'Exception resolved'));

// ---- Reports -------------------------------------------------------------------------------
r.get('/finance/reports/:key', READ, validate(V.reportParam, 'params'), campusQ, async (req: Request, res: Response) =>
  ok(res, await ops.report(req, v(req, 'params').key, campus(req)), 'Report generated'));

// =============================================================================
// Family (Parent 360) — a parent sees and pays only their own children's fees.
// =============================================================================
async function ownChild(req: Request) {
  const id = await resolveStudentId(v(req, 'params').studentId);
  const parentId = req.user!.parentId;
  if (!parentId || !(await isGuardianOf(parentId, id))) throw notFound('Student not found', 'STUDENT_NOT_FOUND');
  return id;
}

r.get('/family/children/:studentId/fees', PAY_OWN, validate(V.studentParam, 'params'), async (req: Request, res: Response) => {
  const id = await ownChild(req);
  return ok(res, await fees.familyFees(id), 'Fees');
});

r.post('/family/children/:studentId/fees/pay', PAY_OWN, validate(V.studentParam, 'params'), validate(V.familyPayment),
  async (req: Request, res: Response) => {
    const id = await ownChild(req);
    const receipt = await fees.familyPay(req, id, v(req));
    return created(res, receipt, `Payment successful (simulated gateway — no real charge was made). Receipt ${receipt.receiptNo}`);
  });

r.get('/family/receipts/:paymentId', PAY_OWN, validate(V.paymentIdParam, 'params'), async (req: Request, res: Response) => {
  const parentId = req.user!.parentId;
  if (!parentId) throw notFound('Receipt not found', 'RECEIPT_NOT_FOUND');
  return ok(res, await fees.familyReceipt(parentId, v(req, 'params').paymentId), 'Receipt');
});

export default r;
