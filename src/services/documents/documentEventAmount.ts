import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documents } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { NotFoundError } from '../../errors/customErrors.js';
import type { DocumentEventAmounts } from '../events/domainEvents.js';
import { workflowDocumentAmount } from '../workflow/workflowDocumentAmount.js';

/**
 * v9.0.407 (TD-713، B15-11): مبلغ‌های رویداد سند فروش و خرید، از سند ذخیره‌شده و درون همان تراکنشی که رویداد را در outbox
 * می‌نویسد: totalAmount مبلغ قابل پرداخت به ارز خود سند (خالص اقلام فعال + مالیات + هزینه خدمات، AGENTS §۶، همان قاعده
 * `workflowDocumentAmount`) و totalAmountIrr همان به ریال با نرخ سند (سند ارزی بی نرخ: null). پیش‌تر رویداد تأیید فاکتور
 * مبلغی نداشت، پس قانون «payload.totalAmount بیشتر از ۰» هرگز اجرا نمی‌شد و ممیزی «به مبلغ undefined» می‌نوشت.
 */
export async function documentEventAmounts(executor: DbExecutor, documentId: number): Promise<DocumentEventAmounts> {
  const [doc] = await executor.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) throw new NotFoundError(`سند ${documentId} برای ثبت رویداد یافت نشد.`);
  const amount = await workflowDocumentAmount(executor, doc);
  const vat = fin(doc.vatAmount ?? 0);
  const service = fin(doc.serviceChargeAmount ?? 0);
  return {
    totalAmount: amount.amountInCurrency,
    netAmount: fin(amount.amountInCurrency).subtract(vat).subtract(service).toNumber(),
    vatAmount: vat.toNumber(),
    serviceChargeAmount: service.toNumber(),
    totalAmountIrr: Number.isFinite(amount.amountIrr) ? amount.amountIrr : null,
  };
}
