import { and, eq } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm, pool } from '../../db/drizzle.js';
import { accounts, treasuryTransactions } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';

/**
 * v10.1.63 (OBS-PR-11, decision ت۴۰ item 13): a bank account whose ledger differs from its treasury balance only by the
 * draft vouchers of its own receipts and payments is «در انتظار تأیید سند» (`pending_approval`), not a discrepancy. On
 * v10.1.62 every new receipt showed the account as «مغایرت دفتری» until an accountant approved its draft voucher.
 */
export async function runBankPendingApprovalTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_bank_pending_approval_obs_pr_11';
  if (!shouldRun(id, 'obs-pr-11', 'treasury', 'bank', 'pending', 'reconciliation')) return results;

  const name = 'v10.1.63: a bank account that only waits for its draft vouchers is «در انتظار تأیید سند», and a real difference is still a discrepancy (OBS-PR-11)';
  const tStart = Date.now();
  try {
    const stamp = `${Date.now().toString().slice(-7)}`;
    const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1003'), eq(accounts.isDeleted, 0)));
    const [ledger] = await orm.insert(accounts).values({
      code: `1003${stamp}9`, name: `OBS-PR-11 bank ledger ${stamp}`, level: 'subsidiary', parentId: parent?.id ?? null,
      accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
    }).returning({ id: accounts.id });
    const bank = await BankAccountService.createBankAccount({ title: `OBS-PR-11 bank ${stamp}`, type: 'bank', accountId: ledger.id, initialBalance: 0, currency: 'IRR' });
    const markRes = await pool.query<{ m: string }>('SELECT COALESCE(MAX(id), 0)::text AS m FROM journal_vouchers');
    const mark = Number(markRes.rows[0].m);
    const statusOf = async () => (await BankAccountService.getBankAccounts()).find(b => b.id === bank.id)?.syncStatus;
    const wrong: string[] = [];

    await TreasuryTransactionService.createTreasuryTransaction({
      type: 'receipt', method: 'bank_transfer', amount: 1500000, bankAccountId: bank.id, partyType: 'customer',
      partyName: 'مشتری آزمون انتظار تأیید', date: '2026-04-01', username: 'inv',
    });
    const pending = await statusOf();
    if (pending !== 'pending_approval') wrong.push(`with only a draft voucher the account is ${pending}, expected pending_approval`);
    const report = await BankAccountService.getBankReconciliationReport();
    if (report.accounts.find(b => b.id === bank.id)?.syncStatus !== 'pending_approval') wrong.push('the reconciliation report does not show the account as pending_approval');
    if ((report.pendingApprovalCount ?? 0) < 1) wrong.push(`the reconciliation report counts ${report.pendingApprovalCount} accounts waiting for approval`);

    const drafts = await pool.query<{ id: number }>(`SELECT id FROM journal_vouchers WHERE id > $1 AND is_deleted = 0 AND status = 'draft'`, [mark]);
    await VoucherService.approveJournalVouchers(drafts.rows.map(r => r.id), undefined, 'inv');
    const approved = await statusOf();
    if (approved !== 'synced') wrong.push(`after approval the account is ${approved}, expected synced`);

    // a treasury row without any voucher is a real difference, approved or not
    await orm.insert(treasuryTransactions).values({
      transactionNumber: `OBS-PR-11-${stamp}`, type: 'receipt', date: '2026-04-02', method: 'cash', amount: money(200000), currency: 'IRR',
      bankAccountId: bank.id, partyType: 'customer', partyName: 'مشتری آزمون مغایرت', status: 'completed',
    });
    const discrepant = await statusOf();
    if (discrepant !== 'discrepant') wrong.push(`a treasury row without a voucher leaves the account ${discrepant}, expected discrepant`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'draft only: pending_approval; approved: synced; row without voucher: discrepant',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
  return results;
}
