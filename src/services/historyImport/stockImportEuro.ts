import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documents } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { historyImportAmount } from '../../lib/historyImport/historyImportAmount.js';
import { SALE_MIN_UNIT_PRICE_RIAL, SALE_PRICE_TOO_LOW_MESSAGE, type StockImportRow } from '../../lib/historyImport/stockHistoryImport.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v12 colleague sales part B3 (docs/roadmap/V12_COLLEAGUE_SALES_START_PLAN.md): a past sales invoice of the sheet «اقلام
 * فاکتور» may be in euros — a partner's, whose debt is fixed in euros — when its lines carry «قیمت ارزی» and «نرخ تسعیر».
 */

/** Why a row's currency or sale price cannot be taken, or null: a euro line needs its rate, a rial one the rial floor */
export function saleLineRefusal(row: StockImportRow, unitPrice: string | null): string | null {
  if (row.currency && row.kind !== 'sale') return 'ارز فقط برای فاکتور فروش است.';
  if (row.currency && !(Number(historyImportAmount(row.exchangeRate)) > 0)) return 'نرخ تسعیر این ردیف فاکتور یورویی خالی یا نادرست است؛ ریال برای هر یورو را بنویسید.';
  if (row.kind === 'sale' && !row.currency && Number(unitPrice) < SALE_MIN_UNIT_PRICE_RIAL) return SALE_PRICE_TOO_LOW_MESSAGE(toPersianDigits(String(unitPrice)));
  return null;
}

/** Every line of one Excel invoice shares its currency and rate */
export function assertOneInvoiceMoney(rows: StockImportRow[]): void {
  const money = new Set(rows.map(r => `${r.currency ?? 'IRR'}|${r.currency ? historyImportAmount(r.exchangeRate) : ''}`));
  if (money.size > 1) {
    throw new ValidationError(`ردیف‌های فاکتور ${toPersianDigits(String(rows[0]?.invoiceRef ?? ''))} اکسل ارز یا نرخ تسعیر یکسان ندارند؛ همهٔ ردیف‌های یک فاکتور یک ارز و یک نرخ دارند.`);
  }
}

/** The currency and rate of the invoice a sale's first line opens (rials for anything else) */
export function invoiceMoneyOf(first: StockImportRow | null): { currency: string; exchangeRate?: string } {
  if (first?.currency !== 'EUR') return { currency: 'IRR' };
  return { currency: 'EUR', exchangeRate: historyImportAmount(first.exchangeRate) ?? undefined };
}

/** A return goes back on a rial invoice only (its id); a euro invoice's return is recorded on it in the app */
export async function rialInvoiceForReturn(tx: DbExecutor, invoiceId: number, excelRef: string): Promise<number> {
  const [original] = await tx.select({ currency: documents.currency }).from(documents).where(eq(documents.id, invoiceId));
  if ((original?.currency || 'IRR').toUpperCase() !== 'IRR') {
    throw new ValidationError(`فاکتور ${toPersianDigits(excelRef)} اکسل یورویی است و برگشت آن از ورود سابقه (که ریالی است) ثبت نمی‌شود؛ برگشت را در برنامه از روی همان فاکتور ثبت کنید.`, undefined, 'HISTORY_IMPORT_RETURN_FOREIGN_INVOICE');
  }
  return invoiceId;
}
