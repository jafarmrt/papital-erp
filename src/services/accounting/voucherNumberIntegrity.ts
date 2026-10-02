import { asc, inArray, sql } from 'drizzle-orm';
import { orm, DbExecutor } from '../../db/drizzle.js';
import { journalVouchers } from '../../db/schema.js';

/**
 * v7.0.91 (TD-195 / audit P1-8): یکتایی شماره سند حسابداری.
 * مهاجرت 0031 ایندکس یکتای uq_jv_voucher_number را فقط وقتی می‌سازد که داده‌های قبلی شماره تکراری نداشته باشند
 * (شماره اسناد قدیمی هرگز خودکار عوض نمی‌شود). بازرس سلامت مالی شماره‌های تکراری و نبودن ایندکس را گزارش می‌کند.
 */
export const VOUCHER_NUMBER_UNIQUE_INDEX = 'uq_jv_voucher_number';

export interface DuplicateVoucherNumberRow {
  id: number;
  voucherNumber: number;
  date: string;
  voucherType: string | null;
  status: string | null;
  description: string;
  isDeleted: number | null;
}

/** همه اسنادی (فعال و حذف‌شده) که شماره‌شان با سند دیگری یکی است، به ترتیب شماره و شناسه. */
export async function findDuplicateVoucherNumbers(executor: DbExecutor = orm): Promise<DuplicateVoucherNumberRow[]> {
  const duplicated = executor.select({ n: journalVouchers.voucherNumber })
    .from(journalVouchers)
    .groupBy(journalVouchers.voucherNumber)
    .having(sql`COUNT(*) > 1`);
  return await executor.select({
    id: journalVouchers.id,
    voucherNumber: journalVouchers.voucherNumber,
    date: journalVouchers.date,
    voucherType: journalVouchers.voucherType,
    status: journalVouchers.status,
    description: journalVouchers.description,
    isDeleted: journalVouchers.isDeleted,
  })
    .from(journalVouchers)
    .where(inArray(journalVouchers.voucherNumber, duplicated))
    .orderBy(asc(journalVouchers.voucherNumber), asc(journalVouchers.id));
}

export async function hasVoucherNumberUniqueIndex(executor: DbExecutor = orm): Promise<boolean> {
  const res = await executor.execute(sql`SELECT to_regclass(${VOUCHER_NUMBER_UNIQUE_INDEX}) IS NOT NULL AS present`);
  return Boolean((res.rows?.[0] as { present?: boolean } | undefined)?.present);
}
