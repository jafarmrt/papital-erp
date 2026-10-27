import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { customers } from '../../db/schema.js';
import { AppError } from '../../errors/customErrors.js';
import { DocumentService } from '../../services/document.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { getDefaultWarehouseCode } from '../../services/inventory/warehouseResolver.js';
import { createTestItem, createTestWarehouse } from '../fixtures/factories.js';
import { receive } from '../invariants/scenarioHelpers.js';
import { TestCaseResult } from '../types.js';
import {
  accountIdsByCode, amountOf, inFiscalSandbox, runCase, sandboxAdminClient, type ShouldRun,
} from './fiscalClosingTests.js';
import { brief } from './receiptsOnInvoicesV11Tests.js';

/**
 * v11 phase 6.1ch (M13, S11): the account card and the Kardex window answer one page from the server, and the stock
 * checks that walk an item's ledger start from the balance before the day they look at. Real Express routes and services
 * on PostgreSQL, each case in its own schema with the standard chart of accounts. The card and Kardex cases are red on
 * v11.4.0 (both answered every row and took no page). The stock check case holds the walk from the opening balance equal
 * to the earlier walk over the whole ledger: green on v11.4.0, red when the opening balance is left out.
 */

interface CardRow { voucherId: number; rowNumber?: number; runningBalance: number; debit: number; credit: number; isOpening?: boolean }
interface CardBody {
  items: CardRow[]; openingBalance: number; totalDebit: number; totalCredit: number; finalBalance: number; total: number; page: number; limit: number;
}
interface KardexEntryBody { transactionId: number; date: string; type: string; location: string; quantity: number; runningBalance: number; documentRef: string }
interface KardexBody {
  entries: KardexEntryBody[]; summary: { netBalance: number }; opening: { date: string; runningBalance: number; runningWac: number; runningTotalValue: number } | null;
  locations: string[]; total: number; page: number; limit: number;
}

async function sell(itemId: number, quantity: number, wh: string, date: string, allowBackdate = false): Promise<number> {
  const { docId } = await DocumentService.createDocumentWithDetails({
    docType: 'invoice', inOut: 'out', status: 'final', date, user: 'inv', buyerName: 'مشتری آزمون صفحه‌بندی',
    items: [{ itemId, quantity, unitPrice: 250_000, location: wh }],
  }, { allowBackdate });
  return docId;
}

async function refusal(run: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
}

const detailOf = (err: AppError | null, key: string) => (err?.details as Record<string, unknown> | undefined)?.[key];

