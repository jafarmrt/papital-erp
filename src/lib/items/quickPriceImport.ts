import { normalizePersianText } from '../../utils/formatters.js';
import { extractRowPriceColumns } from './excelPriceColumns.js';
import { parsePriceAmount, priceCurrencyOf } from './priceInput.js';

/**
 * v9.0.152 (TD-647، تصمیم ت۱ الف): ورود سریع اکسل صفحه قیمت‌گذاری. فقط ستون‌های فهرست‌های قیمت تنظیم‌شده به‌روزرسانی
 * قیمت می‌سازند؛ پیش‌تر هر ستون عددی فایل خروجی همان صفحه («موجودی کل»، «میانگین بهای خرید») فهرست قیمت فروش می‌شد.
 */
export interface QuickImportItem {
  id: number;
  code?: string | null;
  name?: string | null;
}

export interface QuickPriceUpdate {
  itemId: number;
  title: string;
  /** مبلغ با ارقام لاتین، بزرگ‌تر از صفر */
  price: string;
  currency: string;
}

/** v9.0.166 (TD-657): سلول قیمتی که عدد بزرگ‌تر از صفر یا ارز پشتیبانی‌شده ندارد؛ فرستاده نمی‌شود */
export interface QuickPriceInvalidCell {
  code: string;
  title: string;
  value: string;
  currency: string;
}

export interface QuickPriceImportResult {
  updates: QuickPriceUpdate[];
  /** سرستون‌های «قیمت …» که فهرست تنظیم‌شده نیستند */
  unknownColumns: string[];
  /** ردیف‌هایی که کالایشان پیدا نشد */
  unmatchedRows: number;
  invalidCells: QuickPriceInvalidCell[];
}

export function buildQuickPriceUpdates(
  rows: ReadonlyArray<Record<string, unknown>>,
  items: ReadonlyArray<QuickImportItem>,
  strategies: readonly string[],
): QuickPriceImportResult {
  const byCode = new Map<string, QuickImportItem>();
  const byName = new Map<string, QuickImportItem>();
  for (const it of items) {
    if (it.code) byCode.set(normalizePersianText(it.code), it);
    if (it.name) byName.set(normalizePersianText(it.name), it);
  }

  const updates: QuickPriceUpdate[] = [];
  const unknown = new Set<string>();
  const invalidCells: QuickPriceInvalidCell[] = [];
  let unmatchedRows = 0;
  for (const row of rows) {
    const rawCode = row['کد کالا'] ?? row['کد'] ?? row['code'] ?? row['Code'];
    const rawName = row['نام کالا'] ?? row['نام محصول'] ?? row['نام'] ?? row['name'] ?? row['Name'];
    const item = (rawCode ? byCode.get(normalizePersianText(String(rawCode))) : undefined)
      ?? (rawName ? byName.get(normalizePersianText(String(rawName))) : undefined);
    if (!item) {
      unmatchedRows++;
      continue;
    }
    const { prices, unknownColumns } = extractRowPriceColumns(row, strategies);
    unknownColumns.forEach(c => unknown.add(c));
    for (const cell of prices) {
      // v9.0.166 (TD-657): پیش‌تر سلول «۰» حذف قیمت فرستاده می‌شد و «۲٬۵۰۰٬۰۰۰» یا ارز «XYZ» بی‌صدا رد یا ذخیره می‌شد
      const price = parsePriceAmount(cell.value);
      const currency = priceCurrencyOf(cell.currency);
      if (price === null || currency === null) {
        invalidCells.push({ code: String(item.code ?? item.id), title: cell.title, value: String(cell.value), currency: cell.currency });
        continue;
      }
      updates.push({ itemId: item.id, title: cell.title, price, currency });
    }
  }
  return { updates, unknownColumns: [...unknown], unmatchedRows, invalidCells };
}
