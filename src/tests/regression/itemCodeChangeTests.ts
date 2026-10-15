import crypto from 'crypto';
import { inArray } from 'drizzle-orm';
import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { orm } from '../../db/drizzle.js';
import { customers, woocommerceOrderLogs } from '../../db/schema.js';
import { cleanTestTableData } from '../fixtures/dbTestHelper.js';
import { runReservationCases } from './stockReservationTests.js';
import { brief, fixture } from './documentEntryTests.js';

/**
 * Series 10.1, lane L2 (v10.1.9): the item code changes only through its own operation (D-15, TD-1264), website orders
 * and Excel files with an earlier code still find the item, and the sales invoice picker of an open proforma leaves out
 * that proforma's own reservation (TD-1209). Red on v10.1.6: PUT /items/:id changed the code, the change-code route and
 * the history table did not exist, an order with the old SKU failed, and the picker counted the proforma's reservation.
 */
export async function runItemCodeChangeTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_item_code_change_operation_d15',
      'v10.1.9: the item code changes only through change-code with products.change_code and a reason; history and audit rows are written (D-15)',
      ['d15', 'td1263', 'item', 'code', 'permissions'], changeOperationCase],
    ['reg_woocommerce_order_old_code_d15',
      'v10.1.9: a WooCommerce order line with an earlier code finds the item and the order log names the old code; a current code wins (D-15)',
      ['d15', 'td1263', 'woocommerce', 'item'], wooOldCodeCase],
    ['reg_item_excel_import_old_code_d15',
      'v10.1.9: an Excel row with an item\'s earlier code edits that item instead of creating another one (D-15)',
      ['d15', 'td1263', 'item', 'excel'], excelOldCodeCase],
    ['reg_invoice_picker_own_reservation_td_1209',
      'v10.1.9: the sales invoice item picker of an open proforma leaves out that proforma\'s own reservation (TD-1209)',
      ['td1209', 'reservation', 'proforma', 'items'], pickerOwnReservationCase],
  ]);
}

const digits = (n: number) => String(crypto.randomInt(10 ** (n - 1), 10 ** n));
/** A product code «YYYY-Z-TTT-SS» no other test uses */
const productCode = () => `1404-Z-${digits(3)}-${digits(2)}`;

async function newProduct(h: Harness, code = productCode()): Promise<{ id: number; code: string; version: number }> {
  const res = await h.post('/api/items', { type: 'product', name: `کد کالا ${h.tag} ${digits(6)}`, code, unit: 'عدد', category: 'دستبند' });
  const id = Number((res.body as { id?: number }).id ?? (res.body as { data?: { id?: number } }).data?.id);
  if (res.status >= 300 || !id) throw new Error(`setup: item create answered ${brief(res)}`);
  const [row] = await h.q(`SELECT version FROM items WHERE id = $1`, [id]);
  return { id, code, version: Number(row.version) };
}

