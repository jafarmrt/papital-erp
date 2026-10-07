import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { categories, items } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * v9.0.198 (TD-658، B05-12، تصمیم ت۸ الف): نام دسته‌بندی فعال یکتاست با کلید `lower(btrim(name))` (مثل نام کالا و طرف
 * حساب). مهاجرت 0072 ایندکس یکتای جزئی را فقط روی داده بی تکرار می‌سازد و بازرس سلامت مالی تکراری‌ها و کالاهایی را که
 * دسته‌شان دیگر نیست فهرست می‌کند. کالا با متن نام دسته به آن وصل است (`items.category`)، پس هر شرطی که کالاهای یک دسته
 * را می‌خواهد از `itemCategoryCondition` می‌گذرد.
 */
export const CATEGORY_NAME_UNIQUE_INDEX = 'uq_categories_name_active';

export function categoryNameTakenMessage(name: string): string {
  return `دسته‌بندی با نام «${name.trim()}» از قبل هست؛ نام دیگری انتخاب کنید.`;
}

/** کلید نام در کد برنامه، هم‌ارز `lower(btrim(name))` پایگاه‌داده */
export function categoryNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function itemCategoryCondition(categoryName: string): SQL {
  return sql`lower(btrim(${items.category})) = lower(btrim(${String(categoryName)}::text))`;
}

export async function assertCategoryNameAvailable(db: DbExecutor, name: string, excludeId?: number): Promise<void> {
  const conditions = [eq(categories.isDeleted, 0), sql`lower(btrim(${categories.name})) = lower(btrim(${String(name)}::text))`];
  if (excludeId !== undefined) conditions.push(ne(categories.id, excludeId));
  const [taken] = await db.select({ id: categories.id }).from(categories).where(and(...conditions)).limit(1);
  if (taken) throw new ConflictError(categoryNameTakenMessage(name));
}

function isCategoryNameViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const pg = e as { code?: unknown; constraint?: unknown };
    if (pg.code === '23505' && pg.constraint === CATEGORY_NAME_UNIQUE_INDEX) return true;
  }
  return false;
}

/** پنجره رقابتی بین بررسی و نوشتن: نقض ایندکس همان پیام فارسی تکرار (409) می‌شود */
export async function guardCategoryName<T>(name: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (isCategoryNameViolation(err)) throw new ConflictError(categoryNameTakenMessage(name));
    throw err;
  }
}

export interface CategoryIntegrityRow {
  id: number;
  name: string;
  kind: 'duplicate_name' | 'unknown_category';
  /** کد کالا برای کالای بی‌دسته */
  code?: string;
}

export async function findCategoryIntegrityIssues(db: DbExecutor = orm): Promise<CategoryIntegrityRow[]> {
  const key = sql`lower(btrim(${categories.name}))`;
  const duplicated = db.select({ k: sql<string>`${key}`.as('k') }).from(categories)
    .where(eq(categories.isDeleted, 0)).groupBy(key).having(sql`COUNT(*) > 1`);
  const duplicates = await db.select({ id: categories.id, name: categories.name }).from(categories)
    .where(and(eq(categories.isDeleted, 0), inArray(key, duplicated))).orderBy(asc(key), asc(categories.id));
  const liveNames = db.select({ k: sql<string>`${key}`.as('k') }).from(categories).where(eq(categories.isDeleted, 0));
  const orphans = await db.select({ id: items.id, code: items.code, name: items.category }).from(items)
    .where(and(eq(items.isDeleted, 0), sql`btrim(coalesce(${items.category}, '')) <> ''`,
      sql`lower(btrim(${items.category})) NOT IN (${liveNames})`))
    .orderBy(asc(items.id));
  return [
    ...duplicates.map(r => ({ ...r, kind: 'duplicate_name' as const })),
    ...orphans.map(r => ({ id: r.id, code: r.code, name: r.name ?? '', kind: 'unknown_category' as const })),
  ];
}

export async function hasCategoryNameUniqueIndex(db: DbExecutor = orm): Promise<boolean> {
  const res = await db.execute(sql`SELECT to_regclass(${CATEGORY_NAME_UNIQUE_INDEX}) IS NOT NULL AS present`);
  return Boolean((res.rows?.[0] as { present?: boolean } | undefined)?.present);
}

export function buildCategoryIntegrityHealthTest(rows: CategoryIntegrityRow[], indexPresent: boolean): HealthCheckTestResult {
  const duplicateRows = rows.filter(r => r.kind === 'duplicate_name');
  const duplicateGroups = new Set(duplicateRows.map(r => categoryNameKey(r.name))).size;
  const orphanItems = rows.length - duplicateRows.length;
  const issues = duplicateGroups + orphanItems;
  return {
    id: 'category_name_uniqueness',
    category: 'inventory',
    title: 'یکتایی نام دسته‌بندی و دسته کالاها',
    description: 'دو دسته‌بندی فعال نباید نام یکسان داشته باشند و دسته هر کالای فعال باید یک دسته‌بندی موجود باشد',
    status: issues > 0 || !indexPresent ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, issues),
    count: issues,
    message: issues > 0
      ? `${duplicateGroups} نام بین بیش از یک دسته‌بندی فعال مشترک است و ${orphanItems} کالای فعال به دسته‌ای وصل است که دیگر نیست؛ چیزی خودکار تغییر نمی‌کند، دسته تکراری را ویرایش و دسته کالاها را در فرم کالا اصلاح کنید.`
      : (indexPresent
        ? 'نام دسته‌بندی‌های فعال یکتاست و دسته همه کالاهای فعال موجود است.'
        : 'نام تکراری و کالای بی‌دسته نیست، اما قید یکتایی نام دسته در پایگاه‌داده اعمال نشده است.'),
    items: rows.map(r => r.kind === 'duplicate_name'
      ? { id: r.id, code: String(r.id), title: r.name, subtitle: 'نام دسته تکراری', details: 'دسته‌بندی فعال دیگری همین نام را دارد (TD-658).' }
      : { id: r.id, code: r.code ?? '', title: r.name, subtitle: 'دسته کالا نیست', details: `کالای ${r.code ?? r.id} به دسته «${r.name}» وصل است که دسته‌بندی فعالی با این نام نیست (TD-658).` }),
    metrics: { duplicateGroups, orphanItems, uniqueIndexPresent: indexPresent ? 1 : 0 },
  };
}
