import { eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, appSettings, bankAccounts, journalVoucherItems, journalVouchers, productionProjects } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { AccountingReportService } from '../../services/accounting/accountingReport.service.js';
import { AccountMappingService } from '../../services/accounting/accountMapping.service.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Series 10 phase 3 lane L1, package A4 (v10.0.251): project reports, the cash-and-bank card and the account mapping read.
 * Each test is red on the version before its fix.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;

async function runCase(results: TestCaseResult[], id: string, name: string, body: () => Promise<string>): Promise<void> {
  const tStart = Date.now();
  try {
    const details = await body();
    results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

function assertNoProblems(problems: string[]): void {
  if (problems.length > 0) throw new Error(problems.join(' | '));
}

async function anyPostingAccountIds(): Promise<[number, number]> {
  const rows = await orm.select({ id: accounts.id }).from(accounts)
    .where(sql`${accounts.isDeleted} = 0 AND ${accounts.level} IN ('subsidiary', 'detailed')`).orderBy(accounts.id).limit(2);
  if (rows.length < 2) throw new Error('chart of accounts has fewer than two posting accounts');
  return [rows[0].id, rows[1].id];
}

/** One voucher of the given status with a project debit row (in its currency and rate) and a plain credit row */
async function postProjectRow(opts: {
  date: string; status: string; projectId: number; debitAccountId: number; creditAccountId: number;
  amount: number; currency: string; rate: number; description: string;
}): Promise<void> {
  const voucherNumber = Number((await orm.execute(sql`SELECT nextval('journal_voucher_number_seq')::text AS n`)).rows[0].n);
  const rial = opts.amount * opts.rate;
  const [v] = await orm.insert(journalVouchers).values({
    voucherNumber, date: opts.date, voucherType: 'general', status: opts.status, description: opts.description,
    totalDebit: money(rial), totalCredit: money(rial), isDeleted: 0,
  }).returning({ id: journalVouchers.id });
  await orm.insert(journalVoucherItems).values([
    {
      voucherId: v.id, accountId: opts.debitAccountId, debit: money(opts.amount), credit: money(0), rowOrder: 1,
      detailedType: 'project', detailedId: opts.projectId, currency: opts.currency, exchangeRate: money(opts.rate),
    },
    {
      voucherId: v.id, accountId: opts.creditAccountId, debit: money(0), credit: money(opts.amount), rowOrder: 2,
      currency: opts.currency, exchangeRate: money(opts.rate),
    },
  ]);
}

export async function runAccountingP2ReportTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const projectId = 'reg_project_report_status_and_currency_td_966';
  if (shouldRun(projectId, 'td966', 'project', 'accounting', 'a4')) {
    await runCase(results, projectId, 'v10.0.251: the project summary and detail count approved and permanent vouchers only and a foreign row in rials at its own rate (TD-966)', async () => {
      const problems: string[] = [];
      const tag = tagOf();
      const today = await businessTodayIsoDate();
      const [project] = await orm.insert(productionProjects).values({ projectCode: `TD966-${tag}`, title: `Project report ${tag}` })
        .returning({ id: productionProjects.id });
      const [debitId, creditId] = await anyPostingAccountIds();
      const base = { date: today, projectId: project.id, debitAccountId: debitId, creditAccountId: creditId };
      await postProjectRow({ ...base, status: 'approved', amount: 1_000_000, currency: 'IRR', rate: 1, description: `td966 rial ${tag}` });
      await postProjectRow({ ...base, status: 'permanent', amount: 2, currency: 'USD', rate: 500_000, description: `td966 usd ${tag}` });
      await postProjectRow({ ...base, status: 'draft', amount: 7_000_000, currency: 'IRR', rate: 1, description: `td966 draft ${tag}` });

      const summary = (await AccountingReportService.getProjectSummaryReport()).find(r => r.projectId === project.id);
      if (!summary) {
        problems.push('project missing from the summary');
      } else {
        if (summary.entriesCount !== 2) problems.push(`summary entries ${summary.entriesCount}, expected 2 (draft left out)`);
        if (summary.totalDebit !== 2_000_000) problems.push(`summary debit ${summary.totalDebit}, expected 2000000 (1,000,000 + 2 USD x 500,000)`);
      }
      const detail = await AccountingReportService.getProjectDetailReport(project.id);
      if (detail.length !== 2) problems.push(`detail rows ${detail.length}, expected 2`);
      const last = detail[detail.length - 1];
      if (last && Number(last.runningBalance) !== 2_000_000) problems.push(`detail running balance ${last.runningBalance}, expected 2000000`);
      assertNoProblems(problems);
      return 'drafts are left out and a USD row counts at its rate in both project reports';
    });
  }

  const cashId = 'reg_cash_and_bank_per_currency_td_967';
  if (shouldRun(cashId, 'td967', 'treasury', 'dashboard', 'accounting', 'a4')) {
    await runCase(results, cashId, 'v10.0.251: the accounting dashboard sums cash and bank per currency and its rial total holds no foreign balance (TD-967)', async () => {
      const problems: string[] = [];
      const tag = tagOf();
      const before = await AccountingReportService.getFinancialOverviewStats();
      const usdBefore = before.cashAndBankByCurrency?.find(c => c.currency === 'USD')?.amount ?? 0;
      await orm.insert(bankAccounts).values({ code: `TD967-${tag}`, title: `USD box ${tag}`, type: 'cash', currency: 'USD', initialBalance: money(1_000) });
      const after = await AccountingReportService.getFinancialOverviewStats();
      if (Number(after.totalCashAndBank) !== Number(before.totalCashAndBank)) {
        problems.push(`rial total moved from ${before.totalCashAndBank} to ${after.totalCashAndBank} on a USD balance`);
      }
      const usdAfter = after.cashAndBankByCurrency?.find(c => c.currency === 'USD')?.amount;
      if (usdAfter !== usdBefore + 1_000) problems.push(`USD total ${usdAfter}, expected ${usdBefore + 1_000}`);
      const listed = (after.cashAndBankByCurrency ?? []).map(c => c.currency);
      if (listed.includes('IRR') && listed[0] !== 'IRR') problems.push(`currencies listed as ${listed.join(',')}, IRR not first`);
      assertNoProblems(problems);
      return 'foreign treasury balances are listed per currency and never added to rials';
    });
  }

  const mappingId = 'reg_account_mapping_unreadable_refused_td_968';
  if (shouldRun(mappingId, 'td968', 'mapping', 'accounting', 'a4')) {
    await runCase(results, mappingId, 'v10.0.251: an unreadable stored account mapping is refused with ACCOUNT_MAPPING_UNREADABLE, never replaced with the defaults (TD-968)', async () => {
      const problems: string[] = [];
      const keys = ['accounting_account_mappings', 'accounting_mappings_disabled'];
      const saved = await orm.select().from(appSettings).where(sql`${appSettings.key} IN ('accounting_account_mappings', 'accounting_mappings_disabled')`);
      const write = async (key: string, value: string) => {
        await orm.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
      };
      const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
        try {
          await fn();
          return 'no error';
        } catch (err) {
          return (err as { code?: string }).code ?? 'error without code';
        }
      };
      try {
        await write(keys[0], '{not json');
        const broken = await codeOf(() => AccountMappingService.getMappings());
        if (broken !== 'ACCOUNT_MAPPING_UNREADABLE') problems.push(`broken JSON mappings gave ${broken}`);
        await write(keys[0], '[1,2]');
        const notObject = await codeOf(() => AccountMappingService.getMappings());
        if (notObject !== 'ACCOUNT_MAPPING_UNREADABLE') problems.push(`array mappings gave ${notObject}`);
        await write(keys[0], '{}');
        const fine = await codeOf(() => AccountMappingService.getMappings());
        if (fine !== 'no error') problems.push(`empty object mappings gave ${fine}`);
        await write(keys[1], '{"a":1}');
        const disabled = await codeOf(() => AccountMappingService.getDisabledMappings());
        if (disabled !== 'ACCOUNT_MAPPING_UNREADABLE') problems.push(`object disabled list gave ${disabled}`);
      } finally {
        for (const key of keys) {
          const old = saved.find(s => s.key === key);
          if (old) await write(key, old.value ?? '');
          else await orm.delete(appSettings).where(eq(appSettings.key, key));
        }
      }
      assertNoProblems(problems);
      return 'unreadable mappings and disabled lists stop the read with ACCOUNT_MAPPING_UNREADABLE';
    });
  }

  return results;
}
