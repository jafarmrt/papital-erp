import { and, desc, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { documents } from '../../db/schema.js';
import { AppError, NotFoundError } from '../../errors/customErrors.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/** یک سند قطعی با شماره خواسته‌شده، برای انتخاب سال مالی در فرم */
export interface DocumentRefCandidate {
  id: number;
  refFiscalYear: number | null;
  date: string;
  buyerName: string | null;
}

export const DOCUMENT_REF_AMBIGUOUS = 'DOCUMENT_REF_AMBIGUOUS';
export const DOCUMENT_REF_NOT_FOUND = 'DOCUMENT_REF_NOT_FOUND';

/** بیش از این، شماره خطای داده است؛ فهرست کوتاه می‌ماند */
const MAX_CANDIDATES = 20;

/**
 * v9.0.257 (TD-782، یافته B08-13): سند قطعی فعال یک نوع با شماره‌اش، در سال مالی داده‌شده یا همه سال‌ها. شماره سند هر سال
 * از نو شروع می‌شود (`uq_documents_type_fy_ref_active` روی نوع، سال و شماره)، پس یک شماره در چند سال یک سند دارد: یکی
 * باشد شناسه‌اش برمی‌گردد، نباشد ۴۰۴ `DOCUMENT_REF_NOT_FOUND`، و چند تا باشد ۴۰۹ `DOCUMENT_REF_AMBIGUOUS` با فهرست سال‌ها تا
 * فرم سال را بپرسد. پیش‌تر همه اسناد آن نوع با ردیف‌ها و تسویه‌ها بار می‌شد و نخستین سند با آن شماره (همیشه سال جاری)
 * برمی‌گشت: فاکتور سال قبل از فرم برگشت دست‌نیافتنی بود و برگشت به فاکتور نادرست وصل می‌شد.
 */
export async function findFinalDocumentIdByRef(input: { ref: string; type: string; fiscalYear?: number | null; typeTitle: string }): Promise<number> {
  const ref = input.ref.trim();
  const conditions = [
    eq(documents.type, input.type),
    eq(documents.refNumber, ref),
    eq(documents.isDeleted, 0),
    eq(documents.status, 'final'),
  ];
  if (input.fiscalYear) conditions.push(eq(documents.refFiscalYear, input.fiscalYear));
  const rows: DocumentRefCandidate[] = await orm
    .select({ id: documents.id, refFiscalYear: documents.refFiscalYear, date: documents.date, buyerName: documents.buyerName })
    .from(documents)
    .where(and(...conditions))
    .orderBy(desc(documents.refFiscalYear), desc(documents.id))
    .limit(MAX_CANDIDATES);

  const yearText = input.fiscalYear ? ` در سال مالی ${toPersianDigits(String(input.fiscalYear))}` : '';
  if (rows.length === 0) {
    throw new NotFoundError(`${input.typeTitle} قطعی با شماره «${ref}»${yearText} یافت نشد.`, { ref, fiscalYear: input.fiscalYear ?? null }, DOCUMENT_REF_NOT_FOUND);
  }
  if (rows.length > 1) {
    const years = rows.map(r => (r.refFiscalYear ? toPersianDigits(String(r.refFiscalYear)) : 'بی سال')).join('، ');
    throw new AppError(
      `شماره «${ref}» در چند سال مالی ${input.typeTitle} قطعی دارد (${years})؛ سال مالی را انتخاب کنید.`,
      409,
      DOCUMENT_REF_AMBIGUOUS,
      { ref, candidates: rows },
    );
  }
  return rows[0].id;
}
