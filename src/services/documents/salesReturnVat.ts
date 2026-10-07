import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { documentItems, documents } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { currencyScale } from '../../lib/currencyScale.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { formatPersianNumber } from '../../utils/persianNumber.js';
import { computeNetAmount, parseVatInput, type DocumentVat, type VatInput, type VatLine } from './documentVat.js';
import type { DbClient } from './types.js';

/**
 * v9.0.247 (TD-774، یافته B08-05، تصمیم ت۵ «الف» بسته ۸): برگشتِ دارای فاکتور مرجع مالیات بر ارزش افزوده را به نسبت مبلغ
 * خالص برگشتی از مالیات همان فاکتور می‌گیرد: مالیات فاکتور × خالص برگشت ÷ خالص فاکتور، گرد به کوچک‌ترین واحد ارز
 * (TD-382). درصد همان درصد فاکتور است. نسبت روی خالص انباشته برگشت‌های نهایی همان فاکتور گرفته می‌شود
 * (سهم «قبلی‌ها و این» منهای سهم «قبلی‌ها»، هر کدام حداکثر مالیات فاکتور)، تا برگشت کامل در چند نوبت درست همان مالیات
 * فاکتور را برگرداند و گرد کردن هر نوبت جمع را از آن جدا نکند. درصد یا مبلغ دیگر در بدنه ۴۲۲ `RETURN_VAT_MISMATCH`.
 * سند حسابداری برگشت این مالیات را «بدهکار مالیات پرداختنی (۳۲۰۳)» می‌کند و مشتری را خالص به‌علاوه مالیات بستانکار.
 *
 * پیش‌تر برگشت همیشه مالیات صفر داشت: فروش ۱٬۰۰۰٬۰۰۰ با ۱۰٪ و برگشت کامل آن، مشتری را ۱۰۰٬۰۰۰ بدهکار و مالیات
 * پرداختنی را ۱۰۰٬۰۰۰ بستانکار می‌گذاشت.
 */

export async function resolveReturnVatFromInvoice(
  tx: DbClient,
  params: {
    invoiceId: number;
    /** خود برگشت در ویرایش و نهایی‌سازی؛ در ثبت تازه null */
    returnId: number | null;
    lines: VatLine[];
    input: VatInput;
    currency: string | null | undefined;
    stage?: 'record' | 'finalize';
  },
): Promise<DocumentVat> {
  const [invoice] = await tx
    .select({ refNumber: documents.refNumber, vatPercent: documents.vatPercent, vatAmount: documents.vatAmount })
    .from(documents)
    .where(eq(documents.id, params.invoiceId));
  const invoiceLines = await tx
    .select({ quantity: documentItems.quantity, unitPrice: documentItems.unitPrice, discount: documentItems.discount })
    .from(documentItems)
    .where(and(eq(documentItems.documentId, params.invoiceId), eq(documentItems.isDeleted, 0)));
  const invoiceVat = fin(invoice?.vatAmount);
  const invoiceNet = computeNetAmount(invoiceLines);
  const vatPercent = Number(invoice?.vatPercent) || 0;

  const earlier = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(
      eq(documents.returnOfDocumentId, params.invoiceId),
      eq(documents.type, 'return'),
      eq(documents.status, 'final'),
      eq(documents.isDeleted, 0),
      ...(params.returnId !== null ? [ne(documents.id, params.returnId)] : []),
    ))
    .orderBy(asc(documents.id));
  let earlierNet = fin(0);
  if (earlier.length > 0) {
    const earlierLines = await tx
      .select({ documentId: documentItems.documentId, quantity: documentItems.quantity, unitPrice: documentItems.unitPrice, discount: documentItems.discount })
      .from(documentItems)
      .where(and(inArray(documentItems.documentId, earlier.map(r => r.id)), eq(documentItems.isDeleted, 0)));
    for (const { id } of earlier) earlierNet = earlierNet.add(computeNetAmount(earlierLines.filter(l => l.documentId === id)));
  }

  const scale = currencyScale(params.currency);
  const shareOf = (net: FinancialDecimal): FinancialDecimal => {
    if (!invoiceNet.isPositive() || !invoiceVat.isPositive()) return fin(0);
    const share = invoiceVat.multiply(net).divide(invoiceNet, 12).round(scale);
    return share.greaterThan(invoiceVat) ? invoiceVat : share;
  };
  const thisNet = computeNetAmount(params.lines);
  const diff = shareOf(earlierNet.add(thisNet)).subtract(shareOf(earlierNet));
  const vatAmount = diff.isNegative() ? fin(0) : diff;

  const sent = parseVatInput(params.input);
  const percentDiffers = sent.vatPercent !== undefined && !fin(sent.vatPercent).equals(vatPercent);
  const amountDiffers = sent.vatAmount !== undefined && !sent.vatAmount.round(4).equals(vatAmount.round(4));
  if (percentDiffers || amountDiffers) {
    const ref = invoice?.refNumber || String(params.invoiceId);
    const hint = params.stage === 'finalize' ? 'نهایی‌سازی را بی مالیات دستی بفرستید.' : 'مالیات برگشت را نفرستید تا از فاکتور گرفته شود.';
    throw new ValidationError(
      `مالیات برگشت از فروش به نسبت مبلغ برگشتی از مالیات فاکتور مرجع «${ref}» است: ${formatPersianNumber(vatPercent, 4)}٪ و ` +
      `${formatPersianNumber(vatAmount.toNumber(), 4)}، نه ${sent.vatPercent !== undefined ? `${formatPersianNumber(sent.vatPercent, 4)}٪` : ''}` +
      `${sent.vatPercent !== undefined && sent.vatAmount !== undefined ? ' و ' : ''}${sent.vatAmount !== undefined ? formatPersianNumber(sent.vatAmount.toNumber(), 4) : ''}. ${hint}`,
      { invoiceId: params.invoiceId, vatPercent, vatAmount: vatAmount.toNumber() },
      'RETURN_VAT_MISMATCH',
    );
  }
  return { vatPercent, vatAmount: money(vatAmount.round(4)) };
}
