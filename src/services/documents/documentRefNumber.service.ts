import { eq, and, gte, lt } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { documents, appSettings, documentRefCounters } from '../../db/schema.js';
import { jalaliToIsoDate } from '../../utils.js';
import { resolveJalaliFiscalYear } from '../../lib/businessClock.js';
import type { DbClient } from './types.js';

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
    const fiscalYear = resolveJalaliFiscalYear(dateOrFiscalYear ?? null);

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
    for (const doc of existingDocs) {
      // Secondary in-memory validation to guarantee calendar boundary precision
      if (fiscalYear && fiscalYear >= 1300 && fiscalYear <= 1500) {
        const docFy = resolveJalaliFiscalYear(doc.date);
        if (docFy !== fiscalYear) continue;
      }
      if (doc.refNumber) {
        const numStr = String(doc.refNumber).replace(/\D/g, '');
        if (numStr) {
          const val = parseInt(numStr, 10);
          if (!isNaN(val) && val > maxNum) {
            maxNum = val;
          }
        }
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
      return String(Math.max(counter.lastRefNumber + 1, startNumber));
    }

    // Cold start: peek from max existing document number for THIS fiscal year (read-only, no counter write)
    const maxNum = await DocumentRefNumberService.getMaxExistingRefNumber(orm, type, fiscalYear);
    return String(Math.max(maxNum + 1, startNumber));
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

      return String(nextNum);
    };

    if (externalTx) {
      return await execute(externalTx);
    }
    return await orm.transaction(async (tx) => execute(tx));
  }
}
