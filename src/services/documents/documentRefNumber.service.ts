import { eq, and, gte, lt } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { documents, appSettings, documentRefCounters } from '../../db/schema.js';
import { jalaliToIsoDate } from '../../utils.js';
import { businessTodayIsoDate, resolveJalaliFiscalYear } from '../../lib/businessClock.js';
import type { DbClient } from './types.js';
import { ConflictError } from '../../errors/customErrors.js';
import { isAutoRefNumber } from '../../lib/documents/documentRefRules.js';
import { documentTypeTitle } from '../../lib/documents/documentTypeTitles.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/** بیشینه مقدار ستون integer شمارنده `document_ref_counters.last_ref_number` */
export const MAX_REF_COUNTER_VALUE = 2147483647;

/** بیش از این شماره پیاپیِ گرفته‌شده، خطای داده است و شماره خودکار داده نمی‌شود */
const MAX_TAKEN_SERIALS_SKIPPED = 1000;

export const DOCUMENT_REF_TAKEN = 'DOCUMENT_REF_TAKEN';

/** پیام ۴۰۹ شماره گرفته‌شده در همان نوع و سال مالی */
export function documentRefTakenError(docType: string, refNumber: string, fiscalYear: number): ConflictError {
  return new ConflictError(
    `شماره «${refNumber}» در سال مالی ${toPersianDigits(String(fiscalYear))} برای ${documentTypeTitle(docType)} گرفته شده است؛ شماره دیگری بنویسید یا آن را خالی بگذارید تا شماره بعدی سری داده شود.`,
    { refNumber, fiscalYear, docType },
    DOCUMENT_REF_TAKEN,
  );
}

/**
 * v7.0.60 (audit P3-10): شماره ترتیبی یک شماره عطف فقط پسوند عددی آن است.
 * پیش‌تر همه غیرارقام حذف می‌شد و «INV-1403-0005» به 14030005 تبدیل می‌شد و شمارنده را جلو می‌برد.
 * شماره‌ای که به رقم ختم نمی‌شود شماره ترتیبی ندارد (null).
 */
export function extractRefSerial(refNumber: string | number | null | undefined): number | null {
  const match = String(refNumber ?? '').match(/(\d+)$/);
  if (!match) return null;
  const val = parseInt(match[1], 10);
  return Number.isNaN(val) ? null : val;
}

export class DocumentRefNumberService {
  /**
   * Resolves fiscal year from a date string/number and the invoice start-number setting.
   */
  static async resolveRefContext(
    tx: DbClient,
    type: string,
    dateOrFiscalYear?: string | number
  ): Promise<{ fiscalYear: number; startNumber: number }> {
    // V10-1.1: قاعده صریح و واحد — partition key شمارنده‌ها همیشه «سال جلالی» است،
    // نه پرش بین ۱۴۰۵/۲۰۲۶ بسته به فرمت رشته تاریخ.
    // v8.0.48 (TD-311): بی‌تاریخ (پیش‌نمایش شماره بعدی فرم‌ها) سال امروزِ ساعت توافقی است
    const hasDate = dateOrFiscalYear !== undefined && dateOrFiscalYear !== null && String(dateOrFiscalYear).trim() !== '';
    const fiscalYear = resolveJalaliFiscalYear(hasDate ? dateOrFiscalYear : await businessTodayIsoDate());

    let startNumber = 1;
    if (type === 'invoice') {
      const startSetting = await tx.select().from(appSettings).where(eq(appSettings.key, 'invoice_start_number'));
      if (startSetting.length > 0 && !isNaN(parseInt(startSetting[0].value, 10))) {
        startNumber = parseInt(startSetting[0].value, 10);
      }
    }

    return { fiscalYear, startNumber };
  }

  /**
   * TD-152 (V6 Sub-phase 4.3):
   * Scans existing documents of the given type and fiscal year, returning the maximum numeric refNumber suffix.
   * Isolates scanning to the specific fiscal year so that new fiscal years correctly start serial numbers from 1 (or startNumber),
   * rather than carrying over historical numbers from prior years.
   */
  static async getMaxExistingRefNumber(tx: DbClient, type: string, fiscalYear?: number): Promise<number> {
    const conditions = [
      eq(documents.type, type),
      eq(documents.isDeleted, 0)
    ];

    if (fiscalYear && fiscalYear >= 1300 && fiscalYear <= 1500) {
      const startIso = jalaliToIsoDate(`${fiscalYear}/01/01`);
      const endIso = jalaliToIsoDate(`${fiscalYear + 1}/01/01`);
      if (startIso && endIso) {
        conditions.push(
          gte(documents.date, `${startIso} 00:00:00`),
          lt(documents.date, `${endIso} 00:00:00`)
        );
      }
    }

    const existingDocs = await tx
      .select({ refNumber: documents.refNumber, date: documents.date })
      .from(documents)
      .where(and(...conditions));

    let maxNum = 0;
    // v7.0.34 (TD-196): شمارنده در ستون integer نگه داشته می‌شود؛ شماره‌های دستی طولانی (مثلاً ۱۳ رقمی)
    // که از سقف آن بیشترند در مقداردهی اولیه نادیده گرفته می‌شوند — همان قاعده همگام‌سازی شماره دستی در
    // createDocument. پیش‌تر چنین سندی شماره‌گذاری خودکار آن نوع سند را در کل سال مالی متوقف می‌کرد.
    for (const doc of existingDocs) {
      // Secondary in-memory validation to guarantee calendar boundary precision
      if (fiscalYear && fiscalYear >= 1300 && fiscalYear <= 1500) {
        const docFy = resolveJalaliFiscalYear(doc.date);
        if (docFy !== fiscalYear) continue;
      }
      const val = extractRefSerial(doc.refNumber);
      if (val !== null && val <= MAX_REF_COUNTER_VALUE && val > maxNum) {
        maxNum = val;
      }
    }
    return maxNum;
  }

