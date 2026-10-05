import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { customers, documents, items, woocommerceOrderLogs } from '../../db/schema.js';
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
 * کالایی که فقط در انبار غیرپیش‌فرض موجودی دارد: موجودی کل (همان عددی که «همگام‌سازی موجودی» به فروشگاه می‌فرستد) ۵ است
 * ولی فاکتور سفارش فقط از انبار پیش‌فرض کم می‌کند و سفارش پرداخت‌شده رد می‌شود
 */
export async function probeWooStockOutsideDefaultWarehouse(): Promise<boolean> {
  const other = await createTestWarehouse({ name: `انبار دوم ووکامرس ${wooOrderId()}` });
  const item = await createTestItem({ code: `WC_WH_${wooOrderId()}`, stocks: { [other.code]: 5 } });
  const id = wooOrderId();
  const result = await WooOrderSyncService.handleOrder(wooOrder(id, 'processing', item.code, 2, 2000));
  const [row] = await orm.select({ stock: items.currentStock }).from(items).where(eq(items.id, item.id));
  return result.status === 'failed' && Number(row?.stock ?? 0) >= 2;
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
      problems.push(`${currency}: سفارش فاکتور نشد (${result.message.slice(0, 160)})`);
      continue;
    }
    const [doc] = await orm.select({ currency: documents.currency }).from(documents).where(eq(documents.id, result.docId));
    const debit = await customerDebitOf(result.docId);
    if (doc?.currency !== 'IRR' || debit !== rial) problems.push(`${currency}: فاکتور ${doc?.currency} با بدهکار مشتری ${debit}، انتظار IRR و ${rial}`);
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
    if (doc?.buyerName !== existing.name) problems.push(`تلفن «${phone}»: فاکتور به نام ${doc?.buyerName ?? result.message.slice(0, 80)}، انتظار ${existing.name}`);
  }
  const duplicates = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM customers WHERE is_deleted = 0 AND id <> $1 AND regexp_replace(translate(phone, '۰۱۲۳۴۵۶۷۸۹', '0123456789'), '[^0-9]', '', 'g') LIKE $2`,
    [existing.id, `%912${suffix}`]);
  if (Number(duplicates.rows[0].n) !== 0) problems.push(`${duplicates.rows[0].n} مشتری تکراری با همان تلفن ساخته شد`);

  // تلفن دیگری (رقم آخر متفاوت) مشتری تازه می‌سازد
  const other = wooOrder(wooOrderId(), 'processing', item.code, 1, 1000);
  const otherPhone = `0912${suffix.slice(0, 6)}${(Number(suffix.slice(6)) + 1) % 10}`;
  other.billing = { ...other.billing, phone: otherPhone };
  const otherResult = await WooOrderSyncService.handleOrder(other);
  const [otherDoc] = await orm.select({ buyerName: documents.buyerName }).from(documents).where(eq(documents.id, otherResult.docId ?? 0));
  if (otherDoc?.buyerName === existing.name) problems.push(`تلفن دیگر «${otherPhone}» به همان مشتری نسبت داده شد`);
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
      problems.push(`${c.label}: فاکتور نشد (${result.message.slice(0, 160)})`);
      continue;
    }
    const lines = (await invoiceLines(result.docId)).map(l => `${l.q}×${Number(l.p)}`).join('|');
    const debit = await customerDebitOf(result.docId);
    if (debit !== c.debit) problems.push(`${c.label}: بدهکار مشتری ${debit}، انتظار ${c.debit}`);
    if (lines !== c.lines) problems.push(`${c.label}: سطرها ${lines}، انتظار ${c.lines}`);
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
    if (result.status !== 'processed' || !result.docId) return problems.push(`${label}: فاکتور نشد (${result.message.slice(0, 160)})`);
    const [doc] = await orm.select({ service: documents.serviceChargeAmount }).from(documents).where(eq(documents.id, result.docId));
    const got = (await lineDiscounts(result.docId)).join('|');
    if (got !== discounts) problems.push(`${label}: تخفیف سطرها ${got}، انتظار ${discounts}`);
    if (Number(doc?.service ?? 0) !== serviceCharge) problems.push(`${label}: هزینه خدمات ${doc?.service}، انتظار ${serviceCharge}`);
    const customer = await customerDebitOf(result.docId);
    if (customer !== debit) problems.push(`${label}: بدهکار مشتری ${customer}، انتظار ${debit}`);
  };

  await run('تخفیف ۴۰۰ روی ۱۰۰۰ و ۳۰۰۰', twoLines(wooOrderId(), 1000, 3000, { total: '3600', fee_lines: [{ name: 'تخفیف', total: '-400' }] }), 3600, '100|300', 0);
  await run('تخفیف ۱۰۰ کنار ارسال ۲۰۰', wooOrder(wooOrderId(), 'processing', a.code, 1, 1000, { total: '1100', shipping_lines: [{ total: '200' }], fee_lines: [{ name: 'تخفیف', total: '-100' }] }), 1100, '100', 200);
  await run('باقی‌مانده گرد کردن', twoLines(wooOrderId(), 1000, 2000, { total: '2900', fee_lines: [{ name: 'تخفیف', total: '-100' }] }), 2900, '33|67', 0);

  const tooMuch = await WooOrderSyncService.handleOrder(wooOrder(wooOrderId(), 'processing', a.code, 1, 500, {
    total: '100', shipping_lines: [{ total: '200' }], fee_lines: [{ name: 'تخفیف', total: '-600' }],
  }));
  if (tooMuch.status !== 'failed' || !tooMuch.message.includes('تخفیف کارمزدی')) problems.push(`تخفیف بیش از جمع اقلام رد نشد (${tooMuch.status}: ${tooMuch.message.slice(0, 120)})`);
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
  if (same.status !== 'processed') problems.push(`همان سفارش با وضعیت completed: ${same.status}، انتظار processed`);
  const changed = await WooOrderSyncService.handleOrder(wooOrder(edited, 'processing', item.code, 3, 3000));
  const editedLog = await logOf(edited);
  if (changed.status !== 'needs_review' || editedLog?.status !== 'needs_review') problems.push(`سفارش ویرایش‌شده: ${changed.status} / لاگ ${editedLog?.status}، انتظار needs_review`);
  if (!String(editedLog?.errorMessage || '').includes('اقلام یا مبلغ سفارش عوض شده')) problems.push(`پیام تفاوت ویرایش: ${String(editedLog?.errorMessage || '').slice(0, 120)}`);
  if (editedLog?.erpDocumentId !== first.docId) problems.push(`فاکتور لاگ ${editedLog?.erpDocumentId}، انتظار ${first.docId}`);
  const qty = await pool.query<{ q: string }>('SELECT COALESCE(SUM(quantity), 0)::text AS q FROM document_items WHERE document_id = $1 AND is_deleted = 0', [first.docId ?? 0]);
  if (Number(qty.rows[0].q) !== 2) problems.push(`مقدار فاکتور ${qty.rows[0].q}، انتظار ۲ (فاکتور دست نمی‌خورد)`);
  const again = await WooOrderSyncService.handleOrder(wooOrder(edited, 'completed', item.code, 3, 3000));
  if (again.status !== 'needs_review' || (again.docId && again.docId !== first.docId)) problems.push(`وب‌هوک بعدی سفارش در حال بررسی: ${again.status} / ${again.docId}`);

  const refunded = wooOrderId();
  await WooOrderSyncService.handleOrder(wooOrder(refunded, 'processing', item.code, 2, 2000));
  const refund = await WooOrderSyncService.handleOrder(wooOrder(refunded, 'completed', item.code, 2, 2000, { refunds: [{ id: 1, reason: 'یک قلم آسیب دید', total: '-1000' }] }));
  const refundLog = await logOf(refunded);
  if (refund.status !== 'needs_review' || !String(refundLog?.errorMessage || '').includes('استرداد تازه به مبلغ 1000')) {
    problems.push(`استرداد جزئی: ${refund.status} / ${String(refundLog?.errorMessage || '').slice(0, 120)}`);
  }
  return problems;
}
