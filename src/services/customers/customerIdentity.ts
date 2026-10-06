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
