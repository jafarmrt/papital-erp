import { pool } from '../../db/drizzle.js';
import { fin } from '../../lib/financialDecimal.js';
import { DocumentService } from '../../services/document.service.js';
import { InventoryIntegrityService } from '../../services/inventory/inventoryIntegrity.service.js';
import { KardexWacRecalculatorService } from '../../services/inventory/kardexWacRecalculator.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { createTestItem, createTestWarehouse } from '../fixtures/factories.js';
import { checkBusinessInvariants, type InvariantScope } from './businessInvariants.js';
import { invariantProblems, itemState, receive, watermarks } from './scenarioHelpers.js';

/**
 * v8.0.4 — سناریوهای سخت‌گیرانه قاعده تاریخ گردش انبار (TD-257) و همخوانی بازسازی کاردکس با موتور زنده (TD-258).
 * هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

async function sell(itemId: number, quantity: number, wh: string, date: string, allowBackdate = false, status: 'final' | 'draft' = 'final'): Promise<number> {
  const { docId } = await DocumentService.createDocumentWithDetails({
    docType: 'invoice', inOut: 'out', status, date, user: 'inv', buyerName: 'مشتری آزمون تاریخ انبار',
    items: [{ itemId, quantity, unitPrice: 250000, location: wh }],
  }, { allowBackdate });
  return docId;
}

/** اجرای عملیات و برگرداندن پیام خطا (یا null اگر پذیرفته شد) */
async function rejection(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return getErrorMessage(err);
  }
}

/**
 * TD-257 (تصمیم مالک محصول): گردش با تاریخ پیش از آخرین گردش کالا بی‌مجوز رد می‌شود (فاکتور، نهایی‌سازی، انتقال)؛ با
 * مجوز فقط وقتی پذیرفته می‌شود که موجودی تا آن تاریخ و پس از آن منفی نشود؛ هم‌روز آزاد است؛ گردش‌های سند ابطال‌شده
 * «آخرین گردش» نیستند تا ابطال و ثبت دوباره با تاریخ اصلی ممکن بماند.
 */
export async function checkBackdatedStockMovement(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const scope: InvariantScope = { ...mark, itemIds: [item.id] };
  const stockIs = async (expected: number, when: string) => {
    const { stock } = await itemState(item.id);
    if (stock !== expected) problems.push(`${when}: موجودی ${stock}، انتظار ${expected}`);
  };
  await receive(item.id, 10, 100000, wh, '2025-08-01');
  await receive(item.id, 5, 100000, wh, '2025-08-10');

  const unpermitted = await rejection(() => sell(item.id, 4, wh, '2025-08-05'));
  if (!unpermitted?.includes('تاریخ گذشته')) problems.push(`فروش با تاریخ پیش از آخرین گردش بی‌مجوز رد نشد (${unpermitted ?? 'پذیرفته شد'})`);
  await stockIs(15, 'پس از فروش ردشده');

  const permitted = await rejection(() => sell(item.id, 4, wh, '2025-08-05', true));
  if (permitted) problems.push(`فروش با تاریخ گذشته با مجوز و موجودی کافی تا آن تاریخ رد شد: ${permitted}`);
  await stockIs(11, 'پس از فروش مجاز با تاریخ گذشته');

  const beforeStock = await rejection(() => sell(item.id, 2, wh, '2025-07-25', true));
  if (!beforeStock?.includes('منفی')) problems.push(`فروش با مجوز ولی پیش از ورود کالا رد نشد (${beforeStock ?? 'پذیرفته شد'})`);

  const sameDay = await rejection(() => sell(item.id, 1, wh, '2025-08-10'));
  if (sameDay) problems.push(`فروش هم‌روز با آخرین گردش رد شد: ${sameDay}`);

  const voided = await sell(item.id, 2, wh, '2025-08-12');
  await DocumentService.deleteDocument(voided, 'inv');
  const reissue = await rejection(() => sell(item.id, 2, wh, '2025-08-11'));
  if (reissue) problems.push(`ثبت دوباره پس از ابطال با تاریخ پیش از سند ابطال‌شده رد شد: ${reissue}`);
  await stockIs(8, 'پس از ابطال و ثبت دوباره');

  const draftId = await sell(item.id, 1, wh, '2025-08-02', false, 'draft');
  const finalizeUnpermitted = await rejection(() => DocumentService.finalizeDocument(draftId, 'inv'));
  if (!finalizeUnpermitted?.includes('تاریخ گذشته')) problems.push(`نهایی‌سازی پیش‌نویس با تاریخ گذشته بی‌مجوز رد نشد (${finalizeUnpermitted ?? 'پذیرفته شد'})`);
  const finalizePermitted = await rejection(() => DocumentService.finalizeDocument(draftId, 'inv', undefined, { allowBackdate: true }));
  if (finalizePermitted) problems.push(`نهایی‌سازی پیش‌نویس با تاریخ گذشته با مجوز رد شد: ${finalizePermitted}`);
  await stockIs(7, 'پس از نهایی‌سازی مجاز');

  const second = await createTestWarehouse();
  const transfer = await rejection(() => InventoryIntegrityService.executeWarehouseTransfer({
    itemId: item.id, fromLocation: wh, toLocation: second.code, quantity: 1, date: '2025-08-03', user: 'inv',
  }));
  if (!transfer?.includes('تاریخ گذشته')) problems.push(`انتقال با تاریخ گذشته بی‌مجوز رد نشد (${transfer ?? 'پذیرفته شد'})`);

  problems.push(...await invariantProblems(scope, 'پایان سناریوی تاریخ'));
  return problems;
}

