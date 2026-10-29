import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import type { OldOpeningList } from '../../lib/historyImport/oldOpening.js';
import type { StockImportResult, StockImportRow } from '../../lib/historyImport/stockHistoryImport.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { DocumentService } from '../../services/document.service.js';
import { ItemCatalogService } from '../../services/items/itemCatalog.service.js';
import { ItemOpeningService } from '../../services/inventory/itemOpening.service.js';
import { getDefaultWarehouseCode } from '../../services/inventory/warehouseResolver.js';
import { createTestCustomer, createTestUser } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';
import { brief, ok } from './receiptsOnInvoicesV11Tests.js';

/**
 * v11 history import, tool 8 (the 1405 replay): the opening stock entered earlier through the item form (dated the day the
 * item was defined, with a draft opening voucher) is taken back before the replay, so the replay's opening on 1 Farvardin
 * and the movements after it are accepted. Real Express routes and services on PostgreSQL. Red before this change: the
 * routes did not exist (404) and the replay's opening of such an item was refused (it already had an opening voucher).
 */

const LIST = '/api/inventory/history-import/old-openings';
const WITHDRAW = '/api/inventory/history-import/old-openings/withdraw';

const stockOf = async (itemId: number) => Number(((await orm.execute(sql`SELECT coalesce(sum(current_stock), 0)::float AS n FROM item_warehouse_stocks WHERE item_id = ${itemId}`)).rows[0] as { n: number }).n);
const liveVouchers = async (itemId: number) => Number(((await orm.execute(sql`SELECT count(*)::int AS n FROM item_opening_voucher_items l
  JOIN journal_vouchers jv ON jv.id = l.voucher_id AND jv.is_deleted = 0 WHERE l.item_id = ${itemId}`)).rows[0] as { n: number }).n);

