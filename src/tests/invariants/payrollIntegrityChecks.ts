import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { personnel, pieceworkPayrolls } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { PayrollPaymentService } from '../../services/accounting/payrollPayment.service.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { PieceworkPayrollService } from '../../services/piecework/payroll.service.js';
import { checkPayrollInvariants } from './payrollInvariants.js';
import { addLog, fundedBank, newTask, newWorker, payrollCount, personNet, refusalOf } from './payrollScenarios.js';
import { watermarks } from './scenarioHelpers.js';

/** Package 12 payroll (series 9) strict checks for the business_invariants suite: [id, name, check, success text] */

const PERIOD = { startDate: '2026-04-01', endDate: '2026-04-30', username: 'inv' };
let seq = 0;

/** A payslip row written straight to the table, the way versions before v9.0.266 could leave one */
async function legacyPayroll(personnelId: number, amounts: { piecework: number; deductions: number; net: number }): Promise<{ id: number; payrollNumber: string }> {
  const payrollNumber = `PAY-I10-${Date.now().toString().slice(-7)}${++seq}`;
  const [row] = await orm.insert(pieceworkPayrolls).values({
    payrollNumber, personnelId, startDate: '2026-04-01', endDate: '2026-04-30', title: 'I10 legacy payslip',
    totalPieceworkAmount: money(amounts.piecework), totalFixedAmount: money(0), totalBonuses: money(0),
    totalDeductions: money(amounts.deductions), advanceDeduction: money(0), netPayable: money(amounts.net), status: 'approved', isDeleted: 0,
  }).returning({ id: pieceworkPayrolls.id });
  return { id: row.id, payrollNumber };
}

/**
 * v9.0.266 (TD-804, decision t1 «الف»): a payslip with bonuses, deductions and an advance deduction gets a voucher whose
 * wages payable credit is exactly its net (I10); negative bonuses or deductions are refused; I10 flags a legacy payslip with
 * negative deductions or a positive net without a voucher, and such a payslip is not paid until its voucher is issued.
 */
export async function checkPayrollNetEqualsVoucher(): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const task = await newTask();
  const worker = await newWorker('I10 worker');
  await addLog(worker, task, '2026-04-05', 1000000);
  const [{ fullName }] = await orm.select({ fullName: personnel.fullName }).from(personnel).where(eq(personnel.id, worker));
  const bankId = await fundedBank();
  await TreasuryTransactionService.createTreasuryTransaction({
    type: 'payment', method: 'bank_transfer', amount: 200000, bankAccountId: bankId, partyType: 'personnel', partyId: worker, partyName: fullName,
    purpose: 'advance', date: '2026-04-02', username: 'inv',
  });
  const issued = await PieceworkPayrollService.generatePayroll({ personnelId: worker, ...PERIOD, bonuses: 50000, deductions: 150000, deductionsDescription: 'TD-804 deduction', advanceDeduction: 200000 });
  if (!issued.payroll || !fin(issued.payroll.netPayable).equals(700000)) problems.push(`payslip with all parts: ${issued.payroll?.netPayable ?? issued.error}, expected net 700,000`);

  // negative parts are refused before anything is written
  const negativeWorker = await newWorker('I10 negative');
  await addLog(negativeWorker, task, '2026-04-06', 1000000);
  for (const extra of [{ deductions: '-100000' }, { bonuses: '-100000' }, { advanceDeduction: '-1' }]) {
    const refused = await refusalOf(() => PieceworkPayrollService.generatePayroll({ personnelId: negativeWorker, ...PERIOD, ...extra }));
    if (refused === null || !refused.includes('منفی')) problems.push(`negative ${Object.keys(extra)[0]} was not refused (${refused ?? 'accepted'})`);
  }
  if (await payrollCount(negativeWorker) !== 0) problems.push('a payslip was written for a refused negative part');

  for (const v of await checkPayrollInvariants(mark.payrollIdAfter)) problems.push(`clean flow: ${v.invariant} ${v.key} ${v.message} (expected ${v.expected ?? '-'}, actual ${v.actual ?? '-'})`);

  // I10 sees what older versions could leave behind
  const legacyWorker = await newWorker('I10 legacy');
  const negative = await legacyPayroll(legacyWorker, { piecework: 0, deductions: -500000, net: 500000 });
  const unvouchered = await legacyPayroll(legacyWorker, { piecework: 400000, deductions: 0, net: 400000 });
  const flagged = new Set((await checkPayrollInvariants(mark.payrollIdAfter)).map(v => v.key));
  for (const p of [negative, unvouchered]) if (!flagged.has(`payroll:${p.id}`)) problems.push(`I10 did not flag legacy payslip ${p.payrollNumber}`);
  await orm.update(pieceworkPayrolls).set({ isDeleted: 1 }).where(eq(pieceworkPayrolls.id, negative.id));

  // a payslip without a voucher is paid only after its voucher is issued
  const unpaid = await refusalOf(() => PayrollPaymentService.registerPayrollPayment({ payrollId: unvouchered.id, bankAccountId: bankId, paymentDate: '2026-05-01', username: 'inv' }));
  if (unpaid === null || !unpaid.includes('سند حسابداری ندارد')) problems.push(`a payslip without a voucher was paid (${unpaid ?? 'accepted'})`);
  const synced = await PieceworkPayrollService.syncPayrollVoucher(unvouchered.id, { username: 'inv' });
  if (!synced.voucher) problems.push(`the legacy payslip got no voucher on sync (${synced.error})`);
  else await PayrollPaymentService.registerPayrollPayment({ payrollId: unvouchered.id, bankAccountId: bankId, paymentDate: '2026-05-01', username: 'inv' });

  for (const v of await checkPayrollInvariants(mark.payrollIdAfter)) problems.push(`after repair: ${v.invariant} ${v.key} ${v.message}`);
  return problems;
}

