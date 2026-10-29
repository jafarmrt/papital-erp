import { eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { crmLeads } from '../../db/schema.js';
import type { StockImportResult, StockImportRow } from '../../lib/historyImport/stockHistoryImport.js';
import type { TreasuryImportResult, TreasuryImportRow } from '../../lib/historyImport/treasuryHistoryImport.js';
import { createTestCustomer, createTestItem, createTestWarehouse } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';
import { brief, ok } from './receiptsOnInvoicesV11Tests.js';
import { emptyBank } from './historyImportTreasuryV11Tests.js';

/**
 * v11 history import, tool 3 (the 1405 replay from Excel): past sales invoices from the sheet «اقلام فاکتور», posted with
 * the warehouse rows of the month as final invoices on their own day; a past return («مرجوعی») goes back on the invoice its
 * Excel number names, and a past receipt that names the Excel invoice settles that invoice first. Real Express routes and
 * services on PostgreSQL, each scenario in its own schema. Red before this change: the route refused the kinds `sale` and
 * `return` (400) and the table history_import_refs did not exist.
 */

const STOCK_URL = '/api/inventory/history-import';
const TREASURY_URL = '/api/accounting/treasury/history-import';
const IN = 'ورود به انبار';
const SALES = 'اقلام فاکتور';

type Client = Awaited<ReturnType<typeof sandboxAdminClient>> | Awaited<ReturnType<typeof sandboxClientWith>>;

const count = async (query: ReturnType<typeof sql>) => Number(((await orm.execute(query)).rows[0] as { n: number | string }).n);
const footprint = async () => ({
  kardex: await count(sql`SELECT count(*)::int AS n FROM transactions`),
  documents: await count(sql`SELECT count(*)::int AS n FROM documents`),
  refs: await count(sql`SELECT count(*)::int AS n FROM history_import_refs`),
  vouchers: await count(sql`SELECT count(*)::int AS n FROM journal_vouchers`),
  audit: await count(sql`SELECT count(*)::int AS n FROM activity_logs`),
  outbox: await count(sql`SELECT count(*)::int AS n FROM outbox_events`),
  counters: await count(sql`SELECT coalesce(sum(last_ref_number), 0)::int AS n FROM document_ref_counters`),
});
const sameFootprint = (a: Record<string, number>, b: Record<string, number>) => Object.keys(a).filter(k => a[k] !== b[k]).map(k => `${k} ${a[k]} -> ${b[k]}`);

async function postTo<T>(client: Client, url: string, rows: unknown[], commit: boolean): Promise<T> {
  const res = await client.post(url, { commit, rows });
  // a post that recorded nothing answers 409 with its rows, so its key is released
  if (commit && res.status === 409 && res.body?.code === 'HISTORY_IMPORT_NOT_POSTED') return res.body.details as T;
  if (!ok(res)) throw new Error(`the import (${commit ? 'post' : 'preview'}) returned ${brief(res)}`);
  return res.body as T;
}
const stockPost = (client: Client, rows: StockImportRow[], commit: boolean) => postTo<StockImportResult>(client, STOCK_URL, rows, commit);
const rowOf = (result: StockImportResult, rowNo: number, sheet = SALES) => result.rows.find(r => r.rowNo === rowNo && r.sheet === sheet);
const fresh = () => createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });

async function invoiceOfRef(refNumber: string | undefined) {
  const res = await orm.execute(sql`SELECT d.id, d.type, d.status, d.party_id AS "partyId", to_char(d.date, 'YYYY-MM-DD') AS day, d.return_of_document_id AS "returnOf",
      (SELECT coalesce(sum(di.quantity * di.unit_price), 0)::float FROM document_items di WHERE di.document_id = d.id AND di.is_deleted = 0) AS total
    FROM documents d WHERE d.ref_number = ${refNumber ?? ''} AND d.is_deleted = 0 AND d.type IN ('invoice', 'return')`);
  return res.rows as Array<{ id: number; type: string; status: string; partyId: number; day: string; returnOf: number | null; total: number }>;
}

async function stockOf(itemId: number): Promise<number> {
  return count(sql`SELECT coalesce(sum(current_stock), 0)::int AS n FROM item_warehouse_stocks WHERE item_id = ${itemId}`);
}

