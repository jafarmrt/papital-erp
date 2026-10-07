import { and, asc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { customers } from '../../db/schema.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import type { CustomerPick } from '../../lib/permissions/pickLists.js';
import { canSeePartyBankInfo } from './partyBankInfoAccess.js';

/**
 * v9.0.120 (TD-887، تصمیم ت۱۰ الف مدل مجوز): فهرست انتخاب طرف حساب‌ها (`GET /customers/options`) برای فرم‌های بخش‌های
 * دیگر (فاکتور و حواله، رسید انبار، ارتباط با مشتری، پروژه، خرید، نقطه سفارش، حسابداری). فقط فیلدهای
 * `CUSTOMER_PICK_FIELDS` را می‌خواند؛ اطلاعات بانکی با همان قاعده TD-433. فهرست کامل (`GET /customers`، با یادداشت و
 * نسخه رکورد) فقط با customers.view باز است.
 */

/** شرط جست‌وجو و نوع طرف حساب، مشترک فهرست کامل و فهرست انتخاب */
export function customerListConditions(search: string | undefined, partyType: string | undefined): SQL {
  const conditions: SQL[] = [eq(customers.isDeleted, 0)];
  if (search) {
    const pattern = containsLikePattern(search);
    conditions.push(or(
      ilike(customers.name, pattern),
      ilike(customers.phone, pattern),
      ilike(customers.contactName, pattern),
      ilike(customers.supplierCategory, pattern),
      sql`${customers.contacts}::text ILIKE ${pattern}`,
    ) as SQL);
  }
  if (partyType === 'supplier') {
    conditions.push(or(eq(customers.partyType, 'supplier'), eq(customers.partyType, 'both')) as SQL);
  } else if (partyType === 'customer') {
    conditions.push(or(eq(customers.partyType, 'customer'), eq(customers.partyType, 'both')) as SQL);
  } else if (partyType === 'both') {
    conditions.push(eq(customers.partyType, 'both'));
  }
  return and(...conditions) as SQL;
}

export interface PickListQuery {
  search?: string;
  partyType?: string;
  /** بی سقف وقتی نیامده یا صفر است */
  limit?: number;
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
    .where(customerListConditions(query.search, query.partyType))
    .orderBy(asc(customers.name), asc(customers.id))
    .$dynamic();
  const rows = query.limit && query.limit > 0 ? await base.limit(query.limit) : await base;
  return rows as CustomerPick[];
}
