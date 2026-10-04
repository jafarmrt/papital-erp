import { sql, type SQL } from 'drizzle-orm';
import { journalVoucherItems, journalVouchers } from '../../db/schema.js';

/**
 * v8.0.16 (TD-260): ارز و مبلغ گزارشی ردیف سند حسابداری — یک قاعده برای تراز آزمایشی، کارت حساب و صورت‌حساب طرف‌حساب.
 *
 * - ارز ردیف: ارز خود ردیف، وگرنه ارز سند، وگرنه ریال.
 * - نمای «همه ارزها» (ارز خالی یا 'all'): ردیف ریالی با مبلغ خودش و ردیف ارزی با نرخ همان ردیف به ریال، گرد به ریال
 *   (V6.0.21 تراز آزمایشی). پیش‌تر کارت حساب و صورت‌حساب طرف‌حساب مبلغ خام ردیف ارزی را با ریال جمع می‌زدند (۲ دلار = ۲ ریال).
 * - نمای یک ارز: فقط ردیف‌های همان ارز، با مبلغ خودشان.
 */
export const voucherItemCurrencySql = sql<string>`UPPER(COALESCE(NULLIF(${journalVoucherItems.currency}, ''), NULLIF(${journalVouchers.currency}, ''), 'IRR'))`;

export const voucherItemRateSql = sql<string>`COALESCE(NULLIF(${journalVoucherItems.exchangeRate}, 0), 1)`;

export function isAllCurrenciesView(currency?: string | null): boolean {
  return !currency || currency === 'all';
}

/** مبلغ گزارشی ستون بدهکار یا بستانکار ردیف در نمای داده‌شده */
export function voucherItemReportAmountSql(
  column: typeof journalVoucherItems.debit | typeof journalVoucherItems.credit,
  currency?: string | null,
): SQL<string> {
  if (!isAllCurrenciesView(currency)) return sql<string>`${column}`;
  return sql<string>`(CASE WHEN ${voucherItemCurrencySql} = 'IRR' THEN ${column} ELSE ROUND(${column} * ${voucherItemRateSql}, 0) END)`;
}

/** شرط ارز نمای یک ارز (ارز ردیف)؛ در نمای همه ارزها شرطی نیست */
export function voucherItemCurrencyCondition(currency?: string | null): SQL | undefined {
  return isAllCurrenciesView(currency) ? undefined : sql`${voucherItemCurrencySql} = ${String(currency).toUpperCase()}`;
}