export async function runHistoryImportSalesV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const posting = 'reg_history_import_sales_v11';
  if (shouldRun(posting, 'v11', 'history_import', 'sales', 'stock')) {
    await runCase(results, posting, 'v11 history import (tool 3): the lines of two Excel invoices, posted with the opening stock of the month, become two final sales invoices on their own days with their customer and prices; a return names its Excel invoice and goes back on it; a preview keeps nothing (no invoice, Excel number link, Kardex row, voucher, audit row, event or number); a receipt that names the later Excel invoice settles that one, not the older open invoice', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const a = await fresh();
      const b = await fresh();
      const customer = await createTestCustomer({ partyType: 'customer' });

      const rows: StockImportRow[] = [
        { rowNo: 2, sheet: IN, date: '1405-01-01', kind: 'opening', itemCode: a.code, quantity: '20', unitCost: '50000' },
        { rowNo: 3, sheet: IN, date: '1405-01-01', kind: 'opening', itemCode: b.code, quantity: '5', unitCost: '40000' },
        { rowNo: 4, sheet: IN, date: '1405-03-25', kind: 'return', itemCode: a.code, quantity: '1', invoiceRef: 'فاکتور ۵۰' },
        { rowNo: 2, sheet: SALES, date: '1405-03-21', kind: 'sale', itemCode: a.code, quantity: '11', unitPrice: '2625000', invoiceRef: '50', customerId: customer.id },
        { rowNo: 3, sheet: SALES, date: '1405-03-21', kind: 'sale', itemCode: b.code, quantity: '2', unitPrice: '3000000', invoiceRef: '50', customerId: customer.id },
        { rowNo: 4, sheet: SALES, date: '1405-03-01', kind: 'sale', itemCode: a.code, quantity: '1', unitPrice: '1000000', invoiceRef: '49', customerId: customer.id },
      ];

      const before = await footprint();
      const preview = await stockPost(admin, rows, false);
      const moved = sameFootprint(before, await footprint());
      if (preview.committed || preview.okCount !== rows.length) problems.push(`the preview read ${JSON.stringify(preview.rows)}, expected every row ok and nothing committed`);
      if (moved.length > 0) problems.push(`the preview left a trace: ${moved.join(', ')}`);

      const posted = await stockPost(admin, rows, true);
      if (!posted.committed) problems.push(`the post read ${JSON.stringify(posted.rows)}, expected committed`);
      const ref50 = rowOf(posted, 2)?.created?.[0];
      if (!ref50 || rowOf(posted, 3)?.created?.[0] !== ref50) problems.push(`the two lines of invoice 50 went to ${JSON.stringify([rowOf(posted, 2)?.created, rowOf(posted, 3)?.created])}, expected one invoice`);
      const [inv50] = (await invoiceOfRef(ref50)).filter(d => d.type === 'invoice');
      if (!inv50 || inv50.status !== 'final' || Number(inv50.partyId) !== customer.id || inv50.day !== '2026-06-11' || inv50.total !== 34_875_000) {
        problems.push(`invoice 50 reads ${JSON.stringify(inv50)}, expected final, the customer, 1405-03-21 (2026-06-11) and 34,875,000 (11 x 2,625,000 + 2 x 3,000,000)`);
      }
      const link = await count(sql`SELECT count(*)::int AS n FROM history_import_refs WHERE kind = 'sales_invoice' AND excel_ref = '50' AND document_id = ${inv50?.id ?? 0}`);
      if (link !== 1) problems.push('the Excel number 50 is not linked to its invoice');
      const [ret] = (await invoiceOfRef(rowOf(posted, 4, IN)?.created?.[0])).filter(d => d.type === 'return');
      if (!ret || Number(ret.returnOf) !== inv50?.id || ret.day !== '2026-06-15') problems.push(`the return reads ${JSON.stringify(ret)}, expected a return of invoice 50 on 1405-03-25 (2026-06-15)`);
      if (await stockOf(a.id) !== 9) problems.push(`item a ends at ${await stockOf(a.id)}, expected 9 (20 - 1 - 11 + 1)`);
      if (await stockOf(b.id) !== 3) problems.push(`item b ends at ${await stockOf(b.id)}, expected 3`);

      // a receipt that names «فاكتور ۵۰» (Arabic kaf, as Excel often has it) settles invoice 50 although invoice 49 of the same customer is older and open
      const bank = await emptyBank();
      const receipt: TreasuryImportRow = {
        rowNo: 2, sheet: 'دریافت و پرداخت', date: '1405-04-01', kind: 'receipt', bankAccountId: bank, amount: '5000000',
        partyType: 'customer', partyId: customer.id, partyName: customer.name, invoiceRef: 'فاكتور ۵۰', settleOldest: true,
      };
      const paid = await postTo<TreasuryImportResult>(admin, TREASURY_URL, [receipt], true);
      const settled = paid.rows[0]?.settled ?? [];
      if (!paid.committed || settled.length !== 1 || settled[0].refNumber !== ref50 || settled[0].amount !== 5_000_000) problems.push(`the receipt read ${JSON.stringify(paid.rows)}, expected 5,000,000 settled on invoice ${ref50}`);
      // a cheque number in the reference column names no invoice: the oldest open invoice (49) is settled
      const cheque = await postTo<TreasuryImportResult>(admin, TREASURY_URL, [{ ...receipt, rowNo: 3, date: '1405-04-02', amount: '1000', invoiceRef: 'چک 50' }], true);
      const ref49 = rowOf(posted, 4)?.created?.[0];
      if (!cheque.committed || cheque.rows[0]?.settled?.[0]?.refNumber !== ref49) problems.push(`a receipt referring to a cheque number read ${JSON.stringify(cheque.rows)}, expected the oldest invoice ${ref49} settled`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'past invoices are final on their days, a return goes back on its Excel invoice, a receipt settles the invoice it names';
    }));
  }

  const refusals = 'reg_history_import_sales_refusals_v11';
  if (shouldRun(refusals, 'v11', 'history_import', 'sales', 'stock')) {
    await runCase(results, refusals, 'v11 history import (tool 3): an Excel invoice already imported, a return of an Excel invoice not in the app, an invoice whose lines have two days and a sale by a user who may not record a final invoice are refused with their reason, and nothing is kept', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const a = await fresh();
      const customer = await createTestCustomer({ partyType: 'customer' });
      const opening: StockImportRow = { rowNo: 2, sheet: IN, date: '1405-01-01', kind: 'opening', itemCode: a.code, quantity: '20', unitCost: '50000' };
      const sale = (rowNo: number, invoiceRef: string, date = '1405-02-01'): StockImportRow => ({ rowNo, sheet: SALES, date, kind: 'sale', itemCode: a.code, quantity: '1', unitPrice: '1000000', invoiceRef, customerId: customer.id });
      const first = await stockPost(admin, [opening, sale(2, '70')], true);
      if (!first.committed) problems.push(`the setup read ${JSON.stringify(first.rows)}`);

      const before = await footprint();
      const again = await stockPost(admin, [
        sale(2, '70', '1405-02-05'),
        { rowNo: 5, sheet: IN, date: '1405-02-06', kind: 'return', itemCode: a.code, quantity: '1', invoiceRef: '999' },
        sale(3, '71', '1405-02-07'), sale(4, '71', '1405-02-08'),
      ], true);
      if (again.committed) problems.push('a file with refused rows was posted');
      const refusedWith = (rowNo: number, sheet: string, part: string) => {
        const r = again.rows.find(x => x.rowNo === rowNo && x.sheet === sheet);
        if (r?.status !== 'error' || !String(r?.message).includes(part)) problems.push(`row ${rowNo} of ${sheet} reads ${JSON.stringify(r)}, expected an error naming «${part}»`);
      };
      refusedWith(2, SALES, 'پیش‌تر');
      refusedWith(5, IN, 'در برنامه نیست');
      refusedWith(3, SALES, 'تاریخ‌های مختلف');
      const moved = sameFootprint(before, await footprint());
      if (moved.length > 0) problems.push(`a refused post left a trace: ${moved.join(', ')}`);

      // a sale leaves the warehouse the row names (the window's «انبار فروش»), not the default one
      const show = await createTestWarehouse();
      const b = await fresh();
      const shown = await stockPost(admin, [
        { rowNo: 6, sheet: IN, date: '1405-01-01', kind: 'opening', itemCode: b.code, quantity: '3', unitCost: '50000', warehouse: show.code },
        { ...sale(5, '73', '1405-02-10'), itemCode: b.code, warehouse: show.code },
      ], true);
      const left = await count(sql`SELECT coalesce(sum(current_stock), 0)::int AS n FROM item_warehouse_stocks WHERE item_id = ${b.id} AND warehouse_code = ${show.code}`);
      if (!shown.committed || left !== 2) problems.push(`a sale from the display warehouse read ${JSON.stringify(shown.rows)} and left ${left} there, expected committed and 2`);

      const keeper = await sandboxClientWith(['warehouse.history_import', 'warehouse.in', 'warehouse.out']);
      const denied = await stockPost(keeper, [sale(2, '72', '1405-02-09')], false);
      const d = denied.rows[0];
      if (d?.status !== 'error' || !String(d?.message).includes('مجوز')) problems.push(`a sale by a user who may not record a final invoice reads ${JSON.stringify(denied.rows)}, expected refused`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'an invoice is imported once, a return needs its invoice, an invoice has one day, a sale needs the invoice permission';
    }));
  }

  const leadsId = 'reg_history_import_sales_leads_v11';
  if (shouldRun(leadsId, 'v11', 'history_import', 'sales', 'crm')) {
    await runCase(results, leadsId, 'v11 history import (tool 3, sales file column): an Excel invoice that names its sales file links to it and moves it to won, as a proforma becoming an invoice does; a missing file, a file of another customer, a lost file (left lost) and a file that already has an invoice are refused; a sales line priced under 1,000 rials (a euro price) is refused', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const a = await fresh();
      const customer = await createTestCustomer({ partyType: 'customer' });
      const other = await createTestCustomer({ partyType: 'customer' });
      const lead = async (title: string, customerId: number, extra: Partial<typeof crmLeads.$inferInsert> = {}) =>
        (await orm.insert(crmLeads).values({ title, customerId, stage: 'lead', status: 'active', ...extra }).returning({ id: crmLeads.id }))[0].id;
      const open = await lead('open file', customer.id);
      const lost = await lead('lost file', customer.id, { stage: 'lost', status: 'lost' });
      const ofOther = await lead('other customer file', other.id);
      const withProforma = await lead('file with a proforma', customer.id, { hasProforma: 1, proformaId: 2147480000 });

      const opening = await stockPost(admin, [{ rowNo: 2, sheet: IN, date: '1405-01-01', kind: 'opening', itemCode: a.code, quantity: '50', unitCost: '50000' }], true);
      if (!opening.committed) throw new Error(`setup: opening ${JSON.stringify(opening.rows)}`);
      const sale = (rowNo: number, invoiceRef: string, extra: Partial<StockImportRow> = {}): StockImportRow =>
        ({ rowNo, sheet: SALES, date: '1405-02-10', kind: 'sale', itemCode: a.code, quantity: '1', unitPrice: '2000000', invoiceRef, customerId: customer.id, ...extra });

      const linked = await stockPost(admin, [sale(2, '60', { leadId: open })], true);
      const [inv] = await invoiceOfRef(rowOf(linked, 2)?.created?.[0]);
      const [row] = (await orm.select().from(crmLeads).where(eq(crmLeads.id, open)));
      const docLead = inv ? await count(sql`SELECT coalesce(crm_lead_id, 0)::int AS n FROM documents WHERE id = ${inv.id}`) : 0;
      if (!linked.committed || !inv || row?.stage !== 'won' || row?.status !== 'won' || row?.proformaId !== inv.id || docLead !== open) {
        problems.push(`the invoice naming the open file read ${JSON.stringify(linked.rows)}, file ${JSON.stringify({ stage: row?.stage, status: row?.status, proformaId: row?.proformaId })}, document lead ${docLead}; expected linked and won`);
      }

      const refusals: Array<[string, StockImportRow, string]> = [
        ['a missing file', sale(2, '61', { quantity: '2', leadId: 2147480001 }), 'در برنامه نیست'],
        ['a file of another customer', sale(2, '62', { quantity: '3', leadId: ofOther }), 'مشتری دیگری'],
        ['a lost file', sale(2, '63', { quantity: '4', leadId: lost }), 'از دست رفته'],
        ['a file with a proforma', sale(2, '64', { quantity: '5', leadId: withProforma }), 'فاکتور دیگری'],
        ['a second invoice of the won file', sale(2, '65', { quantity: '6', leadId: open }), 'فاکتور دیگری'],
        ['a euro price', sale(2, '66', { quantity: '7', unitPrice: '5.5' }), 'بسیار کم'],
      ];
      for (const [name, r, text] of refusals) {
        const res = await stockPost(admin, [r], true);
        const out = rowOf(res, 2);
        if (res.committed || out?.status !== 'error' || !String(out?.message).includes(text)) problems.push(`${name} read ${JSON.stringify(res.rows)}, expected the matching refusal`);
      }
      const [lostRow] = await orm.select({ stage: crmLeads.stage, status: crmLeads.status }).from(crmLeads).where(eq(crmLeads.id, lost));
      if (lostRow?.stage !== 'lost' || lostRow?.status !== 'lost') problems.push(`the lost file became ${JSON.stringify(lostRow)}`);

      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'the invoice closed its file; the five wrong links and the euro price were refused; the lost file stayed lost';
    }));
  }

  return results;
}
