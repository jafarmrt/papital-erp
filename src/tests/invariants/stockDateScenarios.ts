import { pool } from '../../db/drizzle.js';
import { fin } from '../../lib/financialDecimal.js';
import { DocumentService } from '../../services/document.service.js';
import { InventoryIntegrityService } from '../../services/inventory/inventoryIntegrity.service.js';
import { KardexWacRecalculatorService } from '../../services/inventory/kardexWacRecalculator.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { createTestItem, createTestWarehouse } from '../fixtures/factories.js';
import { checkBusinessInvariants, type InvariantScope } from './businessInvariants.js';
import { I13_VOIDED_INCOMING } from './kardexRebuildInvariant.js';
import { invariantProblems, itemState, legacyZeroCostEntry, receive, watermarks } from './scenarioHelpers.js';

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
    if (stock !== expected) problems.push(`${when}: stock ${stock}, expected ${expected}`);
  };
  await receive(item.id, 10, 100000, wh, '2025-08-01');
  await receive(item.id, 5, 100000, wh, '2025-08-10');

  const unpermitted = await rejection(() => sell(item.id, 4, wh, '2025-08-05'));
  if (!unpermitted?.includes('تاریخ گذشته')) problems.push(`sale dated before the last movement without the permission was not refused (${unpermitted ?? 'accepted'})`);
  await stockIs(15, 'after the refused sale');

  const permitted = await rejection(() => sell(item.id, 4, wh, '2025-08-05', true));
  if (permitted) problems.push(`backdated sale with the permission and enough stock up to that date was refused: ${permitted}`);
  await stockIs(11, 'after the permitted backdated sale');

  const beforeStock = await rejection(() => sell(item.id, 2, wh, '2025-07-25', true));
  if (!beforeStock?.includes('منفی')) problems.push(`sale with the permission but dated before the item came in was not refused (${beforeStock ?? 'accepted'})`);

  const sameDay = await rejection(() => sell(item.id, 1, wh, '2025-08-10'));
  if (sameDay) problems.push(`sale on the same day as the last movement was refused: ${sameDay}`);

  const voided = await sell(item.id, 2, wh, '2025-08-12');
  await DocumentService.deleteDocument(voided, 'inv');
  const reissue = await rejection(() => sell(item.id, 2, wh, '2025-08-11'));
  if (reissue) problems.push(`re-recording after a void, dated before the voided document, was refused: ${reissue}`);
  await stockIs(8, 'after the void and re-recording');

  const draftId = await sell(item.id, 1, wh, '2025-08-02', false, 'draft');
  const finalizeUnpermitted = await rejection(() => DocumentService.finalizeDocument(draftId, 'inv'));
  if (!finalizeUnpermitted?.includes('تاریخ گذشته')) problems.push(`finalizing a backdated draft without the permission was not refused (${finalizeUnpermitted ?? 'accepted'})`);
  const finalizePermitted = await rejection(() => DocumentService.finalizeDocument(draftId, 'inv', undefined, { allowBackdate: true }));
  if (finalizePermitted) problems.push(`finalizing a backdated draft with the permission was refused: ${finalizePermitted}`);
  await stockIs(7, 'after the permitted finalize');

  const second = await createTestWarehouse();
  const transfer = await rejection(() => InventoryIntegrityService.executeWarehouseTransfer({
    itemId: item.id, fromLocation: wh, toLocation: second.code, quantity: 1, date: '2025-08-03', user: 'inv',
  }));
  if (!transfer?.includes('تاریخ گذشته')) problems.push(`backdated transfer without the permission was not refused (${transfer ?? 'accepted'})`);

  problems.push(...await invariantProblems(scope, 'end of the date scenario'));
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
  return violations.some(v => v.invariant === 'I13_kardex_rebuild_wac' && v.message.includes(I13_VOIDED_INCOMING));
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
  if (!refused?.includes('مصرف') || !refused.includes(saleRef)) problems.push(`voiding a consumed receipt was not refused with the consuming document's number (${saleRef}) (${refused ?? 'accepted'})`);
  const afterRefused = await itemState(item.id);
  if (afterRefused.stock !== before.stock || afterRefused.wac !== before.wac || await isDeleted(consumed)) {
    problems.push(`the refused void had an effect: ${JSON.stringify({ before, afterRefused })}`);
  }

  // رسید بعدی مصرف نشده (فروش را رسید اول پوشش می‌دهد): ابطال آزاد است
  const laterVoid = await rejection(() => DocumentService.deleteDocument(later, 'inv'));
  if (laterVoid) problems.push(`void of the unconsumed receipt was refused: ${laterVoid}`);
  // سند خروجی همیشه ابطال‌پذیر است؛ پس از آن رسید اول دیگر مصرف‌شده نیست
  const saleVoid = await rejection(() => DocumentService.deleteDocument(sale, 'inv'));
  if (saleVoid) problems.push(`void of the sales invoice was refused: ${saleVoid}`);
  const consumedVoid = await rejection(() => DocumentService.deleteDocument(consumed, 'inv'));
  if (consumedVoid) problems.push(`void of the receipt after voiding the consuming sale was refused: ${consumedVoid}`);
  const { stock } = await itemState(item.id);
  if (stock !== 0) problems.push(`stock after voiding all documents is ${stock}, not zero`);

  problems.push(...await invariantProblems(scope, 'end of the incoming void scenario'));
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
 * TD-266 (رفع در v8.0.7؛ نگهبان رگرسیون): گزارش کاردکس جاری کالا ردیف معکوس سند ابطال‌شده را می‌آورد ولی ردیف اصلی
 * حذف‌شده را نه؛ پس از ابطال یک فاکتور، مانده پایانی گزارش با موجودی واقعی کالا نمی‌خواند. true یعنی یافته دوباره
 * بازتولید شده است.
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

  problems.push(...await invariantProblems(scope, 'before rebuild'));
  for (const [label, itemId] of [['ابطال رسید فروخته‌شده', voidedReceiptItem.id], ['رسید با تاریخ گذشته', backdatedItem.id]] as const) {
    const before = await itemState(itemId);
    const rebuilt = await KardexWacRecalculatorService.rebuildItemFromLedger(itemId, { user: 'inv' });
    const after = await itemState(itemId);
    // v9.0.90 (TD-487): بازسازی فقط مقدار را می‌سازد؛ WAC بازپخش کاردکس که گزارش می‌کند همان WAC زنده است
    if (after.stock !== before.stock || fin(rebuilt.replayWac).subtract(fin(before.wac)).abs().greaterThan(fin(0.01))) {
      problems.push(`${label}: Kardex rebuild changed the stock or the replay reached another WAC (${before.wac} × ${before.stock} -> ${rebuilt.replayWac} × ${after.stock})`);
    }
  }
  problems.push(...await invariantProblems(scope, 'after rebuild'));
  return problems;
}