/**
 * TD-265 (رفع در v8.0.6؛ نگهبان رگرسیون): ابطال ورودی‌ای که موجودی‌اش با خروجِ تاریخ‌دار بعدی مصرف شده پذیرفته می‌شد و
 * کاردکس به ترتیب تاریخ از تاریخ آن ورودی منفی می‌شد. true یعنی یافته دوباره بازتولید شده است.
 */
export async function probeVoidConsumedReceipt(wh: string): Promise<boolean> {
  const mark = await watermarks();
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const first = await receive(item.id, 10, 100000, wh, '2025-10-01');
  await sell(item.id, 4, wh, '2025-10-02');
  await receive(item.id, 10, 100000, wh, '2025-10-03');
  if (await rejection(() => DocumentService.deleteDocument(first, 'inv'))) return false;
  const violations = await checkBusinessInvariants({ ...mark, itemIds: [item.id] });
  return violations.some(v => v.invariant === 'I13_kardex_rebuild_wac' && v.message.includes('ابطال'));
}

/**
 * TD-265 (تصمیم مالک محصول — گزینه الف): ابطال سند ورودیِ مصرف‌شده با پیامی که اسناد مصرف‌کننده را نام می‌برد رد
 * می‌شود و هیچ اثری نمی‌گذارد؛ ورودیِ مصرف‌نشده، سند خروجی و ورودی‌ای که موجودی قبلی خروج‌ها را پوشش می‌دهد آزادند.
 */
export async function checkVoidConsumedReceiptRefused(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const scope: InvariantScope = { ...mark, itemIds: [item.id] };
  const consumed = await receive(item.id, 10, 100000, wh, '2025-11-01');
  const sale = await sell(item.id, 4, wh, '2025-11-02');
  const later = await receive(item.id, 10, 120000, wh, '2025-11-03');
  const before = await itemState(item.id);

  const refused = await rejection(() => DocumentService.deleteDocument(consumed, 'inv'));
  const saleRef = await refOf(sale);
  if (!refused?.includes('مصرف') || !refused.includes(saleRef)) problems.push(`ابطال رسیدِ مصرف‌شده با نام سند مصرف‌کننده (${saleRef}) رد نشد (${refused ?? 'پذیرفته شد'})`);
  const afterRefused = await itemState(item.id);
  if (afterRefused.stock !== before.stock || afterRefused.wac !== before.wac || await isDeleted(consumed)) {
    problems.push(`ابطال ردشده اثر گذاشت: ${JSON.stringify({ before, afterRefused })}`);
  }

  // رسید بعدی مصرف نشده (فروش را رسید اول پوشش می‌دهد): ابطال آزاد است
  const laterVoid = await rejection(() => DocumentService.deleteDocument(later, 'inv'));
  if (laterVoid) problems.push(`ابطال رسیدِ مصرف‌نشده رد شد: ${laterVoid}`);
  // سند خروجی همیشه ابطال‌پذیر است؛ پس از آن رسید اول دیگر مصرف‌شده نیست
  const saleVoid = await rejection(() => DocumentService.deleteDocument(sale, 'inv'));
  if (saleVoid) problems.push(`ابطال فاکتور فروش رد شد: ${saleVoid}`);
  const consumedVoid = await rejection(() => DocumentService.deleteDocument(consumed, 'inv'));
  if (consumedVoid) problems.push(`ابطال رسید پس از ابطال فروشِ مصرف‌کننده رد شد: ${consumedVoid}`);
  const { stock } = await itemState(item.id);
  if (stock !== 0) problems.push(`موجودی پس از ابطال همه اسناد ${stock} است، نه صفر`);

  problems.push(...await invariantProblems(scope, 'پایان سناریوی ابطال ورودی'));
  return problems;
}

