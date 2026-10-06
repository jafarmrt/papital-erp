import { sql } from 'drizzle-orm';
import { orm } from '../../../db/drizzle.js';
import { ForbiddenError } from '../../../errors/customErrors.js';
import { fin } from '../../../lib/financialDecimal.js';
import { isoToJalaliDate } from '../../../utils/calendarDate.js';
import type { HealthCheckTestResult } from '../../../types.js';

/**
 * v8.0.118 (TD-409، تصمیم مالک محصول — گزینه الف): ثبت دریافت و پرداخت، انتقال بانکی یا چک «بدون سند حسابداری»
 * (`createVoucher: false`) مانده بانک یا دفتر چک را بی‌سند تغییر می‌دهد. این گزینه برای ورود مانده‌های افتتاحیه لازم است،
 * پس حذف نشد: فقط کاربری که این مجوز جدا را دارد (پیش‌فرض به هیچ نقشی داده نمی‌شود؛ مدیر سیستم همیشه دارد) آن را
 * می‌زند، و چنین تراکنش‌ها و چک‌هایی در بررسی سلامت مالی فهرست می‌شوند. روت مجوز را با `userHasRoleOrPermission`
 * می‌سنجد و `allowNoVoucher` را به سرویس می‌دهد؛ از بدنه درخواست خوانده نمی‌شود.
 */
export { NO_VOUCHER_TREASURY_PERMISSION } from '../../../lib/noVoucherPermission.js';

export function assertNoVoucherAllowed(createVoucher: boolean | undefined, allowNoVoucher: boolean | undefined, label: string): void {
  if (createVoucher === false && allowNoVoucher !== true) {
    throw new ForbiddenError(`ثبت ${label} بدون سند حسابداری فقط با مجوز «ثبت خزانه و چک بدون سند حسابداری» ممکن است؛ سند حسابداری را صادر کنید یا از مدیر سیستم این مجوز را بخواهید.`);
  }
}

export interface NoVoucherTreasuryEntry {
  kind: 'treasury' | 'cheque';
  id: number;
  number: string;
  entryType: string;
  date: string;
  amount: string;
  currency: string;
  partyName: string;
  bankAccountId: number | null;
  bankTitle: string | null;
}

/**
 * تراکنش‌های خزانه فعال (نه باطل‌شده) و چک‌های حذف‌نشده‌ای که سند حسابداری ندارند. ردیف معکوسِ ساده (ابطال یک تراکنش)
 * فهرست نمی‌شود، چون اثر اصل را خنثی می‌کند. v9.0.58 (TD-499، ت۱ الف): ردیفی که زنجیره ابطالش اثر اصل را برمی‌گرداند
 * (عمق زوج ≥ ۲، «احیا»؛ پیش از v9.0.58 با ابطال ردیف معکوس ساخته می‌شد) فهرست می‌شود، چون پول را بی سند به بانک برگردانده است.
 */
