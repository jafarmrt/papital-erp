import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { customers, documents, woocommerceOrderLogs } from '../../db/schema.js';
import { WooOrderSyncService, type WcOrderPayload } from '../../services/woocommerce/wooOrderSync.service.js';
import { createTestItem, createTestWarehouse } from '../fixtures/factories.js';

/**
 * حوزه F — ووکامرس: کاوش یافته‌ها برای سوئیت business_invariants (true یعنی یافته هنوز رخ می‌دهد). سفارش‌ها مستقیم به
 * WooOrderSyncService.handleOrder داده می‌شوند (همان نقطه ورود وب‌هوک و همگام‌سازی دستی).
 */

let seq = 0;
/** شماره سفارش یکتا برای هر اجرا */
export function wooOrderId(): string {
  seq += 1;
  return `${90_000_000 + (Date.now() % 1_000_000) * 10 + seq}`;
}

export function wooOrder(id: string, status: string, sku: string, quantity: number, lineTotal: number, extra: Partial<WcOrderPayload> = {}): WcOrderPayload {
  return {
    id, number: id, status, currency: 'IRR', total: String(lineTotal),
    billing: { first_name: 'خریدار', last_name: `آزمون ووکامرس ${id}`, phone: '', city: 'تهران', address_1: 'خیابان آزمون' },
    line_items: [{ id: 1, name: `قلم ${sku}`, sku, quantity, price: lineTotal / quantity, total: String(lineTotal) }],
    ...extra,
  };
}

async function logOf(wcOrderId: string) {
  const [log] = await orm.select().from(woocommerceOrderLogs).where(eq(woocommerceOrderLogs.wcOrderId, wcOrderId));
  return log;
}

/** TD-292 (کاوش رگرسیون؛ رفع v8.0.39): واحد «هزار تومان» (IRHT) افزونه ووکامرس فارسی — ۱۰۰ هزار تومان = ۱٬۰۰۰٬۰۰۰ ریال — فاکتور ریالی درست نمی‌گیرد */
export async function probeWooThousandTomanCurrency(): Promise<boolean> {
  const item = await createTestItem({ code: `WC_IRHT_${wooOrderId()}`, stocks: { '': 5 } });
  const id = wooOrderId();
  const result = await WooOrderSyncService.handleOrder(wooOrder(id, 'processing', item.code, 1, 100, { currency: 'IRHT' }));
  if (result.status !== 'processed' || !result.docId) return true;
  const [doc] = await orm.select({ currency: documents.currency }).from(documents).where(eq(documents.id, result.docId));
  const net = await pool.query<{ n: string }>('SELECT COALESCE(SUM(quantity * unit_price), 0)::text AS n FROM document_items WHERE document_id = $1 AND is_deleted = 0', [result.docId]);
  return doc?.currency !== 'IRR' || Number(net.rows[0].n) !== 1_000_000;
}

/** TD-294 (کاوش رگرسیون؛ رفع v8.0.43): استرداد جزئی سفارشِ فاکتورشده (وضعیت همان completed می‌ماند) هیچ اثری در ERP ندارد */
export async function probeWooPartialRefundIgnored(): Promise<boolean> {
  const item = await createTestItem({ code: `WC_REFUND_${wooOrderId()}`, stocks: { '': 5 } });
  const id = wooOrderId();
  await WooOrderSyncService.handleOrder(wooOrder(id, 'processing', item.code, 2, 2000));
  await WooOrderSyncService.handleOrder(wooOrder(id, 'completed', item.code, 2, 2000, { refunds: [{ id: 1, reason: 'یک قلم آسیب دید', total: '-1000' }] }));
  const log = await logOf(id);
  return log?.status === 'processed' && !String(log.errorMessage || '');
}

