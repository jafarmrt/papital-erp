import { asc, eq } from 'drizzle-orm';
import { items } from '../../db/schema.js';
import { AppError } from '../../errors/customErrors.js';
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