/**
 * TD-266 (تصمیم مالک محصول — نمایش با برچسب): گزارش کاردکس جاری سند ابطال‌شده را با برچسب نشان می‌دهد (ردیف اصلی
 * isVoided در تاریخ خودش و ردیف معکوس isReversal در تاریخ ابطال)، مانده جاری در هر ردیف و پایان درست است، جمع ورود و
 * خروج فقط گردش‌های واقعی را می‌شمارد و WAC جاری با WAC کالا یکی می‌ماند.
 */
export async function checkRunningKardexShowsVoided(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  await receive(item.id, 10, 100000, wh, '2025-12-01');
  const invoice = await sell(item.id, 3, wh, '2025-12-02');
  await DocumentService.deleteDocument(invoice, 'inv');
  const extra = await receive(item.id, 5, 160000, wh, '2025-12-03');
  await DocumentService.deleteDocument(extra, 'inv');

  const report = await InventoryIntegrityService.getItemRunningKardex(item.id);
  const { stock, wac } = await itemState(item.id);
  const last = report.entries[report.entries.length - 1];
  if (!last || last.runningBalance !== stock || report.summary.netBalance !== stock) {
    problems.push(`report closing balance ${last?.runningBalance}/${report.summary.netBalance} does not equal stock ${stock}`);
  }
  if (last && last.runningLocationStock !== stock) problems.push(`warehouse balance on the last row ${last.runningLocationStock}, expected ${stock}`);
  const voided = report.entries.filter(e => e.isVoided);
  const reversals = report.entries.filter(e => e.isReversal);
  if (voided.length !== 2 || reversals.length !== 2) problems.push(`two voided rows and two reversal rows were expected: ${voided.length} / ${reversals.length}`);
  if (report.summary.totalIn !== 10 || report.summary.totalOut !== 0) {
    problems.push(`in/out totals must count only real movements (10 / 0): ${report.summary.totalIn} / ${report.summary.totalOut}`);
  }
  if (report.entries.some(e => e.runningBalance < 0)) problems.push('report running balance went negative somewhere');
  if (!last || fin(last.runningWac).subtract(fin(wac)).abs().greaterThan(fin(0.01))) problems.push(`report closing WAC ${last?.runningWac} does not equal the item WAC ${wac}`);
  // WAC هر ردیف = WAC موتور زنده بلافاصله پس از ثبت همان ردیف (رسید ۵ × ۱۶۰٬۰۰۰ پس از ۱۰ × ۱۰۰٬۰۰۰ ← ۱۲۰٬۰۰۰)
  const extraRow = report.entries.find(e => e.isVoided && e.type === 'in');
  if (!extraRow || fin(extraRow.runningWac).subtract(fin(120000)).abs().greaterThan(fin(0.01))) {
    problems.push(`WAC of the voided receipt row must be the WAC after it was recorded (120,000): ${extraRow?.runningWac}`);
  }
  if (Math.abs(report.summary.valuation - stock * Number(wac)) > 0.01) problems.push(`summary value ${report.summary.valuation}, expected ${stock * Number(wac)}`);
  return problems;
}

