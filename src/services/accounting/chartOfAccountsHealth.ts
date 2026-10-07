import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * بررسی‌های سلامت سرفصل حساب‌ها (بسته ۳، PR ه). هیچ‌کدام داده را بازنویسی نمی‌کند؛ فقط فهرست می‌کند.
 */

export interface DeletedAccountWithRows {
  id: number;
  code: string;
  name: string;
  rowCount: number;
}

/**
 * v9.0.197 (TD-546، B03-04، تصمیم ت۴ الف): حساب حذف‌شده‌ای که هنوز ردیف سند فعال دارد. گزارش‌ها حساب حذف‌شده را
 * نمی‌خوانند، پس این ردیف‌ها از تراز آزمایشی و ترازنامه و بستن سال بیرون می‌مانند.
 */
export async function findDeletedAccountsWithVoucherRows(): Promise<DeletedAccountWithRows[]> {
  const res = await orm.execute(sql`
    SELECT a.id, a.code, a.name, COUNT(*)::int AS row_count
      FROM accounts a
      JOIN journal_voucher_items vi ON vi.account_id = a.id AND vi.is_deleted = 0
      JOIN journal_vouchers v ON v.id = vi.voucher_id AND v.is_deleted = 0
     WHERE a.is_deleted = 1
     GROUP BY a.id, a.code, a.name
     ORDER BY a.code, a.id
     LIMIT 200`);
  return (res.rows as Array<Record<string, unknown>>).map(r => ({
    id: Number(r.id),
    code: String(r.code ?? ''),
    name: String(r.name ?? ''),
    rowCount: Number(r.row_count ?? 0),
  }));
}

export function buildDeletedAccountRowsHealthTest(entries: DeletedAccountWithRows[]): HealthCheckTestResult {
  return {
    id: 'deleted_accounts_with_voucher_rows',
    category: 'accounts',
    title: 'حساب حذف‌شده‌ای که ردیف سند دارد',
    description: 'حسابی که ردیف سند دارد حذف نمی‌شود. حساب‌هایی که پیش‌تر با ردیف سند حذف شدند در تراز آزمایشی، ترازنامه و بستن سال دیده نمی‌شوند؛ این حساب‌ها خودکار عوض نمی‌شوند',
    status: entries.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: entries.length,
    message: entries.length === 0
      ? 'هیچ حساب حذف‌شده‌ای ردیف سند ندارد.'
      : `${toPersianDigits(String(entries.length))} حساب حذف‌شده ردیف سند دارد. حساب را از «سرفصل حساب‌ها» احیا کنید و اگر دیگر به کار نمی‌آید، غیرفعالش کنید.`,
    items: entries.map(e => ({
      id: e.id,
      code: e.code,
      title: e.name,
      subtitle: `${toPersianDigits(String(e.rowCount))} ردیف سند`,
      details: 'حساب حذف‌شده با ردیف سند (TD-546).',
    })),
    metrics: { deletedAccountsWithVoucherRows: entries.length },
  };
}