  /**
   * Peeks the next reference number for a document type WITHOUT incrementing any counter.
   * Used by form prefill endpoints so that abandoned forms / page loads never burn document numbers.
   */
  static async peekNextRef(type: string, dateOrFiscalYear?: string | number): Promise<string> {
    const { fiscalYear, startNumber } = await DocumentRefNumberService.resolveRefContext(orm, type, dateOrFiscalYear);

    const [counter] = await orm
      .select()
      .from(documentRefCounters)
      .where(and(
        eq(documentRefCounters.docType, type),
        eq(documentRefCounters.fiscalYear, fiscalYear)
      ));

    if (counter) {
      return String(await DocumentRefNumberService.firstFreeSerial(orm, type, fiscalYear, Math.max(counter.lastRefNumber + 1, startNumber)));
    }

    // Cold start: peek from max existing document number for THIS fiscal year (read-only, no counter write)
    const maxNum = await DocumentRefNumberService.getMaxExistingRefNumber(orm, type, fiscalYear);
    return String(Math.max(maxNum + 1, startNumber));
  }

  /**
   * v9.0.327 (TD-783): نخستین شماره از `from` به بعد که سند فعالی از همین نوع و سال مالی آن را ندارد. شماره دستی شمارنده
   * را جلو نمی‌برد، پس شماره خودکار از شماره‌های دستیِ جلوتر می‌گذرد تا شاخص یکتای (نوع، سال، شماره) خطا ندهد.
   */
  static async firstFreeSerial(tx: DbClient, type: string, fiscalYear: number, from: number): Promise<number> {
    for (let serial = from; serial < from + MAX_TAKEN_SERIALS_SKIPPED; serial++) {
      const [taken] = await tx.select({ id: documents.id }).from(documents)
        .where(and(eq(documents.type, type), eq(documents.refFiscalYear, fiscalYear), eq(documents.refNumber, String(serial)), eq(documents.isDeleted, 0)))
        .limit(1);
      if (!taken) return serial;
    }
    throw new ConflictError(
      `${toPersianDigits(String(MAX_TAKEN_SERIALS_SKIPPED))} شماره پس از ${toPersianDigits(String(from))} برای ${documentTypeTitle(type)} در سال مالی ${toPersianDigits(String(fiscalYear))} گرفته شده است؛ شماره سند را دستی بنویسید.`,
      { docType: type, fiscalYear, from },
      'DOCUMENT_REF_SERIES_EXHAUSTED',
    );
  }

