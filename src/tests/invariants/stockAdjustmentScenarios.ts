import { orm, pool } from '../../db/drizzle.js';
import { itemPrices } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { fin } from '../../lib/financialDecimal.js';
import { DocumentService } from '../../services/document.service.js';
import { AccountMappingService } from '../../services/accounting/accountMapping.service.js';
import { ItemCatalogService } from '../../services/items/itemCatalog.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { createTestItem } from '../fixtures/factories.js';
import { withTestMarker } from '../fixtures/testMarker.js';
import { checkBusinessInvariants, type InvariantScope } from './businessInvariants.js';
import { invariantProblems, itemState, netByAccount, receive, watermarks } from './scenarioHelpers.js';

/**
 * v8.0.3 — سناریوهای سخت‌گیرانه اصلاح موجودی (TD-255، TD-262، TD-263) برای سوئیت business_invariants.
 * هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

async function mappedAccounts(): Promise<{ diff: number; raw: number; finished: number; diffCode: string }> {
  const diff = await AccountMappingService.getInventoryCountDifferenceAccount();
  const raw = await AccountMappingService.getInventoryRawMaterialsAccount();
  const finished = await AccountMappingService.getInventoryFinishedGoodsAccount();
  if (!diff || !raw || !finished) throw new Error('حساب «کسری و اضافات انبار» یا حساب‌های موجودی در نگاشت حساب‌ها یافت نشد');
  return { diff: diff.id, raw: raw.id, finished: finished.id, diffCode: diff.code };
}

function expectNet(problems: string[], net: Map<number, string>, accountId: number, expected: number, label: string): void {
  const actual = net.get(accountId) ?? '0';
  if (!fin(actual).equals(expected)) problems.push(`${label}: گردش خالص ${actual}، انتظار ${expected}`);
}

/**
 * TD-255 (تصمیم مالک محصول): انبارگردانی سند پیش‌نویس «کسری و اضافات انبار» با بهای کاردکس می‌گیرد؛ اضافی کالای
 * بدون WAC با بهای صفر وارد می‌شود (نه قیمت فهرست)؛ ابطال انبارگردانی سند پیش‌نویسش را حذف می‌کند.
 */
export async function checkStockCountVoucher(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const acc = await mappedAccounts();
  if (acc.diffCode !== '7012') problems.push(`سرفصل نگاشت «کسری و اضافات انبار» ۷۰۱۲ نیست: ${acc.diffCode}`);
  const mark = await watermarks();
  const raw = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const product = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const noCost = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  await orm.insert(itemPrices).values({ itemId: noCost.id, title: 'قیمت فروش آزمون TD-255', price: money(70000) });
  await receive(raw.id, 10, 50000, wh, '2025-07-01');
  await receive(product.id, 5, 80000, wh, '2025-07-01');
  const scope: InvariantScope = { ...mark, itemIds: [raw.id, product.id, noCost.id] };

  // کسری ۳ مواد (۱۵۰٬۰۰۰)، اضافی ۳ محصول (۲۴۰٬۰۰۰)، اضافی ۴ کالای بدون WAC (بهای صفر)
  const auditId = await DocumentService.createDocument({
    docType: 'audit', status: 'final', date: '2025-07-02', user: 'inv', location: wh,
    items: [
      { itemId: raw.id, quantity: 7, physical_stock: 7, location: wh },
      { itemId: product.id, quantity: 8, physical_stock: 8, location: wh },
      { itemId: noCost.id, quantity: 4, physical_stock: 4, location: wh },
    ],
  });
  const vouchers = await pool.query<{ id: number; status: string; voucher_type: string }>(
    `SELECT id, status, voucher_type FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0`, [auditId]);
  if (vouchers.rows.length !== 1) {
    problems.push(`انبارگردانی باید دقیقاً یک سند حسابداری فعال داشته باشد: ${vouchers.rows.length}`);
  } else {
    if (vouchers.rows[0].status !== 'draft') problems.push(`سند انبارگردانی باید پیش‌نویس باشد: ${vouchers.rows[0].status}`);
    const net = await netByAccount([vouchers.rows[0].id]);
    expectNet(problems, net, acc.diff, 150000 - 240000, 'کسری و اضافات انبار');
    expectNet(problems, net, acc.raw, -150000, 'موجودی مواد اولیه');
    expectNet(problems, net, acc.finished, 240000, 'موجودی کالای ساخته‌شده');
  }
  const noCostState = await itemState(noCost.id);
  if (noCostState.stock !== 4 || !fin(noCostState.wac).isZero()) {
    problems.push(`اضافی کالای بدون WAC باید با بهای صفر وارد شود (نه قیمت فهرست ۷۰٬۰۰۰): ${JSON.stringify(noCostState)}`);
  }
  problems.push(...await invariantProblems(scope, 'پس از انبارگردانی'));

  await DocumentService.deleteDocument(auditId, 'inv');
  const after = await pool.query<{ is_deleted: number }>(`SELECT is_deleted FROM journal_vouchers WHERE source_document_id = $1`, [auditId]);
  if (after.rows.length !== 1 || after.rows[0].is_deleted !== 1) {
    problems.push(`ابطال انبارگردانی باید سند پیش‌نویسش را حذف نرم کند: ${JSON.stringify(after.rows)}`);
  }
  const states = [await itemState(raw.id), await itemState(product.id), await itemState(noCost.id)].map(s => s.stock);
  if (states.join(',') !== '10,5,0') problems.push(`ابطال انبارگردانی موجودی را برنگرداند: ${states.join(',')}`);
  problems.push(...await invariantProblems(scope, 'پس از ابطال انبارگردانی'));
  return problems;
}

