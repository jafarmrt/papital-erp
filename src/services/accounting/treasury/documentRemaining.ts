import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/drizzle.js';
import { documents } from '../../../db/schema.js';
import { BusinessLogicError, ValidationError } from '../../../errors/customErrors.js';
import { fin, type FinancialDecimal } from '../../../lib/financialDecimal.js';
import { formatPersianNumber } from '../../../utils/persianNumber.js';

/**
 * v10.0.59 (TD-938، P5-P11، تصمیم ت۸ الف بازبینی فاز ۵): دریافت یا پرداخت وصل به سند حداکثر مانده آن سند است، در ثبت و در
 * «وصل دوباره». پیش‌تر ۳٬۵۰۰٬۰۰۰ برای سند ۳٬۰۰۰٬۰۰۰ پذیرفته می‌شد، سند «تسویه کامل» با مانده ۰ نشان داده می‌شد و مازاد
 * ۵۰۰٬۰۰۰ پنهان می‌ماند. مازاد بی پیوند به سند (علی‌الحساب) ثبت می‌شود.
 *
 * مانده = مبلغ قابل پرداخت سند (خالص اقلام فعال + مالیات + هزینه خدمات، به ارز سند؛ `documentEventAmounts`) − جمع تسویه
 * آن (`settledAmount`، همان جمعی که صفحه سند نشان می‌دهد). سند پیش از خواندن جمع `FOR NO KEY UPDATE` قفل می‌شود
 * (`lockSettlementDocument`، پس از بانک)، پس دو پرداخت همزمان به یک سند پشت سر هم سنجیده می‌شوند؛ این قفل با قفل کلید
 * خارجی درج ردیف خزانه تداخل ندارد.
 */

/** سطح ۶۰، پس از قفل بانک و پیش از قفل `FOR SHARE` همین سند در `assertTreasuryDocumentLink` */
export async function lockSettlementDocument(tx: DbExecutor, documentId: number): Promise<void> {
  await tx.select({ id: documents.id }).from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.isDeleted, 0)))
    .for('no key update');
}

/** مبلغ قابل پرداخت و جمع تسویه سند؛ بسته خزانه بسته اسناد را import نمی‌کند و ریشه ترکیب (`registerWorkflowDomainActions`) آن را ثبت می‌کند */
export type DocumentRemainingReader = (tx: DbExecutor, documentId: number) =>
  Promise<{ refNumber: string | null; payable: FinancialDecimal; settled: FinancialDecimal } | null>;

let readDocumentRemaining: DocumentRemainingReader = async () => {
  throw new BusinessLogicError('مانده سند خوانده نشد؛ سامانه کامل راه‌اندازی نشده است.');
};

export function registerDocumentRemainingReader(reader: DocumentRemainingReader): void {
  readDocumentRemaining = reader;
}

export async function assertWithinDocumentRemaining(tx: DbExecutor, link: { documentId: number; amount: number | string }): Promise<void> {
  const doc = await readDocumentRemaining(tx, link.documentId);
  if (!doc) return;
  const { payable, settled } = doc;
  const remaining = payable.subtract(settled.isNegative() ? 0 : settled);
  if (fin(link.amount).greaterThan(remaining.add(0.01))) {
    const left = remaining.isNegative() ? fin(0) : remaining;
    throw new ValidationError(
      `مبلغ ${formatPersianNumber(fin(link.amount).toNumber())} از مانده سند «${doc.refNumber}» (${formatPersianNumber(left.toNumber())}) بیشتر است؛ حداکثر مانده سند را به آن وصل کنید و مازاد را بی پیوند به سند (علی‌الحساب) ثبت کنید.`,
      { payable: payable.toNumber(), settled: settled.toNumber(), remaining: left.toNumber() },
      'TREASURY_AMOUNT_EXCEEDS_DOCUMENT_REMAINING',
    );
  }
}