export async function findTreasuryEntriesWithoutVoucher(): Promise<NoVoucherTreasuryEntry[]> {
  const res = await orm.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT id, 0 AS depth FROM treasury_transactions WHERE reversal_of_id IS NULL
      UNION ALL
      SELECT t.id, c.depth + 1 FROM treasury_transactions t JOIN chain c ON t.reversal_of_id = c.id
    )
    SELECT 'treasury' AS kind, t.id, t.transaction_number AS number, t.type AS entry_type, t.date::text AS date,
           t.amount::text AS amount, COALESCE(t.currency, 'IRR') AS currency, COALESCE(t.party_name, '') AS party_name,
           t.bank_account_id, b.title AS bank_title
      FROM treasury_transactions t JOIN chain c ON c.id = t.id LEFT JOIN bank_accounts b ON b.id = t.bank_account_id
     WHERE t.is_deleted = 0 AND t.voucher_id IS NULL AND c.depth % 2 = 0 AND COALESCE(t.status, 'completed') <> 'voided'
    UNION ALL
    SELECT 'cheque' AS kind, c.id, c.cheque_number AS number, c.type AS entry_type, c.issue_date::text AS date,
           c.amount::text AS amount, COALESCE(c.currency, 'IRR') AS currency, COALESCE(c.party_name, '') AS party_name,
           c.bank_account_id, b.title AS bank_title
      FROM cheques c LEFT JOIN bank_accounts b ON b.id = c.bank_account_id
     WHERE c.is_deleted = 0 AND c.voucher_id IS NULL
     ORDER BY date, kind, id`);
  const rows = res.rows as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    kind: r.kind === 'cheque' ? 'cheque' : 'treasury',
    id: Number(r.id),
    number: String(r.number ?? ''),
    entryType: String(r.entry_type ?? ''),
    date: String(r.date ?? '').slice(0, 10),
    amount: String(r.amount ?? '0'),
    currency: String(r.currency ?? 'IRR'),
    partyName: String(r.party_name ?? ''),
    bankAccountId: r.bank_account_id === null || r.bank_account_id === undefined ? null : Number(r.bank_account_id),
    bankTitle: r.bank_title === null || r.bank_title === undefined ? null : String(r.bank_title),
  }));
}

const ENTRY_LABEL: Record<string, string> = {
  receipt: 'دریافت', payment: 'پرداخت', received: 'چک دریافتی', paid: 'چک پرداختی',
};

export function buildNoVoucherTreasuryHealthTest(entries: NoVoucherTreasuryEntry[]): HealthCheckTestResult {
  const treasuryCount = entries.filter((e) => e.kind === 'treasury').length;
  const chequeCount = entries.length - treasuryCount;
  return {
    id: 'treasury_without_voucher',
    category: 'treasury',
    title: 'تراکنش‌های خزانه و چک‌های بدون سند حسابداری',
    description: 'دریافت و پرداخت، انتقال بانکی یا چکی که با گزینه «بدون سند حسابداری» ثبت شده مانده بانک یا دفتر چک را بی‌سند تغییر داده است؛ این گزینه فقط با مجوز جدا (مثلاً برای مانده‌های افتتاحیه) در دسترس است. ردیفی که پیش از نسخه ۹.۰.۵۵ با ابطال ردیف معکوس، تراکنش باطل‌شده را بی سند برگردانده است هم این‌جا می‌آید',
    status: entries.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: entries.length,
    message: entries.length === 0
      ? 'همه تراکنش‌های خزانه و چک‌ها سند حسابداری دارند.'
      : `${treasuryCount} تراکنش خزانه و ${chequeCount} چک بدون سند حسابداری ثبت شده است؛ اگر مانده افتتاحیه نیستند، سند آن‌ها را دستی ثبت کنید.`,
    quickFixAction: treasuryCount > 0 ? 'open_treasury' : undefined,
    items: entries.map((e) => ({
      id: `${e.kind}-${e.id}`,
      code: e.kind === 'cheque' ? `چک ${e.number}` : e.number,
      title: `${ENTRY_LABEL[e.entryType] ?? e.entryType} ${e.partyName ? `— ${e.partyName}` : ''}`.trim(),
      subtitle: `${e.bankTitle ? `حساب: ${e.bankTitle} | ` : ''}تاریخ: ${isoToJalaliDate(e.date) || e.date}${e.currency !== 'IRR' ? ` | ارز: ${e.currency}` : ''}`,
      amount: fin(e.amount).toNumber(),
      date: e.date,
      ...(e.kind === 'cheque' ? { linkType: 'cheque' as const, linkId: e.id } : (e.bankAccountId ? { linkType: 'bank_account' as const, linkId: e.bankAccountId } : {})),
      details: 'بدون سند حسابداری ثبت شده است (TD-409).',
    })),
    metrics: { treasuryWithoutVoucher: treasuryCount, chequesWithoutVoucher: chequeCount },
  };
}
