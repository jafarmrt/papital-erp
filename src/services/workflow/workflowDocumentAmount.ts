import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { appSettings, documentItems, documents } from '../../db/schema.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { normalizeCurrency } from '../documents/documentExchangeRate.js';

/**
 * v8.0.123 (TD-404): مبلغی که قاعده‌های گردش‌کار سند می‌سنجند (amount / finalAmount / totalAmount) مبلغ قابل پرداخت سند
 * به ریال است: خالص اقلام فعال + مالیات + هزینه ارسال و خدمات (AGENTS §۶)، و سند ارزی با نرخ تسعیر خودش (یا نرخ تنظیمات
 * exchange_rate_<ارز>، همان ترتیب سند حسابداری). پیش‌تر خالص اقلام بی مالیات و هزینه خدمات و بی تسعیر سنجیده می‌شد و
 * فاکتور ۱۰۰ دلاری با «مبلغ بیشتر از ۱۰٬۰۰۰٬۰۰۰ ریال» از گام تأیید مدیر رد می‌شد.
 *
 * سند ارزی بی هیچ نرخی مبلغ ریالی معلومی ندارد: amountIrr برابر NaN است تا هر مقایسه عددی (بیشتر، کمتر، برابر) نگذرد
 * و گامی که به مبلغ وابسته است تا ثبت نرخ بسته بماند؛ پیش‌تر مبلغ نامعلوم صفر شمرده می‌شد و گام «مبلغ کم» می‌گذشت.
 */
export interface WorkflowDocumentAmount {
  /** مبلغ قابل پرداخت به ریال؛ NaN وقتی سند ارزی نرخ ندارد */
  amountIrr: number;
  /** مبلغ قابل پرداخت به ارز خود سند */
  amountInCurrency: number;
  /** نرخ تسعیر به‌کاررفته (ریال به ازای یک واحد)؛ سند ریالی 1، بی نرخ null */
  exchangeRate: number | null;
  /** شمار ردیف‌های فعال سند */
  lineCount: number;
}

async function documentRate(executor: DbExecutor, doc: typeof documents.$inferSelect, currency: string): Promise<FinancialDecimal | null> {
  if (currency === 'IRR') return fin(1);
  if (fin(doc.exchangeRate).isPositive()) return fin(doc.exchangeRate);
  const [setting] = await executor.select({ value: appSettings.value }).from(appSettings)
    .where(eq(appSettings.key, `exchange_rate_${currency.toLowerCase()}`));
  const settingRate = fin(setting?.value ?? 0);
  return settingRate.isPositive() ? settingRate : null;
}

export async function workflowDocumentAmount(executor: DbExecutor, doc: typeof documents.$inferSelect): Promise<WorkflowDocumentAmount> {
  const lines = await executor.select({ quantity: documentItems.quantity, unitPrice: documentItems.unitPrice, discount: documentItems.discount })
    .from(documentItems)
    .where(and(eq(documentItems.documentId, doc.id), eq(documentItems.isDeleted, 0)));
  let net = fin(0);
  for (const line of lines) {
    net = net.add(fin(line.quantity).multiply(line.unitPrice)).subtract(line.discount ?? 0);
  }
  const payable = net.add(doc.vatAmount ?? 0).add(doc.serviceChargeAmount ?? 0);
  const currency = normalizeCurrency(doc.currency);
  const rate = await documentRate(executor, doc, currency);
  return {
    amountIrr: rate ? payable.multiply(rate).round(0).toNumber() : Number.NaN,
    amountInCurrency: payable.toNumber(),
    exchangeRate: rate ? rate.toNumber() : null,
    lineCount: lines.length,
  };
}