async function changeOperationCase(h: Harness, wrong: string[]): Promise<string> {
  const item = await newProduct(h);
  const other = await newProduct(h);
  const url = `/api/items/${item.id}/change-code`;

  const viaEdit = await h.put(`/api/items/${item.id}`, { name: `ویرایش ${h.tag} ${digits(6)}`, code: productCode(), unit: 'عدد', version: item.version });
  if (viaEdit.status !== 422 || (viaEdit.body as { code?: string }).code !== 'ITEM_CODE_CHANGE_SEPARATE') wrong.push(`a code change through the item edit answered ${brief(viaEdit)}, expected 422 ITEM_CODE_CHANGE_SEPARATE`);

  const editor = await h.sessionWith(['products.view', 'products.edit']);
  const denied = await h.post(url, { code: productCode(), reason: 'آزمون', version: item.version }, editor);
  if (denied.status !== 403) wrong.push(`products.edit alone changed the code: ${brief(denied)}`);

  const noReason = await h.post(url, { code: productCode(), reason: '  ', version: item.version });
  if (noReason.status !== 400) wrong.push(`a blank reason answered ${brief(noReason)}, expected 400`);
  const taken = await h.post(url, { code: other.code, reason: 'آزمون', version: item.version });
  if (taken.status !== 409) wrong.push(`another item's code answered ${brief(taken)}, expected 409`);
  const badFormat = await h.post(url, { code: 'BAD', reason: 'آزمون', version: item.version });
  if (badFormat.status !== 422 || (badFormat.body as { code?: string }).code !== 'ITEM_CODE_FORMAT') wrong.push(`a code in the wrong format answered ${brief(badFormat)}, expected 422 ITEM_CODE_FORMAT`);
  const stale = await h.post(url, { code: productCode(), reason: 'آزمون', version: item.version + 5 });
  if (stale.status !== 409) wrong.push(`a stale version answered ${brief(stale)}, expected 409`);

  const changer = await h.sessionWith(['products.view', 'products.edit', 'products.change_code']);
  const newCode = productCode();
  const ok = await h.post(url, { code: newCode, reason: 'یکسان‌سازی با کد سایت', version: item.version }, changer);
  if (ok.status !== 200) {
    wrong.push(`the change answered ${brief(ok)}, expected 200`);
    return 'change refused';
  }
  const [row] = await h.q(`SELECT code, version FROM items WHERE id = $1`, [item.id]);
  if (row.code !== newCode || Number(row.version) !== item.version + 1) wrong.push(`stored code/version ${row.code}/${row.version}, expected ${newCode}/${item.version + 1}`);
  const history = await h.q(`SELECT old_code, new_code, reason, user_id FROM item_code_history WHERE item_id = $1`, [item.id]);
  if (history.length !== 1 || history[0].old_code !== item.code || history[0].new_code !== newCode || history[0].reason !== 'یکسان‌سازی با کد سایت'
    || Number(history[0].user_id) !== changer.userId) wrong.push(`history rows ${JSON.stringify(history)}`);
  const audit = await h.q(`SELECT details FROM activity_logs WHERE entity = 'کالا' AND entity_id = $1 AND action = 'CHANGE_CODE'`, [String(item.id)]);
  const details = audit[0]?.details as { before?: { code?: string }; after?: { code?: string } } | undefined;
  if (audit.length !== 1 || details?.before?.code !== item.code || details?.after?.code !== newCode) wrong.push(`audit rows ${JSON.stringify(audit)}`);
  const listed = await h.get(`/api/items/${item.id}/code-history`);
  const listedRows = (listed.body as { data?: Array<{ oldCode?: string; createdAt?: string }> }).data ?? [];
  if (listed.status !== 200 || listedRows[0]?.oldCode !== item.code || !String(listedRows[0]?.createdAt).endsWith('Z')) wrong.push(`code history answered ${brief(listed)}`);
  const same = await h.post(url, { code: newCode, reason: 'آزمون', version: item.version + 1 });
  if (same.status !== 422 || (same.body as { code?: string }).code !== 'ITEM_CODE_UNCHANGED') wrong.push(`the same code answered ${brief(same)}, expected 422 ITEM_CODE_UNCHANGED`);
  return `edit ${viaEdit.status}; no permission ${denied.status}; change ${ok.status}; history ${history.length}`;
}

async function wooOldCodeCase(h: Harness, wrong: string[]): Promise<string> {
  const { WooOrderSyncService } = await import('../../services/woocommerce/wooOrderSync.service.js');
  const { createTestItem } = await import('../fixtures/factories.js');
  const oldCode = productCode();
  const item = await createTestItem({ type: 'product', code: oldCode, stocks: { '': 20 } } as never);
  const itemId = Number(item.id);
  const [{ version }] = await h.q(`SELECT version FROM items WHERE id = $1`, [itemId]);
  const changed = await h.post(`/api/items/${itemId}/change-code`, { code: productCode(), reason: 'آزمون سفارش سایت', version: Number(version) });
  if (changed.status !== 200) throw new Error(`setup: change-code answered ${brief(changed)}`);

  const orderIds = [`15${h.tag}${digits(6)}`, `16${h.tag}${digits(6)}`];
  const order = (wcId: string, sku: string) => ({
    id: wcId, number: wcId, status: 'processing', currency: 'IRR', total: '500000',
    billing: { first_name: 'ERP-TEST-MARKER خریدار', last_name: `کد قدیم ${h.tag}`, phone: `0936${digits(7)}`, city: 'تهران', address_1: 'خیابان آزمون' },
    line_items: [{ id: 1, name: 'قلم آزمون', sku, quantity: 1, price: 500000, total: '500000' }],
  });
  const docIds: number[] = [];
  try {
    const first = await WooOrderSyncService.handleOrder(order(orderIds[0], oldCode));
    if (first.status !== 'processed' || !first.docId) wrong.push(`an order with the old code: ${first.status} ${first.message}`);
    else {
      docIds.push(first.docId);
      const lines = await h.q(`SELECT item_id FROM document_items WHERE document_id = $1 AND is_deleted = 0`, [first.docId]);
      if (lines.length !== 1 || Number(lines[0].item_id) !== itemId) wrong.push(`invoice lines ${JSON.stringify(lines)}, expected item ${itemId}`);
      const [log] = await h.q(`SELECT error_message FROM woocommerce_order_logs WHERE wc_order_id = $1`, [orderIds[0]]);
      if (!String(log?.error_message ?? '').includes(oldCode)) wrong.push(`the order log does not name the old code: «${log?.error_message}»`);
    }

    // a live item that now holds the old code as its current code wins over the history
    const holder = await createTestItem({ type: 'product', code: oldCode, stocks: { '': 5 } } as never);
    const second = await WooOrderSyncService.handleOrder(order(orderIds[1], oldCode));
    if (second.status !== 'processed' || !second.docId) wrong.push(`an order with a reused code: ${second.status} ${second.message}`);
    else {
      docIds.push(second.docId);
      const lines = await h.q(`SELECT item_id FROM document_items WHERE document_id = $1 AND is_deleted = 0`, [second.docId]);
      if (Number(lines[0]?.item_id) !== Number(holder.id)) wrong.push(`a reused code went to item ${lines[0]?.item_id}, expected the current holder ${holder.id}`);
    }
  } finally {
    const buyers = await orm.select({ name: woocommerceOrderLogs.buyerName }).from(woocommerceOrderLogs).where(inArray(woocommerceOrderLogs.wcOrderId, orderIds));
    await orm.delete(woocommerceOrderLogs).where(inArray(woocommerceOrderLogs.wcOrderId, orderIds));
    if (docIds.length > 0) {
      await cleanTestTableData('document_items', 'document_id', docIds);
      await cleanTestTableData('transactions', 'document_id', docIds);
    }
    const names = buyers.map(b => b.name).filter((n): n is string => Boolean(n));
    if (names.length > 0) await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.name, names));
  }
  return `old code ${oldCode} found item ${itemId}`;
}

