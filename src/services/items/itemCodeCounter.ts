import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { itemCodeCounters } from '../../db/schema.js';

/**
 * v9.0.172 (TD-656، تصمیم ت۴ الف): ثبت کالا شمارنده سری کدش را جلو می‌برد. پیشنهاد کد فرم (`GET /items/next-code`) پس از
 * نخستین «رزرو» از شمارنده `item_code_counters` می‌خواند؛ پیش‌تر ثبت کالا شمارنده را جلو نمی‌برد و کالای بعدی همان کد
 * پیشنهادی را می‌گرفت و ۴۰۹ «کد تکراری» می‌خورد.
 */
export interface ItemCodeSeries {
  scope: 'product' | 'raw_material';
  counterKey: string;
  serial: number;
}

function segment(value: string): string {
  return value.trim().toUpperCase().replace(/^-+|-+$/g, '');
}

/** سری شمارنده یک کد، با همان کلید `ItemCatalogService` (محصول `سال|حرف دسته|ترنسفر`، ماده اولیه پیشوند)، یا null */
export function itemCodeSeries(type: string | null | undefined, code: string): ItemCodeSeries | null {
  const clean = code.trim();
  if (type === 'raw_material') {
    const m = /^(.+?)-{1,2}(\d+)$/.exec(clean);
    if (!m) return null;
    const prefix = segment(m[1]);
    if (!/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/.test(prefix)) return null;
    return { scope: 'raw_material', counterKey: prefix, serial: Number(m[2]) };
  }
  const m = /^(\d{4})-([A-Za-z]+)-(.+)-(\d+)$/.exec(clean);
  if (!m) return null;
  const transfer = segment(m[3]);
  if (!transfer) return null;
  return { scope: 'product', counterKey: `${m[1]}|${segment(m[2])}|${transfer}`, serial: Number(m[4]) };
}

/**
 * شمارنده سری کد ذخیره‌شده را زیر قفل ردیفش به `max(last_number, شماره سری کد)` می‌رساند، درون تراکنش ثبت کالا.
 * سری‌ای که هنوز ردیف شمارنده ندارد دست نمی‌خورد: پیشنهاد آن از کدهای موجود (همین کد هم) خوانده می‌شود.
 */
export async function advanceItemCodeCounter(tx: DbExecutor, type: string | null | undefined, code: string): Promise<void> {
  const series = itemCodeSeries(type, code);
  if (!series || !Number.isSafeInteger(series.serial)) return;
  const where = and(eq(itemCodeCounters.scope, series.scope), eq(itemCodeCounters.prefixKey, series.counterKey));
  const [counter] = await tx.select().from(itemCodeCounters).where(where).for('update');
  if (counter && Number(counter.lastNumber) < series.serial) {
    await tx.update(itemCodeCounters).set({ lastNumber: series.serial }).where(where);
  }
}