export async function runServerPagingV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const cardId = 'reg_account_card_server_pages_v11_6_1ch_m13';
  if (shouldRun(cardId, 'v11', 'phase6', 'm13', 'accounting', 'account-card', 'paging', 'report')) {
    await runCase(results, cardId, 'v11 phase 6.1ch (M13): the account card answers one page; row numbers, running balances and totals count the whole period, the opening row comes on the first page only, export=true answers every row, and the party card pages the same way', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const ids = await accountIdsByCode('1201', '5001');
      const [party] = await orm.insert(customers).values({ name: 'مشتری کارت صفحه‌بندی', partyType: 'customer' }).returning({ id: customers.id, name: customers.name });
      const post = async (date: string, debit: number, credit: number) => {
        const description = `M13 card ${date}`;
        await VoucherService.createJournalVoucher({
          date, voucherType: 'general', status: 'approved', description, referenceModule: 'manual',
          items: [
            { accountId: ids['1201'], debit, credit, detailedType: 'customer', detailedId: party.id, detailedName: party.name, description },
            { accountId: ids['5001'], debit: credit, credit: debit, description },
          ],
        });
      };
      await post('2025-01-05', 100_000, 0);
      const period: Array<[number, number]> = [[50_000, 0], [0, 30_000], [70_000, 0], [0, 40_000], [20_000, 0], [0, 15_000], [10_000, 0]];
      for (const [i, [debit, credit]] of period.entries()) await post(`2025-02-0${i + 1}`, debit, credit);

      const base = `/api/accounting/reports/account-card?accountId=${ids['1201']}&detailedType=customer&detailedId=${party.id}&startDate=2025-02-01&endDate=2025-02-28`;
      const card = async (query: string): Promise<CardBody> => {
        const res = await admin.get(`${base}&${query}`);
        if (res.status !== 200) throw new Error(`${query} answered ${brief(res)}`);
        return res.body as CardBody;
      };
      const all = await card('export=true');
      const allRows = all.items.filter(row => !row.isOpening);
      const expectedRunning = period.reduce<number[]>((acc, [d, c]) => [...acc, (acc.at(-1) ?? 100_000) + d - c], []);
      if (allRows.length !== 7 || all.items[0]?.isOpening !== true || amountOf(all.items[0]?.runningBalance) !== 100_000) problems.push(`export: ${all.items.length} rows, first ${JSON.stringify(all.items[0])}, expected the opening row of 100000 and 7 rows`);
      if (JSON.stringify(allRows.map(row => amountOf(row.runningBalance))) !== JSON.stringify(expectedRunning)) problems.push(`export running balances ${JSON.stringify(allRows.map(row => row.runningBalance))}, expected ${JSON.stringify(expectedRunning)}`);
      if (JSON.stringify(allRows.map(row => row.rowNumber)) !== JSON.stringify([1, 2, 3, 4, 5, 6, 7])) problems.push(`export row numbers ${JSON.stringify(allRows.map(row => row.rowNumber))}`);
      const sums = { openingBalance: 100_000, totalDebit: 150_000, totalCredit: 85_000, finalBalance: 165_000, total: 7 };

      const pages: CardRow[] = [];
      for (const page of [1, 2, 3]) {
        const body = await card(`limit=3&page=${page}`);
        const rows = body.items.filter(row => !row.isOpening);
        pages.push(...rows);
        const got = { openingBalance: amountOf(body.openingBalance), totalDebit: amountOf(body.totalDebit), totalCredit: amountOf(body.totalCredit), finalBalance: amountOf(body.finalBalance), total: body.total };
        if (JSON.stringify(got) !== JSON.stringify(sums)) problems.push(`page ${page} totals ${JSON.stringify(got)}, expected ${JSON.stringify(sums)} on every page`);
        if (body.page !== page || body.limit !== 3) problems.push(`page ${page} answered page ${body.page}, limit ${body.limit}`);
        const hasOpening = body.items.some(row => row.isOpening);
        if (hasOpening !== (page === 1)) problems.push(`page ${page} ${hasOpening ? 'has' : 'lacks'} the opening row`);
        if (rows.length !== (page === 3 ? 1 : 3)) problems.push(`page ${page} has ${rows.length} rows`);
      }
      const key = (row: CardRow) => `${row.voucherId}:${row.rowNumber}:${amountOf(row.runningBalance)}`;
      if (JSON.stringify(pages.map(key)) !== JSON.stringify(allRows.map(key))) problems.push(`the three pages ${JSON.stringify(pages.map(key))} are not the export ${JSON.stringify(allRows.map(key))}`);

      // the party's own card (customers page and dossier) takes every period and pages the same way
      const own = await admin.get(`/api/customers/${party.id}/account-card?limit=3&page=3`);
      const ownBody = own.body as CardBody;
      const ownRows = (ownBody?.items ?? []).filter(row => !row.isOpening);
      if (own.status !== 200 || ownBody.total !== 8 || JSON.stringify(ownRows.map(row => row.rowNumber)) !== '[7,8]'
        || amountOf(ownRows.at(-1)?.runningBalance) !== 165_000 || amountOf(ownBody.finalBalance) !== 165_000) {
        problems.push(`the party card page 3 answered ${brief(own)}, expected rows 7 and 8 of 8 ending at 165000`);
      }

      for (const query of ['limit=1001', 'page=0', 'export=yes']) {
        const res = await admin.get(`${base}&${query}`);
        if (res.status !== 400) problems.push(`${query} answered ${res.status}, expected 400`);
      }
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return `3 pages of 3 rows = the export of 7 rows (running 100000 → 165000), opening row on page 1 only; party card page 3 = rows 7 and 8 of 8`;
    }));
  }

  const kardexId = 'reg_kardex_window_server_pages_v11_6_1ch_s11';
  if (shouldRun(kardexId, 'v11', 'phase6', 's11', 'inventory', 'kardex', 'paging')) {
    await runCase(results, kardexId, 'v11 phase 6.1ch (S11): the Kardex window answers the rows of a date range one page at a time, opens the range with the balance at the end of the day before, filters by direction, warehouse and search on the server, lists every warehouse of the item, and keeps the summary of the whole ledger', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const main = String(await getDefaultWarehouseCode(orm));
      const other = await createTestWarehouse();
      const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
      await receive(item.id, 10, 100_000, main, '2025-01-10');
      await receive(item.id, 5, 100_000, other.code, '2025-02-05');
      await sell(item.id, 3, main, '2025-02-10');
      const lastSale = await sell(item.id, 2, main, '2025-02-20');
      await receive(item.id, 4, 100_000, main, '2025-03-05');
      // the sandbox numbers documents 1, 2, …, so the search looks for a note only the last sale's row carries
      await orm.execute(sql`UPDATE transactions SET notes = 'M13 Kardex marker' WHERE document_id = ${lastSale}`);
      const saleRef = String(((await orm.execute(sql`SELECT ref_number FROM documents WHERE id = ${lastSale}`)).rows[0] as { ref_number: string }).ref_number);

      const kardex = async (query: string): Promise<KardexBody> => {
        const res = await admin.get(`/api/inventory/item-kardex/${item.id}${query ? `?${query}` : ''}`);
        if (res.status !== 200) throw new Error(`kardex ${query} answered ${brief(res)}`);
        return res.body as KardexBody;
      };
      const feb = 'from=2025-02-01&to=2025-02-28';

      const whole = await kardex('');
      if (whole.entries.length !== 5 || whole.total !== 5 || whole.opening !== null || whole.summary.netBalance !== 14) problems.push(`the bare Kardex: ${whole.entries.length} rows of ${whole.total}, opening ${JSON.stringify(whole.opening)}, net ${whole.summary.netBalance}`);
      if ([...whole.locations].sort().join() !== [main, other.code].sort().join()) problems.push(`locations ${JSON.stringify(whole.locations)}, expected ${main} and ${other.code}`);

      const second = await kardex(`${feb}&limit=1&page=2`);
      if (second.total !== 3 || second.page !== 2 || second.entries.length !== 1 || second.entries[0]?.type !== 'out' || second.entries[0]?.runningBalance !== 12) problems.push(`February page 2 of 1 row: ${JSON.stringify({ total: second.total, page: second.page, entries: second.entries.map(e => [e.type, e.quantity, e.runningBalance]) })}, expected the sale of 3 with a balance of 12, of 3 rows`);
      if (second.opening?.date !== '2025-02-01' || second.opening?.runningBalance !== 10 || second.opening?.runningWac !== 100_000 || second.opening?.runningTotalValue !== 1_000_000) problems.push(`opening ${JSON.stringify(second.opening)}, expected 10 at 100000 on 2025-02-01`);
      if (second.summary.netBalance !== 14 || second.locations.length !== 2) problems.push(`a page keeps the whole summary and every warehouse: net ${second.summary.netBalance}, locations ${JSON.stringify(second.locations)}`);

      const outs = await kardex(`${feb}&type=out`);
      if (outs.total !== 2 || outs.entries.some(e => e.type !== 'out')) problems.push(`February out rows: ${outs.total}`);
      const atOther = await kardex(`${feb}&location=${encodeURIComponent(other.code)}`);
      if (atOther.total !== 1 || atOther.entries[0]?.quantity !== 5) problems.push(`February rows at ${other.code}: ${atOther.total}`);
      const found = await kardex(`${feb}&search=${encodeURIComponent('kardex MARKER')}`);
      if (found.total !== 1 || found.entries[0]?.documentRef !== saleRef || found.entries[0]?.runningBalance !== 10) problems.push(`search of the note: ${JSON.stringify(found.entries.map(e => [e.documentRef, e.runningBalance]))}, expected the sale ${saleRef} at 10`);
      const exported = await kardex(`${feb}&limit=1&export=true`);
      if (exported.entries.length !== 3 || exported.total !== 3 || exported.page !== 1) problems.push(`February export: ${exported.entries.length} rows of ${exported.total}, page ${exported.page}`);

      for (const query of ['from=1405-13-40', 'type=sideways', 'limit=5000', 'page=0', 'export=1']) {
        const res = await admin.get(`/api/inventory/item-kardex/${item.id}?${query}`);
        if (res.status !== 400) problems.push(`${query} answered ${res.status}, expected 400`);
      }
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'February page 2 = the sale of 3 at 12 after an opening of 10; direction, warehouse and search filters, export and the whole summary hold';
    }));
  }

  const ledgerId = 'reg_stock_checks_start_from_opening_v11_6_1ch_s11';
  if (shouldRun(ledgerId, 'v11', 'phase6', 's11', 'inventory', 'void', 'backdate', 'stock')) {
    await runCase(results, ledgerId, 'v11 phase 6.1ch (S11): the void guard and the backdated out check read the item ledger from the day they look at, after the balance before it: the shortfall and the stock available count the earlier receipt', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const main = String(await getDefaultWarehouseCode(orm));

      // a void that breaks a later sale: 10 in before, 5 voided, 12 out → short by 2 (not 12)
      const a = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
      await receive(a.id, 10, 100_000, main, '2025-04-01');
      const voidedA = await receive(a.id, 5, 100_000, main, '2025-04-02');
      await sell(a.id, 12, main, '2025-04-03');
      const refusedA = await refusal(() => DocumentService.deleteDocument(voidedA, 'inv'));
      if (detailOf(refusedA, 'code') !== 'VOID_BREAKS_STOCK_HISTORY' || detailOf(refusedA, 'shortfall') !== '2') problems.push(`voiding 5 of 15 before a sale of 12: ${refusedA?.message ?? 'accepted'} ${JSON.stringify(refusedA?.details ?? null)}, expected VOID_BREAKS_STOCK_HISTORY short by 2`);

      // a void the earlier receipt covers: 10 in before, 5 voided, 8 out → allowed
      const b = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
      await receive(b.id, 10, 100_000, main, '2025-04-01');
      const voidedB = await receive(b.id, 5, 100_000, main, '2025-04-02');
      await sell(b.id, 8, main, '2025-04-03');
      const refusedB = await refusal(() => DocumentService.deleteDocument(voidedB, 'inv'));
      if (refusedB) problems.push(`voiding 5 of 15 before a sale of 8 was refused: ${refusedB.message}`);

      // a backdated sale: 10 in, 6 out two days later, 10 in after → 4 can leave on the day between, 5 cannot
      const c = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
      await receive(c.id, 10, 100_000, main, '2025-05-01');
      await sell(c.id, 6, main, '2025-05-03');
      await receive(c.id, 10, 100_000, main, '2025-05-04');
      const tooMany = await refusal(() => sell(c.id, 5, main, '2025-05-02', true));
      if (detailOf(tooMany, 'code') !== 'STOCK_NEGATIVE_AS_OF_DATE' || detailOf(tooMany, 'available') !== 4) problems.push(`a backdated sale of 5 with 4 left after the later sale: ${tooMany?.message ?? 'accepted'} ${JSON.stringify(tooMany?.details ?? null)}, expected STOCK_NEGATIVE_AS_OF_DATE with 4 available`);
      const fits = await refusal(() => sell(c.id, 4, main, '2025-05-02', true));
      if (fits) problems.push(`a backdated sale of 4 with 4 left was refused: ${fits.message}`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'void of 5 before a sale of 12 → short by 2; before a sale of 8 → allowed; backdated sale of 5 → 4 available, of 4 → allowed';
    }));
  }

  return results;
}
