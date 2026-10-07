import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { journalVouchers } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { jalaliYearBounds } from '../../utils/calendarDate.js';
import { ChartOfAccountsService } from '../../services/accounting/chartOfAccounts.service.js';
import { FiscalPeriodService } from '../../services/accounting/fiscalPeriod.service.js';
import { FiscalYearService } from '../../services/accounting/fiscalYear.service.js';
import { AccountingReportService } from '../../services/accounting/accountingReport.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { setupTestSchema, withIsolatedTestSchema } from '../setup/testDb.js';
import { createTestRole, createTestUser } from '../fixtures/factories.js';
import { migrationsCopyUpTo, runMigrationsIn } from '../recovery/migrationChecks.js';
import { REPO_ROOT } from '../recovery/scratchDatabase.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Package 3 (accounting and money core), PR «ب» fiscal-year closing. Closing a year touches the whole ledger and, from
 * this PR on, depends on which earlier years are closed, so every scenario runs in its own isolated schema with the
 * standard chart of accounts. Each test is red on the version before its fix.
 */

export type ShouldRun = (id: string, ...extra: string[]) => boolean;

export async function runCase(results: TestCaseResult[], id: string, name: string, body: () => Promise<string>): Promise<void> {
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

export function assertNoProblems(problems: string[]): void {
  if (problems.length > 0) throw new Error(problems.join(' | '));
}

/** A fresh schema with the standard chart of accounts; the fiscal period cache and the HTTP admin session stay inside it */
export async function inFiscalSandbox<T>(fn: () => Promise<T>): Promise<T> {
  FiscalPeriodService.resetCache();
  try {
    return await withIsolatedTestSchema(async () => {
      try {
        await ChartOfAccountsService.seedStandardAccounts();
        return await fn();
      } finally {
        const { cleanupHttpTestUsers } = await import('../fixtures/httpTestHelper.js');
        await cleanupHttpTestUsers();
      }
    });
  } finally {
    FiscalPeriodService.resetCache();
  }
}

export async function sandboxAdminClient() {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const s = await getAdminSession();
  return {
    get: (url: string) => request(app).get(url).set('Cookie', s.cookie),
    post: (url: string, body: unknown) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body as object),
    put: (url: string, body: unknown) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body as object),
    del: (url: string) => request(app).delete(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
  };
}

/** A logged-in user whose role holds exactly these permissions (inside the sandbox) */
export async function sandboxClientWith(permissions: string[]) {
  const { getTestApp, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const role = await createTestRole({ permissions });
  const user = await createTestUser({ role: role.code });
  const s = await loginTestUserWithSession(app, user.username);
  return {
    get: (url: string) => request(app).get(url).set('Cookie', s.cookie),
    post: (url: string, body: unknown) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body as object),
  };
}

export async function accountIdsByCode(...codes: string[]): Promise<Record<string, number>> {
  const all = await ChartOfAccountsService.getAllAccounts();
  const out: Record<string, number> = {};
  for (const code of codes) {
    const acc = all.find(a => a.code === code);
    if (!acc) throw new Error(`standard account ${code} is missing`);
    out[code] = acc.id;
  }
  return out;
}

/** An approved two-row voucher through the voucher service */
export async function postApproved(date: string, debitAccountId: number, creditAccountId: number, amount: number, description: string): Promise<number> {
  const v = await VoucherService.createJournalVoucher({
    date, voucherType: 'general', status: 'approved', description, referenceModule: 'manual',
    items: [
      { accountId: debitAccountId, debit: amount, credit: 0, description },
      { accountId: creditAccountId, debit: 0, credit: amount, description },
    ],
  });
  return v.id;
}

export function yearBounds(year: number): { firstDay: string; lastDay: string; nextFirstDay: string } {
  const b = jalaliYearBounds(year);
  if (!b) throw new Error(`no bounds for year ${year}`);
  return b;
}

export const amountOf = (value: unknown) => fin(value as number ?? 0).toNumber();

