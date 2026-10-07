import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * v9.0.160 (TD-653، تصمیم ت۴ الف): کد و نام کالای فعال یکتاست. کلید کد `upper(btrim(code))` است (کدی که فقط در بزرگی و
 * کوچکی حروف یا فاصله فرق دارد همان کد است؛ ووکامرس و رزرو پروژه کالا را با کد پیدا می‌کنند) و کلید نام
 * `lower(btrim(name))`، مثل طرف حساب (TD-420). مهاجرت 0069 ایندکس‌های یکتای جزئی را فقط روی داده بی تکرار می‌سازد و
 * بازرس سلامت مالی تکراری‌ها را فهرست می‌کند. پیش‌تر بررسی و درج بی قفل و قید بود و درخواست‌های هم‌زمان کالای هم‌کد و
 * هم‌نام می‌ساختند.
 */
export const ITEM_CODE_UNIQUE_INDEX = 'uq_items_code_active';
export const ITEM_NAME_UNIQUE_INDEX = 'uq_items_name_active';

export const ITEM_CODE_TAKEN_MESSAGE = 'کد کالا تکراری است و مجاز به استفاده مجدد نیستید.';

export function itemNameTakenMessage(name: string, takenByCode?: string): string {
  return takenByCode
    ? `محصولی با نام «${name.trim()}» قبلاً با کد «${takenByCode}» در سیستم ثبت شده است. ثبت دو محصول با نام مشابه امکان‌پذیر نیست.`
    : `محصولی با نام «${name.trim()}» قبلاً در سیستم ثبت شده است. ثبت دو محصول با نام مشابه امکان‌پذیر نیست.`;
}

export function itemCodeKeyCondition(code: string): SQL {
  return sql`upper(btrim(${items.code})) = upper(btrim(${String(code)}::text))`;
}

export function itemNameKeyCondition(name: string): SQL {
  return sql`lower(btrim(${items.name})) = lower(btrim(${String(name)}::text))`;
}

async function findActiveItem(db: DbExecutor, key: SQL, excludeId?: number) {
  const conditions = [eq(items.isDeleted, 0), key];
  if (excludeId !== undefined) conditions.push(ne(items.id, excludeId));
  const [row] = await db.select({ id: items.id, code: items.code, name: items.name }).from(items)
    .where(and(...conditions)).orderBy(asc(items.id)).limit(1);
  return row;
}

export async function assertItemCodeAvailable(db: DbExecutor, code: string, excludeId?: number): Promise<void> {
  if (await findActiveItem(db, itemCodeKeyCondition(code), excludeId)) throw new ConflictError(ITEM_CODE_TAKEN_MESSAGE);
}

export async function assertItemNameAvailable(db: DbExecutor, name: string, excludeId?: number): Promise<void> {
  const taken = await findActiveItem(db, itemNameKeyCondition(name), excludeId);
  if (taken) throw new ConflictError(itemNameTakenMessage(name, taken.code));
}

/** نام ایندکس یکتای کالا در خطای 23505 (Drizzle خطای pg را در `cause` می‌پیچد)، یا null */
export function itemUniqueViolation(err: unknown): 'code' | 'name' | null {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const pg = e as { code?: unknown; constraint?: unknown };
    if (pg.code === '23505' && pg.constraint === ITEM_CODE_UNIQUE_INDEX) return 'code';
    if (pg.code === '23505' && pg.constraint === ITEM_NAME_UNIQUE_INDEX) return 'name';
  }
  return null;
}

/** پنجره رقابتی بین بررسی و نوشتن: نقض ایندکس همان پیام فارسی تکرار (409) می‌شود؛ هر خطای دیگر دست‌نخورده برمی‌گردد */
export async function guardItemIdentity<T>(name: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    const kind = itemUniqueViolation(err);
    if (kind === 'code') throw new ConflictError(ITEM_CODE_TAKEN_MESSAGE);
    if (kind === 'name') throw new ConflictError(itemNameTakenMessage(name));
    throw err;
  }
}

