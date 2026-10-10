import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { cheques, itemOpeningVoucherItems, items, productionProjects } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { AccountingReportService } from '../../services/accounting/accountingReport.service.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, accountIdsByCode, assertNoProblems, inFiscalSandbox, runCase } from './fiscalClosingTests.js';

/** Fresh-eyes work-map test B-02: one detail account is one row of the level-4 trial balance. */

interface DetailRow { debit: number; credit: number; detailedType: string; detailedId?: number; detailedName: string }

async function postRows(date: string, description: string, rows: Array<DetailRow & { accountId: number }>, referenceModule = 'manual', sourceChequeId: number | null = null): Promise<number> {
  const voucher = await VoucherService.createJournalVoucher({
    date, voucherType: 'general', status: 'approved', description, referenceModule, sourceChequeId,
    items: rows.map(r => ({ ...r, description })),
  });
  return voucher.id;
}

export async function runTrialBalanceDetailTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const id = 'reg_trial_balance_detail_one_row_td_1128';
  if (shouldRun(id, 'td1128', 'trial', 'balance', 'detail', 'accounting')) {
    await runCase(results, id, 'v10.0.85: the level-4 trial balance shows one row per detail account (type and id) under its current name, whatever name each voucher stored, groups rows without a detail id of automatic vouchers by their cheque or opening item, else on the account general row and keeps a name typed on a manual voucher (TD-1128)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const today = await businessTodayIsoDate();
      const acc = await accountIdsByCode('1402', '1101', '1001', '1401', '4001');
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
      // a cheque's registration and clearing store two labels of one cheque, without a detail id but with the cheque link
      const [cheque] = await orm.insert(cheques).values({
        type: 'received', chequeNumber: '100200', bankName: 'TD-1128 bank', issueDate: today, dueDate: today,
        amount: money(500_000), partyName: 'TD-1128 drawer',
      }).returning({ id: cheques.id });
      await postRows(today, 'TD-1128 cheque', [
        { accountId: acc['1101'], debit: 500_000, credit: 0, detailedType: 'other', detailedName: 'چک صیادی 1234567890123456' },
        { accountId: acc['1001'], debit: 0, credit: 500_000, detailedType: 'other', detailedName: 'cash' },
      ], 'cheque', cheque.id);
      await postRows(today, 'TD-1128 cheque cleared', [
        { accountId: acc['1001'], debit: 500_000, credit: 0, detailedType: 'other', detailedName: 'cash' },
        { accountId: acc['1101'], debit: 0, credit: 500_000, detailedType: 'other', detailedName: 'چک 100200' },
      ], 'cheque', cheque.id);
      // a legacy cheque voucher without the link has no stable reference: the general row
      await postRows(today, 'TD-1128 legacy cheque', [
        { accountId: acc['1101'], debit: 30_000, credit: 0, detailedType: 'other', detailedName: 'چک قدیمی 777' },
        { accountId: acc['1001'], debit: 0, credit: 30_000, detailedType: 'other', detailedName: 'cash' },
      ], 'cheque');
      // an item opening row is keyed by its linked item, its capital row has no stable reference
      const [item] = await orm.insert(items).values({ code: 'TD1128-ITEM', name: 'TD-1128 bead', type: 'raw_material', unit: 'عدد' })
        .returning({ id: items.id });
      const openingId = await postRows(today, 'TD-1128 item opening', [
        { accountId: acc['1401'], debit: 40_000, credit: 0, detailedType: 'other', detailedName: 'موجودی اولیه TD-1128 bead' },
        { accountId: acc['4001'], debit: 0, credit: 40_000, detailedType: 'other', detailedName: 'سرمایه اولیه' },
      ], 'item_opening');
      await orm.insert(itemOpeningVoucherItems).values({ voucherId: openingId, itemId: item.id, amount: money(40_000) });
      await orm.update(items).set({ name: 'TD-1128 bead renamed' }).where(eq(items.id, item.id));
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
        const cheque = chequeRows.filter(r => r.name.includes('چک 100200'));
        const general = chequeRows.filter(r => r.name.includes('سایر / عمومی'));
        if (cheque.length !== 1) problems.push(`${level}: 1101 shows ${cheque.length} rows for cheque 100200 ${JSON.stringify(chequeRows.map(r => r.name))}, expected one`);
        else if (cheque[0].debitBalance !== 0 || cheque[0].creditBalance !== 0) problems.push(`${level}: the cheque 100200 row balance is ${cheque[0].debitBalance}/${cheque[0].creditBalance}, expected zero`);
        if (general.length !== 1 || general[0].debitBalance !== 30_000) problems.push(`${level}: the legacy cheque without a link shows ${JSON.stringify(general.map(r => [r.name, r.debitBalance]))}, expected one general row of 30,000`);
        if (typed.length !== 1 || typed[0].debitBalance !== 70_000) problems.push(`${level}: the typed manual detail shows ${JSON.stringify(typed.map(r => [r.name, r.debitBalance]))}, expected one row of 70,000`);
        const itemRows = on(acc['1401']);
        if (itemRows.length !== 1 || !itemRows[0].name.includes('TD-1128 bead renamed (TD1128-ITEM)')) problems.push(`${level}: 1401 shows ${JSON.stringify(itemRows.map(r => r.name))}, expected one row under the item's current name and code`);
      }
      assertNoProblems(problems);
      return 'Rows of one project under two stored names and two labels of one linked cheque each show as one row with a zero balance, an unlinked cheque goes to the general row, an opening row shows its item and a typed manual detail keeps its row, at the detailed and the tree level.';
    }));
  }

  return results;
}
