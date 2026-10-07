import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * v9.0.111 (TD-570، B03-28): ردیف‌های سند یک حساب همراه همه زیرحساب‌هایش (گروه ← کل ← معین)، برای کارت حساب.
 * کلیک روی ردیف گروه یا کل در تراز آزمایشی و انتخاب گروه یا کل در «مرور حساب‌ها» کارت همان حساب را می‌خواهند؛
 * پیش‌تر کارت فقط `account_id =` همان حساب را می‌خواند و حساب گروه و کل که سند نمی‌خورند ۰ ردیف و مانده ۰ داشتند.
 * زیرحساب‌های حذف‌شده هم شمرده می‌شوند، چون سندهای ثبت‌شده آن‌ها در مانده گروه هستند؛ `UNION` چرخه احتمالی را می‌بندد.
 */
export function accountSubtreeCondition(column: AnyColumn, accountId: number): SQL {
  return sql`${column} IN (
    WITH RECURSIVE account_subtree AS (
      SELECT id FROM accounts WHERE id = ${accountId}::int
      UNION
      SELECT child.id FROM accounts child JOIN account_subtree parent ON child.parent_id = parent.id
    )
    SELECT id FROM account_subtree
  )`;
}
