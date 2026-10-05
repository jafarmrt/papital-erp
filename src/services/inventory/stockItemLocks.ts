import { asc, inArray } from 'drizzle-orm';
import { items } from '../../db/schema.js';
import type { DbExecutor } from '../../db/drizzle.js';
import { sortIdsForLocking } from '../../lib/lockOrder.js';

/**
 * v8.0.67 (TD-320): قفل ردیف کالاهای یک گردش انبار. هر مسیری که موجودی را جابه‌جا می‌کند (ثبت و نهایی‌سازی و ابطال
 * سند، برگشت از فروش، انتقال، تخصیص BOM) همه کالاهایش را یک‌جا، به ترتیب صعودی شناسه و پیش از هر قفل یا نوشتن دیگر
 * (شمارنده شماره سند، ردیف سند، ردیف کاردکس) با همین تابع قفل می‌کند.
 *
 * حالت قفل FOR NO KEY UPDATE است، نه FOR UPDATE: درج ردیف فرزند (کاردکس، اقلام سند) قفل FOR KEY SHARE کلید خارجی روی
 * ردیف کالا می‌گیرد که با FOR UPDATE ناسازگار است. پیش‌تر دو ابطال هم‌زمان که هر کدام ردیف کاردکس معکوس را پیش از
 * قفل کالا درج کرده بودند، منتظر قفل اشتراکی یکدیگر می‌ماندند (بن‌بست 40P01). دو گردش هم‌کالا همچنان پشت هم اجرا
 * می‌شوند، چون NO KEY UPDATE با خودش ناسازگار است.
 */
export async function lockStockItems(tx: DbExecutor, itemIds: Iterable<unknown>): Promise<void> {
  const ids = sortIdsForLocking([...itemIds].map(id => Number(id))).filter(id => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return;
  // ORDER BY پیش از قفل اجرا می‌شود (گره LockRows بالای Sort)، پس ردیف‌ها به ترتیب صعودی شناسه قفل می‌شوند
  await tx.select({ id: items.id }).from(items).where(inArray(items.id, ids)).orderBy(asc(items.id)).for('no key update');
}