/** TD-294 (کاوش رگرسیون؛ رفع v8.0.43): ویرایش سفارشِ فاکتورشده در فروشگاه (مقدار ۲ ← ۳، مبلغ ۲۰۰۰ ← ۳۰۰۰) نادیده گرفته می‌شود */
export async function probeWooEditedOrderIgnored(): Promise<boolean> {
  const item = await createTestItem({ code: `WC_EDIT_${wooOrderId()}`, stocks: { '': 5 } });
  const id = wooOrderId();
  const first = await WooOrderSyncService.handleOrder(wooOrder(id, 'processing', item.code, 2, 2000));
  await WooOrderSyncService.handleOrder(wooOrder(id, 'processing', item.code, 3, 3000));
  const log = await logOf(id);
  const qty = await pool.query<{ q: string }>('SELECT COALESCE(SUM(quantity), 0)::text AS q FROM document_items WHERE document_id = $1 AND is_deleted = 0', [first.docId ?? 0]);
  return log?.status === 'processed' && Number(qty.rows[0].q) === 2 && !String(log.errorMessage || '');
}

/**
 * TD-293 (کاوش رگرسیون؛ رفع v8.0.44، با انبار فروشگاه پیش‌فرض): کالایی که فقط در انبار غیرفروشگاه موجودی دارد: موجودی کل ۵ است
 * ولی فاکتور سفارش فقط از انبار پیش‌فرض کم می‌کند و سفارش پرداخت‌شده رد می‌شود
 */
export async function probeWooStockOutsideDefaultWarehouse(): Promise<boolean> {
  const other = await createTestWarehouse({ name: `انبار دوم ووکامرس ${wooOrderId()}` });
  const item = await createTestItem({ code: `WC_WH_${wooOrderId()}`, stocks: { [other.code]: 5 } });
  const id = wooOrderId();
  const result = await WooOrderSyncService.handleOrder(wooOrder(id, 'processing', item.code, 2, 2000));
  // آنچه همگام‌سازی موجودی برای این کالا به فروشگاه می‌فرستد (از v8.0.44 موجودی قابل فروش انبار فروشگاه)
  const { shopSellableStocks } = await import('../../services/woocommerce/shopWarehouse.js');
  const { sellable } = await shopSellableStocks(orm, [item.id]);
  return result.status === 'failed' && (sellable.get(item.id) ?? 0) >= 2;
}

/** TD-295 (کاوش رگرسیون؛ رفع v8.0.42): سفارشی با تخفیف به‌صورت کارمزد منفی (fee_lines = −۲۰۰) کلاً فاکتور نمی‌شود */
export async function probeWooNegativeFeeRejected(): Promise<boolean> {
  const item = await createTestItem({ code: `WC_FEE_${wooOrderId()}`, stocks: { '': 5 } });
  const id = wooOrderId();
  const result = await WooOrderSyncService.handleOrder(wooOrder(id, 'processing', item.code, 1, 1000, {
    total: '800', fee_lines: [{ name: 'تخفیف', total: '-200' }],
  }));
  return result.status === 'failed';
}

/** TD-296 (کاوش رگرسیون؛ رفع v8.0.40): مشتری موجود با تلفن ۰۹۱۲… با سفارش تلفن +۹۸۹۱۲… شناخته نمی‌شود و مشتری تکراری ساخته می‌شود */
export async function probeWooPhoneFormatDuplicatesCustomer(): Promise<boolean> {
  const suffix = wooOrderId().slice(-7);
  const localPhone = `0912${suffix}`;
  const [existing] = await orm.insert(customers).values({ name: `مشتری آزمون تلفن ${suffix}`, phone: localPhone }).returning({ id: customers.id, name: customers.name });
  const item = await createTestItem({ code: `WC_PHONE_${wooOrderId()}`, stocks: { '': 5 } });
  const id = wooOrderId();
  const order = wooOrder(id, 'processing', item.code, 1, 1000);
  order.billing = { ...order.billing, phone: `+98912${suffix}` };
  const result = await WooOrderSyncService.handleOrder(order);
  const [doc] = await orm.select({ buyerName: documents.buyerName }).from(documents).where(and(eq(documents.id, result.docId ?? 0)));
  return Boolean(existing) && doc?.buyerName !== existing.name;
}

/** TD-297 (کاوش رگرسیون؛ رفع v8.0.41): ردیف ۳ عددی با جمع ۱۰۰۰ ریال فی ۳۳۳٫۳۳۳۳ می‌گیرد — بدهکار مشتری با مبلغ پرداختی سفارش یکی نیست */
export async function probeWooFractionalRialResidue(): Promise<boolean> {
  const item = await createTestItem({ code: `WC_ROUND_${wooOrderId()}`, stocks: { '': 5 } });
  const id = wooOrderId();
  const result = await WooOrderSyncService.handleOrder(wooOrder(id, 'processing', item.code, 3, 1000));
  if (result.status !== 'processed' || !result.docId) return false;
  const debit = await pool.query<{ d: string }>(
    `SELECT COALESCE(SUM(i.debit), 0)::text AS d FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
      WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0 AND a.code = '1201'`, [result.docId]);
  return Number(debit.rows[0].d) !== 1000;
}

