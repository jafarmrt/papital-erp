import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { customers } from '../../db/schema.js';
import { customerHasTagCondition } from './customerTags.service.js';
import { foldedContains } from '../../lib/search/searchSql.js';
import { phoneMatchKeySql, phoneSearchKey } from '../../lib/search/phoneMatchKey.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import type { CustomerPick } from '../../lib/permissions/pickLists.js';
import { canSeePartyBankInfo } from './partyBankInfoAccess.js';

/**
 * v9.0.137 (TD-887، تصمیم ت۱۰ الف مدل مجوز): فهرست انتخاب طرف حساب‌ها (`GET /customers/options`) برای فرم‌های بخش‌های
 * دیگر (فاکتور و حواله، رسید انبار، ارتباط با مشتری، پروژه، خرید، نقطه سفارش، حسابداری). فقط فیلدهای
 * `CUSTOMER_PICK_FIELDS` را می‌خواند؛ اطلاعات بانکی با همان قاعده TD-433. فهرست کامل (`GET /customers`، با یادداشت و
 * نسخه رکورد) فقط با customers.view باز است.
 */

/** شرط جست‌وجو و نوع طرف حساب، مشترک فهرست کامل و فهرست انتخاب */
export function customerListConditions(search: string | undefined, partyType: string | undefined, tagId?: number): SQL {
  const conditions: SQL[] = [eq(customers.isDeleted, 0)];
  // v11 phase 6.3p (U8): one search rule (`foldedContains`); before, «0912…» in Latin digits or an Arabic «ي» found nothing here
  const searched = foldedContains([
    customers.name,
    customers.phone,
    customers.contactName,
    customers.supplierCategory,
    // v10.1.15 (N-02 بخش ۱): وب‌سایت، ایمیل و اینستاگرام هم جست‌وجو می‌شوند (ایمیل افراد رابط در contacts است)
    customers.website,
    customers.email,
    customers.instagram,
    sql`${customers.contacts}::text`,
  ], search);
  // a phone typed with spaces, «+98» or «0098» matches the stored number by its TD-296 key, as in global search
  const phoneKey = phoneSearchKey(String(search ?? '').trim());
  if (searched) {
    conditions.push(phoneKey ? or(searched, sql`${phoneMatchKeySql(customers.phone)} LIKE ${containsLikePattern(phoneKey)}`) as SQL : searched);
  }
  if (partyType === 'supplier') {
    conditions.push(or(eq(customers.partyType, 'supplier'), eq(customers.partyType, 'both')) as SQL);
  } else if (partyType === 'customer') {
    // v11 phase 6.1ch (C13, review): a legacy party without a kind is a customer, as the treasury and voucher rules and the
    // forms read it (`partyType || 'customer'`), so a server search past the cap finds it too
    conditions.push(or(eq(customers.partyType, 'customer'), eq(customers.partyType, 'both'), isNull(customers.partyType), eq(customers.partyType, '')) as SQL);
  } else if (partyType === 'both') {
    conditions.push(eq(customers.partyType, 'both'));
  }
  // v10.1.23 (N-02 بخش ۳): پالایش با برچسب زنده طرف حساب
  if (tagId !== undefined) conditions.push(customerHasTagCondition(tagId));
  return and(...conditions) as SQL;
}

export interface PickListQuery {
  search?: string;
  partyType?: string;
  /** بی سقف وقتی نیامده یا صفر است */
  limit?: number;
  /** v11 phase 6.1ch (C13): only these parties (`?ids=`), the chosen or stored ones a form's cut list lacks */
  ids?: number[];
}

export async function listCustomerPicks(user: { role?: string } | undefined, query: PickListQuery): Promise<CustomerPick[]> {
  const withBankInfo = await canSeePartyBankInfo(user);
  const columns = {
    id: customers.id,
    name: customers.name,
    partyType: customers.partyType,
    supplierCategory: customers.supplierCategory,
    contactName: customers.contactName,
    phone: customers.phone,
    country: customers.country,
    province: customers.province,
    city: customers.city,
    address: customers.address,
    contacts: customers.contacts,
    ...(withBankInfo ? { bankInfo: customers.bankInfo } : {}),
  };
  const base = orm.select(columns).from(customers)
    .where(and(customerListConditions(query.search, query.partyType), query.ids ? inArray(customers.id, query.ids) : undefined))
    .orderBy(asc(customers.name), asc(customers.id))
    .$dynamic();
  const rows = query.limit && query.limit > 0 ? await base.limit(query.limit) : await base;
  return rows as CustomerPick[];
}
