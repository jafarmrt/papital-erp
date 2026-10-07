import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import type { HealthCheckTestResult } from '../../types.js';
import { isoToJalaliDate } from '../../utils/calendarDate.js';
import { accountHasActiveChildSql } from './postingAccounts.js';
import { ACCOUNT_MAPPING_CONCEPTS, type AccountMappingKey } from '../../lib/accounting/accountMappingConcepts.js';
import { AccountMappingService, DEFAULT_ACCOUNT_MAPPINGS, accountMappingIssues, type AccountMappingIssue } from './accountMapping.service.js';
import { ChartOfAccountsService } from './chartOfAccounts.service.js';

const VOUCHER_STATUS_TEXT: Record<string, string> = { draft: 'پیش‌نویس', approved: 'تأییدشده', permanent: 'دائم' };

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

export interface VoucherOnNonPostingAccount {
  id: number;
  voucherNumber: string;
  date: string;
  status: string;
  accounts: string[];
}

/**
 * v9.0.198 (TD-549، B03-07): سند فعالی که ردیفی روی حساب گروه یا کل یا حساب دارای زیرحساب فعال دارد (تراز آزمایشی
 * معین، صورت‌های مالی و بستن سال آن ردیف را نمی‌بینند)، و سند پیش‌نویسی که ردیفی روی حساب غیرفعال دارد. ردیف گذشته
 * روی حساب غیرفعال در سند تأییدشده درست است، چون غیرفعال کردن جای حذف حساب است (TD-546). هیچ ردیفی بازنویسی نمی‌شود.
 */
export async function findVouchersOnNonPostingAccounts(): Promise<VoucherOnNonPostingAccount[]> {
  const res = await orm.execute(sql`
    SELECT v.id, v.voucher_number, v.date, v.status,
           array_agg(DISTINCT a.code || ' ' || a.name ORDER BY a.code || ' ' || a.name) AS accounts
      FROM journal_voucher_items vi
      JOIN journal_vouchers v ON v.id = vi.voucher_id AND v.is_deleted = 0
      JOIN accounts a ON a.id = vi.account_id AND a.is_deleted = 0
     WHERE vi.is_deleted = 0
       AND (a.level NOT IN ('subsidiary', 'detailed')
            OR ${accountHasActiveChildSql(sql`a.id`)}
            OR (v.status = 'draft' AND a.is_active = 0))
     GROUP BY v.id, v.voucher_number, v.date, v.status
     ORDER BY v.date, v.id
     LIMIT 200`);
  return (res.rows as Array<Record<string, unknown>>).map(r => ({
    id: Number(r.id),
    voucherNumber: String(r.voucher_number ?? ''),
    date: String(r.date ?? ''),
    status: String(r.status ?? ''),
    accounts: Array.isArray(r.accounts) ? r.accounts.map(String) : [],
  }));
}

export function buildNonPostingRowsHealthTest(entries: VoucherOnNonPostingAccount[]): HealthCheckTestResult {
  return {
    id: 'voucher_rows_on_non_posting_accounts',
    category: 'vouchers',
    title: 'ردیف سند روی حساب گروه، کل یا دارای زیرحساب',
    description: 'ردیف سند فقط روی حساب فعال معین یا تفصیلیِ بی زیرحساب فعال ثبت می‌شود. ردیف‌های پیشین روی حساب گروه، کل یا دارای زیرحساب در تراز معین، صورت‌های مالی و بستن سال دیده نمی‌شوند؛ پیش‌نویس روی حساب غیرفعال هم فهرست می‌شود. ردیف‌ها خودکار عوض نمی‌شوند',
    status: entries.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: entries.length,
    message: entries.length === 0
      ? 'هیچ سندی ردیف روی حساب غیرقابل ثبت ندارد.'
      : `${toPersianDigits(String(entries.length))} سند ردیف روی حساب گروه، کل، دارای زیرحساب یا (در پیش‌نویس) غیرفعال دارد. سند تأییدشده را با سند اصلاحی و پیش‌نویس را با ویرایش روی حساب معین یا تفصیلی ببرید.`,
    items: entries.map(e => ({
      id: e.id,
      code: e.voucherNumber,
      title: `سند ${toPersianDigits(e.voucherNumber)}`,
      subtitle: e.accounts.map(a => toPersianDigits(a)).join('، '),
      details: `${VOUCHER_STATUS_TEXT[e.status] ?? e.status}، تاریخ ${toPersianDigits(isoToJalaliDate(e.date) || e.date)} (TD-549).`,
    })),
    metrics: { vouchersOnNonPostingAccounts: entries.length },
  };
}

export interface AccountMappingHealthEntry extends AccountMappingIssue {
  fallback: string;
}

/**
 * v9.0.199 (TD-550، B03-08): نگاشت‌هایی که امروز به حساب ناموجود، غیرقابل ثبت یا ناسازگار با مفهوم می‌رسند. سند
 * خودکار چنین مفهومی کد پیش‌فرض را می‌گیرد (اگر قابل ثبت باشد)؛ هیچ نگاشتی خودکار عوض نمی‌شود.
 */
export async function findAccountMappingIssues(): Promise<AccountMappingHealthEntry[]> {
  const [mappings, disabled, chart] = await Promise.all([
    AccountMappingService.getMappings(), AccountMappingService.getDisabledMappings(), ChartOfAccountsService.getAllAccounts(),
  ]);
  const entries = ACCOUNT_MAPPING_CONCEPTS.map(c => [c.key, disabled.includes(c.key) ? c.defaultCode : (String(mappings[c.key] || '') || c.defaultCode)] as [AccountMappingKey, string]);
  const issues = accountMappingIssues(entries, chart);
  const defaultIssues = new Set(accountMappingIssues(ACCOUNT_MAPPING_CONCEPTS.map(c => [c.key, c.defaultCode] as [AccountMappingKey, string]), chart).map(i => i.key));
  return issues.map(i => ({ ...i, fallback: i.code !== DEFAULT_ACCOUNT_MAPPINGS[i.key] && !defaultIssues.has(i.key) ? DEFAULT_ACCOUNT_MAPPINGS[i.key] : '' }));
}

export function buildAccountMappingHealthTest(entries: AccountMappingHealthEntry[]): HealthCheckTestResult {
  return {
    id: 'account_mapping_invalid',
    category: 'accounts',
    title: 'نگاشت حساب سندهای خودکار',
    description: 'هر مفهوم نگاشت (موجودی، دریافتنی، درآمد و …) باید به حساب فعال معین یا تفصیلیِ بی زیرحساب با نوع همان مفهوم برسد. نگاشت نادرست خودکار عوض نمی‌شود',
    status: entries.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: entries.length,
    message: entries.length === 0
      ? 'همه نگاشت‌های حساب درست‌اند.'
      : `${toPersianDigits(String(entries.length))} نگاشت حساب نادرست است. از «تنظیمات › حسابداری» حساب درست را انتخاب و ذخیره کنید.`,
    items: entries.map((e, index) => ({
      id: index + 1,
      code: e.key,
      title: e.label,
      subtitle: `کد ${toPersianDigits(e.code)}: ${e.reason}`,
      details: e.fallback
        ? `سند خودکار این مفهوم اکنون حساب پیش‌فرض ${toPersianDigits(e.fallback)} را می‌گیرد (TD-550).`
        : 'سند خودکار این مفهوم حساب درستی ندارد (TD-550).',
    })),
    metrics: { invalidAccountMappings: entries.length },
  };
}
