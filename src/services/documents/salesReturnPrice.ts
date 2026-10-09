import { and, asc, eq, inArray } from 'drizzle-orm';
import { completeReturnLines, type EarlierReturnLine } from './salesReturnCompletion.js';
import { documentItems, documents, items } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { fin, type DecimalValue } from '../../lib/financialDecimal.js';
import { money, type Money } from '../../lib/money.js';
import { invoiceReturnTerms, isInvoiceNetUnitPrice } from '../../lib/documents/returnUnitPrice.js';
import { formatPersianNumber } from '../../utils/persianNumber.js';
import { normalizeCurrency, parseExchangeRateInput, type ExchangeRateInput } from './documentExchangeRate.js';
import { assertReturnableInvoice } from './salesReturnCost.js';
import type { DbClient, DocumentLineItemInput } from './types.js';

/**
 * v9.0.273 (TD-788، یافته B08-19، تصمیم ت۱۰ «الف» بسته ۸): برگشت از فروشِ دارای فاکتور مرجع، ارز، نرخ تسعیر و قیمت
 * خالص هر واحد را از همان فاکتور می‌گیرد (`invoiceReturnTerms`)، پس بستانکاری مشتری همان مبلغی است که بابت همان کالا
 * بدهکار شده بود. ارز، نرخ یا قیمت دیگر در بدنه، تخفیف ردیف و کالایی که در فاکتور نیست ۴۲۲ می‌گیرد؛ فیلدی که فرستاده
 * نشود از فاکتور پر می‌شود. ثبت، ویرایش پیش‌نویس و نهایی‌سازی برگشت همین قاعده را اجرا می‌کنند. برگشت بی فاکتور مرجع
 * قیمت را از کاربر می‌گیرد.
 *
 * پیش‌تر قیمت، تخفیف، ارز و نرخ برگشت از بدنه می‌آمد: یک عدد که ۹۰۰٬۰۰۰ ریال خالص فروخته شده بود با ۵٬۰۰۰٬۰۰۰ ریال
 * بستانکار می‌شد، و برگشت کامل فاکتور ۱۸۰ دلاری از صفحه انبار (ارز `IRR`، قیمت ۱۰۰، بی تخفیف) فقط ۲۰۰ ریال.
 */

export interface ReturnInvoiceTermsResult<T extends DocumentLineItemInput> {
  currency: string;
  /** نرخ فاکتور مرجع؛ برای فاکتور ارزی قدیمی بی نرخ، نرخ ارسالی (اگر باشد) */
  exchangeRate: Money | null;
  /** ردیف‌ها با قیمت خالص فاکتور و تخفیف صفر؛ وقتی ردیفی فرستاده نشده null */
  lines: T[] | null;
}

type LinePriceInput = Pick<DocumentLineItemInput, 'itemId' | 'unit_price' | 'unitPrice' | 'price' | 'discount'>;

function sentValue(...values: unknown[]): DecimalValue | undefined {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v as DecimalValue;
  }
  return undefined;
}

function amountText(value: DecimalValue): string {
  return formatPersianNumber(fin(value).toNumber(), 4);
}

/**
 * ارز، نرخ و ردیف‌های برگشت را با فاکتور مرجع می‌سنجد و از آن پر می‌کند. `stage: 'finalize'` همان سنجش روی پیش‌نویس
 * ذخیره‌شده است و پیام آن کاربر را به ویرایش پیش‌نویس می‌فرستد.
 */