async function excelOldCodeCase(h: Harness, wrong: string[]): Promise<string> {
  const { importItemsFromExcel } = await import('../../services/items/itemExcelImport.js');
  const item = await newProduct(h);
  const changed = await h.post(`/api/items/${item.id}/change-code`, { code: productCode(), reason: 'آزمون اکسل', version: item.version });
  if (changed.status !== 200) throw new Error(`setup: change-code answered ${brief(changed)}`);
  const [before] = await h.q(`SELECT name, code FROM items WHERE id = $1`, [item.id]);
  const result = await importItemsFromExcel([
    { 'کد کالا': item.code, 'نام محصول': before.name, 'نوع کالا': 'محصول نهایی', 'رنگ': 'طلایی' },
  ], 'product', { username: 'admin' }, { createItems: true, editItems: true, editPrices: true, stockIn: true, stockOut: true });
  const holders = await h.q(`SELECT id FROM items WHERE code = $1 AND is_deleted = 0`, [item.code]);
  if (holders.length > 0) wrong.push(`the import created item ${holders[0].id} with the old code`);
  const [after] = await h.q(`SELECT code, color FROM items WHERE id = $1`, [item.id]);
  if (after.color !== 'طلایی') wrong.push(`the old-code row did not edit the item: color ${after.color}, errors ${JSON.stringify(result.errors)}`);
  if (after.code !== before.code) wrong.push(`the import changed the code to ${after.code}`);
  return `errors ${result.errors.length}; color ${after.color}`;
}

async function pickerOwnReservationCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const itemId = await f.item(10);
  const proforma = await h.post('/api/documents', f.doc('invoice', 'proforma', [{ itemId, quantity: 4, unit_price: 5_000, location: f.wh }]));
  if (proforma.status !== 200) throw new Error(`setup: proforma answered ${brief(proforma)}`);
  const docId = Number((proforma.body as { docId?: unknown }).docId);
  const [{ code }] = await h.q(`SELECT code FROM items WHERE id = $1`, [itemId]);
  const reservedOf = async (url: string) => {
    const res = await h.get(url);
    const pick = ((res.body as { data?: Array<{ id: number; reservedStock?: number }> }).data ?? []).find(p => Number(p.id) === itemId);
    return { status: res.status, reserved: pick?.reservedStock };
  };
  const plain = await reservedOf(`/api/items/options?reserved=1&search=${encodeURIComponent(String(code))}`);
  const own = await reservedOf(`/api/items/options?reserved=1&search=${encodeURIComponent(String(code))}&excludeDocumentId=${docId}`);
  if (plain.reserved !== 4) wrong.push(`new invoice picker reserved ${JSON.stringify(plain)}, expected 4`);
  if (own.reserved !== 0) wrong.push(`the proforma's own picker reserved ${JSON.stringify(own)}, expected 0`);
  return `reserved for a new invoice ${plain.reserved}, for the proforma itself ${own.reserved}`;
}
