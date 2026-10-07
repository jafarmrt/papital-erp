import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { activityLogs, fiscalPeriods, journalVouchers } from '../../db/schema.js';
import { businessFiscalYear, businessTodayIsoDate } from '../../lib/businessClock.js';
import { FiscalYearService } from '../../services/accounting/fiscalYear.service.js';
import { AccountingReportService } from '../../services/accounting/accountingReport.service.js';
import { TestCaseResult } from '../types.js';
import {
  type ShouldRun, accountIdsByCode, amountOf, assertNoProblems, inFiscalSandbox, postApproved, runCase, sandboxAdminClient,
  sandboxClientWith, yearBounds,
} from './fiscalClosingTests.js';

/**
 * Package 3 PR «ب»: when a fiscal year may be closed and reopened, and in which order (decisions t1 and t2). Each scenario
 * runs in its own isolated schema with the standard chart of accounts and is red on the version before its fix.
 */
export async function runFiscalYearOrderTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const endedId = 'reg_fiscal_year_close_after_end_and_reopen_td_543';
  if (shouldRun(endedId, 'td543', 'fiscal', 'closing', 'reopen', 'package3')) {
    await runCase(results, endedId, 'v9.0.122: a fiscal year is closed only after its last day, the closing form lists only ended years, and the last closed year is reopened with a reason, its closing vouchers voided and the reopening audited (TD-543)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const acc = await accountIdsByCode('1001', '4001', '5001');
      const admin = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const current = await businessFiscalYear();

      // 1) B03-01: the current year, and the next one, are not closed; today's vouchers keep posting
      await postApproved(today, acc['1001'], acc['5001'], 7_000, 'TD-543 sale today');
      for (const year of [current, current + 1]) {
        const res = await admin.post('/api/accounting/fiscal-closing/execute', { year: String(year), createOpeningVoucher: true });
        if (res.status !== 422 || res.body?.code !== 'FISCAL_YEAR_NOT_ENDED') problems.push(`closing ${year} answered ${res.status} ${JSON.stringify(res.body).slice(0, 160)}, expected 422 FISCAL_YEAR_NOT_ENDED`);
      }
      const notEnded = await FiscalYearService.executeFiscalYearClosing({ year: current, username: 'reg' }).then(() => 'closed', (err: { code?: string }) => err?.code);
      if (notEnded !== 'FISCAL_YEAR_NOT_ENDED') problems.push(`the service closing ${current} gave ${notEnded}`);
      const closedNow = await orm.select({ year: fiscalPeriods.fiscalYear }).from(fiscalPeriods)
        .where(and(inArray(fiscalPeriods.fiscalYear, [current, current + 1]), eq(fiscalPeriods.status, 'closed')));
      if (closedNow.length > 0) problems.push(`years ${closedNow.map(r => r.year).join(', ')} were closed before their end`);
      await postApproved(today, acc['1001'], acc['5001'], 1_000, 'TD-543 sale after the refused closing').catch((err: Error) => problems.push(`a voucher dated today was refused: ${err.message}`));
      const previewNow = await admin.get(`/api/accounting/fiscal-closing/preview?year=${current}`);
      if (previewNow.status !== 200 || previewNow.body?.yearEnded !== false) problems.push(`the preview of ${current} gave ${previewNow.status} yearEnded=${previewNow.body?.yearEnded}, expected false`);

      // 2) two ended years with vouchers, closed in order; the form lists ended years only
      await postApproved('2016-05-01', acc['1001'], acc['4001'], 10_000, 'TD-543 capital 1395');
      await postApproved('2016-06-01', acc['1001'], acc['5001'], 4_000, 'TD-543 sale 1395');
      await postApproved('2017-06-01', acc['1001'], acc['5001'], 6_000, 'TD-543 sale 1396');
      const previewOld = await admin.get('/api/accounting/fiscal-closing/preview?year=1395');
      if (previewOld.body?.yearEnded !== true) problems.push(`the preview of 1395 gave yearEnded=${previewOld.body?.yearEnded}, expected true`);
      const close95 = await FiscalYearService.executeFiscalYearClosing({ year: 1395, createOpeningVoucher: true, username: 'reg' });
      const close96 = await FiscalYearService.executeFiscalYearClosing({ year: 1396, createOpeningVoucher: true, username: 'reg' });
      const yearsRes = await admin.get('/api/accounting/fiscal-closing/years');
      const rows = (yearsRes.body?.years ?? []) as Array<{ year: number; status: string; hasVouchers: boolean }>;
      const row = (y: number) => rows.find(r => r.year === y);
      if (yearsRes.status !== 200) problems.push(`GET /fiscal-closing/years answered ${yearsRes.status}`);
      else {
        if (yearsRes.body.currentYear !== current) problems.push(`years: currentYear ${yearsRes.body.currentYear}, expected ${current}`);
        if (rows.some(r => r.year >= current) || rows[rows.length - 1]?.year !== current - 1) problems.push(`years lists ${rows.map(r => r.year).join(',')}, expected ended years up to ${current - 1}`);
        if (row(1395)?.status !== 'closed' || row(1396)?.status !== 'closed' || !row(1396)?.hasVouchers) problems.push(`years rows 1395/1396: ${JSON.stringify([row(1395), row(1396)])}`);
        if (row(1397)?.status !== 'open' || !row(1397)?.hasVouchers || row(1398)?.hasVouchers) problems.push(`years rows 1397/1398: ${JSON.stringify([row(1397), row(1398)])}`);
        if (yearsRes.body.reopenableYear !== 1396) problems.push(`years: reopenableYear ${yearsRes.body.reopenableYear}, expected 1396`);
      }

      // 3) B03-01 / t2: only the last closed year, with a reason and the reopen permission
      const reason = 'TD-543 sale of 1396 entered late';
      const expect = async (label: string, res: request.Response, status: number, code?: string) => {
        if (res.status !== status || (code && res.body?.code !== code)) problems.push(`${label}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}, expected ${status}${code ? ` ${code}` : ''}`);
      };
      await expect('reopening 1395 while 1396 is closed', await admin.post('/api/accounting/fiscal-closing/reopen', { year: 1395, reason }), 409, 'FISCAL_YEAR_LATER_CLOSED');
      await expect('reopening without a reason', await admin.post('/api/accounting/fiscal-closing/reopen', { year: 1396, reason: '  ' }), 400);
      const closer = await sandboxClientWith(['accounting.view', 'accounting.vouchers', 'accounting.fiscal_close']);
      await expect('reopening with the closing permission only', await closer.post('/api/accounting/fiscal-closing/reopen', { year: 1396, reason }), 403);
      const reopener = await sandboxClientWith(['accounting.view', 'accounting.vouchers', 'accounting.fiscal_reopen']);
      const reopened = await reopener.post('/api/accounting/fiscal-closing/reopen', { year: 1396, reason });
      await expect('reopening 1396', reopened, 200);
      const run96 = close96.closingVouchers.map(v => v.id).sort((a, b) => a - b);
      const voided = ((reopened.body?.voidedVouchers ?? []) as Array<{ id: number; action: string }>);
      if (JSON.stringify(voided.map(v => v.id).sort((a, b) => a - b)) !== JSON.stringify(run96) || voided.some(v => v.action !== 'reversed')) {
        problems.push(`reopening voided ${JSON.stringify(voided)}, expected reversals of ${JSON.stringify(run96)}`);
      }
      const [p96] = await orm.select().from(fiscalPeriods).where(eq(fiscalPeriods.fiscalYear, 1396));
      if (p96?.status !== 'open' || p96.closingVoucherId !== null || p96.closedAt !== null) problems.push(`fiscal_periods 1396 after reopening: ${JSON.stringify(p96)}`);
      const reversals = await orm.select().from(journalVouchers).where(and(eq(journalVouchers.isDeleted, 0), inArray(journalVouchers.referenceId, run96)));
      for (const v of close96.closingVouchers) {
        const r = reversals.find(x => x.referenceId === v.id);
        if (!r || r.date !== v.date || r.voucherType !== v.voucherType || r.sourceFiscalYear !== 1396 || r.status !== 'approved') {
          problems.push(`voucher ${v.referenceNumber}: reversal ${JSON.stringify(r && { date: r.date, type: r.voucherType, year: r.sourceFiscalYear, status: r.status })}, expected ${v.date} ${v.voucherType} 1396 approved`);
        }
      }
      const { firstDay: first96, lastDay: last96 } = yearBounds(1396);
      const income96 = await AccountingReportService.getIncomeStatement({ startDate: first96, endDate: last96, includeClosing: true });
      if (amountOf(income96.totalRevenue) !== 6_000) problems.push(`income statement 1396 with closing vouchers after reopening: revenue ${income96.totalRevenue}, expected 6000`);
      const [audit] = await orm.select().from(activityLogs).where(and(eq(activityLogs.entity, 'سال مالی'), eq(activityLogs.entityId, '1396')));
      const auditDetails = (audit?.details ?? {}) as { reason?: string; before?: { status?: string }; after?: { status?: string }; voidedVouchers?: unknown[] };
      if (auditDetails.reason !== reason || auditDetails.before?.status !== 'closed' || auditDetails.after?.status !== 'open' || auditDetails.voidedVouchers?.length !== run96.length) {
        problems.push(`audit row of the reopening: ${JSON.stringify(audit?.details).slice(0, 200)}`);
      }
      await postApproved('2017-09-01', acc['1001'], acc['5001'], 500, 'TD-543 late sale 1396').catch((err: Error) => problems.push(`posting in the reopened 1396 was refused: ${err.message}`));
      await expect('reopening an open year', await admin.post('/api/accounting/fiscal-closing/reopen', { year: 1396, reason }), 409, 'FISCAL_YEAR_NOT_CLOSED');

      // 4) closing again and reopening again voids only the new run; then 1395 is the last closed year
      const close96b = await FiscalYearService.executeFiscalYearClosing({ year: 1396, createOpeningVoucher: true, username: 'reg' });
      const again = await admin.post('/api/accounting/fiscal-closing/reopen', { year: 1396, reason: 'TD-543 second reopening' });
      const againIds = ((again.body?.voidedVouchers ?? []) as Array<{ id: number }>).map(v => v.id).sort((a, b) => a - b);
      if (JSON.stringify(againIds) !== JSON.stringify(close96b.closingVouchers.map(v => v.id).sort((a, b) => a - b))) problems.push(`the second reopening voided ${JSON.stringify(againIds)}, expected only the new run`);
      const back95 = await admin.post('/api/accounting/fiscal-closing/reopen', { year: 1395, reason: 'TD-543 reopen 1395' });
      await expect('reopening 1395 once 1396 is open', back95, 200);
      if ((back95.body?.voidedVouchers ?? []).length !== close95.closingVouchers.length) problems.push(`reopening 1395 voided ${(back95.body?.voidedVouchers ?? []).length} vouchers, expected ${close95.closingVouchers.length}`);
      const tb = await AccountingReportService.getTrialBalance({ level: 'subsidiary', endDate: today, includeClosing: true });
      const cash = tb.find(r => r.code === '1001');
      if (amountOf(cash?.debitBalance) !== 10_000 + 4_000 + 6_000 + 500 + 7_000 + 1_000) problems.push(`cash after reopening both years: ${cash?.debitBalance}`);

      // 5) the health check lists a year closed before its end
      await orm.insert(fiscalPeriods).values([
        { fiscalYear: 1390, status: 'closed', closedAt: '2011-12-01 08:00:00', closedBy: 'td543' },
        { fiscalYear: 1391, status: 'closed', closedAt: '2013-04-01 08:00:00', closedBy: 'td543' },
      ]);
      const { findEarlyClosedYears } = await import('../../services/accounting/fiscalClosingHealth.js');
      const early = (await findEarlyClosedYears()).map(e => e.year);
      if (JSON.stringify(early) !== '[1390]') problems.push(`early closed years listed ${JSON.stringify(early)}, expected [1390]`);
      assertNoProblems(problems);
      return `closing ${current} and ${current + 1} refused; 1396 then 1395 reopened with their closing vouchers reversed`;
    }));
  }

  const orderId = 'reg_fiscal_years_close_in_order_td_544';
  if (shouldRun(orderId, 'td544', 'fiscal', 'closing', 'package3')) {
    await runCase(results, orderId, 'v9.0.123: a fiscal year closes only when every earlier year with vouchers is closed, the form starts on the oldest open year with vouchers, and years closed out of order are listed by the health check (TD-544)', async () => {
      const problems: string[] = [];
      await inFiscalSandbox(async () => {
        const acc = await accountIdsByCode('1001', '4001', '5001');
        const admin = await sandboxAdminClient();
        // B03-02 example S02: 1395 is closed; cash revenue 1,000,000 in 1396 and 2,000,000 in 1397; cash 8,800,000 before
        await postApproved('2016-05-01', acc['1001'], acc['4001'], 8_800_000, 'TD-544 capital 1395');
        await FiscalYearService.executeFiscalYearClosing({ year: 1395, createOpeningVoucher: true, username: 'reg' });
        await postApproved('2017-06-01', acc['1001'], acc['5001'], 1_000_000, 'TD-544 sale 1396');
        await postApproved('2018-06-01', acc['1001'], acc['5001'], 2_000_000, 'TD-544 sale 1397');

        const preview97 = await admin.get('/api/accounting/fiscal-closing/preview?year=1397');
        if (JSON.stringify(preview97.body?.earlierOpenYears) !== '[1396]') problems.push(`the preview of 1397 lists earlier open years ${JSON.stringify(preview97.body?.earlierOpenYears)}, expected [1396]`);
        const refused = await admin.post('/api/accounting/fiscal-closing/execute', { year: '1397', createOpeningVoucher: true });
        if (refused.status !== 422 || refused.body?.code !== 'FISCAL_YEAR_EARLIER_OPEN') problems.push(`closing 1397 with 1396 open answered ${refused.status} ${JSON.stringify(refused.body).slice(0, 200)}, expected 422 FISCAL_YEAR_EARLIER_OPEN`);
        const service = await FiscalYearService.executeFiscalYearClosing({ year: 1397, createOpeningVoucher: false, username: 'reg' })
          .then(() => 'closed', (err: { code?: string }) => err?.code);
        if (service !== 'FISCAL_YEAR_EARLIER_OPEN') problems.push(`the service closing 1397 gave ${service}`);
        const [p97] = await orm.select().from(fiscalPeriods).where(eq(fiscalPeriods.fiscalYear, 1397));
        if (p97?.status === 'closed') problems.push('1397 was closed while 1396 was open');
        const years = await admin.get('/api/accounting/fiscal-closing/years');
        if (years.body?.defaultYear !== 1396) problems.push(`the closing form starts on ${years.body?.defaultYear}, expected the oldest open year with vouchers 1396`);

        // in order: 1396, then 1397; each closes its own year's profit and cash stays whole
        const close96 = await FiscalYearService.executeFiscalYearClosing({ year: 1396, createOpeningVoucher: true, username: 'reg' });
        const preview97b = await admin.get('/api/accounting/fiscal-closing/preview?year=1397');
        if ((preview97b.body?.earlierOpenYears ?? []).length !== 0) problems.push(`after closing 1396 the preview of 1397 still lists ${JSON.stringify(preview97b.body?.earlierOpenYears)}`);
        const close97 = await FiscalYearService.executeFiscalYearClosing({ year: 1397, createOpeningVoucher: true, username: 'reg' });
        if (amountOf(close96.netProfit) !== 1_000_000 || amountOf(close97.netProfit) !== 2_000_000) problems.push(`profits ${close96.netProfit} / ${close97.netProfit}, expected 1000000 / 2000000`);
        const { firstDay: first98 } = yearBounds(1398);
        const cash = (await AccountingReportService.getTrialBalance({ level: 'subsidiary', endDate: first98 })).find(r => r.code === '1001');
        if (amountOf(cash?.debitBalance) !== 11_800_000) problems.push(`cash on ${first98}: ${cash?.debitBalance}, expected 11800000`);

        // a year without vouchers does not hold a later one: 1398 closes without an opening voucher, 1399 stays empty
        await FiscalYearService.executeFiscalYearClosing({ year: 1398, createOpeningVoucher: false, username: 'reg' });
        await postApproved('2021-06-01', acc['1001'], acc['5001'], 500_000, 'TD-544 sale 1400');
        await FiscalYearService.executeFiscalYearClosing({ year: 1400, createOpeningVoucher: false, username: 'reg' })
          .catch((err: Error) => problems.push(`closing 1400 with only the empty 1399 open was refused: ${err.message}`));
      });

      // the health check lists years closed before an earlier year with vouchers
      await inFiscalSandbox(async () => {
        const acc = await accountIdsByCode('1001', '4001');
        await postApproved('2011-06-01', acc['1001'], acc['4001'], 1_000, 'TD-544 open 1390');
        await postApproved('2014-06-01', acc['1001'], acc['4001'], 1_000, 'TD-544 1393');
        for (const [fiscalYear, closedAt] of [[1391, '2013-04-01 08:00:00'], [1393, '2016-01-01 08:00:00'], [1394, '2015-06-01 08:00:00']] as const) {
          const closed = { status: 'closed', closedAt, closedBy: 'td544' };
          await orm.insert(fiscalPeriods).values({ fiscalYear, ...closed }).onConflictDoUpdate({ target: fiscalPeriods.fiscalYear, set: closed });
        }
        const { findOutOfOrderClosedYears } = await import('../../services/accounting/fiscalClosingHealth.js');
        const listed = JSON.stringify(await findOutOfOrderClosedYears());
        const expected = JSON.stringify([
          { year: 1391, earlierYears: [1390] }, { year: 1393, earlierYears: [1390] }, { year: 1394, earlierYears: [1390, 1393] },
        ]);
        if (listed !== expected) problems.push(`out-of-order closed years ${listed}, expected ${expected}`);
      });
      assertNoProblems(problems);
      return '1397 refused while 1396 was open; closed in order with cash 11,800,000; out-of-order closings listed';
    });
  }

  return results;
}
