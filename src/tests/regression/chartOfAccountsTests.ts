import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, journalVoucherItems } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { AccountingReportService } from '../../services/accounting/accountingReport.service.js';
import { FinancialHealthService } from '../../services/accounting/financialHealth.service.js';
import { TestCaseResult } from '../types.js';
import {
  type ShouldRun, accountIdsByCode, amountOf, assertNoProblems, inFiscalSandbox, postApproved, runCase, sandboxAdminClient,
} from './fiscalClosingTests.js';

/**
 * Package 3 PR «ه»: the chart of accounts (decision t4 «الف»). Each scenario runs in its own isolated schema with the
 * standard chart of accounts and is red on the version before its fix.
 */

type AdminClient = Awaited<ReturnType<typeof sandboxAdminClient>>;

async function createSubsidiary(admin: AdminClient, code: string, name: string, parentId: number, accountType = 'expense', nature = 'debit'): Promise<number> {
  const res = await admin.post('/api/accounting/accounts', { code, name, level: 'subsidiary', parentId, accountType, nature });
  if (res.status !== 201) throw new Error(`creating account ${code} answered ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  return Number(res.body.id);
}

async function accountRow(id: number) {
  const [row] = await orm.select({ id: accounts.id, isDeleted: accounts.isDeleted, name: accounts.name, accountType: accounts.accountType })
    .from(accounts).where(eq(accounts.id, id));
  return row;
}

async function activeRowsOn(accountId: number): Promise<number> {
  const rows = await orm.select({ id: journalVoucherItems.id }).from(journalVoucherItems)
    .where(and(eq(journalVoucherItems.accountId, accountId), eq(journalVoucherItems.isDeleted, 0)));
  return rows.length;
}

export async function runChartOfAccountsTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const deleteId = 'reg_account_with_voucher_rows_not_deleted_td_546';
  if (shouldRun(deleteId, 'td546', 'account', 'chart', 'package3')) {
    await runCase(results, deleteId, 'v9.0.197: an account with voucher rows of any status is not deleted (409), a new account with a deleted code gets a new id instead of reviving the old row, and the health check lists deleted accounts that still carry rows (TD-546)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const acc = await accountIdsByCode('70', '1001');
      const today = await businessTodayIsoDate();

      // 1) B03-04 S03: expense 7091 with an approved voucher of 700,000 was deleted (200) and the trial balance lost its debit
      const posted = await createSubsidiary(admin, '7091', 'TD-546 rent', acc['70']);
      await postApproved(today, posted, acc['1001'], 700_000, 'TD-546 approved row');
      const delPosted = await admin.del(`/api/accounting/accounts/${posted}`);
      if (delPosted.status !== 409 || delPosted.body?.code !== 'ACCOUNT_HAS_VOUCHER_ROWS') {
        problems.push(`deleting an account with an approved row answered ${delPosted.status} ${JSON.stringify(delPosted.body).slice(0, 200)}, expected 409 ACCOUNT_HAS_VOUCHER_ROWS`);
      }
      if ((await accountRow(posted))?.isDeleted !== 0) problems.push('the refused account was deleted anyway');
      const tb = await AccountingReportService.getTrialBalance({ level: 'subsidiary', endDate: today });
      const debit = tb.reduce((s, r) => s + amountOf(r.debitBalance), 0);
      const credit = tb.reduce((s, r) => s + amountOf(r.creditBalance), 0);
      if (debit !== credit || debit !== 700_000) problems.push(`trial balance after the refused delete: debit ${debit}, credit ${credit}, expected 700,000 each`);

      // 2) a draft row counts too: «with any status»
      const drafted = await createSubsidiary(admin, '7092', 'TD-546 draft only', acc['70']);
      await VoucherService.createJournalVoucher({
        date: today, voucherType: 'general', status: 'draft', description: 'TD-546 draft row', referenceModule: 'manual',
        items: [{ accountId: drafted, debit: 50_000, credit: 0 }, { accountId: acc['1001'], debit: 0, credit: 50_000 }],
      });
      const delDraft = await admin.del(`/api/accounting/accounts/${drafted}`);
      if (delDraft.status !== 409 || delDraft.body?.code !== 'ACCOUNT_HAS_VOUCHER_ROWS') problems.push(`deleting an account with a draft row answered ${delDraft.status}, expected 409`);
      else if (!String(delDraft.body?.error ?? delDraft.body?.message ?? '').includes('غیرفعال')) problems.push(`the refusal does not point to deactivation: ${JSON.stringify(delDraft.body).slice(0, 200)}`);

      // 3) an unused account is still deleted, and its code then makes a new row (was the same id with the new name and type)
      const unused = await createSubsidiary(admin, '7093', 'TD-546 unused', acc['70']);
      const delUnused = await admin.del(`/api/accounting/accounts/${unused}`);
      if (delUnused.status !== 200) problems.push(`deleting an unused account answered ${delUnused.status} ${JSON.stringify(delUnused.body).slice(0, 160)}`);
      const reused = await createSubsidiary(admin, '7093', 'TD-546 scrap sales', acc['70'], 'revenue', 'credit').catch((err: Error) => { problems.push(err.message); return 0; });
      if (reused === unused) problems.push(`the deleted code 7093 revived account ${unused} instead of making a new one`);
      if ((await accountRow(unused))?.isDeleted !== 1) problems.push('the deleted account 7093 is no longer deleted');

      // 4) an account deleted with rows by an earlier version: the new account with its code does not inherit the rows,
      //    and the health check lists the deleted one
      const legacy = await createSubsidiary(admin, '7094', 'TD-546 legacy', acc['70']);
      await postApproved(today, legacy, acc['1001'], 300_000, 'TD-546 legacy row');
      await orm.update(accounts).set({ isDeleted: 1 }).where(eq(accounts.id, legacy));
      const successor = await createSubsidiary(admin, '7094', 'TD-546 successor', acc['70'], 'revenue', 'credit').catch((err: Error) => { problems.push(err.message); return 0; });
      if (successor === legacy) problems.push(`the deleted code 7094 revived account ${legacy} with its voucher row`);
      else if (successor && await activeRowsOn(successor) !== 0) problems.push(`the new account 7094 carries ${await activeRowsOn(successor)} voucher rows`);
      const report = await FinancialHealthService.runHealthCheck();
      const health = report.tests.find(t => t.id === 'deleted_accounts_with_voucher_rows');
      const listed = (health?.items ?? []).map(i => Number(i.id));
      if (!health || health.status !== 'warning' || JSON.stringify(listed) !== JSON.stringify([legacy])) {
        problems.push(`health check deleted_accounts_with_voucher_rows: ${health?.status} ${JSON.stringify(listed)}, expected warning with ${legacy} only`);
      }

      assertNoProblems(problems);
      return 'Accounts with approved or draft rows refused (409), the trial balance kept, an unused account deleted, its code reused as a new id, and the legacy deleted account with rows listed by the health check.';
    }));
  }

  return results;
}