  /**
   * Calculates the next reference number for a given document type using the atomic document_ref_counters table.
   * Lock contention on the documents table is completely avoided by locking only the target counter row.
   */
  static async getNextRef(type: string, dateOrFiscalYear?: string | number, externalTx?: DbClient): Promise<string> {
    const execute = async (tx: DbClient) => {
      const { fiscalYear, startNumber } = await DocumentRefNumberService.resolveRefContext(tx, type, dateOrFiscalYear);

      // Lock only the specific counter row for (docType, fiscalYear)
      const [counter] = await tx
        .select()
        .from(documentRefCounters)
        .where(and(
          eq(documentRefCounters.docType, type),
          eq(documentRefCounters.fiscalYear, fiscalYear)
        ))
        .for('update');

      let nextNum: number;
      if (counter) {
        nextNum = Math.max(counter.lastRefNumber + 1, startNumber);
        await tx
          .update(documentRefCounters)
          .set({ lastRefNumber: nextNum })
          .where(and(
            eq(documentRefCounters.docType, type),
            eq(documentRefCounters.fiscalYear, fiscalYear)
          ));
      } else {
        // V9-1.2 / V6 TD-152: cold-start atomic seeding — INSERT ... ON CONFLICT DO NOTHING eliminates the
        // MAX()+1 race where two concurrent first calls computed the same number.
        const maxNum = await DocumentRefNumberService.getMaxExistingRefNumber(tx, type, fiscalYear);
        const seedNum = Math.max(maxNum + 1, startNumber);

        const inserted = await tx
          .insert(documentRefCounters)
          .values({
            docType: type,
            fiscalYear,
            lastRefNumber: seedNum,
          })
          .onConflictDoNothing({
            target: [documentRefCounters.docType, documentRefCounters.fiscalYear]
          })
          .returning({ lastRefNumber: documentRefCounters.lastRefNumber });

        if (inserted.length > 0) {
          // This transaction won the seeding race — the seeded value is ours to consume
          nextNum = seedNum;
        } else {
          // A concurrent transaction seeded the counter first — lock and increment atomically
          const [retryCounter] = await tx
            .select()
            .from(documentRefCounters)
            .where(and(
              eq(documentRefCounters.docType, type),
              eq(documentRefCounters.fiscalYear, fiscalYear)
            ))
            .for('update');

          nextNum = Math.max((retryCounter?.lastRefNumber || 0) + 1, startNumber);
          await tx
            .update(documentRefCounters)
            .set({ lastRefNumber: nextNum })
            .where(and(
              eq(documentRefCounters.docType, type),
              eq(documentRefCounters.fiscalYear, fiscalYear)
            ));
        }
      }

      // v9.0.327 (TD-783): شماره دستیِ جلوتر از شمارنده را رد می‌شود (شمارنده زیر قفل همین تراکنش است)
      const free = await DocumentRefNumberService.firstFreeSerial(tx, type, fiscalYear, nextNum);
      if (free !== nextNum) {
        await tx
          .update(documentRefCounters)
          .set({ lastRefNumber: free })
          .where(and(
            eq(documentRefCounters.docType, type),
            eq(documentRefCounters.fiscalYear, fiscalYear)
          ));
      }
      return String(free);
    };

    if (externalTx) {
      return await execute(externalTx);
    }
    return await orm.transaction(async (tx) => execute(tx));
  }

  /**
   * شماره عطف سند تازه و سال مالی پارتیشن شماره‌گذاری آن (زیر تراکنش فراخواننده). شماره خالی یا «auto» شماره آزاد بعدی سری
   * همان نوع و سال را می‌گیرد. v9.0.80 (TD-489): از createDocument جدا شد تا حواله انتقال بین انبارها همان قاعده را بگیرد.
   *
   * v9.0.327 (TD-783، تصمیم ت۹ الف): شماره دستی گرفته‌شده (همان نوع و سال) ۴۰۹ `DOCUMENT_REF_TAKEN` است و شمارنده سری را
   * جلو نمی‌برد. پیش‌تر شماره تکراری بی‌صدا با شماره خودکار عوض می‌شد (گزارش ممیزی شماره درخواستی را می‌نوشت) و یک شماره
   * بزرگ دستی (۹۰۰۰۰۰) سری را برای همیشه به ۹۰۰۰۰۱ می‌برد. شماره سند فروش (فاکتور، برگشت) را route فقط از سری می‌پذیرد.
   */
  static async assignDocumentRefNumber(
    tx: DbClient,
    docType: string,
    normalizedDocDate: string,
    requested: string | number | null | undefined,
  ): Promise<{ refNumber: string; refFiscalYear: number }> {
    // v7.0.21 (TD-178 / audit P0-2): سال مالی پارتیشن شماره‌گذاری — دقیقاً همان مقداری که
    // DocumentRefNumberService.getNextRef برای همین تاریخ استفاده می‌کند؛ یکتایی شماره عطف در این دامنه است.
    const refFiscalYear = resolveJalaliFiscalYear(normalizedDocDate);
    if (isAutoRefNumber(requested)) {
      return { refNumber: await DocumentRefNumberService.getNextRef(docType, normalizedDocDate, tx), refFiscalYear };
    }
    const refNumber = String(requested).trim();
    await DocumentRefNumberService.assertRefNumberFree(tx, { docType, refFiscalYear, refNumber });
    return { refNumber, refFiscalYear };
  }

  /** شماره در همان نوع و سال مالی به سند فعال دیگری نرسیده باشد، وگرنه ۴۰۹ با نام نوع و سال */
  static async assertRefNumberFree(
    tx: DbClient,
    input: { docType: string; refFiscalYear: number; refNumber: string; excludeDocumentId?: number },
  ): Promise<void> {
    const taken = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(
        eq(documents.type, input.docType),
        eq(documents.refFiscalYear, input.refFiscalYear),
        eq(documents.refNumber, input.refNumber),
        eq(documents.isDeleted, 0)
      ));
    if (taken.some(d => d.id !== input.excludeDocumentId)) {
      throw documentRefTakenError(input.docType, input.refNumber, input.refFiscalYear);
    }
  }
}
