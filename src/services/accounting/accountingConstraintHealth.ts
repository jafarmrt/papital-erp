import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * v9.0.202 (TD-562، B03-20): قیدهای پایگاه‌داده ردیف سند، سند و سرفصل (مهاجرت 0071). هر قید `NOT VALID` افزوده و فقط
 * روی داده تمیز اعتبارسنجی شد؛ این بررسی ردیف‌های ناسازگار قدیمی و قید اعتبارسنجی‌نشده را فهرست می‌کند و چیزی را
 * بازنویسی نمی‌کند. عبارت هر قید همان عبارت مهاجرت است؛ ردیف حذف نرم‌شده معاف است.
 */
export interface AccountingIntegrityRule {
  name: string;
  table: 'journal_voucher_items' | 'journal_vouchers' | 'accounts';
  label: string;
  /** ردیف‌هایی که قید را می‌شکنند (عبارت ثابت، بی ورودی کاربر) */
  violation: string;
}

export const ACCOUNTING_INTEGRITY_RULES: readonly AccountingIntegrityRule[] = [
  { name: 'chk_jvi_amounts_non_negative', table: 'journal_voucher_items', label: 'ردیف سند با بدهکار یا بستانکار منفی',
    violation: 'NOT (is_deleted = 1 OR (debit >= 0 AND credit >= 0))' },
  { name: 'chk_jvi_amount_present', table: 'journal_voucher_items', label: 'ردیف سند بی مبلغ (بدهکار و بستانکار هر دو صفر)',
    violation: 'NOT (is_deleted = 1 OR debit <> 0 OR credit <> 0)' },
  { name: 'chk_jv_status', table: 'journal_vouchers', label: 'سند با وضعیت ناشناخته',
    violation: "NOT (is_deleted = 1 OR status IN ('draft', 'approved', 'permanent'))" },
  { name: 'chk_jv_voucher_type', table: 'journal_vouchers', label: 'سند با نوع ناشناخته',
    violation: "NOT (is_deleted = 1 OR voucher_type IN ('general', 'opening', 'closing', 'sales', 'purchase', 'treasury', 'payroll', 'adjustment', 'settlement'))" },
  { name: 'chk_accounts_level', table: 'accounts', label: 'حساب با سطح ناشناخته',
    violation: "NOT (is_deleted = 1 OR level IN ('group', 'general', 'subsidiary', 'detailed'))" },
  { name: 'chk_accounts_account_type', table: 'accounts', label: 'حساب با نوع ناشناخته',
    violation: "NOT (is_deleted = 1 OR account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense', 'cost_of_sales'))" },
  { name: 'chk_accounts_nature', table: 'accounts', label: 'حساب با ماهیت ناشناخته',
    violation: "NOT (is_deleted = 1 OR nature IN ('debit', 'credit', 'both'))" },
  { name: 'fk_accounts_parent', table: 'accounts', label: 'حسابی که حساب بالادستش وجود ندارد',
    violation: 'parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts p WHERE p.id = accounts.parent_id)' },
];

export type ConstraintState = 'valid' | 'not_valid' | 'missing';

export interface AccountingIntegrityEntry {
  name: string;
  label: string;
  state: ConstraintState;
  brokenRows: number;
}

export async function findAccountingIntegrityGaps(): Promise<AccountingIntegrityEntry[]> {
  const entries: AccountingIntegrityEntry[] = [];
  for (const rule of ACCOUNTING_INTEGRITY_RULES) {
    const stateRes = await orm.execute(sql`
      SELECT convalidated FROM pg_constraint WHERE conname = ${rule.name} AND conrelid = to_regclass(${rule.table})`);
    const row = (stateRes.rows as Array<{ convalidated?: boolean }>)[0];
    const state: ConstraintState = !row ? 'missing' : row.convalidated ? 'valid' : 'not_valid';
    const countRes = await orm.execute(sql`SELECT COUNT(*)::int AS n FROM ${sql.identifier(rule.table)} WHERE ${sql.raw(rule.violation)}`);
    const brokenRows = Number((countRes.rows as Array<{ n?: number }>)[0]?.n ?? 0);
    if (state !== 'valid' || brokenRows > 0) entries.push({ name: rule.name, label: rule.label, state, brokenRows });
  }
  return entries;
}

const STATE_TEXT: Record<ConstraintState, string> = {
  valid: 'قید برقرار است',
  not_valid: 'قید فقط ردیف‌های تازه را می‌سنجد',
  missing: 'قید در پایگاه‌داده نیست',
};

export function buildAccountingIntegrityHealthTest(entries: AccountingIntegrityEntry[]): HealthCheckTestResult {
  const broken = entries.reduce((sum, e) => sum + e.brokenRows, 0);
  return {
    id: 'accounting_integrity_constraints',
    category: 'vouchers',
    title: 'قیدهای پایگاه‌داده سند و سرفصل',
    description: 'پایگاه‌داده مبلغ منفی یا ردیف بی مبلغ، وضعیت و نوع ناشناخته سند، سطح و نوع و ماهیت ناشناخته حساب و حساب بالادست ناموجود را نمی‌پذیرد. ردیف‌های قدیمی ناسازگار خودکار عوض نمی‌شوند و قیدشان فقط ردیف تازه را می‌سنجد',
    status: entries.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: broken,
    message: entries.length === 0
      ? 'همه قیدهای سند و سرفصل برقرارند.'
      : `${toPersianDigits(String(entries.length))} قید سند و سرفصل کامل برقرار نیست${broken > 0 ? ` و ${toPersianDigits(String(broken))} ردیف قدیمی آن را می‌شکند` : ''}. ردیف را با سند اصلاحی یا ویرایش حساب درست کنید؛ ردیف حذف‌شده معاف است.`,
    items: entries.map((e, index) => ({
      id: index + 1,
      code: e.name,
      title: e.label,
      subtitle: `${toPersianDigits(String(e.brokenRows))} ردیف ناسازگار`,
      details: `${STATE_TEXT[e.state]} (TD-562).`,
    })),
    metrics: { accountingIntegrityGaps: entries.length, accountingIntegrityBrokenRows: broken },
  };
}
