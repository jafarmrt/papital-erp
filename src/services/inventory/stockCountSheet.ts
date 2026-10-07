import { asc, eq } from 'drizzle-orm';
import { items } from '../../db/schema.js';
import { AppError, ValidationError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import { ItemWarehouseStockService } from './itemWarehouseStock.service.js';
import { createWarehouseResolver, type DbClient } from './warehouseResolver.js';

/**
 * v9.0.55 (TD-480، B06-01، تصمیم ت۷ الف): برگه انبارگردانی.
 * موقعیت برگه با همان قاعده ثبت سند (`createWarehouseResolver`: کد یا نام، خالی = انبار پیش‌فرض) به کد انبار تبدیل
 * می‌شود و موقعیت ناشناخته ۴۲۲ می‌گیرد. پیش‌تر route موجودی را با کلید خام (نام انبار) می‌خواند، ستون «موجودی
 * سیستمی» برای همه کالاها ۰ بود و «کپی و ثبت» موجودی کل انبار را صفر می‌کرد.
 */

export const STALE_BOOK_STOCK_CODE = 'AUDIT_BOOK_STOCK_CHANGED';

export interface StockCountSheetRow {
  id: number;
  code: string;
  name: string;
  unit: string | null;
  category: string | null;
  type: string | null;
  system_stock: number;
  physical_stock: '';
  /** کد انبار (حل‌شده) */
  location: string;
}

export async function getStockCountSheetItems(executor: DbClient, rawLocation: unknown): Promise<StockCountSheetRow[]> {
  const resolveWh = await createWarehouseResolver(executor);
  const location = resolveWh(rawLocation);
  const allItems = await executor
    .select({ id: items.id, code: items.code, name: items.name, unit: items.unit, category: items.category, type: items.type })
    .from(items)
    .where(eq(items.isDeleted, 0))
    .orderBy(asc(items.code));
  // موجودی ثبت‌شده همین انبار از جدول نرمال (TD-214)؛ انبار بدون ردیف یعنی صفر
  const stockMap = await ItemWarehouseStockService.getStocksForItems(executor, allItems.map(i => i.id));
  return allItems.map(item => ({
    ...item,
    system_stock: stockMap.get(item.id)?.byCode[location] ?? 0,
    physical_stock: '',
    location,
  }));
}

export interface BookStockLine {
  itemId: number;
  code: string;
  name: string;
  /** موجودی دفتری که برگه نشان داده و فرستاده است؛ بی مقدار یعنی سنجیده نمی‌شود */
  shown: unknown;
  /** موجودی همین انبار در پایگاه‌داده، زیر قفل کالاها */
  current: number;
}

/**
 * ت۷ الف: ردیف‌هایی که موجودی دفتری نمایش‌داده‌شان با موجودی لحظه ثبت فرق دارد؛ اگر باشد ثبت با ۴۰۹ رد می‌شود
 * تا برگه دوباره بارگذاری شود (شمارش با موجودی‌ای سنجیده نشود که کاربر ندیده است).
 */
export function assertBookStocksUnchanged(lines: BookStockLine[]): void {
  const changed = lines.filter(l => {
    if (l.shown === undefined || l.shown === null || String(l.shown).trim() === '') return false;
    return !fin(l.shown as string | number).round(4).equals(fin(l.current).round(4));
  });
  if (changed.length === 0) return;
  const list = changed
    .map(l => `«${l.name}» (${l.code}): برگه ${fin(l.shown as string | number).round(4).toString()}، اکنون ${fin(l.current).round(4).toString()}`)
    .join('؛ ');
  throw new AppError(
    `موجودی دفتری این کالاها پس از بارگذاری برگه انبارگردانی تغییر کرده است: ${list}. برگه را دوباره بارگذاری کنید و شمارش‌ها را با موجودی تازه بسنجید.`,
    409,
    STALE_BOOK_STOCK_CODE,
    { items: changed.map(l => ({ itemId: l.itemId, code: l.code, name: l.name, shown: fin(l.shown as string | number).toNumber(), current: l.current })) },
  );
}

export interface StockCountLine {
  itemId: number;
  code: string;
  name: string;
  /** کد انبار ردیف پس از `createWarehouseResolver` */
  location: string;
  /** مقدار شمارش‌شده‌ای که ردیف فرستاده است */
  physical: unknown;
}

const isBlank = (value: unknown) => value === undefined || value === null || String(value).trim() === '';
const lineLabel = (l: Pick<StockCountLine, 'name' | 'code' | 'location'>) => `«${l.name}» (${l.code}) در انبار ${l.location}`;

/**
 * v9.0.255 (TD-777): هر ردیف انبارگردانی شمارش دارد و هر (کالا، انبار) یک ردیف. ردیف بی شمارش ۴۲۲ `AUDIT_COUNT_MISSING`
 * (پیش‌تر شمارش‌نشده صفر حساب می‌شد و همه موجودی آن انبار کسری می‌خورد) و ردیف تکراری ۴۲۲ `AUDIT_DUPLICATE_LINE` (پیش‌تر
 * هر ردیف با همان موجودی دفتری سنجیده و دو بار اصلاح می‌شد: دو شمارش ۶ از موجودی ۱۰، موجودی را ۲ می‌کرد).
 */
export function assertStockCountLines(lines: StockCountLine[]): void {
  const missing = lines.filter(l => isBlank(l.physical));
  if (missing.length > 0) {
    throw new ValidationError(
      `شمارش این کالاها وارد نشده است: ${missing.map(lineLabel).join('؛ ')}. شمارش هر ردیف را بنویسید یا کالای شمارش‌نشده را از سند بردارید.`,
      { items: missing.map(l => ({ itemId: l.itemId, code: l.code, location: l.location })) },
      'AUDIT_COUNT_MISSING',
    );
  }
  const seen = new Set<string>();
  const duplicates: StockCountLine[] = [];
  for (const l of lines) {
    const key = `${l.itemId}|${l.location}`;
    if (seen.has(key) && !duplicates.some(d => `${d.itemId}|${d.location}` === key)) duplicates.push(l);
    seen.add(key);
  }
  if (duplicates.length > 0) {
    throw new ValidationError(
      `هر کالا در هر انبار فقط یک ردیف شمارش دارد؛ این کالاها بیش از یک ردیف دارند: ${duplicates.map(lineLabel).join('؛ ')}.`,
      { items: duplicates.map(l => ({ itemId: l.itemId, code: l.code, location: l.location })) },
      'AUDIT_DUPLICATE_LINE',
    );
  }
}

/**
 * v9.0.255 (TD-777): انحراف هر ردیف سند انبارگردانی از ردیف‌های فعال و غیرمعکوس کاردکس همان سند، با کلید (کالا، انبار).
 * `resolveKey` محل کاردکس یا ردیف را به یک کلید انبار برمی‌گرداند. پیش‌تر هر ردیف با نخستین ردیف کاردکس همان کالا، بی انبار
 * و با ردیف‌های حذف‌شده، جور می‌شد و کالای دو انباره در انبار درست «انحراف ۳−» نشان می‌داد.
 */
export function stockCountVariances(
  ledgerRows: Array<{ itemId: number; type: string; quantity: number; location: string | null }>,
  resolveKey: (location: string | null) => string,
): Map<string, number> {
  const variances = new Map<string, number>();
  for (const row of ledgerRows) {
    const key = `${row.itemId}|${resolveKey(row.location)}`;
    const signed = row.type === 'in' ? Number(row.quantity) : -Number(row.quantity);
    variances.set(key, fin(variances.get(key) ?? 0).add(signed).toNumber());
  }
  return variances;
}