/**
 * TD-262: اصلاح موجودی کالای موجود از درون‌ریزی اکسل سند «کسری و اضافات انبار» با بهای کاردکس می‌گیرد و کالای تازه
 * با موجودی، سند افتتاحیه (موجودی × WAC / سرمایه اولیه)؛ ارزش انبار با دفتر کل یکی می‌ماند.
 */
export async function checkExcelAdjustmentVoucher(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const acc = await mappedAccounts();
  const stamp = Date.now().toString(36).toUpperCase();
  const mark = await watermarks();
  const existing = await createTestItem({
    type: 'raw_material', stocks: {}, weightedAverageCost: 0, code: `V803D${stamp}-101`, name: withTestMarker(`کالای اکسل ${stamp}`),
  });
  await receive(existing.id, 10, 30000, wh, '2025-07-03');
  const newCode = `V803E${stamp}-102`;

  const result = await ItemCatalogService.processUnifiedImport([
    { 'کد کالا': existing.code, 'نام کالا': existing.name, 'نوع کالا': 'ماده اولیه', 'موجودی کل': 6 },
    { 'کد کالا': newCode, 'نام کالا': withTestMarker(`کالای تازه اکسل ${stamp}`), 'نوع کالا': 'ماده اولیه', 'موجودی کل': 5, 'قیمت میانگین خرید (WAC)': 20000 },
  ], undefined, { user: { username: 'inv' } });
  if (result.errors.length > 0) problems.push(`خطای درون‌ریزی: ${JSON.stringify(result.errors)}`);
  const created = await pool.query<{ id: number }>(`SELECT id FROM items WHERE code = $1 AND is_deleted = 0`, [newCode]);
  const newItemId = created.rows[0]?.id;
  if (!newItemId) return [...problems, 'کالای تازه از اکسل ساخته نشد'];

  const adjustment = await pool.query<{ id: number; status: string }>(
    `SELECT id, status FROM journal_vouchers
      WHERE id > $1 AND is_deleted = 0 AND reference_module = 'inventory' AND reference_number = 'درون‌ریزی اکسل'`, [mark.voucherIdAfter]);
  if (adjustment.rows.length !== 1) {
    problems.push(`اصلاح موجودی از اکسل باید دقیقاً یک سند «کسری و اضافات انبار» بگیرد: ${adjustment.rows.length}`);
  } else {
    if (adjustment.rows[0].status !== 'draft') problems.push(`سند اصلاح اکسل باید پیش‌نویس باشد: ${adjustment.rows[0].status}`);
    const net = await netByAccount([adjustment.rows[0].id]);
    expectNet(problems, net, acc.diff, 120000, 'کسری و اضافات انبار (کسری ۴ × ۳۰٬۰۰۰)');
    expectNet(problems, net, acc.raw, -120000, 'موجودی مواد اولیه');
  }
  const opening = await pool.query<{ id: number }>(
    `SELECT id FROM journal_vouchers WHERE is_deleted = 0 AND reference_module = 'item_opening' AND reference_id = $1`, [newItemId]);
  if (opening.rows.length !== 1) {
    problems.push(`کالای تازه با موجودی باید سند افتتاحیه بگیرد: ${opening.rows.length}`);
  } else {
    const net = await netByAccount([opening.rows[0].id]);
    expectNet(problems, net, acc.raw, 100000, 'موجودی اولیه کالای تازه (۵ × ۲۰٬۰۰۰)');
  }
  problems.push(...await invariantProblems({ ...mark, itemIds: [existing.id, newItemId] }, 'پس از درون‌ریزی اکسل'));
  return problems;
}

