import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts } from '../../db/schema.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import type { StockImportResult, StockImportRow } from '../../lib/historyImport/stockHistoryImport.js';
import type { TreasuryImportResult, TreasuryImportRow } from '../../lib/historyImport/treasuryHistoryImport.js';
import { createTestCustomer, createTestItem } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';
import { brief, ok } from './receiptsOnInvoicesV11Tests.js';

/**
 * v11 history import, tool 6 (the 1405 replay from Excel): a past purchase receipt keeps the supplier's invoice number
 * («شماره فاکتور مرجع») it was imported with, and a past supplier payment of the «هزینه‌ها» sheet that names that number
 * («شماره مرجع-فاکتور») settles that receipt first; an empty number settles the oldest; a number with no receipt is refused;
 * a payment before the named receipt still settles it. Real Express routes and services on PostgreSQL, in its own schema.
 * Red before this change: the route refused the field `purchaseRef` (400) and history_import_purchase_refs did not exist.
 */

type Client = Awaited<ReturnType<typeof sandboxAdminClient>>;

const count = async (query: ReturnType<typeof sql>) => Number(((await orm.execute(query)).rows[0] as { n: number | string }).n);

/** A bank of its own with 10,000,000 opening balance, so the payments are not refused for the balance. */
async function fundedBank(): Promise<number> {
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1003'), eq(accounts.isDeleted, 0)));
  const code = `1003${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const [ledger] = await orm.insert(accounts).values({
    code, name: 'بانک آزمون رسید خرید', level: 'subsidiary', parentId: parent?.id ?? null, accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  const bank = await BankAccountService.createBankAccount({ title: `بانک آزمون ${code}`, type: 'bank', accountId: ledger.id, initialBalance: 10_000_000, currency: 'IRR', openingDate: '2026-03-21' });
  return bank.id;
}

async function postTo<T>(client: Client, url: string, rows: unknown[], commit: boolean): Promise<T> {
  const res = await client.post(url, { commit, rows });
  // a post that recorded nothing answers 409 with its rows, so its key is released
  if (commit && res.status === 409 && res.body?.code === 'HISTORY_IMPORT_NOT_POSTED') return res.body.details as T;
  if (!ok(res)) throw new Error(`the import (${commit ? 'post' : 'preview'}) returned ${brief(res)}`);
  return res.body as T;
}

export async function runHistoryImportPurchaseRefsV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const id = 'reg_history_import_purchase_refs_v11';
  if (shouldRun(id, 'v11', 'history_import', 'purchase', 'treasury')) {
    await runCase(results, id, 'v11 history import (tool 6): past purchase receipts keep the supplier invoice numbers they were imported with (one receipt paid in two rows keeps both); a supplier payment that names the later one (another spelling, Persian digits) settles that one although the other is older and open; a payment before the named receipt still settles it; a payment with no number, and what a named one has left, go to the oldest receipt without a number first; a number with no receipt is refused and nothing is kept', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
      const supplier = await createTestCustomer({ partyType: 'supplier' });
      const IN = 'ورود به انبار';
      const receipts: StockImportRow[] = [
        { rowNo: 2, sheet: IN, date: '1405-02-01', kind: 'purchase', itemCode: item.code, quantity: '10', unitCost: '100000', supplierId: supplier.id, slipRef: 'A-100' },
        { rowNo: 3, sheet: IN, date: '1405-02-05', kind: 'purchase', itemCode: item.code, quantity: '5', unitCost: '100000', supplierId: supplier.id, slipRef: 'B-200' },
        // bought on credit: no «هزینه‌ها» row names it
        { rowNo: 4, sheet: IN, date: '1405-02-03', kind: 'purchase', itemCode: item.code, quantity: '2', unitCost: '100000', supplierId: supplier.id },
        // paid in two «هزینه‌ها» rows
        { rowNo: 5, sheet: IN, date: '1405-02-06', kind: 'purchase', itemCode: item.code, quantity: '3', unitCost: '100000', supplierId: supplier.id, slipRef: '۹، 10' },
      ];
      const stock = await postTo<StockImportResult>(admin, '/api/inventory/history-import', receipts, true);
      if (!stock.committed) throw new Error(`the receipts read ${JSON.stringify(stock.rows)}, expected committed`);
      const refA = stock.rows.find(r => r.rowNo === 2)?.created?.[0];
      const refB = stock.rows.find(r => r.rowNo === 3)?.created?.[0];
      const refC = stock.rows.find(r => r.rowNo === 4)?.created?.[0];
      const refD = stock.rows.find(r => r.rowNo === 5)?.created?.[0];
      const linked = await orm.execute(sql`SELECT r.excel_ref AS ref, d.ref_number AS "refNumber" FROM history_import_purchase_refs r JOIN documents d ON d.id = r.document_id
        WHERE r.supplier_id = ${supplier.id} ORDER BY r.excel_ref`);
      const pairs = (linked.rows as Array<{ ref: string; refNumber: string }>).map(r => `${r.ref}=${r.refNumber}`).join(',');
      const expectedPairs = `10=${refD},9=${refD},a-100=${refA},b-200=${refB}`;
      if (pairs !== expectedPairs) problems.push(`the receipts are linked as ${pairs}, expected ${expectedPairs}`);

      const bank = await fundedBank();
      const URL = '/api/accounting/treasury/history-import';
      const payment = (rowNo: number, date: string, amount: string, purchaseRef?: string): TreasuryImportRow => ({
        rowNo, sheet: 'هزینه‌ها', date, kind: 'payment', bankAccountId: bank, amount,
        partyType: 'supplier', partyId: supplier.id, partyName: supplier.name, settleOldest: true, ...(purchaseRef ? { purchaseRef, invoiceRef: purchaseRef } : {}),
      });

      // paid before receipt B came in: it still settles B, not the open receipt A
      const advance = await postTo<TreasuryImportResult>(admin, URL, [payment(2, '1405-02-02', '100000', 'B-200')], true);
      const s0 = advance.rows[0]?.settled ?? [];
      if (!advance.committed || s0.length !== 1 || s0[0].refNumber !== refB || s0[0].amount !== 100_000) problems.push(`a payment before its named receipt read ${JSON.stringify(advance.rows)}, expected 100,000 settled on ${refB}`);

      // B has 400,000 left; the other 100,000 goes to the oldest receipt without a number, C, not to the older A that waits for its row
      const named = await postTo<TreasuryImportResult>(admin, URL, [payment(3, '1405-03-01', '500000', 'b-۲۰۰')], true);
      const s1 = (named.rows[0]?.settled ?? []).map(x => `${x.refNumber}:${x.amount}`).join(',');
      if (!named.committed || s1 !== `${refB}:400000,${refC}:100000`) problems.push(`the payment naming b-200 read ${JSON.stringify(named.rows)}, expected ${refB}:400000,${refC}:100000`);

      // no number: what C has left first, then the oldest numbered receipt, A
      const oldest = await postTo<TreasuryImportResult>(admin, URL, [payment(4, '1405-03-02', '300000')], true);
      const s2 = (oldest.rows[0]?.settled ?? []).map(x => `${x.refNumber}:${x.amount}`).join(',');
      if (!oldest.committed || s2 !== `${refC}:100000,${refA}:200000`) problems.push(`a payment with no number read ${JSON.stringify(oldest.rows)}, expected ${refC}:100000,${refA}:200000`);

      // D was paid in two rows; each names its own number
      const split = await postTo<TreasuryImportResult>(admin, URL, [payment(6, '1405-03-03', '100000', '9'), payment(7, '1405-03-04', '200000', '10')], true);
      const s3 = split.rows.map(row => (row.settled ?? []).map(x => `${x.refNumber}:${x.amount}`).join(',')).join(' ');
      if (!split.committed || s3 !== `${refD}:100000 ${refD}:200000`) problems.push(`the two payments of one purchase read ${JSON.stringify(split.rows)}, expected both on ${refD}`);

      const before = await count(sql`SELECT count(*)::int AS n FROM treasury_transactions`);
      const unknown = await postTo<TreasuryImportResult>(admin, URL, [payment(5, '1405-03-05', '100000', 'X-1')], true);
      const r = unknown.rows[0];
      if (unknown.committed || r?.status !== 'error' || !String(r?.message).includes('رسید خرید')) problems.push(`a payment naming an unknown invoice read ${JSON.stringify(unknown.rows)}, expected refused`);
      if (await count(sql`SELECT count(*)::int AS n FROM treasury_transactions`) !== before) problems.push('a refused payment left a treasury row');

      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'a payment settles the receipt whose supplier invoice it names; empty settles the oldest; unknown is refused';
    }));
  }

  return results;
}
