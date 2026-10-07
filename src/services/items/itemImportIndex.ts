import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';
import type { ItemRow } from './itemExcelRow.js';

const codeKey = (code: string) => code.toUpperCase();
const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * v9.0.179 (TD-663، B05-17): کالاهای یک فایل اکسل با یک پرس‌وجو، نه سه پرس‌وجو برای هر ردیف (کد دقیق، کد هم‌حرف و نام
 * تکراری). کالاهایی که کد یا نامشان در فایل آمده یک‌جا و به ترتیب شناسه قفل می‌شوند (FOR NO KEY UPDATE، قفل مسیرهای
 * انبار، §19)؛ کالای تازه و تغییر نام هر ردیف همان‌جا در نمایه ثبت می‌شود تا ردیف‌های بعدی همان فایل آن را ببینند.
 * قاعده‌ها همان `findItemByCode` پیشین (v9.0.148، TD-651) و کلید ایندکس یکتای نام (TD-653) است.
 */
export class ImportItemIndex {
  private readonly byId = new Map<number, ItemRow>();

  static async load(tx: DbExecutor, codes: string[], names: string[]): Promise<ImportItemIndex> {
    const index = new ImportItemIndex();
    const upperCodes = [...new Set(codes.filter(Boolean).map(codeKey))];
    const lowerNames = [...new Set(names.filter(Boolean).map(nameKey))];
    if (upperCodes.length === 0 && lowerNames.length === 0) return index;
    const rows = await tx.select().from(items)
      .where(and(eq(items.isDeleted, 0), or(
        upperCodes.length > 0 ? inArray(sql`upper(${items.code})`, upperCodes) : undefined,
        lowerNames.length > 0 ? inArray(sql`lower(btrim(${items.name}))`, lowerNames) : undefined,
      )))
      .orderBy(asc(items.id))
      .for('no key update');
    for (const row of rows) index.byId.set(row.id, row);
    return index;
  }

  /** کد دقیق، وگرنه تنها کالایی که کدش جز در بزرگی و کوچکی حروف برابر است؛ چند کالای هم‌حرف `ambiguous` است */
  findByCode(code: string): { item: ItemRow | null; ambiguous: string[] } {
    const live = [...this.byId.values()];
    const exact = live.find(i => i.code === code);
    if (exact) return { item: exact, ambiguous: [] };
    const similar = live.filter(i => codeKey(i.code) === codeKey(code));
    if (similar.length > 1) return { item: null, ambiguous: similar.map(i => i.code) };
    return { item: similar[0] ?? null, ambiguous: [] };
  }

  /** کالای فعال دیگری با همین کلید نام (lower(btrim(name)))، یا null */
  nameConflict(name: string, exceptId?: number): ItemRow | null {
    for (const row of this.byId.values()) {
      if (row.id !== exceptId && nameKey(row.name) === nameKey(name)) return row;
    }
    return null;
  }

  /** کالای تازه یا تغییر یافته این فایل */
  remember(row: ItemRow): void {
    this.byId.set(row.id, row);
  }
}
