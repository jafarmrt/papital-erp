import { orm } from '../../db/drizzle.js';
import { productionProjects } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { AccountingReportService } from '../../services/accounting/accountingReport.service.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, accountIdsByCode, assertNoProblems, inFiscalSandbox, runCase } from './fiscalClosingTests.js';

/** Fresh-eyes work-map test B-02: one detail account is one row of the level-4 trial balance. */

interface DetailRow { debit: number; credit: number; detailedType: string; detailedId?: number; detailedName: string }

async function postRows(date: string, description: string, rows: Array<DetailRow & { accountId: number }>, referenceModule = 'manual'): Promise<void> {
  await VoucherService.createJournalVoucher({
    date, voucherType: 'general', status: 'approved', description, referenceModule,
    items: rows.map(r => ({ ...r, description })),
  });
}

export async function runTrialBalanceDetailTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const id = 'reg_trial_balance_detail_one_row_td_1128';
  if (shouldRun(id, 'td1128', 'trial', 'balance', 'detail', 'accounting')) {
    await runCase(results, id, 'v10.0.85: the level-4 trial balance shows one row per detail account (type and id) under its current name, whatever name each voucher stored, puts rows without a detail id of automatic vouchers on the account general row and keeps a name typed on a manual voucher (TD-1128)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const today = await businessTodayIsoDate();
      const acc = await accountIdsByCode('1402', '1101', '1001');
      const [project] = await orm.insert(productionProjects).values({ projectCode: 'PRJ-TD1128', title: 'TD-1128 project' })
        .returning({ id: productionProjects.id });

      // allocation voucher stores «title (code)», production receipt stores the title only
      await postRows(today, 'TD-1128 allocation', [
        { accountId: acc['1402'], debit: 1_660_000, credit: 0, detailedType: 'project', detailedId: project.id, detailedName: 'TD-1128 project (PRJ-TD1128)' },
        { accountId: acc['1001'], debit: 0, credit: 1_660_000, detailedType: 'other', detailedName: 'cash' },
      ]);
      await postRows(today, 'TD-1128 production receipt', [
        { accountId: acc['1001'], debit: 1_660_000, credit: 0, detailedType: 'other', detailedName: 'cash' },
        { accountId: acc['1402'], debit: 0, credit: 1_660_000, detailedType: 'project', detailedId: project.id, detailedName: 'TD-1128 project' },
      ]);
      // a cheque's registration and clearing store two labels of one cheque, without an id
      await postRows(today, 'TD-1128 cheque', [
        { accountId: acc['1101'], debit: 500_000, credit: 0, detailedType: 'other', detailedName: 'چک صیادی 1234567890123456' },
        { accountId: acc['1001'], debit: 0, credit: 500_000, detailedType: 'other', detailedName: 'cash' },
      ], 'cheque');
      await postRows(today, 'TD-1128 cheque cleared', [
        { accountId: acc['1001'], debit: 500_000, credit: 0, detailedType: 'other', detailedName: 'cash' },
        { accountId: acc['1101'], debit: 0, credit: 500_000, detailedType: 'other', detailedName: 'چک 100200' },
      ], 'cheque');
      // a name a person typed on a manual voucher stays its own row
      await postRows(today, 'TD-1128 manual detail', [
        { accountId: acc['1101'], debit: 70_000, credit: 0, detailedType: 'other', detailedName: 'TD-1128 typed detail' },
        { accountId: acc['1001'], debit: 0, credit: 70_000, detailedType: 'other', detailedName: 'cash' },
      ]);

      for (const level of ['detailed', 'all'] as const) {
        const rows = (await AccountingReportService.getTrialBalance({ level })).filter(r => r.level === 'detailed');
        const on = (accountId: number) => rows.filter(r => r.parentId === accountId);
        const projectRows = on(acc['1402']);
        if (projectRows.length !== 1) problems.push(`${level}: 1402 shows ${projectRows.length} detail rows ${JSON.stringify(projectRows.map(r => r.name))}, expected one`);
        else {
          if (!projectRows[0].name.includes('TD-1128 project (PRJ-TD1128)')) problems.push(`${level}: the project row is named «${projectRows[0].name}», expected its current label`);
          if (projectRows[0].debitBalance !== 0 || projectRows[0].creditBalance !== 0) problems.push(`${level}: the project row balance is ${projectRows[0].debitBalance}/${projectRows[0].creditBalance}, expected zero`);
        }
        const chequeRows = on(acc['1101']);
        const typed = chequeRows.filter(r => r.name.includes('TD-1128 typed detail'));
        const general = chequeRows.filter(r => !r.name.includes('TD-1128 typed detail'));
        if (general.length !== 1) problems.push(`${level}: 1101 shows ${general.length} rows for the cheque ${JSON.stringify(general.map(r => r.name))}, expected one general row`);
        else if (general[0].debitBalance !== 0 || general[0].creditBalance !== 0) problems.push(`${level}: the 1101 general row balance is ${general[0].debitBalance}/${general[0].creditBalance}, expected zero`);
        if (typed.length !== 1 || typed[0].debitBalance !== 70_000) problems.push(`${level}: the typed manual detail shows ${JSON.stringify(typed.map(r => [r.name, r.debitBalance]))}, expected one row of 70,000`);
      }
      assertNoProblems(problems);
      return 'Rows of one project under two stored names and two labels of one cheque each show as one row with a zero balance and a typed manual detail keeps its row, at the detailed and the tree level.';
    }));
  }

  return results;
}
