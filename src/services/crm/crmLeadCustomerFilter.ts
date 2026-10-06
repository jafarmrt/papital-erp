import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { crmLeads, customers } from '../../db/schema.js';

/**
 * v9.0.15 (TD-429): فیلتر «مشتری» پرونده‌های فروش با شناسه طرف حساب. پیش‌تر صفحه نام طرف حساب را می‌فرستاد و سرور آن را با
 * `customer_name` برابر می‌گرفت، ولی فرم پرونده نام رابط را در `customer_name` و نام طرف حساب را در `company` می‌نویسد: پرونده
 * «شرکت آینه» با رابط «آقای صادقی» با فیلتر نام پیدا نمی‌شد. پرونده قدیمی بی شناسه وقتی می‌آید که نام مشتری یا شرکت آن
 * (بی فاصله دو سر) دقیقاً نام کنونی طرف حساب باشد (همان قاعده `partyDetailedRowsCondition`).
 */
export async function leadCustomerCondition(customerId: number): Promise<SQL> {
  const [party] = await orm.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId));
  const byId = eq(crmLeads.customerId, customerId);
  const name = (party?.name ?? '').trim();
  if (!name) return byId;
  const legacy = and(
    isNull(crmLeads.customerId),
    or(sql`btrim(${crmLeads.customerName}) = ${name}::text`, sql`btrim(${crmLeads.company}) = ${name}::text`),
  );
  return or(byId, legacy) as SQL;
}