/**
 * v9.0.267 (TD-807, B12P-04): the outstanding advance comes only from the advance ledger account (mapped 1301); a
 * personnel without such rows has none. A settlement payment used to count as an advance, so an advance deduction of the
 * same amount passed the TD-282 guard and turned 1301 negative.
 */
export async function checkAdvanceBalanceFromLedgerOnly(): Promise<string[]> {
  const problems: string[] = [];
  const worker = await newWorker('TD-807 worker');
  await addLog(worker, await newTask(), '2026-04-07', 3000000);
  const [{ fullName }] = await orm.select({ fullName: personnel.fullName }).from(personnel).where(eq(personnel.id, worker));
  // v10.0.57 (TD-925): a treasury settlement payment is refused now (salary is settled through the payslip payment), so it
  // cannot be counted as an advance either
  const bankId = await fundedBank();
  const settlement = await refusalOf(() => TreasuryTransactionService.createTreasuryTransaction({
    type: 'payment', method: 'bank_transfer', amount: 2000000, bankAccountId: bankId, partyType: 'personnel', partyId: worker, partyName: fullName,
    purpose: 'settlement', date: '2026-04-03', username: 'inv',
  }));
  if (settlement === null) problems.push('a treasury settlement payment to personnel was accepted');
  const balance = await PayrollPaymentService.getPersonnelAdvanceBalance(worker);
  if (balance.outstandingAdvance !== 0 || balance.totalAdvances !== 0) problems.push(`advance balance after a settlement payment: ${balance.outstandingAdvance} (total ${balance.totalAdvances}), expected 0`);
  const issued = await PieceworkPayrollService.generatePayroll({ personnelId: worker, ...PERIOD, advanceDeduction: 2000000 });
  if (issued.payroll) problems.push(`an advance deduction of 2,000,000 was accepted without any advance (net ${issued.payroll.netPayable})`);
  else if (!String(issued.error ?? '').includes('مساعده')) problems.push(`the refusal does not name the advance: ${issued.error}`);
  const ledger = await personNet('1301', worker);
  if (!fin(ledger).isZero()) problems.push(`the advance account of the worker is ${ledger}, expected 0`);
  if (await payrollCount(worker) !== 0) problems.push('a payslip was written for the refused advance deduction');
  return problems;
}

export const PAYROLL_INTEGRITY_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_td_804_payroll_net_equals_voucher', 'v9.0.266: a payslip voucher credits wages payable with exactly the net (I10); negative bonuses, deductions or advance deductions are refused and a payslip without a voucher is not paid (TD-804)',
    () => checkPayrollNetEqualsVoucher(), 'net 700,000 matched the voucher; three negative parts refused; I10 flagged both legacy payslips; the unvouchered one was paid after its voucher was issued'],
  ['inv_td_807_advance_balance_from_ledger_only', 'v9.0.267: the outstanding advance is read only from the advance ledger account; a settlement payment is no advance and an advance deduction against it is refused (TD-807)',
    () => checkAdvanceBalanceFromLedgerOnly(), 'balance 0 after a settlement payment of 2,000,000; the advance deduction refused; 1301 stayed 0'],
];
