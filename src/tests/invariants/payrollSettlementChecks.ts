import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { bankAccounts, personnel, treasuryTransactions } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { PayrollPaymentService } from '../../services/accounting/payrollPayment.service.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { DocumentService } from '../../services/document.service.js';
import { PieceworkPayrollService } from '../../services/piecework/payroll.service.js';
import { createTestItem } from '../fixtures/factories.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';
import { addLog, fundedBank, newTask, newWorker, personNet, refusalOf } from './payrollScenarios.js';

/**
 * Phase 3 lane L1 (money), PR 5: treasury rows that pay salary, void an advance or overpay a document, checked against
 * decision t8 «الف» of the phase 5 review (TD-925, TD-926, TD-938). Each check is red on the code before its fix.
 */

const PERIOD = { startDate: '2026-04-01', endDate: '2026-04-30', username: 'inv' };
let seq = 0;
const tag = (prefix: string) => `${prefix}-${Date.now().toString().slice(-7)}-${++seq}`;

async function workerName(id: number): Promise<string> {
  const [row] = await orm.select({ fullName: personnel.fullName }).from(personnel).where(eq(personnel.id, id));
  return row?.fullName ?? '';
}

async function bankBalance(id: number): Promise<string> {
  const [row] = await orm.select({ balance: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, id));
  return fin(row?.balance ?? 0).toString();
}

/** fundedBank (5,000,000) topped up to 25,000,000, enough for a payslip and the overpayments tried below */
async function richBank(): Promise<number> {
  const id = await fundedBank();
  await TreasuryTransactionService.createTreasuryTransaction({
    type: 'receipt', method: 'bank_transfer', amount: 20000000, bankAccountId: id, partyType: 'other', contraAccountId: await miscContraAccountId(),
    partyName: 'PR5 top-up', date: '2026-04-01', username: 'inv',
  });
  return id;
}

async function errorCodeOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return String((err as { code?: unknown })?.code ?? (err instanceof Error ? err.message : err));
  }
}

/**
 * TD-925 (P5-W02): a treasury payment to personnel with purpose «settlement» and the payslip payment paid the same net
 * twice. Salary is settled only through the payslip payment: the treasury payment is refused before anything is written,
 * the payslip is paid once, and a personnel receipt with purpose «settlement» (money handed back) is still accepted.
 */
export async function checkSalarySettlementOnlyThroughPayslip(): Promise<string[]> {
  const problems: string[] = [];
  const worker = await newWorker('TD-925 worker');
  await addLog(worker, await newTask(), '2026-04-08', 3000000);
  const name = await workerName(worker);
  const bankId = await richBank();
  const issued = await PieceworkPayrollService.generatePayroll({ personnelId: worker, ...PERIOD });
  if (!issued.payroll) return [`the payslip was not issued: ${issued.error}`];
  await PieceworkPayrollService.updatePayrollStatus(issued.payroll.id, { status: 'approved', username: 'inv' });

  const before = await bankBalance(bankId);
  const refused = await errorCodeOf(() => TreasuryTransactionService.createTreasuryTransaction({
    type: 'payment', method: 'bank_transfer', amount: 3000000, bankAccountId: bankId, partyType: 'personnel', partyId: worker, partyName: name,
    purpose: 'settlement', date: '2026-05-01', username: 'inv',
  }));
  if (refused !== 'TREASURY_PAYROLL_SETTLEMENT_VIA_PAYSLIP') problems.push(`a treasury salary settlement payment was not refused (${refused ?? 'accepted'})`);
  if (await bankBalance(bankId) !== before) problems.push(`the refused settlement changed the bank balance: ${before} -> ${await bankBalance(bankId)}`);

  await PayrollPaymentService.registerPayrollPayment({ payrollId: issued.payroll.id, bankAccountId: bankId, paymentDate: '2026-05-01', username: 'inv' });
  const spent = fin(before).subtract(await bankBalance(bankId));
  if (!spent.equals(3000000)) problems.push(`the bank paid ${spent.toString()} for a net of 3,000,000`);
  const wages = await personNet('3201', worker);
  if (!fin(wages).isZero()) problems.push(`wages payable of the worker is ${wages} after the payslip payment, expected 0`);

  const handedBack = await refusalOf(() => TreasuryTransactionService.createTreasuryTransaction({
    type: 'receipt', method: 'cash', amount: 100000, bankAccountId: bankId, partyType: 'personnel', partyId: worker, partyName: name,
    purpose: 'settlement', date: '2026-05-02', username: 'inv',
  }));
  if (handedBack !== null) problems.push(`a personnel settlement receipt was refused: ${handedBack}`);
  return problems;
}