async function refOf(documentId: number): Promise<string> {
  const res = await pool.query<{ ref: string }>('SELECT ref_number AS ref FROM documents WHERE id = $1', [documentId]);
  return res.rows[0]?.ref ?? '';
}

async function isDeleted(documentId: number): Promise<boolean> {
  const res = await pool.query<{ d: number }>('SELECT is_deleted AS d FROM documents WHERE id = $1', [documentId]);
  return res.rows[0]?.d === 1;
}

/**
 * TD-266 (باز): گزارش کاردکس جاری کالا (getItemRunningKardex) ردیف معکوس سند ابطال‌شده را می‌آورد ولی ردیف اصلی
 * حذف‌شده را نه؛ پس از ابطال یک فاکتور، مانده پایانی گزارش با موجودی واقعی کالا نمی‌خواند. true یعنی یافته هنوز
 * بازتولید می‌شود.
 */
export async function probeRunningKardexAfterVoid(wh: string): Promise<boolean> {
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  await receive(item.id, 10, 100000, wh, '2025-10-05');
  const invoice = await sell(item.id, 3, wh, '2025-10-06');
  await DocumentService.deleteDocument(invoice, 'inv');
  const report = await InventoryIntegrityService.getItemRunningKardex(item.id);
  const last = report.entries[report.entries.length - 1];
  const { stock } = await itemState(item.id);
  return !last || Number(last.runningBalance) !== stock;
}

/**
 * TD-258: بازسازی کاردکس (ابزار تعمیر) WAC همخوان با موتور زنده و دفتر کل را تغییر نمی‌دهد: ابطال رسیدی که بخشی از
 * آن فروخته شده و رسید مجاز با تاریخ گذشته.
 */
export async function checkRebuildMatchesLiveEngine(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const voidedReceiptItem = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const backdatedItem = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const scope: InvariantScope = { ...mark, itemIds: [voidedReceiptItem.id, backdatedItem.id] };

  // الف) رسید ۱۰ × ۱۰۰٬۰۰۰، رسید ۴ × ۴۰۰٬۰۰۰، فروش ۳، ابطال رسید دوم
  await receive(voidedReceiptItem.id, 10, 100000, wh, '2025-09-01');
  const second = await receive(voidedReceiptItem.id, 4, 400000, wh, '2025-09-02');
  await sell(voidedReceiptItem.id, 3, wh, '2025-09-03');
  await DocumentService.deleteDocument(second, 'inv');

  // ب) رسید ۱۰ × ۱۰۰٬۰۰۰، فروش ۴، سپس رسید مجاز با تاریخ گذشته ۵ × ۴۰۰٬۰۰۰
  await receive(backdatedItem.id, 10, 100000, wh, '2025-09-10');
  await sell(backdatedItem.id, 4, wh, '2025-09-12');
  await receive(backdatedItem.id, 5, 400000, wh, '2025-09-05', true);

  problems.push(...await invariantProblems(scope, 'پیش از بازسازی'));
  for (const [label, itemId] of [['ابطال رسید فروخته‌شده', voidedReceiptItem.id], ['رسید با تاریخ گذشته', backdatedItem.id]] as const) {
    const before = await itemState(itemId);
    await KardexWacRecalculatorService.rebuildItemFromLedger(itemId, { user: 'inv' });
    const after = await itemState(itemId);
    if (after.stock !== before.stock || fin(after.wac).subtract(fin(before.wac)).abs().greaterThan(fin(0.01))) {
      problems.push(`${label}: بازسازی کاردکس WAC یا موجودی را تغییر داد (${before.wac} × ${before.stock} ← ${after.wac} × ${after.stock})`);
    }
  }
  problems.push(...await invariantProblems(scope, 'پس از بازسازی'));
  return problems;
}