/**
 * TD-264 (رفع در v8.0.5؛ نگهبان رگرسیون): درون‌ریزی اکسل WAC کالای دارای موجودی را مستقیم با ستون «قیمت میانگین خرید»
 * عوض می‌کرد؛ ارزش موجودی فعلی بدون سند حسابداری تغییر می‌کرد. true یعنی یافته دوباره بازتولید شده است.
 */
export async function probeExcelWacOverwrite(wh: string): Promise<boolean> {
  const stamp = Date.now().toString(36).toUpperCase();
  const mark = await watermarks();
  const item = await createTestItem({
    type: 'raw_material', stocks: {}, weightedAverageCost: 0, code: `V803W${stamp}-103`, name: withTestMarker(`کالای WAC اکسل ${stamp}`),
  });
  await receive(item.id, 10, 30000, wh, '2025-07-06');
  await ItemCatalogService.processUnifiedImport([
    { 'کد کالا': item.code, 'نام کالا': item.name, 'نوع کالا': 'ماده اولیه', 'موجودی کل': 10, 'قیمت میانگین خرید (WAC)': 45000 },
  ], undefined, { user: { username: 'inv' } });
  const violations = await checkBusinessInvariants({ ...mark, itemIds: [item.id] });
  return violations.some(v => v.invariant === 'I3_stock_value_equals_ledger');
}

/**
 * TD-263: انبارگردانی فقط نهایی ثبت می‌شود؛ انبارگردانی پیش‌نویسِ قدیمی (که موجودی را عوض کرده بود) نهایی نمی‌شود و
 * ابطالش موجودی را برمی‌گرداند.
 */
export async function checkAuditMustBeFinal(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  await receive(item.id, 6, 10000, wh, '2025-07-04');
  const scope: InvariantScope = { ...mark, itemIds: [item.id] };
  const audit = (status: 'draft' | 'final', skipVoucherSync = false) => DocumentService.createDocument({
    docType: 'audit', status, date: '2025-07-05', user: 'inv', location: wh, skipVoucherSync,
    items: [{ itemId: item.id, quantity: 2, physical_stock: 2, location: wh }],
  });

  let draftRejected = false;
  try {
    await audit('draft');
  } catch (err) {
    draftRejected = getErrorMessage(err).includes('نهایی');
  }
  if (!draftRejected) problems.push('انبارگردانی پیش‌نویس رد نشد');
  const afterDraft = await itemState(item.id);
  if (afterDraft.stock !== 6) problems.push(`انبارگردانی پیش‌نویس ردشده موجودی را تغییر داد: ${afterDraft.stock}`);

  // انبارگردانی پیش‌نویس قدیمی: موجودی ۶ ← ۲ اعمال شده و سند در وضعیت پیش‌نویس مانده (بدون سند حسابداری)
  const legacyId = await audit('final', true);
  await pool.query(`UPDATE documents SET status = 'draft' WHERE id = $1`, [legacyId]);
  let finalizeRejected = false;
  try {
    await DocumentService.finalizeDocument(legacyId, 'inv');
  } catch (err) {
    finalizeRejected = getErrorMessage(err).includes('انبارگردانی');
  }
  if (!finalizeRejected) problems.push('نهایی‌سازی انبارگردانی پیش‌نویس رد نشد');
  const afterFinalize = await itemState(item.id);
  if (afterFinalize.stock !== 2) problems.push(`نهایی‌سازی انبارگردانی پیش‌نویس موجودی را دوباره تغییر داد: ${afterFinalize.stock}`);

  await DocumentService.deleteDocument(legacyId, 'inv');
  const afterVoid = await itemState(item.id);
  if (afterVoid.stock !== 6) problems.push(`ابطال انبارگردانی پیش‌نویس قدیمی موجودی را برنگرداند: ${afterVoid.stock}`);
  problems.push(...await invariantProblems(scope, 'پس از ابطال انبارگردانی پیش‌نویس'));
  return problems;
}

