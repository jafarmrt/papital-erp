/**
 * v10.0.255 (TD-915 / TD-924، تصمیم ت۵ الف بازبینی فاز ۵): مانده طرف حساب فقط روی حساب‌های دائم است. ردیف حساب موقت
 * (درآمد، هزینه، بهای تمام‌شده) تفصیلی طرف حساب دارد ولی طلب یا بدهی او نیست: درآمد کالای اهدایی (۵۲۰۴) با تفصیلی
 * تأمین‌کننده صورت‌حساب او را پس از پرداخت کامل منفی می‌کرد و هزینه حقوق (۶۰۰۲ / ۶۰۰۳) با تفصیلی پرسنل صورت‌حساب فیش
 * پرداخت‌شده را «بدهکار» نشان می‌داد. صورت‌حساب طرف حساب، کارت حساب طرف حساب و نگهبان حذف همین قاعده را می‌خوانند؛
 * ردیف‌های موقت جدا (`temporaryRows`) و بیرون از مانده می‌آیند.
 */
import type { ForeignAmountOrigin } from '../../types/accounting.types';

/** نوع حساب‌هایی که در بستن سال صفر می‌شوند (حساب موقت) */
export const TEMPORARY_ACCOUNT_TYPES = ['revenue', 'expense', 'cost_of_sales'] as const;

export function isTemporaryAccountType(accountType: string | null | undefined): boolean {
  return (TEMPORARY_ACCOUNT_TYPES as readonly string[]).includes(String(accountType ?? ''));
}

export interface PartyTemporaryRow extends ForeignAmountOrigin {
  voucherId: number;
  voucherNumber: number;
  date: string;
  description: string;
  accountCode: string;
  accountName: string;
  currency: string;
  debit: number;
  credit: number;
}

/** ردیف‌های حساب موقتِ طرف حساب در بازه گزارش؛ در مانده و جمع گردش صورت‌حساب نیستند */
export interface PartyTemporaryRows {
  items: PartyTemporaryRow[];
  totalDebit: number;
  totalCredit: number;
}

export const PARTY_TEMPORARY_ROWS_TITLE = 'گردش حساب‌های موقت (درآمد و هزینه)';
export const PARTY_TEMPORARY_ROWS_NOTE = 'این ردیف‌ها تفصیلی همین طرف حساب را دارند ولی طلب یا بدهی او نیستند و در مانده حساب شمرده نمی‌شوند.';

export function partyTemporaryRowsOf(value: { temporaryRows?: PartyTemporaryRows | null } | null | undefined): PartyTemporaryRow[] {
  return Array.isArray(value?.temporaryRows?.items) ? value.temporaryRows.items : [];
}
