/**
 * Pure payroll arithmetic shared by the API (Calculate) and the sample seed,
 * so seeded payslips and calculated payslips follow exactly the same rules.
 *
 *   Earnings   = basic + approved allowances + approved overtime (hours × rate)
 *                + approved reimbursements
 *   Deductions = PF 12% of basic + professional tax ₹200 + TDS (slab-lite) + loan (0)
 *                + loss of pay: (basic + allowances) ÷ working days × unpaid days
 *
 * Unpaid days come from staff attendance: Absent = 1, Half Day = ½. Present, Late and
 * On Leave (approved, paid leave) cost nothing; days not marked are not deducted.
 * Working days are the month's days excluding Sundays.
 *
 * TDS slab-lite (annualised on regular pay, i.e. basic + allowances):
 *   taxable = 12 × regular gross − 12 × PF − ₹50,000 standard deduction
 *   0 – 2.5 L: nil · 2.5 – 5 L: 5% · 5 – 10 L: 15% · above 10 L: 25%, plus 4% cess,
 *   spread over 12 months and rounded to the nearest ₹100.
 */

export const PF_RATE = 0.12;
export const PROFESSIONAL_TAX = 200;
export const STANDARD_DEDUCTION = 50_000;

export interface PayInputs {
  basic: number;
  allowances: { label: string; amount: number }[];
  overtimeHours: number;
  overtimeAmount: number;
  reimbursements: number;
  loan?: number;
  /** Absent days (half days count ½) not covered by paid leave, and the month's working days. */
  unpaidDays?: number;
  workingDays?: number;
}

export interface Payslip {
  earnings: { label: string; amount: number }[];
  deductions: { label: string; amount: number }[];
  gross: number;
  totalDeductions: number;
  net: number;
  allowancesTotal: number;
  overtimeTotal: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function annualTax(taxable: number) {
  const slabs: [number, number, number][] = [
    [250_000, 500_000, 0.05],
    [500_000, 1_000_000, 0.15],
    [1_000_000, Infinity, 0.25],
  ];
  let tax = 0;
  for (const [lo, hi, rate] of slabs) {
    if (taxable > lo) tax += (Math.min(taxable, hi) - lo) * rate;
  }
  return tax * 1.04;
}

export function monthlyTds(regularGross: number, pf: number) {
  const taxable = Math.max(0, regularGross * 12 - pf * 12 - STANDARD_DEDUCTION);
  return Math.round(annualTax(taxable) / 12 / 100) * 100;
}

export function calculatePayslip(i: PayInputs): Payslip {
  const allowancesTotal = r2(i.allowances.reduce((a, x) => a + x.amount, 0));
  const overtimeTotal = r2(i.overtimeAmount);
  const earnings = [
    { label: 'Basic', amount: r2(i.basic) },
    ...i.allowances.map((a) => ({ label: a.label, amount: r2(a.amount) })),
    { label: `Overtime (${Number(i.overtimeHours.toFixed(1))} hrs)`, amount: overtimeTotal },
  ];
  if (i.reimbursements > 0) earnings.push({ label: 'Reimbursements', amount: r2(i.reimbursements) });
  const pf = Math.round(i.basic * PF_RATE);
  const tds = monthlyTds(i.basic + allowancesTotal, pf);
  const deductions = [
    { label: 'Provident fund', amount: pf },
    { label: 'Professional tax', amount: PROFESSIONAL_TAX },
    { label: 'Income tax (TDS)', amount: tds },
    { label: 'Loan recovery', amount: r2(i.loan ?? 0) },
  ];
  const lop = lossOfPay(i.basic + allowancesTotal, i.unpaidDays ?? 0, i.workingDays ?? 0);
  if (lop > 0) {
    const days = Number((i.unpaidDays ?? 0).toFixed(1));
    deductions.push({ label: `Loss of pay (${days} day${days === 1 ? '' : 's'})`, amount: lop });
  }
  const gross = r2(earnings.reduce((a, x) => a + x.amount, 0));
  const totalDeductions = r2(deductions.reduce((a, x) => a + x.amount, 0));
  return { earnings, deductions, gross, totalDeductions, net: r2(gross - totalDeductions), allowancesTotal, overtimeTotal };
}

/** Pay withheld for unpaid days: regular monthly pay ÷ working days × unpaid days (never more than the month's pay). */
export function lossOfPay(regularMonthly: number, unpaidDays: number, workingDays: number) {
  if (!(unpaidDays > 0) || !(workingDays > 0)) return 0;
  return Math.min(r2(regularMonthly), Math.round((regularMonthly / workingDays) * Math.min(unpaidDays, workingDays)));
}

/** Working days in the month starting `monthStart` (YYYY-MM-01): every day except Sundays. */
export function workingDaysInMonth(monthStart: string) {
  const [y, m] = monthStart.slice(0, 7).split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= last; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 0) n++;
  return n;
}

/** Default overtime rate: twice the hourly basic (basic ÷ 208 h), rounded to ₹10, minimum ₹300. */
export function defaultOvertimeRate(basic: number) {
  return Math.max(300, Math.round((basic / 208) * 2 / 10) * 10);
}

/** Leave days between two dates, excluding Sundays. */
export function leaveDays(from: string, to: string) {
  let n = 0;
  for (const d of dateRange(from, to)) if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) n++;
  return n;
}

export function dateRange(from: string, to: string) {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
