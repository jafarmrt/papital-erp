import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, bankAccounts } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { ChequeLifecycleService } from '../../services/accounting/treasury/chequeLifecycle.service.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { checkBankInvariants } from './bankInvariants.js';

/** Package 4 (series 9) strict checks for the business_invariants suite: [id, name, check, success text] */

let seq = 0;
const tag = (prefix: string) => `${prefix}${Date.now().toString().slice(-7)}${++seq}`;

/** A bank with a ledger account of its own under 1003, so other tests' banks never touch its ledger rows */
async function bankWithOwnLedger(title: string, initialBalance = 0) {
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1003'), eq(accounts.isDeleted, 0)));
  const [ledger] = await orm.insert(accounts).values({
    code: `1003${tag('')}`, name: `${title} (test ledger)`, level: 'subsidiary', parentId: parent?.id ?? null,
    accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  return BankAccountService.createBankAccount({ title: `${title} ${tag('B')}`, type: 'bank', accountId: ledger.id, initialBalance, currency: 'IRR' });
}

/**
 * v9.0.67 (TD-499, decision t1 «الف»): everyday treasury flows keep the bank invariants I15 / I16 — receipt, payment,
 * transfer, void, a cleared received cheque and an opening balance (draft vouchers count, TD-252) — and voiding a reversal
 * row is refused, so a receipt voided with its draft voucher never comes back to the bank without a voucher.
 */
export async function checkTreasuryFlowsKeepBankInvariants(): Promise<string[]> {
  const problems: string[] = [];
  const main = await bankWithOwnLedger('Bank invariant main');
  const other = await bankWithOwnLedger('Bank invariant other');
  const opening = await bankWithOwnLedger('Bank invariant opening', 2000000);
  const base = { method: 'bank_transfer' as const, partyType: 'other' as const, partyName: 'bank invariant test', date: '2026-04-01', username: 'inv' };
  const receipt = await TreasuryTransactionService.createTreasuryTransaction({ ...base, type: 'receipt', amount: 3000000, bankAccountId: main.id });
  const payment = await TreasuryTransactionService.createTreasuryTransaction({ ...base, type: 'payment', amount: 1000000, bankAccountId: main.id });
  await TreasuryTransactionService.createTreasuryTransfer({ amount: 500000, fromBankAccountId: main.id, toBankAccountId: other.id, date: '2026-04-02', username: 'inv' });
  const reversal = await TreasuryTransactionService.voidTreasuryTransaction(payment.id, { reason: 'bank invariant test', username: 'inv' });
  try {
    await TreasuryTransactionService.voidTreasuryTransaction(reversal.id, { reason: 'revive', username: 'inv' });
    problems.push('voiding a reversal row was accepted');
  } catch (err) {
    if (!getErrorMessage(err).includes('تراکنش تازه')) problems.push(`voiding a reversal row failed with an unexpected error: ${getErrorMessage(err)}`);
  }
  const cheque = await ChequeLifecycleService.createCheque({
    type: 'received', chequeNumber: tag('I'), bankName: 'ملت', issueDate: '2026-03-01', dueDate: '2026-04-01', amount: 700000,
    partyName: 'bank invariant customer', username: 'inv',
  });
  await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'passed', bankAccountId: main.id, actionDate: '2026-04-03', username: 'inv' });
  if (!receipt.voucherId) problems.push('the receipt got no voucher');
  // main: 3,000,000 − 500,000 (transfer) + 700,000 (cheque) = 3,200,000; the voided payment nets to 0
  const [mainRow] = await orm.select({ current: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, main.id));
  if (!fin(mainRow?.current ?? 0).equals(3200000)) problems.push(`main bank balance ${mainRow?.current}, expected 3,200,000`);
  for (const v of await checkBankInvariants([main.id, other.id, opening.id])) problems.push(`${v.invariant} ${v.key}: expected ${v.expected ?? '-'}, actual ${v.actual ?? '-'}`);
  return problems;
}

export const TREASURY_BANK_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_td_499_bank_invariants_hold', 'v9.0.67: receipts, payments, transfers, voids, a cleared cheque and an opening balance keep every bank equal to its ledger rows (I15) with no revived row without a voucher (I16); voiding a reversal row is refused (TD-499)',
    () => checkTreasuryFlowsKeepBankInvariants(), 'bank invariants I15 and I16 held on three banks; the reversal row could not be voided'],
];
