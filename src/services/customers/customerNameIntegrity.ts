import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { customers } from '../../db/schema.js';
import type { HealthCheckTestResult } from '../../types.js';
import { CUSTOMER_NAME_UNIQUE_INDEX, customerNameKey } from './customerIdentity.js';

/**
 * v9.0.8 (TD-420): بازرس سلامت مالی طرف حساب‌های فعال هم‌نام (کلید lower(btrim(name))) را فهرست می‌کند. مهاجرت 0052 روی
 * چنین داده‌ای ایندکس یکتا را نمی‌سازد و هیچ طرف حسابی خودکار تغییر نام یا ادغام نمی‌شود.
 */
export interface DuplicateCustomerNameRow {
  id: number;
  name: string;
  phone: string | null;
  partyType: string | null;
}

export async function findDuplicateCustomerNames(executor: DbExecutor = orm): Promise<DuplicateCustomerNameRow[]> {
  const key = sql`lower(btrim(${customers.name}))`;
  const duplicated = executor.select({ k: sql<string>`${key}`.as('k') })
    .from(customers)
    .where(eq(customers.isDeleted, 0))
    .groupBy(key)
    .having(sql`COUNT(*) > 1`);
  return await executor.select({ id: customers.id, name: customers.name, phone: customers.phone, partyType: customers.partyType })
    .from(customers)
    .where(and(eq(customers.isDeleted, 0), inArray(key, duplicated)))
    .orderBy(asc(key), asc(customers.id));
}

export async function hasCustomerNameUniqueIndex(executor: DbExecutor = orm): Promise<boolean> {
  const res = await executor.execute(sql`SELECT to_regclass(${CUSTOMER_NAME_UNIQUE_INDEX}) IS NOT NULL AS present`);
  return Boolean((res.rows?.[0] as { present?: boolean } | undefined)?.present);
}

const PARTY_TYPE_LABELS: Record<string, string> = { customer: 'مشتری', supplier: 'تأمین‌کننده', both: 'مشتری و تأمین‌کننده' };

export function buildCustomerNameHealthTest(duplicates: DuplicateCustomerNameRow[], uniqueIndexPresent: boolean): HealthCheckTestResult {
  const idsByKey = new Map<string, number[]>();
  for (const r of duplicates) {
    const key = customerNameKey(r.name);
    idsByKey.set(key, [...(idsByKey.get(key) ?? []), r.id]);
  }
  const duplicateNameCount = idsByKey.size;
  const penalty = Math.min(10, duplicateNameCount * 2);
  return {
    id: 'customer_name_uniqueness',
    category: 'accounts',
    title: 'یکتایی نام طرف حساب‌ها',
    description: 'دو طرف حساب فعال نباید نام یکسان داشته باشند (بدون توجه به حروف بزرگ و کوچک و فاصله)؛ سند فروش طرف حساب را با نام پیدا می‌کند و پایگاه‌داده با ایندکس یکتا از نام تکراری جلوگیری می‌کند',
    status: duplicateNameCount > 0 || !uniqueIndexPresent ? 'warning' : 'healthy',
    scoreImpact: -penalty,
    count: duplicateNameCount,
    message: duplicateNameCount > 0
      ? `${duplicateNameCount} نام بین بیش از یک طرف حساب فعال مشترک است و قید یکتایی نام در پایگاه‌داده اعمال نشده است؛ طرف حساب‌ها خودکار تغییر نام یا ادغام نمی‌شوند و باید یکی از آن‌ها ویرایش شود.`
      : (uniqueIndexPresent
        ? 'نام تکراری بین طرف حساب‌های فعال وجود ندارد و پایگاه‌داده از ثبت نام تکراری جلوگیری می‌کند.'
        : 'نام تکراری بین طرف حساب‌های فعال وجود ندارد اما قید یکتایی نام در پایگاه‌داده اعمال نشده است.'),
    items: duplicates.map((r) => ({
      id: r.id,
      code: `طرف حساب #${r.id}`,
      title: r.name,
      subtitle: `نوع: ${PARTY_TYPE_LABELS[r.partyType ?? ''] ?? '—'} | تلفن: ${r.phone || '—'}`,
      details: `طرف حساب‌های هم‌نام: ${(idsByKey.get(customerNameKey(r.name)) ?? [r.id]).map((id) => `#${id}`).join('، ')} (TD-420).`,
    })),
    metrics: { duplicateNames: duplicateNameCount, duplicateCustomerRows: duplicates.length, uniqueIndexPresent: uniqueIndexPresent ? 1 : 0 },
  };
}
