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

/** استرداد جزئی سفارشِ فاکتورشده (وضعیت همان completed می‌ماند) هیچ اثری در ERP ندارد: نه علامت بررسی، نه پیام */
export async function probeWooPartialRefundIgnored(): Promise<boolean> {
  const item = await createTestItem({ code: `WC_REFUND_${wooOrderId()}`, stocks: { '': 5 } });
  const id = wooOrderId();
  await WooOrderSyncService.handleOrder(wooOrder(id, 'processing', item.code, 2, 2000));
  await WooOrderSyncService.handleOrder(wooOrder(id, 'completed', item.code, 2, 2000, { refunds: [{ id: 1, reason: 'یک قلم آسیب دید', total: '-1000' }] }));
  const log = await logOf(id);
  return log?.status === 'processed' && !String(log.errorMessage || '');
}

/** ویرایش سفارشِ فاکتورشده در فروشگاه (مقدار ۲ ← ۳، مبلغ ۲۰۰۰ ← ۳۰۰۰) نادیده گرفته می‌شود و فاکتور با سفارش نمی‌خواند */
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

/** سفارشی با تخفیف به‌صورت کارمزد منفی (fee_lines = −۲۰۰) کلاً فاکتور نمی‌شود */
export async function probeWooNegativeFeeRejected(): Promise<boolean> {
  const item = await createTestItem({ code: `WC_FEE_${wooOrderId()}`, stocks: { '': 5 } });
  const id = wooOrderId();
  const result = await WooOrderSyncService.handleOrder(wooOrder(id, 'processing', item.code, 1, 1000, {
    total: '800', fee_lines: [{ name: 'تخفیف', total: '-200' }],
  }));
  return result.status === 'failed';
}

/** مشتری موجود با تلفن ۰۹۱۲… با سفارش تلفن +۹۸۹۱۲… شناخته نمی‌شود و مشتری تکراری ساخته می‌شود */
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

/** ردیف ۳ عددی با جمع ۱۰۰۰ ریال: فی ۳۳۳٫۳۳۳۳ و جمع فاکتور ۹۹۹٫۹۹۹۹ — بدهکار مشتری با مبلغ پرداختی سفارش یکی نیست */
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
