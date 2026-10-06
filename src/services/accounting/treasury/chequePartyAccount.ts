import { sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../../db/drizzle.js';
import type { cheques } from '../../../db/schema.js';
import { ValidationError } from '../../../errors/customErrors.js';
import { fin } from '../../../lib/financialDecimal.js';
import { isoToJalaliDate } from '../../../utils/calendarDate.js';
import type { HealthCheckTestResult } from '../../../types.js';
import { AccountMappingService } from '../accountMapping.service.js';
import { TreasuryTransactionService } from './treasuryTransaction.service.js';

type ChequeRow = typeof cheques.$inferSelect;

/** ردیف طرف حساب سند چک: حساب و تفصیلی */
export interface ChequePartyPosting {
  accountId: number;
  detailedType: string;
  detailedId: number | null;
  detailedName: string;
}

/**
 * v9.0.74 (TD-497، B04-01، تصمیم مالک محصول ت۲ الف): سرفصل طرف حساب چک تازه با همان قاعده فرم خزانه از نوع طرف حساب
 * ساخته می‌شود: مشتری ← دریافتنی تجاری، تأمین‌کننده ← پرداختنی تجاری، پرسنل ← حقوق پرداختنی یا مساعده (هدف)، «متفرقه» و
 * «سایر» پرسنل ← سرفصلی که کاربر انتخاب کرده است. پیش‌تر چک دریافتی همیشه دریافتنی تجاری با تفصیلی مشتری و چک پرداختی
 * همیشه پرداختنی تجاری با تفصیلی تأمین‌کننده می‌گرفت، پس چک پرسنل روی مشتری هم‌شناسه می‌نشست.
 */
export async function resolveChequePartyAccountId(
  tx: DbExecutor,
  partyType: string,
  purpose: string | null,
  contraAccountId: number | null,
): Promise<number | null> {
  const contra = await TreasuryTransactionService.resolveContraAccount(partyType, purpose, tx, contraAccountId);
  return contra.account?.id ?? contra.fallbackGeneralId ?? null;
}

/**
 * ردیف طرف حساب اسناد چرخه چک (ثبت، برگشت چک پرداختی، عودت): چکی که سرفصل طرف حسابش ذخیره شده (از v9.0.74) همان
 * سرفصل و تفصیلی نوع خودش را می‌گیرد؛ چک پیشین قاعده پیشین را ادامه می‌دهد (دریافتی ← دریافتنی تجاری با تفصیلی مشتری،
 * پرداختی ← پرداختنی تجاری با تفصیلی تأمین‌کننده) تا برگشت و عودت همان ردیف ثبتش را ببندند. اسناد گذشته بازنویسی نمی‌شوند.
 */
export async function chequePartyPosting(tx: DbExecutor, cheque: ChequeRow): Promise<ChequePartyPosting | null> {
  if (cheque.partyAccountId) {
    const partyType = cheque.partyType || 'customer';
    return {
      accountId: cheque.partyAccountId,
      detailedType: partyType,
      detailedId: partyType === 'other' ? null : cheque.partyId,
      detailedName: cheque.partyName,
    };
  }
  const legacy = cheque.type === 'received'
    ? await AccountMappingService.getTradeReceivablesAccount(tx)
    : await AccountMappingService.getTradePayablesAccount(tx);
  if (!legacy) return null;
  return {
    accountId: legacy.id,
    detailedType: cheque.type === 'received' ? 'customer' : 'supplier',
    detailedId: cheque.partyId,
    detailedName: cheque.partyName,
  };
}

export function requireChequePartyAccount(accountId: number | null, partyLabel: string): number {
  if (!accountId) {
    throw new ValidationError(`سرفصل طرف حساب چک (${partyLabel}) در کدینگ یافت نشد؛ ابتدا تنظیمات حسابداری را تکمیل کنید.`);
  }
  return accountId;
}

export interface LegacyChequePartyEntry {
  id: number;
  chequeNumber: string;
  type: string;
  partyType: string;
  partyName: string;
  amount: string;
  issueDate: string;
}

/**
 * چک‌های پیش از v9.0.74 که سندشان با نوع طرف حسابشان نمی‌خواند: چک دریافتی از غیر مشتری (در دریافتنی تجاری با تفصیلی
 * مشتری) و چک پرداختی به غیر تأمین‌کننده (در پرداختنی تجاری با تفصیلی تأمین‌کننده). بازنویسی نمی‌شوند؛ فهرست می‌شوند تا
 * حسابدار سند اصلاحی دستی ثبت کند.
 */
export async function findLegacyChequePartyMismatches(): Promise<LegacyChequePartyEntry[]> {
  const res = await orm.execute(sql`
    SELECT id, cheque_number, type, COALESCE(party_type, 'customer') AS party_type, party_name, amount::text AS amount,
           issue_date::text AS issue_date
      FROM cheques
     WHERE is_deleted = 0 AND party_account_id IS NULL AND voucher_id IS NOT NULL
       AND ((type = 'received' AND COALESCE(party_type, 'customer') <> 'customer')
         OR (type = 'paid' AND COALESCE(party_type, 'customer') <> 'supplier'))
     ORDER BY issue_date, id`);
  return (res.rows as Array<Record<string, unknown>>).map(r => ({
    id: Number(r.id),
    chequeNumber: String(r.cheque_number ?? ''),
    type: String(r.type ?? ''),
    partyType: String(r.party_type ?? ''),
    partyName: String(r.party_name ?? ''),
    amount: String(r.amount ?? '0'),
    issueDate: String(r.issue_date ?? '').slice(0, 10),
  }));
}

const PARTY_LABEL: Record<string, string> = { customer: 'مشتری', supplier: 'تأمین‌کننده', personnel: 'پرسنل', other: 'متفرقه' };

export function buildLegacyChequePartyHealthTest(entries: LegacyChequePartyEntry[]): HealthCheckTestResult {
  return {
    id: 'cheque_party_account_legacy',
    category: 'treasury',
    title: 'چک‌های پیشین که سندشان با نوع طرف حساب نمی‌خواند',
    description: 'پیش از نسخه ۹.۰.۷۴ سند چک دریافتی همیشه در دریافتنی تجاری با تفصیلی مشتری و سند چک پرداختی همیشه در پرداختنی تجاری با تفصیلی تأمین‌کننده ثبت می‌شد؛ چک پرسنل یا متفرقه روی مشتری یا تأمین‌کننده هم‌شناسه نشسته است. این اسناد بازنویسی نمی‌شوند',
    status: entries.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: entries.length,
    message: entries.length === 0
      ? 'سند همه چک‌ها با نوع طرف حسابشان می‌خواند.'
      : `${entries.length} چک پیشین در حساب طرف حسابی جز نوع خودش ثبت شده است؛ سند اصلاحی دستی ثبت کنید.`,
    items: entries.map(e => ({
      id: `cheque-${e.id}`,
      code: `چک ${e.chequeNumber}`,
      title: `${e.type === 'received' ? 'چک دریافتی از' : 'چک پرداختی به'} ${PARTY_LABEL[e.partyType] ?? e.partyType} — ${e.partyName}`,
      subtitle: `تاریخ صدور: ${isoToJalaliDate(e.issueDate) || e.issueDate}`,
      amount: fin(e.amount).toNumber(),
      date: e.issueDate,
      linkType: 'cheque' as const,
      linkId: e.id,
      details: e.type === 'received'
        ? 'در دریافتنی تجاری با تفصیلی مشتری ثبت شده است (TD-497).'
        : 'در پرداختنی تجاری با تفصیلی تأمین‌کننده ثبت شده است (TD-497).',
    })),
    metrics: { legacyChequePartyMismatches: entries.length },
  };
}
