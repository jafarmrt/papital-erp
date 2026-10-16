import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, journalVoucherItems } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { FiscalYearService } from '../../services/accounting/fiscalYear.service.js';
import { FinancialHealthService } from '../../services/accounting/financialHealth.service.js';
import { getErrorMessage } from '../../utils.js';
import type { TestCaseResult } from '../types.js';
import {
  accountIdsByCode, assertNoProblems, inFiscalSandbox, postApproved, runCase, sandboxAdminClient, type ShouldRun,
} from './fiscalClosingTests.js';

/**
 * v10.1.45 closing sweep, accounting server observations of package 3: each test is red on v10.1.44.
 */
export async function runAccountingSweepTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const toleranceId = 'reg_health_voucher_balance_tolerance_obs_r1_42';
  if (shouldRun(toleranceId, 'obs-r1-42', 'health', 'voucher', 'balance')) {
    await runCase(results, toleranceId, 'v10.1.45: the financial health check lists a voucher off by 0.03, the same tolerance (0.01) every voucher path uses (OBS-R1-42)', async () => inFiscalSandbox(async () => {
      const acc = await accountIdsByCode('1001', '4001');
      const voucherId = await postApproved('2016-04-10', acc['1001'], acc['4001'], 1_000_000, 'OBS-R1-42 voucher');
      // a legacy voucher whose credit row is 0.03 short (no service writes one today)
      await orm.update(journalVoucherItems).set({ credit: money('999999.97') })
        .where(and(eq(journalVoucherItems.voucherId, voucherId), sql`${journalVoucherItems.credit} > 0`));
      const report = await FinancialHealthService.runHealthCheck();
      const test = report.tests.find(t => t.id === 'vouchers_balance');
      assertNoProblems(test?.status === 'error' && test.count === 1 ? [] : [`vouchers_balance is ${test?.status} with ${test?.count} voucher(s), expected error with 1`]);
      return 'a voucher off by 0.03 is listed as unbalanced';
    }));
  }

  const limitId = 'reg_voucher_list_limit_obs_r1_43';
  if (shouldRun(limitId, 'obs-r1-43', 'voucher', 'list', 'limit')) {
    await runCase(results, limitId, 'v10.1.45: the voucher list refuses a page larger than the 100 rows it reads with 400 (OBS-R1-43)', async () => inFiscalSandbox(async () => {
      const admin = await sandboxAdminClient();
      const big = await admin.get('/api/accounting/vouchers?page=1&limit=101');
      const max = await admin.get('/api/accounting/vouchers?page=1&limit=100');
      assertNoProblems([
        ...(big.status === 400 ? [] : [`limit=101 answered ${big.status}, expected 400`]),
        ...(max.status === 200 && max.body?.limit === 100 ? [] : [`limit=100 answered ${max.status} with limit ${max.body?.limit}`]),
      ]);
      return 'limit 101 is 400, limit 100 reads 100';
    }));
  }

  const closingId = 'reg_fiscal_closing_accounts_in_tx_obs_r1_48';
  if (shouldRun(closingId, 'obs-r1-48', 'fiscal', 'closing', 'account')) {
    await runCase(results, closingId, 'v10.1.45: a refused fiscal-year closing leaves no summary profit and loss or retained earnings account behind (OBS-R1-48)', async () => inFiscalSandbox(async () => {
      const acc = await accountIdsByCode('1001', '4001');
      await postApproved('2016-04-10', acc['1001'], acc['4001'], 1_000_000, 'OBS-R1-48 capital');
      await VoucherService.createJournalVoucher({
        date: '2016-05-10', voucherType: 'general', status: 'draft', description: 'OBS-R1-48 draft', referenceModule: 'manual',
        items: [
          { accountId: acc['1001'], debit: 1000, credit: 0, description: 'draft' },
          { accountId: acc['4001'], debit: 0, credit: 1000, description: 'draft' },
        ],
      });
      // the mapped accounts are gone, so the closing has to make them
      await orm.update(accounts).set({ isDeleted: 1 }).where(sql`${accounts.code} IN ('4301', '4201')`);
      let refused = '';
      try {
        await FiscalYearService.executeFiscalYearClosing({ year: 1395, createOpeningVoucher: true, username: 'reg' });
      } catch (err) {
        refused = getErrorMessage(err);
      }
      const made = await orm.select({ code: accounts.code }).from(accounts)
        .where(and(eq(accounts.isDeleted, 0), sql`${accounts.code} IN ('4301', '4201')`));
      assertNoProblems([
        ...(refused ? [] : ['the closing with a draft voucher was not refused']),
        ...(made.length === 0 ? [] : [`the refused closing left account(s) ${made.map(m => m.code).join(', ')}`]),
      ]);
      return 'the refused closing created no account';
    }));
  }

  return results;
}
