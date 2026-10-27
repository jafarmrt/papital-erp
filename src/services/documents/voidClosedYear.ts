import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { transactions } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import { formatPersianNumber } from '../../utils/persianNumber.js';
import { FiscalPeriodService } from '../accounting/fiscalPeriod.service.js';

/**
 * v11 phase 6.1j (M10): a document whose live Kardex rows are dated in a closed fiscal year is not voided (409
 * `DOCUMENT_IN_CLOSED_YEAR`). A void soft-deletes those rows, so the closed year's stock ledger, its year-end stock value
 * and its cost of sales would change after the books were closed. Its effect is undone in the open year with a new
 * document instead. A document without Kardex rows (a draft, a proforma) is still voided. Called by `deleteDocument`
 * after the document lock and before any write.
 */
export async function assertVoidOutsideClosedYears(tx: DbExecutor, doc: { id: number; refNumber: string | null; type: string }): Promise<void> {
  const rows = await tx.selectDistinct({ date: transactions.date }).from(transactions)
    .where(and(eq(transactions.documentId, doc.id), eq(transactions.isDeleted, 0)))
    .orderBy(asc(transactions.date));
  const years = new Set<number>();
  for (const row of rows) {
    const date = String(row.date ?? '').slice(0, 10);
    if (date && await FiscalPeriodService.isClosed(date, tx)) years.add(FiscalPeriodService.yearOf(date));
  }
  if (years.size === 0) return;

  const yearList = [...years].sort((a, b) => a - b).map(y => formatPersianNumber(y, 0)).join('، ');
  throw new ConflictError(
    `سند ${doc.refNumber ? `«${doc.refNumber}» ` : ''}گردش کالای سال مالی ${yearList} را دارد که بسته شده است، پس باطل نمی‌شود: `
      + 'ابطال، کاردکس و ارزش انبار پایان آن سال را پس از بستن دفترها عوض می‌کرد. اثر آن را در سال باز با سند تازه برگردانید '
      + `(${UNDO_HINTS[doc.type] ?? 'سند وارونهٔ آن'}).`,
    { documentId: doc.id, closedYears: [...years] },
    'DOCUMENT_IN_CLOSED_YEAR',
  );
}

/** The new document that undoes each type's effect in the open year */
const UNDO_HINTS: Readonly<Record<string, string>> = {
  invoice: 'برای فاکتور فروش، برگشت از فروش',
  return: 'برای برگشت از فروش، فاکتور فروش',
  receipt: 'برای رسید، حواله یا شمارش انبار',
  purchase: 'برای فاکتور خرید، حواله یا شمارش انبار',
  production_receipt: 'برای رسید تولید، حواله یا شمارش انبار',
  remittance: 'برای حواله، رسید یا شمارش انبار',
  waste: 'برای ضایعات، رسید یا شمارش انبار',
  audit: 'برای انبارگردانی، شمارش تازه',
  transfer: 'برای حواله انتقال، انتقال وارونه',
};
