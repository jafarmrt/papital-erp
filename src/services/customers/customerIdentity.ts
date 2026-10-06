import { and, asc, eq, ne, sql, type SQL } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { customers } from '../../db/schema.js';
import { BadRequestError } from '../../errors/customErrors.js';
import { phoneMatchKey, phoneMatchKeySql } from '../woocommerce/phoneMatchKey.js';

type CustomerRow = typeof customers.$inferSelect;

/**
 * v9.0.7 (TD-419، تصمیم مالک محصول ت۳ الف): تلفن طرف حساب با کلید تطبیق `phoneMatchKey` (TD-296) سنجیده می‌شود، در
 * ارتباط با مشتری، فرم طرف حساب و درون‌ریزی اکسل، همان‌طور که ووکامرس از v8.0.40 می‌سنجد. پیش‌تر برابری دقیق رشته بود و
 * `09121234567`، `0912 123 4567` و `+989121234567` سه طرف حساب جدا می‌ساختند.
 */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = phoneMatchKey(a);
  return key !== '' && key === phoneMatchKey(b);
}

/** شرط «تلفن طرف حساب همین شماره است»؛ تلفن بی رقم شرطی ندارد */
export function customerPhoneKeyCondition(phone: string | null | undefined): SQL | undefined {
  const key = phoneMatchKey(phone);
  return key ? sql`${phoneMatchKeySql(customers.phone)} = ${key}` : undefined;
}

/** نخستین طرف حساب فعال (کمترین شناسه) با همین شماره، جز excludeId */
export async function findActiveCustomerByPhone(phone: string | null | undefined, db: DbExecutor = orm, excludeId?: number): Promise<CustomerRow | undefined> {
  const byPhone = customerPhoneKeyCondition(phone);
  if (!byPhone) return undefined;
  const conditions = [eq(customers.isDeleted, 0), byPhone];
  if (excludeId !== undefined) conditions.push(ne(customers.id, excludeId));
  const [row] = await db.select().from(customers).where(and(...conditions)).orderBy(asc(customers.id)).limit(1);
  return row;
}

export async function assertCustomerPhoneAvailable(phone: string | null | undefined, db: DbExecutor = orm, excludeId?: number): Promise<void> {
  const taken = await findActiveCustomerByPhone(phone, db, excludeId);
  if (taken) throw new BadRequestError(`طرف حساب «${taken.name}» با همین شماره تلفن قبلاً ثبت شده است.`);
}

/**
 * v9.0.8 (TD-420، تصمیم مالک محصول ت۳ الف): دو طرف حساب فعال هم‌نام نمی‌شوند. کلید `lower(btrim(name))` است (نامی که
 * فقط در حروف بزرگ و کوچک یا فاصله ابتدا و انتها فرق دارد همان نام است، مثل درون‌ریزی اکسل). مهاجرت 0052 ایندکس یکتای
 * جزئی uq_customers_name_active را فقط روی داده بدون نام تکراری می‌سازد و بازرس سلامت مالی تکراری‌ها را فهرست می‌کند.
 * پیش‌تر بررسی و درج بی قفل و قید بود و درخواست‌های هم‌زمان با یک نام دو طرف حساب می‌ساختند.
 */
export const CUSTOMER_NAME_UNIQUE_INDEX = 'uq_customers_name_active';

/** همان کلید ایندکس، برای مقایسه در حافظه */
export function customerNameKey(name: string | null | undefined): string {
  return String(name ?? '').trim().toLowerCase();
}

export function customerNameKeyCondition(name: string): SQL {
  return sql`lower(btrim(${customers.name})) = lower(btrim(${String(name)}::text))`;
}

/** نخستین طرف حساب فعال (کمترین شناسه) با همین نام، جز excludeId */
export async function findActiveCustomerByName(name: string, db: DbExecutor = orm, excludeId?: number): Promise<CustomerRow | undefined> {
  if (!customerNameKey(name)) return undefined;
  const conditions = [eq(customers.isDeleted, 0), customerNameKeyCondition(name)];
  if (excludeId !== undefined) conditions.push(ne(customers.id, excludeId));
  const [row] = await db.select().from(customers).where(and(...conditions)).orderBy(asc(customers.id)).limit(1);
  return row;
}

export const CUSTOMER_NAME_TAKEN_MESSAGE = 'طرف حساب با این نام قبلاً ثبت شده است.';

export async function assertCustomerNameAvailable(name: string, db: DbExecutor = orm, excludeId?: number): Promise<void> {
  if (await findActiveCustomerByName(name, db, excludeId)) throw new BadRequestError(CUSTOMER_NAME_TAKEN_MESSAGE);
}

/** خطای 23505 روی ایندکس uq_customers_name_active (Drizzle خطای pg را در `cause` می‌پیچد) */
export function isCustomerNameUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const pg = e as { code?: unknown; constraint?: unknown };
    if (pg.code === '23505' && pg.constraint === CUSTOMER_NAME_UNIQUE_INDEX) return true;
  }
  return false;
}

/** پنجره رقابتی بین بررسی و نوشتن: نقض ایندکس همان پیام فارسی نام تکراری می‌شود؛ هر خطای دیگر دست‌نخورده برمی‌گردد */
export async function guardCustomerName<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    throw isCustomerNameUniqueViolation(err) ? new BadRequestError(CUSTOMER_NAME_TAKEN_MESSAGE) : err;
  }
}