export async function enforceReturnInvoiceTerms<T extends DocumentLineItemInput>(
  tx: DbClient,
  invoiceId: number,
  input: { currency?: unknown; rate?: ExchangeRateInput; lines?: T[] | null; stage?: 'record' | 'finalize' },
): Promise<ReturnInvoiceTermsResult<T>> {
  await assertReturnableInvoice(tx, invoiceId);
  const [invoice] = await tx
    .select({ refNumber: documents.refNumber, currency: documents.currency, exchangeRate: documents.exchangeRate })
    .from(documents)
    .where(eq(documents.id, invoiceId));
  const invoiceLines = await tx
    .select({ itemId: documentItems.itemId, quantity: documentItems.quantity, unitPrice: documentItems.unitPrice, discount: documentItems.discount })
    .from(documentItems)
    .where(and(eq(documentItems.documentId, invoiceId), eq(documentItems.isDeleted, 0)))
    .orderBy(asc(documentItems.id));
  const terms = invoiceReturnTerms(invoiceLines);
  const ref = invoice?.refNumber || String(invoiceId);
  const hint = input.stage === 'finalize'
    ? 'پیش‌نویس برگشت را ویرایش کنید تا با ارز، نرخ و قیمت خالص همان فاکتور ذخیره شود.'
    : 'برگشت با ارز، نرخ و قیمت خالص همان فاکتور ثبت می‌شود.';

  const currency = normalizeCurrency(invoice?.currency);
  const sentCurrency = sentValue(input.currency);
  if (sentCurrency !== undefined && normalizeCurrency(sentCurrency) !== currency) {
    throw new ValidationError(
      `ارز برگشت از فروش (${normalizeCurrency(sentCurrency)}) با ارز فاکتور مرجع «${ref}» (${currency}) یکی نیست. ${hint}`,
      { invoiceId, currency, sentCurrency: normalizeCurrency(sentCurrency) },
      'RETURN_CURRENCY_MISMATCH',
    );
  }

  let exchangeRate: Money | null = null;
  if (currency !== 'IRR') {
    const invoiceRate = fin(invoice?.exchangeRate);
    const sentRate = parseExchangeRateInput(input.rate);
    if (invoiceRate.isPositive()) {
      if (sentRate !== undefined && !sentRate.equals(invoiceRate)) {
        throw new ValidationError(
          `نرخ تسعیر برگشت از فروش (${amountText(sentRate)} ریال) با نرخ فاکتور مرجع «${ref}» (${amountText(invoiceRate)} ریال به ازای هر ${currency}) یکی نیست. ${hint}`,
          { invoiceId, exchangeRate: invoiceRate.toNumber(), sentExchangeRate: sentRate.toNumber() },
          'RETURN_EXCHANGE_RATE_MISMATCH',
        );
      }
      exchangeRate = money(invoiceRate);
    } else {
      // فاکتور ارزی پیش از v7.0.63 بی نرخ ذخیره شده است؛ نرخ برگشت از کاربر (و در نبودش ۴۲۲ نرخ الزامی)
      exchangeRate = sentRate ?? null;
    }
  }

  if (!Array.isArray(input.lines)) return { currency, exchangeRate, lines: null };

  const lineItemIds = [...new Set(input.lines.map(l => Number(l.itemId)).filter(id => Number.isInteger(id) && id > 0))];
  const itemRows = lineItemIds.length > 0
    ? await tx.select({ id: items.id, name: items.name, code: items.code }).from(items).where(inArray(items.id, lineItemIds))
    : [];
  const itemLabel = (id: number) => {
    const it = itemRows.find(r => r.id === id);
    return `«${it?.name ?? id}» (${it?.code ?? '-'})`;
  };

  // v10.0.39 (TD-933، تصمیم ب): برگشتی که مقدار کالا را کامل برمی‌گرداند باقی‌مانده دقیق خالص آن را برمی‌گرداند
  const earlierLines = await earlierFinalReturnLines(tx, invoiceId);
  const completionPrices = new Map<number, ReturnType<typeof fin>>();
  for (const [itemId, price] of completeReturnLines(input.lines.map(l => ({ itemId: Number(l.itemId), quantity: l.quantity as DecimalValue })), terms, earlierLines).completionPrices) {
    completionPrices.set(itemId, price);
  }

  const problems: string[] = [];
  const details: Array<Record<string, unknown>> = [];
  const priced = input.lines.map((line: T) => {
    const itemId = Number(line.itemId);
    const itemTerms = terms.get(itemId);
    if (!itemTerms) {
      problems.push(`کالای ${itemLabel(itemId)} در فاکتور مرجع نیست`);
      details.push({ itemId, reason: 'not_on_invoice' });
      return line;
    }
    const priceLine = line as LinePriceInput;
    const sentPrice = sentValue(priceLine.unit_price, priceLine.unitPrice, priceLine.price);
    // v10.0.39 (TD-933): ردیف تکمیلی برگشت کامل (یک واحد با باقی‌مانده دقیق) که پیش‌نویس ذخیره کرده هم پذیرفته است
    const completion = completionPrices.get(itemId);
    if (sentPrice !== undefined && !isInvoiceNetUnitPrice(sentPrice, itemTerms.netUnitPrice) && !(completion && isInvoiceNetUnitPrice(sentPrice, completion))) {
      problems.push(`قیمت کالای ${itemLabel(itemId)} ${amountText(sentPrice)} است، ولی قیمت خالص هر واحد آن در فاکتور ${amountText(itemTerms.netUnitPrice)} ${currency}`);
      details.push({ itemId, reason: 'price', sent: fin(sentPrice).toNumber(), netUnitPrice: itemTerms.netUnitPrice.toNumber() });
    }
    const sentDiscount = sentValue(priceLine.discount);
    if (sentDiscount !== undefined && !fin(sentDiscount).isZero()) {
      problems.push(`ردیف کالای ${itemLabel(itemId)} تخفیف ${amountText(sentDiscount)} دارد، ولی قیمت خالص فاکتور تخفیف را در خود دارد`);
      details.push({ itemId, reason: 'discount', sent: fin(sentDiscount).toNumber() });
    }
    return { ...line, unit_price: itemTerms.netUnitPrice.toString(), unitPrice: undefined, price: undefined, discount: 0 };
  });
  if (problems.length > 0) {
    throw new ValidationError(
      `برگشت از فروش با فاکتور مرجع «${ref}» نمی‌خواند: ${problems.join('؛ ')}. ${hint}`,
      { invoiceId, lines: details },
      'RETURN_PRICE_MISMATCH',
    );
  }
  const lines = completeReturnLines(priced, terms, earlierLines).lines;
  return { currency, exchangeRate, lines };
}

/** ردیف‌های زنده برگشت‌های قطعی و ابطال‌نشده پیشین همان فاکتور */
async function earlierFinalReturnLines(tx: DbClient, invoiceId: number): Promise<EarlierReturnLine[]> {
  return tx
    .select({ itemId: documentItems.itemId, quantity: documentItems.quantity, unitPrice: documentItems.unitPrice, discount: documentItems.discount })
    .from(documentItems)
    .innerJoin(documents, eq(documents.id, documentItems.documentId))
    .where(and(
      eq(documents.returnOfDocumentId, invoiceId),
      eq(documents.type, 'return'),
      eq(documents.status, 'final'),
      eq(documents.isDeleted, 0),
      eq(documentItems.isDeleted, 0),
    ));
}