/**
 * TD-269: بازپخش WAC کاردکس از WAC صفر شروع می‌شود، نه از WAC کنونی کالا. کالای بدون WAC که نخست با قیمت صفر وارد شده
 * (ارزش صفر) و سپس خریده شده، پس از بازسازی همان WAC زنده را دارد؛ کالای دارای WAC اولیه که با قیمت صفر وارد شده (ردیف
 * کاردکس به همان WAC، TD-256) و کالای بی‌گردش WAC خود را نگه می‌دارند.
 */
export async function checkReplayStartsAtZeroWac(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const freeFirst = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const opening = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 50000 });
  const idle = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 70000 });
  const scope: InvariantScope = { ...mark, itemIds: [freeFirst.id, opening.id, idle.id] };
  const production = (itemId: number, quantity: number, date: string) => DocumentService.createDocument({
    docType: 'production_receipt', inOut: 'in', status: 'final', date, user: 'inv',
    items: [{ itemId, quantity, unitPrice: 0, location: wh }],
  });

  // رسید تولید ۱۰ × ۰ (ارزش صفر) و رسید ۹ × ۱۴۵٬۸۷۹ ← WAC ۶۹٬۱۰۰٫۵۷۸۹ (بذر ۴ شبیه‌ساز)
  // v9.0.453 (TD-906): سند رسید تولید این ردیف را دیگر نمی‌پذیرد؛ ورود صفر کالای بی‌WAC ردیف پیشین کاردکس است
  await legacyZeroCostEntry(freeFirst.id, 10, wh, '2025-10-01', 'production_receipt');
  await receive(freeFirst.id, 9, 145879, wh, '2025-10-02');
  // WAC اولیه ۵۰٬۰۰۰، رسید تولید ۴ × ۰ (به همان WAC) و رسید ۴ × ۷۰٬۰۰۰ ← WAC ۶۰٬۰۰۰
  await production(opening.id, 4, '2025-10-01');
  await receive(opening.id, 4, 70000, wh, '2025-10-02');

  const expected: Array<[string, number, string]> = [
    ['ورود نخست با قیمت صفر', freeFirst.id, '69100.5789'],
    ['WAC اولیه و ورود با قیمت صفر', opening.id, '60000'],
    ['کالای بی‌گردش', idle.id, '70000'],
  ];
  for (const [label, itemId, wac] of expected) {
    const live = await itemState(itemId);
    if (!fin(live.wac).equals(fin(wac))) problems.push(`${label}: live WAC ${live.wac}, expected ${wac}`);
  }
  problems.push(...await invariantProblems(scope, 'before rebuild'));
  for (const [label, itemId, wac] of expected) {
    const rebuilt = await KardexWacRecalculatorService.rebuildItemFromLedger(itemId, { user: 'inv' });
    if (fin(rebuilt.replayWac).subtract(fin(wac)).abs().greaterThan(fin(0.01))) problems.push(`${label}: Kardex replay gave WAC ${rebuilt.replayWac}, expected ${wac}`);
  }
  return problems;
}