/** بدهکار مشتری (۱۲۰۱) سند حسابداری یک فاکتور */
async function customerDebitOf(documentId: number): Promise<number> {
  const res = await pool.query<{ d: string }>(
    `SELECT COALESCE(SUM(i.debit), 0)::text AS d FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
      WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0 AND a.code = '1201'`, [documentId]);
  return Number(res.rows[0].d);
}

/**
 * TD-292: واحدهای ریالی افزونه ووکامرس فارسی به ریال تبدیل می‌شوند — هزار تومان (IRHT) ×۱۰٬۰۰۰، هزار ریال (IRHR) ×۱٬۰۰۰ و
 * تومان (IRT) ×۱۰ — و فاکتور ریالی با بدهکار مشتری برابر مبلغ سفارش صادر می‌شود.
 */
export async function checkWooRialUnits(): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ code: `WC_UNITS_${wooOrderId()}`, stocks: { '': 10 } });
  const cases: Array<[string, number, number]> = [['IRHT', 100, 1_000_000], ['IRHR', 250, 250_000], ['IRT', 300, 3_000]];
  for (const [currency, amount, rial] of cases) {
    const id = wooOrderId();
    const result = await WooOrderSyncService.handleOrder(wooOrder(id, 'processing', item.code, 1, amount, { currency }));
    if (result.status !== 'processed' || !result.docId) {
      problems.push(`${currency}: the order was not invoiced (${result.message.slice(0, 160)})`);
      continue;
    }
    const [doc] = await orm.select({ currency: documents.currency }).from(documents).where(eq(documents.id, result.docId));
    const debit = await customerDebitOf(result.docId);
    if (doc?.currency !== 'IRR' || debit !== rial) problems.push(`${currency}: invoice ${doc?.currency} with customer debit ${debit}, expected IRR and ${rial}`);
  }
  return problems;
}

/**
 * TD-296: سفارش با تلفن مشتری موجود در هر قالبی (‎+۹۸…، ۰۰۹۸…، بدون صفر، با فاصله، ارقام فارسی) همان مشتری را می‌یابد و
 * مشتری تکراری نمی‌سازد؛ تلفن دیگری که فقط ارقام مشترک دارد با او یکی گرفته نمی‌شود.
 */