/**
 * TD-926 (P5-W03): voiding an advance that a live payslip has deducted turned the advance account negative and put the
 * money back in the bank. Such a void is refused with 409 while the outstanding advance would fall below zero; an advance
 * not yet deducted, or one whose payslip was deleted, is still voided.
 */
export async function checkDeductedAdvanceNotVoided(): Promise<string[]> {
  const problems: string[] = [];
  const worker = await newWorker('TD-926 worker');
  await addLog(worker, await newTask(), '2026-04-09', 3000000);
  const name = await workerName(worker);
  const bankId = await richBank();
  const advance = await TreasuryTransactionService.createTreasuryTransaction({
    type: 'payment', method: 'bank_transfer', amount: 2000000, bankAccountId: bankId, partyType: 'personnel', partyId: worker, partyName: name,
    purpose: 'advance', date: '2026-04-02', username: 'inv',
  });
  const spare = await TreasuryTransactionService.createTreasuryTransaction({
    type: 'payment', method: 'bank_transfer', amount: 300000, bankAccountId: bankId, partyType: 'personnel', partyId: worker, partyName: name,
    purpose: 'advance', date: '2026-04-03', username: 'inv',
  });
  const issued = await PieceworkPayrollService.generatePayroll({ personnelId: worker, ...PERIOD, advanceDeduction: 2000000 });
  if (!issued.payroll) return [`the payslip with the advance deduction was not issued: ${issued.error}`];

  const before = await bankBalance(bankId);
  const refused = await errorCodeOf(() => TreasuryTransactionService.voidTreasuryTransaction(advance.id, { reason: 'TD-926', username: 'inv' }));
  if (refused !== 'TREASURY_ADVANCE_DEDUCTED') problems.push(`voiding an advance a live payslip deducted was not refused (${refused ?? 'accepted'})`);
  const [row] = await orm.select({ status: treasuryTransactions.status }).from(treasuryTransactions).where(eq(treasuryTransactions.id, advance.id));
  if (row?.status !== 'completed') problems.push(`the refused void left the advance ${row?.status}`);
  if (await bankBalance(bankId) !== before) problems.push(`the refused void changed the bank balance: ${before} -> ${await bankBalance(bankId)}`);
  const ledger = await personNet('1301', worker);
  if (!fin(ledger).equals(300000)) problems.push(`the advance account of the worker is ${ledger}, expected 300,000`);

  // the 300,000 not deducted stays voidable
  const spareVoid = await refusalOf(() => TreasuryTransactionService.voidTreasuryTransaction(spare.id, { reason: 'TD-926 spare', username: 'inv' }));
  if (spareVoid !== null) problems.push(`voiding an advance that no payslip deducted was refused: ${spareVoid}`);

  // once the payslip is deleted the deduction is gone and the advance is voided
  const notDeleted = await refusalOf(() => PieceworkPayrollService.deletePayroll(issued.payroll!.id, { username: 'inv' }));
  if (notDeleted !== null) return [...problems, `the payslip was not deleted: ${notDeleted}`];
  const afterDelete = await refusalOf(() => TreasuryTransactionService.voidTreasuryTransaction(advance.id, { reason: 'TD-926 after delete', username: 'inv' }));
  if (afterDelete !== null) problems.push(`voiding the advance after its payslip was deleted was refused: ${afterDelete}`);
  const final = await personNet('1301', worker);
  if (!fin(final).isZero()) problems.push(`the advance account of the worker is ${final} after both voids, expected 0`);
  return problems;
}

/**
 * TD-938 (P5-P11): a payment of 3,500,000 to a purchase document of 3,000,000 was accepted and shown as «تسویه کامل» with
 * nothing left. A receipt or payment linked to a document is at most the document's remaining amount, on create and on
 * relink; the excess is recorded on account, without a document.
 */
