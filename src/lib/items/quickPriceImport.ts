import { normalizePersianText } from '../../utils/formatters.js';
import { extractRowPriceColumns } from './excelPriceColumns.js';

/**
 * v9.0.114 (TD-647، تصمیم ت۱ الف): ورود سریع اکسل صفحه قیمت‌گذاری. فقط ستون‌های فهرست‌های قیمت تنظیم‌شده به‌روزرسانی
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
  price: number;
  currency: string;
}

export interface QuickPriceImportResult {
  updates: QuickPriceUpdate[];
  /** سرستون‌های «قیمت …» که فهرست تنظیم‌شده نیستند */
  unknownColumns: string[];
  /** ردیف‌هایی که کالایشان پیدا نشد */
  unmatchedRows: number;
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
      const price = Number(cell.value);
      if (Number.isNaN(price)) continue;
      updates.push({ itemId: item.id, title: cell.title, price, currency: cell.currency });
    }
  }
  return { updates, unknownColumns: [...unknown], unmatchedRows };
}