/**
 * TD-264 (تصمیم مالک محصول — گزینه الف): ردیف اکسلی که WAC کالای دارای موجودی را تغییر می‌دهد ثبت نمی‌شود و با پیام
 * روشن در فهرست خطاها می‌آید؛ مقدار برابر WAC فعلی (کمتر از ۱ ریال اختلاف) و کالای بدون موجودی آزادند و ردیف‌های دیگر
 * همان فایل ثبت می‌شوند.
 */
export async function checkExcelWacChangeRefused(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const stamp = Date.now().toString(36).toUpperCase();
  const mark = await watermarks();
  const stocked = await createTestItem({
    type: 'raw_material', stocks: {}, weightedAverageCost: 0, reorderPoint: 3, code: `V805S${stamp}-104`, name: withTestMarker(`کالای WAC دارای موجودی ${stamp}`),
  });
  const empty = await createTestItem({
    type: 'raw_material', stocks: {}, weightedAverageCost: 0, reorderPoint: 3, code: `V805Z${stamp}-105`, name: withTestMarker(`کالای WAC بدون موجودی ${stamp}`),
  });
  await receive(stocked.id, 10, 30000, wh, '2025-10-07');
  const reorderOf = async (id: number) => Number((await pool.query<{ r: string }>('SELECT reorder_point::text AS r FROM items WHERE id = $1', [id])).rows[0]?.r);

  const refused = await ItemCatalogService.processUnifiedImport([
    { 'کد کالا': stocked.code, 'نام کالا': stocked.name, 'نوع کالا': 'ماده اولیه', 'نقطه سفارش': 7, 'قیمت میانگین خرید (WAC)': 45000 },
    { 'کد کالا': empty.code, 'نام کالا': empty.name, 'نوع کالا': 'ماده اولیه', 'نقطه سفارش': 8, 'قیمت میانگین خرید (WAC)': 25000 },
  ], undefined, { user: { username: 'inv' } });
  const rowError = refused.errors.find(e => e.code === stocked.code);
  if (!rowError || !rowError.message.includes('WAC')) problems.push(`ردیف تغییر WAC کالای دارای موجودی در فهرست خطاها نیامد: ${JSON.stringify(refused.errors)}`);
  const afterRefused = await itemState(stocked.id);
  if (!fin(afterRefused.wac).equals(30000) || await reorderOf(stocked.id) !== 3) {
    problems.push(`ردیف ردشده نباید ثبت شود: WAC ${afterRefused.wac}، نقطه سفارش ${await reorderOf(stocked.id)}`);
  }
  const emptyState = await itemState(empty.id);
  if (!fin(emptyState.wac).equals(25000) || await reorderOf(empty.id) !== 8) {
    problems.push(`کالای بدون موجودی باید WAC و نقطه سفارش فایل را بگیرد: WAC ${emptyState.wac}، نقطه سفارش ${await reorderOf(empty.id)}`);
  }

  const sameValue = await ItemCatalogService.processUnifiedImport([
    { 'کد کالا': stocked.code, 'نام کالا': stocked.name, 'نوع کالا': 'ماده اولیه', 'نقطه سفارش': 9, 'قیمت میانگین خرید (WAC)': 30000.4 },
  ], undefined, { user: { username: 'inv' } });
  const afterSame = await itemState(stocked.id);
  if (sameValue.errors.length > 0 || !fin(afterSame.wac).equals(30000) || await reorderOf(stocked.id) !== 9) {
    problems.push(`WAC برابر مقدار فعلی (با کمتر از ۱ ریال اختلاف) باید بی‌خطا بماند و WAC فعلی حفظ شود: ${JSON.stringify(sameValue.errors)}، WAC ${afterSame.wac}`);
  }
  problems.push(...await invariantProblems({ ...mark, itemIds: [stocked.id, empty.id] }, 'پس از درون‌ریزی'));
  return problems;
}