export async function checkWooPhoneMatchesCustomer(): Promise<string[]> {
  const problems: string[] = [];
  const suffix = wooOrderId().slice(-7);
  const [existing] = await orm.insert(customers).values({ name: `مشتری آزمون تطبیق تلفن ${suffix}`, phone: `0912${suffix}` }).returning({ id: customers.id, name: customers.name });
  const item = await createTestItem({ code: `WC_PHONE_OK_${wooOrderId()}`, stocks: { '': 20 } });
  const persian = (s: string) => s.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  const formats = [`+98912${suffix}`, `0098912${suffix}`, `912${suffix}`, `0912 ${suffix.slice(0, 3)} ${suffix.slice(3)}`, persian(`0912${suffix}`)];
  for (const phone of formats) {
    const id = wooOrderId();
    const order = wooOrder(id, 'processing', item.code, 1, 1000);
    order.billing = { ...order.billing, phone };
    const result = await WooOrderSyncService.handleOrder(order);
    const [doc] = await orm.select({ buyerName: documents.buyerName }).from(documents).where(eq(documents.id, result.docId ?? 0));
    if (doc?.buyerName !== existing.name) problems.push(`phone "${phone}": invoice in the name of ${doc?.buyerName ?? result.message.slice(0, 80)}, expected ${existing.name}`);
  }
  const duplicates = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM customers WHERE is_deleted = 0 AND id <> $1 AND regexp_replace(translate(phone, '۰۱۲۳۴۵۶۷۸۹', '0123456789'), '[^0-9]', '', 'g') LIKE $2`,
    [existing.id, `%912${suffix}`]);
  if (Number(duplicates.rows[0].n) !== 0) problems.push(`${duplicates.rows[0].n} duplicate customers were created with the same phone`);

  // تلفن دیگری (رقم آخر متفاوت) مشتری تازه می‌سازد
  const other = wooOrder(wooOrderId(), 'processing', item.code, 1, 1000);
  const otherPhone = `0912${suffix.slice(0, 6)}${(Number(suffix.slice(6)) + 1) % 10}`;
  other.billing = { ...other.billing, phone: otherPhone };
  const otherResult = await WooOrderSyncService.handleOrder(other);
  const [otherDoc] = await orm.select({ buyerName: documents.buyerName }).from(documents).where(eq(documents.id, otherResult.docId ?? 0));
  if (otherDoc?.buyerName === existing.name) problems.push(`another phone "${otherPhone}" was assigned to the same customer`);
  return problems;
}

/** سطرهای فعال یک فاکتور: مقدار و فی */
async function invoiceLines(documentId: number): Promise<Array<{ q: number; p: string }>> {
  const res = await pool.query<{ q: string; p: string }>(
    'SELECT quantity::text AS q, unit_price::text AS p FROM document_items WHERE document_id = $1 AND is_deleted = 0 ORDER BY id', [documentId]);
  return res.rows.map(r => ({ q: Number(r.q), p: r.p }));
}

/**
 * TD-297: جمع هر ردیف سفارش در فاکتور دقیق می‌ماند — ۳ عدد با جمع ۱۰۰۰ ریال دو سطر ۲ × ۳۳۳ و ۱ × ۳۳۴ می‌شود و بدهکار مشتری
 * دقیقاً ۱۰۰۰ است؛ ۷ عدد ۱۰۰۰۰ تومانی ۱۰۰٬۰۰۰ ریال؛ با ارسال و مالیات هم جمع با مبلغ پرداختی برابر است؛ ردیف بخش‌پذیر یک سطر می‌ماند.
 */
export async function checkWooExactLineTotals(): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ code: `WC_EXACT_${wooOrderId()}`, stocks: { '': 30 } });
  const cases: Array<{ label: string; order: WcOrderPayload; debit: number; lines: string }> = [
    { label: '۳ عدد، ۱۰۰۰ ریال', order: wooOrder(wooOrderId(), 'processing', item.code, 3, 1000), debit: 1000, lines: '2×333|1×334' },
    { label: '۷ عدد، ۱۰۰۰۰ تومان', order: wooOrder(wooOrderId(), 'processing', item.code, 7, 10000, { currency: 'IRT' }), debit: 100000, lines: '6×14285|1×14290' },
    { label: '۳ عدد با ارسال ۱۰۰ و مالیات ۹۰', order: wooOrder(wooOrderId(), 'processing', item.code, 3, 1000, { total: '1190', shipping_lines: [{ total: '100' }], total_tax: '90' }), debit: 1190, lines: '2×333|1×334' },
    { label: '۴ عدد، ۱۰۰۰ ریال (بخش‌پذیر)', order: wooOrder(wooOrderId(), 'processing', item.code, 4, 1000), debit: 1000, lines: '4×250' },
  ];
  for (const c of cases) {
    const result = await WooOrderSyncService.handleOrder(c.order);
    if (result.status !== 'processed' || !result.docId) {
      problems.push(`${c.label}: not invoiced (${result.message.slice(0, 160)})`);
      continue;
    }
    const lines = (await invoiceLines(result.docId)).map(l => `${l.q}×${Number(l.p)}`).join('|');
    const debit = await customerDebitOf(result.docId);
    if (debit !== c.debit) problems.push(`${c.label}: customer debit ${debit}, expected ${c.debit}`);
    if (lines !== c.lines) problems.push(`${c.label}: lines ${lines}, expected ${c.lines}`);
  }
  return problems;
}

/** تخفیف سطرهای فاکتور به ترتیب ثبت */
async function lineDiscounts(documentId: number): Promise<number[]> {
  const res = await pool.query<{ d: string }>('SELECT COALESCE(discount, 0)::text AS d FROM document_items WHERE document_id = $1 AND is_deleted = 0 ORDER BY id', [documentId]);
  return res.rows.map(r => Number(r.d));
}

/**
 * TD-295 (تصمیم مالک محصول — گزینه الف): کارمزد منفی سفارش (تخفیف) به نسبت مبلغ سطرها تخفیف سطر می‌شود — ۴۰۰ روی ۱۰۰۰ و ۳۰۰۰
 * می‌شود ۱۰۰ و ۳۰۰ و بدهکار مشتری ۳۶۰۰؛ کنار هزینه ارسال، ارسال کامل هزینه خدمات می‌ماند؛ باقی‌مانده گرد کردن به سطر بزرگ‌تر
 * می‌رسد؛ تخفیفِ بیش از جمع اقلام رد می‌شود.
 */
export async function checkWooNegativeFeeAsLineDiscount(): Promise<string[]> {
  const problems: string[] = [];
  const a = await createTestItem({ code: `WC_FEE_A_${wooOrderId()}`, stocks: { '': 20 } });
  const b = await createTestItem({ code: `WC_FEE_B_${wooOrderId()}`, stocks: { '': 20 } });
  const twoLines = (id: string, totalA: number, totalB: number, extra: Partial<WcOrderPayload>): WcOrderPayload => ({
    ...wooOrder(id, 'processing', a.code, 1, totalA, extra),
    line_items: [
      { id: 1, name: 'قلم الف', sku: a.code, quantity: 1, price: totalA, total: String(totalA) },
      { id: 2, name: 'قلم ب', sku: b.code, quantity: 1, price: totalB, total: String(totalB) },
    ],
  });
  const run = async (label: string, order: WcOrderPayload, debit: number, discounts: string, serviceCharge: number) => {
    const result = await WooOrderSyncService.handleOrder(order);
    if (result.status !== 'processed' || !result.docId) return problems.push(`${label}: not invoiced (${result.message.slice(0, 160)})`);
    const [doc] = await orm.select({ service: documents.serviceChargeAmount }).from(documents).where(eq(documents.id, result.docId));
    const got = (await lineDiscounts(result.docId)).join('|');
    if (got !== discounts) problems.push(`${label}: line discounts ${got}, expected ${discounts}`);
    if (Number(doc?.service ?? 0) !== serviceCharge) problems.push(`${label}: service charge ${doc?.service}, expected ${serviceCharge}`);
    const customer = await customerDebitOf(result.docId);
    if (customer !== debit) problems.push(`${label}: customer debit ${customer}, expected ${debit}`);
  };

  await run('تخفیف ۴۰۰ روی ۱۰۰۰ و ۳۰۰۰', twoLines(wooOrderId(), 1000, 3000, { total: '3600', fee_lines: [{ name: 'تخفیف', total: '-400' }] }), 3600, '100|300', 0);
  await run('تخفیف ۱۰۰ کنار ارسال ۲۰۰', wooOrder(wooOrderId(), 'processing', a.code, 1, 1000, { total: '1100', shipping_lines: [{ total: '200' }], fee_lines: [{ name: 'تخفیف', total: '-100' }] }), 1100, '100', 200);
  await run('باقی‌مانده گرد کردن', twoLines(wooOrderId(), 1000, 2000, { total: '2900', fee_lines: [{ name: 'تخفیف', total: '-100' }] }), 2900, '33|67', 0);

  const tooMuch = await WooOrderSyncService.handleOrder(wooOrder(wooOrderId(), 'processing', a.code, 1, 500, {
    total: '100', shipping_lines: [{ total: '200' }], fee_lines: [{ name: 'تخفیف', total: '-600' }],
  }));
  if (tooMuch.status !== 'failed' || !tooMuch.message.includes('تخفیف کارمزدی')) problems.push(`a discount above the item total was not refused (${tooMuch.status}: ${tooMuch.message.slice(0, 120)})`);
  return problems;
}

/**
 * TD-294 (تصمیم مالک محصول — گزینه الف): سفارشِ فاکتورشده‌ای که در فروشگاه ویرایش شود (مقدار ۲ ← ۳، مبلغ ۲۰۰۰ ← ۳۰۰۰) یا
 * استرداد تازه بگیرد «نیازمند بررسی» می‌شود و پیام تفاوت را می‌گوید؛ فاکتور دست نمی‌خورد. همان سفارش بی‌تغییر (processing ←
 * completed) علامتی نمی‌گیرد و وب‌هوک بعدیِ سفارشِ در حال بررسی فاکتور تازه نمی‌سازد.
 */
export async function checkWooChangedOrderFlagged(): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ code: `WC_CHANGE_${wooOrderId()}`, stocks: { '': 20 } });

  const edited = wooOrderId();
  const first = await WooOrderSyncService.handleOrder(wooOrder(edited, 'processing', item.code, 2, 2000));
  const same = await WooOrderSyncService.handleOrder(wooOrder(edited, 'completed', item.code, 2, 2000));
  if (same.status !== 'processed') problems.push(`same order with status completed: ${same.status}, expected processed`);
  const changed = await WooOrderSyncService.handleOrder(wooOrder(edited, 'processing', item.code, 3, 3000));
  const editedLog = await logOf(edited);
  if (changed.status !== 'needs_review' || editedLog?.status !== 'needs_review') problems.push(`edited order: ${changed.status} / log ${editedLog?.status}, expected needs_review`);
  if (!String(editedLog?.errorMessage || '').includes('اقلام یا مبلغ سفارش عوض شده')) problems.push(`edit difference message: ${String(editedLog?.errorMessage || '').slice(0, 120)}`);
  if (editedLog?.erpDocumentId !== first.docId) problems.push(`log invoice ${editedLog?.erpDocumentId}, expected ${first.docId}`);
  const qty = await pool.query<{ q: string }>('SELECT COALESCE(SUM(quantity), 0)::text AS q FROM document_items WHERE document_id = $1 AND is_deleted = 0', [first.docId ?? 0]);
  if (Number(qty.rows[0].q) !== 2) problems.push(`invoice quantity ${qty.rows[0].q}, expected 2 (the invoice is not touched)`);
  const again = await WooOrderSyncService.handleOrder(wooOrder(edited, 'completed', item.code, 3, 3000));
  if (again.status !== 'needs_review' || (again.docId && again.docId !== first.docId)) problems.push(`next webhook of the order under review: ${again.status} / ${again.docId}`);

  const refunded = wooOrderId();
  await WooOrderSyncService.handleOrder(wooOrder(refunded, 'processing', item.code, 2, 2000));
  const refund = await WooOrderSyncService.handleOrder(wooOrder(refunded, 'completed', item.code, 2, 2000, { refunds: [{ id: 1, reason: 'یک قلم آسیب دید', total: '-1000' }] }));
  const refundLog = await logOf(refunded);
  if (refund.status !== 'needs_review' || !String(refundLog?.errorMessage || '').includes('استرداد تازه به مبلغ 1000')) {
    problems.push(`partial refund: ${refund.status} / ${String(refundLog?.errorMessage || '').slice(0, 120)}`);
  }
  return problems;
}

/** تنظیم موقت app_settings؛ مقدارهای پیشین را برای بازگرداندن برمی‌گرداند */
async function withSettings<T>(values: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const { appSettings } = await import('../../db/schema.js');
  const { inArray } = await import('drizzle-orm');
  const keys = Object.keys(values);
  const previous = await orm.select().from(appSettings).where(inArray(appSettings.key, keys));
  try {
    for (const [key, value] of Object.entries(values)) {
      await orm.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
    }
    return await fn();
  } finally {
    await orm.delete(appSettings).where(inArray(appSettings.key, keys));
    for (const row of previous) await orm.insert(appSettings).values({ key: row.key, value: row.value });
  }
}

/** فروشگاه ووکامرس ساختگی روی 127.0.0.1: جستجوی محصول با SKU و ثبت stock_quantity هر PUT */
async function mockWooStore(productIdBySku: Map<string, number>): Promise<{ url: string; pushed: Map<number, number>; close: () => Promise<void> }> {
  const http = await import('http');
  const pushed = new Map<number, number>();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    let body = '';
    req.on('data', chunk => { body += String(chunk); });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && url.pathname.endsWith('/wp-json/wc/v3/products')) {
        const id = productIdBySku.get(url.searchParams.get('sku') || '');
        res.end(JSON.stringify(id ? [{ id }] : []));
        return;
      }
      const match = url.pathname.match(/\/wp-json\/wc\/v3\/products\/(\d+)$/);
      if (req.method === 'PUT' && match) {
        const parsed = JSON.parse(body || '{}') as { stock_quantity?: number };
        pushed.set(Number(match[1]), Number(parsed.stock_quantity));
        res.end('{}');
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, pushed, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

/**
 * TD-293 (تصمیم مالک محصول — گزینه الف): «انبار فروشگاه اینترنتی». با تنظیم انبار دوم، فاکتور سفارش از همان انبار کم می‌کند
 * (کالایی که فقط آنجا موجودی دارد فاکتور می‌شود)، و همگام‌سازی موجودی (تک‌کالا و دسته‌ای) موجودی قابل فروش همان انبار را
 * می‌فرستد: ۵ منهای ۲ رزرو پیش‌فاکتور = ۳، و کالایی با ۶ در انبار پیش‌فرض و ۱ در انبار فروشگاه = ۱ (نه جمع ۷).
 */
export async function checkWooShopWarehouse(): Promise<string[]> {
  const problems: string[] = [];
  const shop = await createTestWarehouse({ name: `انبار فروشگاه آزمون ${wooOrderId()}` });
  const onlyShop = await createTestItem({ code: `WC_SHOP_A_${wooOrderId()}`, stocks: { [shop.code]: 5 } });
  const reserved = await createTestItem({ code: `WC_SHOP_B_${wooOrderId()}`, stocks: { [shop.code]: 5 } });
  const mostlyDefault = await createTestItem({ code: `WC_SHOP_C_${wooOrderId()}`, stocks: { '': 6, [shop.code]: 1 } });
  const { DocumentService } = await import('../../services/document.service.js');
  await DocumentService.createDocument({
    docType: 'proforma', status: 'proforma', inOut: 'out', date: new Date().toISOString().slice(0, 10), user: 'inv', buyerName: 'خریدار پیش‌فاکتور آزمون',
    items: [{ itemId: reserved.id, quantity: 2, unitPrice: 1000, location: shop.code }],
  });
  const store = await mockWooStore(new Map([[onlyShop.code, 501], [reserved.code, 502], [mostlyDefault.code, 503]]));
  try {
    await withSettings({ wc_shop_warehouse: shop.code, wc_store_url: store.url, wc_consumer_key: 'ck_test', wc_consumer_secret: 'cs_test' }, async () => {
      const result = await WooOrderSyncService.handleOrder(wooOrder(wooOrderId(), 'processing', onlyShop.code, 2, 2000));
      if (result.status !== 'processed' || !result.docId) {
        problems.push(`the order for a shop warehouse item was not invoiced (${result.message.slice(0, 160)})`);
      } else {
        const loc = await pool.query<{ l: string }>('SELECT location AS l FROM document_items WHERE document_id = $1 AND is_deleted = 0', [result.docId]);
        if (loc.rows[0]?.l !== shop.code) problems.push(`invoice line warehouse "${loc.rows[0]?.l}", expected "${shop.code}"`);
      }

      const request = (await import('supertest')).default;
      const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
      const app = await getTestApp();
      const session = await getAdminSession();
      for (const item of [reserved, mostlyDefault]) {
        const res = await request(app).post('/api/woocommerce/sync-item').set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken).send({ itemId: item.id });
        if (res.status !== 200) problems.push(`sync of item ${item.code}: ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
      }
      if (store.pushed.get(502) !== 3) problems.push(`pushed stock of the reserved item ${store.pushed.get(502)}, expected 3 (5 minus 2 reserved)`);
      if (store.pushed.get(503) !== 1) problems.push(`pushed stock of the default warehouse item ${store.pushed.get(503)}, expected 1 (shop warehouse only)`);

      store.pushed.clear();
      const all = await request(app).post('/api/woocommerce/sync-all-stocks').set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken).send({});
      if (all.status !== 200) problems.push(`bulk sync: ${all.status}`);
      if (store.pushed.get(501) !== 3 || store.pushed.get(502) !== 3 || store.pushed.get(503) !== 1) {
        problems.push(`bulk sync: ${[501, 502, 503].map(id => store.pushed.get(id)).join(', ')}, expected 3, 3, 1`);
      }
    });
  } finally {
    await store.close();
  }
  return problems;
}
