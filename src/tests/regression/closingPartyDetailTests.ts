import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { journalVoucherItems } from '../../db/schema.js';
import { FiscalYearService } from '../../services/accounting/fiscalYear.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { createTestCustomer } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { accountIdsByCode, amountOf, assertNoProblems, inFiscalSandbox, runCase, type ShouldRun } from './fiscalClosingTests.js';

/**
 * v10.0.264 (OBS-R1-45, TD-985): the closing and opening vouchers of a fiscal year keep each balance's detail.
 * Before, they posted one row per subsidiary account with detail «other», so a customer's receivable of the closed
 * year vanished from its account card in the new year and the level-4 trial balance of the last day showed a separate
 * negative «other» row against every party.
 */
export async function runClosingPartyDetailTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_closing_vouchers_keep_party_detail_obs_r1_45';
  if (!shouldRun(id, 'obs-r1-45', 'td985', 'fiscal', 'closing', 'accounting')) return results;

  await runCase(results, id, 'v10.0.264: the closing and opening vouchers carry one row per party detail (type and id) of each balance-sheet account, so each party starts the new year with its own balance (OBS-R1-45)', async () => inFiscalSandbox(async () => {
    const problems: string[] = [];
    const year = 1395;
    const acc = await accountIdsByCode('1001', '1201', '3001', '4001', '5001');
    const a = await createTestCustomer({ name: 'OBS-R1-45 customer A' });
    const b = await createTestCustomer({ name: 'OBS-R1-45 customer B' });
    const s = await createTestCustomer({ name: 'OBS-R1-45 supplier', partyType: 'supplier' });
    const post = (date: string, items: Array<Record<string, unknown>>) => VoucherService.createJournalVoucher({
      date, voucherType: 'general', status: 'approved', description: 'OBS-R1-45', referenceModule: 'manual',
      items: items as Parameters<typeof VoucherService.createJournalVoucher>[0]['items'],
    });
    await post('2016-05-01', [
      { accountId: acc['1001'], debit: 10_000_000, credit: 0 },
      { accountId: acc['4001'], debit: 0, credit: 10_000_000 },
    ]);
    await post('2016-07-01', [
      { accountId: acc['1201'], detailedType: 'customer', detailedId: a.id, detailedName: a.name, debit: 3_000_000, credit: 0 },
      { accountId: acc['1201'], detailedType: 'customer', detailedId: b.id, detailedName: b.name, debit: 2_000_000, credit: 0 },
      { accountId: acc['5001'], debit: 0, credit: 5_000_000 },
    ]);
    await post('2016-08-01', [
      { accountId: acc['1001'], debit: 700_000, credit: 0 },
      { accountId: acc['3001'], detailedType: 'supplier', detailedId: s.id, detailedName: s.name, debit: 0, credit: 700_000 },
    ]);

    const closed = await FiscalYearService.executeFiscalYearClosing({ year, createOpeningVoucher: true, username: 'reg' });
    const opening = closed.closingVouchers.find(v => v.referenceNumber === `OPENING-${year + 1}`);
    const closing = closed.closingVouchers.find(v => v.referenceNumber === `CLOSING-${year}`);
    if (!opening || !closing) throw new Error('the closing run issued no closing or opening voucher');

    const rowsOf = (voucherId: number) => orm.select().from(journalVoucherItems)
      .where(and(eq(journalVoucherItems.voucherId, voucherId), eq(journalVoucherItems.isDeleted, 0)));
    const expectRow = (label: string, rows: Awaited<ReturnType<typeof rowsOf>>, accountId: number, type: string, detailId: number, debit: number, credit: number) => {
      const hit = rows.filter(r => r.accountId === accountId && r.detailedType === type && r.detailedId === detailId);
      if (hit.length !== 1 || amountOf(hit[0].debit) !== debit || amountOf(hit[0].credit) !== credit) {
        const seen = rows.filter(r => r.accountId === accountId)
          .map(r => `${r.detailedType}/${r.detailedId ?? '-'} ${amountOf(r.debit)}/${amountOf(r.credit)}`).join(', ');
        problems.push(`${label}: expected one ${type} ${detailId} row ${debit}/${credit}, found [${seen}]`);
      }
    };
    const openingRows = await rowsOf(opening.id);
    expectRow('opening 1201 customer A', openingRows, acc['1201'], 'customer', a.id, 3_000_000, 0);
    expectRow('opening 1201 customer B', openingRows, acc['1201'], 'customer', b.id, 2_000_000, 0);
    expectRow('opening 3001 supplier', openingRows, acc['3001'], 'supplier', s.id, 0, 700_000);
    const closingRows = await rowsOf(closing.id);
    expectRow('closing 1201 customer A', closingRows, acc['1201'], 'customer', a.id, 0, 3_000_000);
    expectRow('closing 3001 supplier', closingRows, acc['3001'], 'supplier', s.id, 700_000, 0);
    const cash = openingRows.filter(r => r.accountId === acc['1001']);
    if (cash.length !== 1 || amountOf(cash[0].debit) !== 10_700_000) {
      problems.push(`opening cash: expected one row of 10,700,000, found ${cash.map(r => amountOf(r.debit)).join(', ')}`);
    }
    assertNoProblems(problems);
    return `${year} closed; each party opens ${year + 1} with its own detail row`;
  }));
  return results;
}