export async function runFiscalClosingTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const reportsId = 'reg_reports_exclude_year_end_closing_td_545';
  if (shouldRun(reportsId, 'td545', 'fiscal', 'closing', 'accounting', 'package3')) {
    await runCase(results, reportsId, 'v9.0.120: after a year is closed, its income statement, balance sheet, trial balance and ratios up to its last day leave the closing vouchers out unless "include closing vouchers" is ticked; opening and manual closing-type vouchers still count (TD-545)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const year = 1395;
      const { firstDay, lastDay, nextFirstDay } = yearBounds(year);
      const acc = await accountIdsByCode('1001', '1201', '4001', '5001', '7002');
      // B03-03 example S01: capital 10,000,000 in cash, a credit sale of 5,000,000, rent 1,200,000 in cash
      await postApproved('2016-04-10', acc['1001'], acc['4001'], 10_000_000, 'TD-545 capital');
      await postApproved('2016-08-01', acc['1201'], acc['5001'], 5_000_000, 'TD-545 credit sale');
      await postApproved('2016-10-01', acc['7002'], acc['1001'], 1_200_000, 'TD-545 rent');
      // a manual voucher saved as type «closing» on the year's last day (the old form saved opening balances that way):
      // it is not the closing run's voucher and keeps counting
      const legacy = await postApproved(lastDay, acc['1001'], acc['4001'], 500_000, 'TD-545 manual closing-type voucher');
      await orm.update(journalVouchers).set({ voucherType: 'closing' }).where(eq(journalVouchers.id, legacy));

      const closed = await FiscalYearService.executeFiscalYearClosing({ year, createOpeningVoucher: true, username: 'reg' });
      const expectDefault = { revenue: 5_000_000, net: 3_800_000, assets: 14_300_000, credit5001: 5_000_000 };
      for (const includeClosing of [false, true]) {
        const label = includeClosing ? 'with closing vouchers' : 'default';
        const want = (value: number) => includeClosing ? 0 : value;
        const isYear = await AccountingReportService.getIncomeStatement({ startDate: firstDay, endDate: lastDay, includeClosing });
        if (amountOf(isYear.totalRevenue) !== want(expectDefault.revenue) || amountOf(isYear.netProfit) !== want(expectDefault.net)) {
          problems.push(`${label}: income statement ${year} revenue ${isYear.totalRevenue} net ${isYear.netProfit}, expected ${want(expectDefault.revenue)} / ${want(expectDefault.net)}`);
        }
        const isToDate = await AccountingReportService.getIncomeStatement({ endDate: lastDay, includeClosing });
        if (amountOf(isToDate.totalRevenue) !== want(expectDefault.revenue)) problems.push(`${label}: income statement up to ${lastDay} revenue ${isToDate.totalRevenue}`);
        const bs = await AccountingReportService.getBalanceSheet({ date: lastDay, includeClosing });
        if (amountOf(bs.totalAssets) !== want(expectDefault.assets)) problems.push(`${label}: balance sheet ${lastDay} total assets ${bs.totalAssets}, expected ${want(expectDefault.assets)}`);
        const ratios = await AccountingReportService.getFinancialRatios({ asOfDate: lastDay, includeClosing });
        if (amountOf(ratios.totalRevenue) !== want(expectDefault.revenue)) problems.push(`${label}: ratios revenue ${ratios.totalRevenue}`);
        for (const startDate of [undefined, firstDay]) {
          const tb = await AccountingReportService.getTrialBalance({ level: 'subsidiary', startDate, endDate: lastDay, includeClosing });
          const row = tb.find(r => r.code === '5001');
          if (amountOf(row?.creditBalance) !== want(expectDefault.credit5001)) {
            problems.push(`${label}: trial balance ${startDate ?? 'cumulative'}..${lastDay} 5001 credit balance ${row?.creditBalance}, expected ${want(expectDefault.credit5001)}`);
          }
        }
        // the next year: closing and opening are a pair, nothing is counted twice
        const bsNext = await AccountingReportService.getBalanceSheet({ date: nextFirstDay, includeClosing });
        if (amountOf(bsNext.totalAssets) !== expectDefault.assets) problems.push(`${label}: balance sheet ${nextFirstDay} total assets ${bsNext.totalAssets}, expected ${expectDefault.assets}`);
        const isNext = await AccountingReportService.getIncomeStatement({ startDate: nextFirstDay, endDate: nextFirstDay, includeClosing });
        if (amountOf(isNext.totalRevenue) !== 0) problems.push(`${label}: income statement of ${year + 1} carries revenue ${isNext.totalRevenue} of the closed year`);
      }

      // the routes read the box: «همراه اسناد اختتامیه»
      const admin = await sandboxAdminClient();
      const range = `startDate=${firstDay}&endDate=${lastDay}`;
      const routeChecks: Array<[string, (body: Record<string, unknown>) => number, number]> = [
        [`/api/accounting/reports/income-statement?${range}`, b => amountOf(b.totalRevenue), expectDefault.revenue],
        [`/api/accounting/reports/balance-sheet?asOfDate=${lastDay}`, b => amountOf(b.totalAssets), expectDefault.assets],
        [`/api/accounting/reports/financial-ratios?asOfDate=${lastDay}`, b => amountOf(b.totalRevenue), expectDefault.revenue],
        [`/api/accounting/reports/trial-balance?level=subsidiary&${range}`, b => amountOf((b.report as Array<{ code: string; creditBalance: number }>).find(r => r.code === '5001')?.creditBalance), expectDefault.credit5001],
      ];
      for (const [url, read, value] of routeChecks) {
        for (const [suffix, expected] of [['', value], ['&includeClosing=true', 0]] as const) {
          const res = await admin.get(`${url}${suffix}`);
          if (res.status !== 200) problems.push(`${url}${suffix} returned ${res.status}: ${JSON.stringify(res.body).slice(0, 160)}`);
          else if (read(res.body) !== expected) problems.push(`${url}${suffix} gave ${read(res.body)}, expected ${expected}`);
        }
      }
      // the closing run's four vouchers carry the closed year; the manual closing-type voucher does not
      let linked: Array<{ id: number; ref: string | null; year: number | null }> = [];
      try {
        linked = await orm.select({ id: journalVouchers.id, ref: journalVouchers.referenceNumber, year: journalVouchers.sourceFiscalYear })
          .from(journalVouchers).where(eq(journalVouchers.isDeleted, 0));
      } catch (err) {
        problems.push(`voucher links unreadable: ${err instanceof Error ? err.message : String(err)}`);
      }
      const runIds = new Set(closed.closingVouchers.map(v => v.id));
      const runLinks = linked.filter(v => runIds.has(v.id)).map(v => `${v.ref}=${v.year}`).sort();
      const expectedLinks = [`CLOSE-PROFIT-${year}=${year}`, `CLOSE-TEMP-${year}=${year}`, `CLOSING-${year}=${year}`, `OPENING-${year + 1}=${year}`];
      if (JSON.stringify(runLinks) !== JSON.stringify(expectedLinks)) problems.push(`closing run vouchers linked as ${JSON.stringify(runLinks)}, expected ${JSON.stringify(expectedLinks)}`);
      const legacyLink = linked.find(v => v.id === legacy)?.year;
      if (linked.length > 0 && legacyLink !== null) problems.push(`the manual closing-type voucher got source_fiscal_year ${legacyLink}`);

      assertNoProblems(problems);
      return `closed ${year}; reports up to ${lastDay}: revenue ${expectDefault.revenue}, assets ${expectDefault.assets}; with closing vouchers 0`;
    }));
  }

  const manualId = 'reg_manual_voucher_cannot_be_closing_td_559';
  if (shouldRun(manualId, 'td559', 'fiscal', 'closing', 'vouchers', 'package3')) {
    await runCase(results, manualId, 'v9.0.121: a manual voucher takes neither the closing type nor a reserved reference, a manual «CLOSING-<year>» no longer blocks closing that year and legacy manual closing-type vouchers reverse and are listed by the health check (TD-559)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const year = 1395;
      const { firstDay, lastDay } = yearBounds(year);
      const acc = await accountIdsByCode('1001', '4001', '5001');
      const admin = await sandboxAdminClient();
      const body = (extra: Record<string, unknown>) => ({
        date: '2016-05-01', description: 'TD-559 manual voucher', status: 'approved',
        items: [{ accountId: acc['1001'], debit: 1000, credit: 0 }, { accountId: acc['4001'], debit: 0, credit: 1000 }],
        ...extra,
      });
      const refused = async (label: string, res: request.Response, status: number, needle: string) => {
        if (res.status !== status || !JSON.stringify(res.body).includes(needle)) {
          problems.push(`${label}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}, expected ${status} with «${needle}»`);
        }
      };

      await refused('manual closing type', await admin.post('/api/accounting/vouchers', body({ voucherType: 'closing' })), 400, 'بستن سال مالی');
      for (const ref of [' closing-1395', 'REV-V77', 'Corr-V5', 'OPENING-1396']) {
        await refused(`reserved reference «${ref}»`, await admin.post('/api/accounting/vouchers', body({ referenceNumber: ref })), 400, 'رزروشده');
      }
      const opening = await admin.post('/api/accounting/vouchers', body({ voucherType: 'opening', referenceNumber: 'OPEN-BAL-1395', date: firstDay }));
      if (opening.status !== 201 || opening.body?.voucherType !== 'opening') problems.push(`manual opening voucher: ${opening.status} ${opening.body?.voucherType}`);
      const draft = await admin.post('/api/accounting/vouchers', body({ status: 'draft' }));
      await refused('edit a draft to closing type', await admin.put(`/api/accounting/vouchers/${draft.body?.id}`, { voucherType: 'closing' }), 400, 'بستن سال مالی');
      await VoucherService.deleteJournalVoucher(Number(draft.body?.id));

      // legacy rows the old form saved: a manual «CLOSING-1395» and a manual opening saved as closing type
      const legacyClosingRef = await VoucherService.createJournalVoucher({
        date: '2016-06-01', voucherType: 'general', status: 'approved', description: 'TD-559 legacy manual CLOSING ref', referenceModule: 'manual', referenceNumber: `CLOSING-${year}`,
        items: [{ accountId: acc['1001'], debit: 2000, credit: 0 }, { accountId: acc['5001'], debit: 0, credit: 2000 }],
      });
      const legacyOpening = await postApproved(firstDay, acc['1001'], acc['4001'], 3000, 'TD-559 legacy opening saved as closing');
      await orm.update(journalVouchers).set({ voucherType: 'closing' }).where(inArray(journalVouchers.id, [legacyClosingRef.id, legacyOpening]));

      try {
        await FiscalYearService.executeFiscalYearClosing({ year, createOpeningVoucher: true, username: 'reg' });
      } catch (err) {
        problems.push(`closing ${year} with a manual «CLOSING-${year}» voucher was refused: ${err instanceof Error ? err.message : String(err)}`);
      }

      const reversed = await admin.post(`/api/accounting/vouchers/${legacyOpening}/reverse`, { reason: 'TD-559' });
      if (reversed.status !== 201) problems.push(`reversing a legacy manual closing-type voucher: ${reversed.status} ${JSON.stringify(reversed.body).slice(0, 200)}`);

      // the health check lists the legacy manual closing-type vouchers, not the closing run's
      const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');
      const health = await FinancialHealthService.runHealthCheck();
      const listed = health.tests.find(t => t.id === 'manual_vouchers_closing_type');
      const listedIds = (listed?.items ?? []).map(i => Number(i.linkId)).sort((a, b) => a - b);
      const expectedIds = [legacyClosingRef.id, legacyOpening].sort((a, b) => a - b);
      if (JSON.stringify(listedIds) !== JSON.stringify(expectedIds)) problems.push(`health check lists ${JSON.stringify(listedIds)}, expected the legacy vouchers ${JSON.stringify(expectedIds)}`);
      assertNoProblems(problems);
      return `manual closing type and reserved references refused; ${year} closed up to ${lastDay} despite a manual CLOSING-${year}`;
    }));
  }

  const lockedId = 'reg_closing_run_vouchers_locked_td_559';
  if (shouldRun(lockedId, 'td559', 'fiscal', 'closing', 'vouchers', 'package3')) {
    await runCase(results, lockedId, 'v9.0.121: the vouchers a fiscal-year closing issued, its opening voucher included, are neither reversed, corrected nor put back to draft; only reopening the year undoes them (TD-559)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const year = 1395;
      const acc = await accountIdsByCode('1001', '4001', '5001');
      const admin = await sandboxAdminClient();
      await postApproved('2016-05-01', acc['1001'], acc['4001'], 10_000, 'TD-559 capital');
      await postApproved('2016-06-01', acc['1001'], acc['5001'], 4_000, 'TD-559 cash sale');
      const closed = await FiscalYearService.executeFiscalYearClosing({ year, createOpeningVoucher: true, username: 'reg' });
      const refused = async (label: string, res: request.Response) => {
        if (res.status !== 409 || res.body?.code !== 'FISCAL_CLOSING_VOUCHER_LOCKED') {
          problems.push(`${label}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}, expected 409 FISCAL_CLOSING_VOUCHER_LOCKED`);
        }
      };
      const runTemp = closed.closingVouchers.find(v => v.referenceNumber === `CLOSE-TEMP-${year}`);
      const runOpening = closed.closingVouchers.find(v => v.referenceNumber === `OPENING-${year + 1}`);
      await refused('reversing the closing run\'s voucher', await admin.post(`/api/accounting/vouchers/${runTemp?.id}/reverse`, { reason: 'TD-559' }));
      await refused('the closing run\'s opening voucher back to draft', await admin.put(`/api/accounting/vouchers/${runOpening?.id}/status`, { status: 'draft' }));
      await refused('correcting the closing run\'s opening voucher', await admin.post(`/api/accounting/vouchers/${runOpening?.id}/correct`, {
        reason: 'TD-559', newItems: [{ accountId: acc['1001'], debit: 1, credit: 0 }, { accountId: acc['4001'], debit: 0, credit: 1 }],
      }));
      const [opening] = await orm.select({ status: journalVouchers.status }).from(journalVouchers).where(eq(journalVouchers.id, runOpening?.id ?? 0));
      if (opening?.status !== 'approved') problems.push(`the closing run's opening voucher is ${opening?.status}, expected approved`);
      const reversalRows = await orm.select({ id: journalVouchers.id }).from(journalVouchers)
        .where(and(eq(journalVouchers.isDeleted, 0), inArray(journalVouchers.referenceId, [runTemp?.id ?? 0, runOpening?.id ?? 0])));
      if (reversalRows.length > 0) problems.push(`the closing run's vouchers got ${reversalRows.length} reversal or correction vouchers`);
      assertNoProblems(problems);
      return `the closing run of ${year} stays as issued`;
    }));
  }

  const backfillId = 'reg_closing_voucher_year_link_backfill_td_545';
  if (shouldRun(backfillId, 'td545', 'fiscal', 'closing', 'migration', 'package3')) {
    await runCase(results, backfillId, 'v9.0.120: the upgrade links only the vouchers a fiscal-year closing issued to the closed year, not manual vouchers of type closing or a later voucher with the same reference (TD-545)', async () => {
      const problems: string[] = [];
      const fresh = await setupTestSchema({ migrate: async () => ({ success: true, appliedCount: 0, errors: [] }) });
      const q = (text: string) => pool.query(text.replace(/\$S\./g, `"${fresh.schema}".`));
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-p03-mig-'));
      try {
        // the migration before the link column (its number changes when other lanes merge first)
        const journal = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string }> };
        const linkIdx = journal.entries.find(e => e.tag.endsWith('_journal_voucher_source_fiscal_year'))?.idx;
        if (linkIdx === undefined) throw new Error('the journal_voucher_source_fiscal_year migration is missing');
        migrationsCopyUpTo(root, linkIdx - 1);
        const before = await runMigrationsIn(root);
        if (!before.success) throw new Error(`migrations before ${linkIdx} failed: ${before.errors.join('; ')}`);
        await q(`INSERT INTO $S.fiscal_periods (fiscal_year, status) VALUES (1395, 'closed'), (1396, 'open')`);
        const rows: Array<[number, string, string, string, string, number]> = [
          // number, date, type, module, reference, is_deleted
          [880001, '2017-03-20', 'closing', 'manual', 'CLOSE-TEMP-1395', 1], // a deleted earlier run: never linked
          [880002, '2017-03-20', 'closing', 'manual', 'CLOSE-TEMP-1395', 0],
          [880003, '2017-03-20', 'closing', 'manual', 'CLOSE-PROFIT-1395', 0],
          [880004, '2017-03-20', 'closing', 'manual', 'CLOSING-1395', 0],
          [880005, '2017-03-21', 'opening', 'manual', 'OPENING-1396', 0],
          [880006, '2017-03-20', 'closing', 'manual', 'CLOSING-1395', 0], // a later manual voucher with the same reference
          [880007, '2016-03-25', 'closing', 'manual', 'OPEN-BAL', 0], // the old form saved opening balances as «closing»
          [880008, '2018-03-20', 'closing', 'manual', 'CLOSE-TEMP-1396', 0], // year 1396 is open
          [880009, '2017-03-20', 'closing', 'invoice', 'CLOSING-1395', 0], // not the closing run's module
          [880010, '2016-06-01', 'closing', 'manual', 'CLOSE-TEMP-1395', 0], // a later voucher with the run's reference
        ];
        for (const [n, date, type, module, ref, deleted] of rows) {
          await q(`INSERT INTO $S.journal_vouchers (voucher_number, date, description, voucher_type, status, reference_module, reference_number, is_deleted)
                   VALUES (${n}, '${date}', 'td545 backfill', '${type}', 'permanent', '${module}', '${ref}', ${deleted})`);
        }
        migrationsCopyUpTo(root, Number.MAX_SAFE_INTEGER);
        const upgrade = await runMigrationsIn(root);
        if (!upgrade.success) throw new Error(`upgrade failed: ${upgrade.errors.join('; ').slice(0, 300)}`);
        const linked = (await q(`SELECT voucher_number, source_fiscal_year FROM $S.journal_vouchers WHERE voucher_number BETWEEN 880001 AND 880010 ORDER BY 1`)).rows as Array<{ voucher_number: number; source_fiscal_year: number | null }>;
        const got = linked.map(r => `${r.voucher_number}:${r.source_fiscal_year ?? '-'}`).join(',');
        const expected = '880001:-,880002:1395,880003:1395,880004:1395,880005:1395,880006:-,880007:-,880008:-,880009:-,880010:-';
        if (got !== expected) problems.push(`links after upgrade ${got}, expected ${expected}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        await fresh.teardown();
      }
      assertNoProblems(problems);
      return 'only the closing run of 1395 is linked';
    });
  }

  return results;
}