export async function runHistoryImportOldOpeningsV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_history_import_old_openings_v11';
  if (shouldRun(id, 'v11', 'history_import', 'inventory', 'stock')) {
    await runCase(results, id, 'v11 history import (tool 8): old item-form openings with a draft voucher are listed and taken back (reversal on the same day, stock back to zero, draft voucher deleted, audit row), all or nothing; an item that moved, an approved voucher or a shared voucher with an item left out refuses; the replay then enters the item\'s opening on 1 Farvardin and a purchase after it', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const user = await createTestUser({ role: 'admin' });
      const main = String(await getDefaultWarehouseCode(orm));
      const today = await businessTodayIsoDate();
      const supplier = await createTestCustomer({ partyType: 'supplier' });
      const createItem = async (label: string, voucher = true) => {
        const s = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const created = await orm.transaction(tx => ItemCatalogService.createItem({
          type: 'raw_material', name: `old opening ${label} ${s}`, code: `OO_${label}_${s}`, unit: 'عدد', category: '',
          weighted_average_cost: 100, [`stock_${main}`]: 10,
        }, { id: user.id, username: user.username }, tx, { canEnterStock: true }));
        const itemId = created.insertedId as number;
        if (voucher) await ItemOpeningService.issueItemOpeningVoucher(itemId, { userId: user.id, username: user.username });
        return { id: itemId, code: `OO_${label}_${s}` };
      };
      const a = await createItem('a');
      const b = await createItem('b');
      const moved = await createItem('moved');
      await DocumentService.createDocument({
        docType: 'receipt', status: 'final', inOut: 'in', date: today, user: 'oo', buyerName: supplier.name,
        location: main, items: [{ itemId: moved.id, quantity: 5, unit_price: 200, location: main }],
      });
      const approved = await createItem('approved');
      await orm.execute(sql`UPDATE journal_vouchers SET status = 'approved' WHERE id IN (SELECT voucher_id FROM item_opening_voucher_items WHERE item_id = ${approved.id})`);
      // an opening without a voucher (zero cost, or its draft deleted by hand) is taken back too
      const bare = await createItem('bare', false);
      const e = await createItem('e', false);
      const f = await createItem('f', false);
      await orm.transaction(tx => ItemOpeningService.issueImportOpeningVoucher(tx, [e.id, f.id], { userId: user.id, username: user.username }));

      const listRes = await admin.get(LIST);
      if (!ok(listRes)) throw new Error(`the list returned ${brief(listRes)}`);
      const list = listRes.body as OldOpeningList;
      const entry = (itemId: number) => list.items.find(i => i.itemId === itemId);
      for (const it of [a, b, e, f, bare]) if (!entry(it.id)?.withdrawable) problems.push(`item ${it.code} listed ${JSON.stringify(entry(it.id))}, expected withdrawable`);
      for (const it of [moved, approved]) if (entry(it.id)?.withdrawable !== false || !entry(it.id)?.reason) problems.push(`item ${it.code} listed ${JSON.stringify(entry(it.id))}, expected refused with a reason`);
      if (entry(a.id)?.quantity !== '10' || entry(a.id)?.value !== '1000' || entry(a.id)?.day !== today) problems.push(`item a listed ${JSON.stringify(entry(a.id))}, expected 10 worth 1000 on ${today}`);

      // all or nothing: an item that moved, or a shared voucher with an item left out, refuses the whole request
      for (const ids of [[a.id, moved.id], [a.id, approved.id], [e.id]]) {
        const refused = await admin.post(WITHDRAW, { itemIds: ids });
        if (refused.status !== 409 || refused.body?.code !== 'OLD_OPENING_NOT_WITHDRAWABLE') problems.push(`withdrawing ${JSON.stringify(ids)} returned ${brief(refused)}, expected 409 OLD_OPENING_NOT_WITHDRAWABLE`);
      }
      if (await stockOf(a.id) !== 10 || await liveVouchers(a.id) !== 1) problems.push('a refused request changed item a');

      const done = await admin.post(WITHDRAW, { itemIds: [a.id, b.id, e.id, f.id, bare.id] });
      if (!ok(done) || done.body.items !== 5 || done.body.vouchers !== 3) problems.push(`the withdrawal returned ${brief(done)}, expected 5 items and 3 vouchers`);
      for (const it of [a, b, e, f, bare]) {
        if (await stockOf(it.id) !== 0) problems.push(`item ${it.code} holds ${await stockOf(it.id)} after the withdrawal`);
        if (await liveVouchers(it.id) !== 0) problems.push(`item ${it.code} still has a live opening voucher`);
      }
      const kardex = (await orm.execute(sql`SELECT type, is_deleted AS "isDeleted", reversal_of_id AS "reversalOf", to_char(date, 'YYYY-MM-DD') AS day
        FROM transactions WHERE item_id = ${a.id} ORDER BY id`)).rows as Array<{ type: string; isDeleted: number; reversalOf: number | null; day: string }>;
      if (kardex.length !== 2 || kardex[0].isDeleted !== 1 || kardex[1].type !== 'out' || !kardex[1].reversalOf || kardex[1].day !== kardex[0].day) problems.push(`item a's Kardex reads ${JSON.stringify(kardex)}, expected the deleted opening and its reversal on the same day`);
      const audit = Number(((await orm.execute(sql`SELECT count(*)::int AS n FROM activity_logs WHERE entity = 'کالا' AND entity_id = ${String(a.id)} AND description LIKE 'برداشتن موجودی اولیه%'`)).rows[0] as { n: number }).n);
      if (audit !== 1) problems.push(`item a has ${audit} withdrawal audit rows, expected 1`);
      if (await stockOf(moved.id) !== 15 || await liveVouchers(approved.id) !== 1) problems.push('the refused items were changed');

      // the replay: the opening on 1 Farvardin and a purchase after it are accepted
      const rows: StockImportRow[] = [
        { rowNo: 2, sheet: 'ورود به انبار', date: '1405-01-01', kind: 'opening', itemCode: a.code, quantity: '7', unitCost: '120' },
        { rowNo: 3, sheet: 'ورود به انبار', date: '1405-01-10', kind: 'purchase', itemCode: a.code, quantity: '3', unitCost: '130', supplierId: supplier.id, slipRef: 'خ۹' },
      ];
      const posted = await admin.post('/api/inventory/history-import', { commit: true, rows });
      const result = posted.body as StockImportResult;
      if (!ok(posted) || !result.committed) problems.push(`the replay returned ${brief(posted)}, expected both rows committed`);
      if (await stockOf(a.id) !== 10) problems.push(`item a holds ${await stockOf(a.id)} after the replay, expected 10 (7 + 3)`);

      // the replay's own opening is never listed as an old opening (review of #431: it could undo the replay)
      const again = (await admin.get(LIST)).body as OldOpeningList;
      const aAgain = again.items.find(i => i.itemId === a.id);
      if (aAgain) problems.push(`after the replay item a lists ${JSON.stringify(aAgain)}, expected the replay's opening left out`);
      if (again.items.some(i => i.itemId === b.id)) problems.push('item b is listed again after its opening was taken back');
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'old openings are taken back all or nothing and the replay then enters them on 1 Farvardin';
    }));
  }
  return results;
}