export async function checkSettlementWithinDocumentRemaining(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const supplier = `تأمین‌کننده TD-938 ${tag('S')}`;
  const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const purchase = await DocumentService.createDocument({
    docType: 'receipt', inOut: 'in', status: 'final', date: '2026-04-01', user: 'inv', buyerName: supplier,
    items: [{ itemId: item.id, quantity: 1, unitPrice: 3000000, location: wh }],
  });
  const bankId = await richBank();
  const pay = (amount: number, documentId: number | null = purchase) => TreasuryTransactionService.createTreasuryTransaction({
    type: 'payment', method: 'bank_transfer', amount, bankAccountId: bankId, partyType: 'supplier', partyName: supplier,
    documentId, date: '2026-04-02', username: 'inv',
  });

  const over = await errorCodeOf(() => pay(3500000));
  if (over !== 'TREASURY_AMOUNT_EXCEEDS_DOCUMENT_REMAINING') problems.push(`a payment of 3,500,000 to a document of 3,000,000 was not refused (${over ?? 'accepted'})`);
  const first = await pay(2000000);
  const second = await errorCodeOf(() => pay(1000001));
  if (second !== 'TREASURY_AMOUNT_EXCEEDS_DOCUMENT_REMAINING') problems.push(`a payment one rial above the remaining 1,000,000 was not refused (${second ?? 'accepted'})`);
  const rest = await refusalOf(() => pay(1000000));
  if (rest !== null) problems.push(`paying exactly the remaining 1,000,000 was refused: ${rest}`);

  // a payment on account cannot be moved onto the settled document either
  const onAccount = await pay(500000, null);
  const { relinkTreasuryDocument } = await import('../../services/accounting/treasury/treasuryDocumentRelink.js');
  const relinked = await errorCodeOf(() => relinkTreasuryDocument({ id: onAccount.id, documentId: purchase, username: 'inv' }));
  if (relinked !== 'TREASURY_AMOUNT_EXCEEDS_DOCUMENT_REMAINING') problems.push(`moving a payment onto a settled document was not refused (${relinked ?? 'accepted'})`);

  // voiding the first payment frees its 2,000,000 again
  await TreasuryTransactionService.voidTreasuryTransaction(first.id, { reason: 'TD-938', username: 'inv' });
  const again = await refusalOf(() => pay(2000000));
  if (again !== null) problems.push(`after voiding a payment its amount could not be paid again: ${again}`);

  const paid = await pool.query<{ n: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS n FROM treasury_transactions
      WHERE document_id = $1 AND is_deleted = 0 AND status = 'completed' AND reversal_of_id IS NULL`, [purchase]);
  if (!fin(paid.rows[0]?.n ?? 0).equals(3000000)) problems.push(`the live payments of the document sum to ${paid.rows[0]?.n}, expected 3,000,000`);
  const [link] = await orm.select({ documentId: treasuryTransactions.documentId }).from(treasuryTransactions)
    .where(and(eq(treasuryTransactions.id, onAccount.id), eq(treasuryTransactions.isDeleted, 0)));
  if (link?.documentId !== null) problems.push(`the refused relink moved the payment to document ${link?.documentId}`);
  return problems;
}

export const PAYROLL_SETTLEMENT_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_td_925_salary_settlement_via_payslip', 'v10.0.22: salary is settled only through the payslip payment; a treasury settlement payment to personnel is refused (TD-925)',
    () => checkSalarySettlementOnlyThroughPayslip(), 'treasury settlement refused with nothing written; the payslip paid once; a settlement receipt accepted'],
  ['inv_td_926_deducted_advance_not_voided', 'v10.0.23: an advance a live payslip deducted is not voided; one not deducted, or after its payslip is deleted, is (TD-926)',
    () => checkDeductedAdvanceNotVoided(), 'void refused with 409 and nothing changed; the spare advance and the advance after the payslip delete voided; 1301 back to 0'],
  ['inv_td_938_settlement_within_document_remaining', 'v10.0.24: a treasury row linked to a document is at most its remaining amount, on create and on relink (TD-938)',
    (wh) => checkSettlementWithinDocumentRemaining(wh), 'overpayments refused on create and relink; the exact remainder and a payment freed by a void accepted'],
];