export interface DuplicateItemIdentityRow {
  id: number;
  code: string;
  name: string;
  kind: 'code' | 'name';
}

async function duplicatesBy(db: DbExecutor, key: SQL, kind: 'code' | 'name'): Promise<DuplicateItemIdentityRow[]> {
  const duplicated = db.select({ k: sql<string>`${key}`.as('k') }).from(items)
    .where(eq(items.isDeleted, 0)).groupBy(key).having(sql`COUNT(*) > 1`);
  const rows = await db.select({ id: items.id, code: items.code, name: items.name }).from(items)
    .where(and(eq(items.isDeleted, 0), inArray(key, duplicated)))
    .orderBy(asc(key), asc(items.id));
  return rows.map(r => ({ ...r, kind }));
}

export async function findDuplicateItemIdentities(db: DbExecutor = orm): Promise<DuplicateItemIdentityRow[]> {
  return [
    ...await duplicatesBy(db, sql`upper(btrim(${items.code}))`, 'code'),
    ...await duplicatesBy(db, sql`lower(btrim(${items.name}))`, 'name'),
  ];
}

export async function hasItemIdentityIndexes(db: DbExecutor = orm): Promise<boolean> {
  const res = await db.execute(sql`SELECT to_regclass(${ITEM_CODE_UNIQUE_INDEX}) IS NOT NULL AND to_regclass(${ITEM_NAME_UNIQUE_INDEX}) IS NOT NULL AS present`);
  return Boolean((res.rows?.[0] as { present?: boolean } | undefined)?.present);
}

export function buildItemIdentityHealthTest(duplicates: DuplicateItemIdentityRow[], indexesPresent: boolean): HealthCheckTestResult {
  const keyOf = (r: DuplicateItemIdentityRow) => r.kind === 'code' ? `code:${r.code.trim().toUpperCase()}` : `name:${r.name.trim().toLowerCase()}`;
  const idsByKey = new Map<string, number[]>();
  for (const r of duplicates) idsByKey.set(keyOf(r), [...(idsByKey.get(keyOf(r)) ?? []), r.id]);
  const groups = idsByKey.size;
  return {
    id: 'item_identity_uniqueness',
    category: 'inventory',
    title: 'یکتایی کد و نام کالا',
    description: 'دو کالای فعال نباید کد یکسان (بدون توجه به حروف بزرگ و کوچک و فاصله) یا نام یکسان داشته باشند؛ ووکامرس و رزرو پروژه کالا را با کد پیدا می‌کنند',
    status: groups > 0 || !indexesPresent ? 'warning' : 'healthy',
    scoreImpact: -Math.min(10, groups * 2),
    count: groups,
    message: groups > 0
      ? `${groups} کد یا نام بین بیش از یک کالای فعال مشترک است و قید یکتایی در پایگاه‌داده اعمال نشده است؛ کالاها خودکار تغییر نمی‌کنند و باید یکی از آن‌ها ویرایش شود.`
      : (indexesPresent
        ? 'کد و نام تکراری بین کالاهای فعال وجود ندارد و پایگاه‌داده از ثبت تکراری جلوگیری می‌کند.'
        : 'کد و نام تکراری بین کالاهای فعال وجود ندارد اما قید یکتایی در پایگاه‌داده اعمال نشده است.'),
    items: duplicates.map(r => ({
      id: r.id,
      code: r.code,
      title: r.name,
      subtitle: r.kind === 'code' ? 'کد تکراری' : 'نام تکراری',
      details: `کالاهای هم‌${r.kind === 'code' ? 'کد' : 'نام'}: ${(idsByKey.get(keyOf(r)) ?? [r.id]).map(id => `#${id}`).join('، ')} (TD-653).`,
    })),
    metrics: { duplicateGroups: groups, duplicateItemRows: duplicates.length, uniqueIndexesPresent: indexesPresent ? 1 : 0 },
  };
}
